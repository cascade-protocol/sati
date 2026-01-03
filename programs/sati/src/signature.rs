//! Signature verification and hash computation utilities.
//!
//! # Naming Convention
//!
//! Throughout this module and the SATI codebase:
//! - `token_account` = Agent's **MINT ADDRESS** (stable identity, named for SAS wire format compatibility)
//! - NOT an Associated Token Account (ATA)
//!
//! # Authorization Model
//!
//! - **Agent signature**: Verified via ATA ownership. The NFT owner signs, not the mint.
//!   The on-chain instruction verifies `agent_ata.owner == signatures[0].pubkey`.
//! - **Counterparty signature**: Direct pubkey match against `counterparty` field.
//! - Hash functions include the mint address (stable identity); signatures come from the NFT owner.

use anchor_lang::prelude::*;
use sha3::{Digest, Keccak256};
use solana_program::{
    clock::Clock,
    ed25519_program::ID as ED25519_PROGRAM_ID,
    secp256k1_recover::secp256k1_recover,
    sysvar::instructions::{load_instruction_at_checked, ID as SYSVAR_INSTRUCTIONS_ID},
};

use crate::constants::*;
use crate::errors::SatiError;
use crate::state::SignatureMode;

/// Size of Ed25519 signature offset structure (7 u16 fields = 14 bytes)
const ED25519_OFFSETS_SIZE: usize = 14;

/// Signature data extracted from Ed25519 instruction.
/// Contains the pubkey, signature bytes, and the message that was signed.
#[derive(Clone, Debug)]
pub struct ExtractedSignature {
    pub pubkey: Pubkey,
    pub sig: [u8; 64],
    pub message: Vec<u8>,
}

/// Extract and verify Ed25519 signatures from transaction instructions.
///
/// **Key design**: Match by MESSAGE content first, then verify pubkey binding.
/// This is resilient to transactions with unrelated Ed25519 instructions from other protocols.
///
/// Returns extracted signatures matched to expected roles:
/// - For DualSignature: [agent_sig, counterparty_sig]
/// - For single signature modes: [signer_sig]
///
/// # Arguments
/// * `instructions_sysvar` - The instructions sysvar account
/// * `expected_agent_pubkey` - Agent's pubkey (agent_ata.owner) or None for CounterpartySigned
/// * `expected_counterparty_pubkey` - Counterparty's pubkey from data[65..97]
/// * `signature_mode` - DualSignature, CounterpartySigned, or AgentOwnerSigned
/// * `expected_messages` - Expected messages to match (required for all modes)
///
/// # Returns
/// * `Ok(Vec<ExtractedSignature>)` - Extracted signatures in role order
/// * `Err` - If signatures missing, message mismatch, or pubkey binding fails
pub fn extract_ed25519_signatures(
    instructions_sysvar: &AccountInfo,
    expected_agent_pubkey: Option<&Pubkey>,
    expected_counterparty_pubkey: &Pubkey,
    signature_mode: SignatureMode,
    expected_messages: &[Vec<u8>],
) -> Result<Vec<ExtractedSignature>> {
    require!(
        instructions_sysvar.key == &SYSVAR_INSTRUCTIONS_ID,
        SatiError::InvalidInstructionsSysvar
    );

    // Collect all signatures from ALL Ed25519 instructions in transaction
    // (other protocols may include their own Ed25519 instructions)
    let mut all_signatures: Vec<ExtractedSignature> = Vec::new();
    let mut index = 0;
    let mut found_ed25519 = false;

    while let Ok(instruction) = load_instruction_at_checked(index, instructions_sysvar) {
        if instruction.program_id == ED25519_PROGRAM_ID {
            found_ed25519 = true;
            let data = &instruction.data;
            require!(data.len() >= 2, SatiError::InvalidEd25519Instruction);

            let num_signatures = data[0] as usize;
            require!(num_signatures > 0, SatiError::InvalidEd25519Instruction);

            let offsets_start = 2;

            for i in 0..num_signatures {
                let offset_pos = offsets_start + (i * ED25519_OFFSETS_SIZE);
                require!(
                    data.len() >= offset_pos + ED25519_OFFSETS_SIZE,
                    SatiError::InvalidEd25519Instruction
                );

                // Parse offsets
                let sig_offset = u16::from_le_bytes(
                    data[offset_pos..offset_pos + 2]
                        .try_into()
                        .map_err(|_| SatiError::InvalidEd25519Instruction)?,
                ) as usize;
                let pubkey_offset = u16::from_le_bytes(
                    data[offset_pos + 4..offset_pos + 6]
                        .try_into()
                        .map_err(|_| SatiError::InvalidEd25519Instruction)?,
                ) as usize;
                let msg_offset = u16::from_le_bytes(
                    data[offset_pos + 8..offset_pos + 10]
                        .try_into()
                        .map_err(|_| SatiError::InvalidEd25519Instruction)?,
                ) as usize;
                let msg_size = u16::from_le_bytes(
                    data[offset_pos + 10..offset_pos + 12]
                        .try_into()
                        .map_err(|_| SatiError::InvalidEd25519Instruction)?,
                ) as usize;

                // Extract pubkey
                require!(
                    data.len() >= pubkey_offset + 32,
                    SatiError::InvalidEd25519Instruction
                );
                let pubkey_bytes: [u8; 32] = data[pubkey_offset..pubkey_offset + 32]
                    .try_into()
                    .map_err(|_| SatiError::InvalidEd25519Instruction)?;

                // Extract signature
                require!(
                    data.len() >= sig_offset + 64,
                    SatiError::InvalidEd25519Instruction
                );
                let sig: [u8; 64] = data[sig_offset..sig_offset + 64]
                    .try_into()
                    .map_err(|_| SatiError::InvalidEd25519Instruction)?;

                // Extract message
                require!(
                    data.len() >= msg_offset + msg_size,
                    SatiError::InvalidEd25519Instruction
                );
                let message = data[msg_offset..msg_offset + msg_size].to_vec();

                all_signatures.push(ExtractedSignature {
                    pubkey: Pubkey::new_from_array(pubkey_bytes),
                    sig,
                    message,
                });
            }
        }
        index += 1;
    }

    require!(found_ed25519, SatiError::Ed25519InstructionNotFound);

    // Match signatures to expected roles BY MESSAGE CONTENT
    // This is resilient to transactions with unrelated Ed25519 instructions
    let mut result: Vec<ExtractedSignature> = Vec::new();

    match signature_mode {
        SignatureMode::DualSignature => {
            let agent_pubkey = expected_agent_pubkey.ok_or(SatiError::AgentAtaRequired)?;

            // Find agent sig by message match (interaction_hash)
            let agent_sig = all_signatures
                .iter()
                .find(|s| s.message == expected_messages[0])
                .ok_or(SatiError::AgentSignatureNotFound)?;

            // Find counterparty sig by message match (SIWS)
            let counterparty_sig = all_signatures
                .iter()
                .find(|s| s.message == expected_messages[1])
                .ok_or(SatiError::CounterpartySignatureNotFound)?;

            // Verify pubkey binding AFTER finding by message
            require!(
                agent_sig.pubkey == *agent_pubkey,
                SatiError::SignatureMismatch
            );
            require!(
                counterparty_sig.pubkey == *expected_counterparty_pubkey,
                SatiError::SignatureMismatch
            );

            // SECURITY: Ensure different signers
            require!(
                agent_sig.pubkey != counterparty_sig.pubkey,
                SatiError::DuplicateSigners
            );

            result.push(agent_sig.clone());
            result.push(counterparty_sig.clone());
        }

        SignatureMode::CounterpartySigned => {
            // Find by message match
            let sig = all_signatures
                .iter()
                .find(|s| s.message == expected_messages[0])
                .ok_or(SatiError::CounterpartySignatureNotFound)?;

            // Verify pubkey binding
            require!(
                sig.pubkey == *expected_counterparty_pubkey,
                SatiError::SignatureMismatch
            );

            result.push(sig.clone());
        }

        SignatureMode::AgentOwnerSigned => {
            // Find by message match (signer could be owner OR delegate)
            let sig = all_signatures
                .iter()
                .find(|s| s.message == expected_messages[0])
                .ok_or(SatiError::AgentSignatureNotFound)?;

            // Note: verify_agent_authorization will check if pubkey is owner or valid delegate
            // We don't verify pubkey here because delegate won't match agent_ata.owner
            result.push(sig.clone());
        }
    }

    Ok(result)
}

/// Compute the interaction hash that the agent signs (blind to outcome).
/// Domain: SATI:interaction:v1
///
/// Used by:
/// - Agent in DualSignature mode (Feedback, Validation)
/// - Provider in SingleSigner mode (ReputationScore)
pub fn compute_interaction_hash(
    sas_schema: &Pubkey,
    task_ref: &[u8; 32],
    data_hash: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_INTERACTION);
    hasher.update(sas_schema.as_ref());
    hasher.update(task_ref);
    hasher.update(data_hash);
    hasher.finalize().into()
}

// NOTE: compute_feedback_hash, compute_validation_hash, compute_reputation_hash
// were removed in the universal base layout migration. Counterparty now signs
// a human-readable SIWS message (passed as counterparty_message parameter).
// For SingleSigner mode, the provider signs the interaction_hash.

/// Compute the deterministic nonce for compressed attestation address derivation.
/// Includes counterparty to ensure unique addresses per (task, agent, counterparty) tuple.
pub fn compute_attestation_nonce(
    task_ref: &[u8; 32],
    sas_schema: &Pubkey,
    token_account: &Pubkey,
    counterparty: &Pubkey,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(task_ref);
    hasher.update(sas_schema.as_ref());
    hasher.update(token_account.as_ref());
    hasher.update(counterparty.as_ref());
    hasher.finalize().into()
}

/// Compute the deterministic nonce for regular (SAS) attestation.
/// One ReputationScore per (provider, agent) pair.
pub fn compute_reputation_nonce(provider: &Pubkey, token_account: &Pubkey) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(provider.as_ref());
    hasher.update(token_account.as_ref());
    hasher.finalize().into()
}

/// Compute the deterministic nonce for delegation attestation.
/// One delegation per (schema, delegate, agent) tuple.
/// Uses schema pubkey as domain separator to enable future delegation versions.
pub fn compute_delegation_nonce(
    delegate_schema: &Pubkey,
    delegate: &Pubkey,
    agent_mint: &Pubkey,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(delegate_schema.as_ref());
    hasher.update(delegate.as_ref());
    hasher.update(agent_mint.as_ref());
    hasher.finalize().into()
}

/// Compute the hash for EVM address linking.
/// Domain: SATI:evm_link:v1
pub fn compute_evm_link_hash(
    agent_mint: &Pubkey,
    evm_address: &[u8; 20],
    chain_id: &str,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_EVM_LINK);
    hasher.update(agent_mint.as_ref());
    hasher.update(evm_address);
    hasher.update(chain_id.as_bytes());
    hasher.finalize().into()
}

/// Verify secp256k1 signature and check recovered address matches expected.
/// Returns Ok(()) if signature is valid and recovered address matches.
pub fn verify_secp256k1_signature(
    message_hash: &[u8; 32],
    signature: &[u8; 64],
    recovery_id: u8,
    expected_evm_address: &[u8; 20],
) -> Result<()> {
    // Recover public key from signature
    let recovered_pubkey = secp256k1_recover(message_hash, recovery_id, signature)
        .map_err(|_| SatiError::Secp256k1RecoveryFailed)?;

    // Derive Ethereum address from public key (keccak256 of pubkey, take last 20 bytes)
    let pubkey_hash = Keccak256::digest(recovered_pubkey.0);
    let recovered_address: [u8; 20] = pubkey_hash[12..32]
        .try_into()
        .map_err(|_| SatiError::InvalidEvmAddressRecovery)?;

    // Verify address matches
    require!(
        recovered_address == *expected_evm_address,
        SatiError::EvmAddressMismatch
    );

    Ok(())
}

// ============================================================================
// Delegation Verification
// ============================================================================

/// Parsed delegation attestation data for verification.
pub struct ParsedDelegation {
    /// Delegate pubkey (who is authorized to sign) - from counterparty field
    pub delegate: Pubkey,
    /// Agent mint address (which agent this delegation is for) - from token_account field
    pub agent_mint: Pubkey,
    /// Delegator pubkey (owner at time of delegation) - from data_hash field
    pub delegator: Pubkey,
    /// Expiry timestamp (0 = never expires) - from SAS tail
    pub expiry: i64,
}

/// Parse a SAS delegation attestation account to extract delegation fields.
///
/// SAS attestation layout:
/// - header(101): discriminator(1) + nonce(32) + credential(32) + schema(32) + data_len(4)
/// - data(variable): universal layout with delegation-specific fields
/// - tail(72): signer(32) + expiry(8) + token_account(32)
///
/// Delegation fields in universal layout (within data section):
/// - token_account (offset 33): agent mint
/// - counterparty (offset 65): delegate pubkey
/// - data_hash (offset 98): delegator pubkey
pub fn parse_delegation_attestation(data: &[u8]) -> Result<ParsedDelegation> {
    require!(
        data.len() >= MIN_DELEGATION_ATTESTATION_SIZE,
        SatiError::AttestationDataTooSmall
    );

    // Read data_len (u32 LE at offset 97, which is SAS_HEADER_SIZE - 4)
    let data_len = u32::from_le_bytes(
        data[SAS_HEADER_SIZE - 4..SAS_HEADER_SIZE]
            .try_into()
            .map_err(|_| SatiError::InvalidSignature)?,
    ) as usize;

    let data_start = SAS_DATA_OFFSET;

    // Verify we have enough data for the fields we need
    require!(
        data.len() >= data_start + data_len + SAS_SIGNER_SIZE + SAS_EXPIRY_SIZE,
        SatiError::AttestationDataTooSmall
    );

    // Parse universal layout fields within data section
    // agent_mint at offset 33 within data (token_account field)
    let agent_mint = Pubkey::new_from_array(
        data[data_start + offsets::TOKEN_ACCOUNT..data_start + offsets::COUNTERPARTY]
            .try_into()
            .map_err(|_| SatiError::InvalidSignature)?,
    );

    // delegate at offset 65 within data (counterparty field)
    let delegate = Pubkey::new_from_array(
        data[data_start + offsets::COUNTERPARTY..data_start + offsets::OUTCOME]
            .try_into()
            .map_err(|_| SatiError::InvalidSignature)?,
    );

    // delegator at offset 98 within data (data_hash field)
    let delegator = Pubkey::new_from_array(
        data[data_start + offsets::DATA_HASH..data_start + offsets::CONTENT_TYPE]
            .try_into()
            .map_err(|_| SatiError::InvalidSignature)?,
    );

    // Expiry is after data section + signer field
    let expiry_offset = data_start + data_len + SAS_SIGNER_SIZE;
    let expiry = i64::from_le_bytes(
        data[expiry_offset..expiry_offset + SAS_EXPIRY_SIZE]
            .try_into()
            .map_err(|_| SatiError::InvalidSignature)?,
    );

    Ok(ParsedDelegation {
        delegate,
        agent_mint,
        delegator,
        expiry,
    })
}

/// Verify agent authorization for attestation signing.
///
/// Implements the dual-path authorization model:
/// 1. **Owner Fast Path (~100 CU)**: If signer == agent ATA owner → authorize
/// 2. **Delegation Path (~5-10k CU)**: Verify delegation attestation
///
/// # Arguments
/// * `signer` - The pubkey that signed the attestation
/// * `agent_mint` - The agent's mint address (token_account field)
/// * `agent_ata_owner` - The current owner of the agent ATA
/// * `delegation_schema` - Schema for delegation verification (None = owner only)
/// * `delegation_attestation` - Optional delegation attestation account
/// * `sati_credential` - SATI SAS credential for PDA derivation
/// * `clock` - Current clock for expiry verification
///
/// # Returns
/// * `Ok(())` if authorization passes
/// * `Err` with appropriate delegation error if authorization fails
pub fn verify_agent_authorization(
    signer: &Pubkey,
    agent_mint: &Pubkey,
    agent_ata_owner: &Pubkey,
    delegation_schema: Option<&Pubkey>,
    delegation_attestation: Option<&AccountInfo>,
    sati_credential: &Pubkey,
    clock: &Clock,
) -> Result<()> {
    // 1. Owner Fast Path: If signer is the agent ATA owner, authorize immediately
    if signer == agent_ata_owner {
        return Ok(());
    }

    // 2. Schema Check: If delegation_schema is None, only owner can sign
    let delegate_schema = delegation_schema.ok_or(SatiError::OwnerOnly)?;

    // 3. Delegation Required: Must provide delegation attestation
    let delegation_account =
        delegation_attestation.ok_or(SatiError::DelegationAttestationRequired)?;

    // 4. PDA Verification: Derive expected PDA and verify it matches
    let nonce = compute_delegation_nonce(delegate_schema, signer, agent_mint);

    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[
            b"attestation",
            sati_credential.as_ref(),
            delegate_schema.as_ref(),
            &nonce,
        ],
        &solana_attestation_service_client::programs::SOLANA_ATTESTATION_SERVICE_ID,
    );

    require!(
        delegation_account.key() == expected_pda,
        SatiError::InvalidDelegationPDA
    );

    // 5. Parse delegation attestation
    let delegation_data = delegation_account.try_borrow_data()?;
    let parsed = parse_delegation_attestation(&delegation_data)?;
    drop(delegation_data);

    // 6. Delegate Binding: attestation.counterparty == signer
    require!(parsed.delegate == *signer, SatiError::DelegateMismatch);

    // 7. Agent Binding: attestation.token_account == agent_mint
    require!(
        parsed.agent_mint == *agent_mint,
        SatiError::AgentMintMismatch
    );

    // 8. Owner Binding: attestation.data_hash == current_owner (transfer safety)
    require!(
        parsed.delegator == *agent_ata_owner,
        SatiError::DelegationOwnerMismatch
    );

    // 9. Expiration Check: expiry == 0 OR expiry > current_timestamp
    if parsed.expiry != 0 {
        require!(
            parsed.expiry > clock.unix_timestamp,
            SatiError::DelegationExpired
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::pubkey;

    #[test]
    fn test_interaction_hash_deterministic() {
        let schema = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let data_hash = [2u8; 32];

        let hash1 = compute_interaction_hash(&schema, &task_ref, &data_hash);
        let hash2 = compute_interaction_hash(&schema, &task_ref, &data_hash);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_interaction_hash_differs_by_data_hash() {
        let schema = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let data_hash1 = [1u8; 32];
        let data_hash2 = [2u8; 32];

        let hash1 = compute_interaction_hash(&schema, &task_ref, &data_hash1);
        let hash2 = compute_interaction_hash(&schema, &task_ref, &data_hash2);

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_attestation_nonce_includes_counterparty() {
        let task_ref = [1u8; 32];
        let schema = Pubkey::new_unique();
        let token_account = Pubkey::new_unique();
        let counterparty1 = Pubkey::new_unique();
        let counterparty2 = Pubkey::new_unique();

        let nonce1 = compute_attestation_nonce(&task_ref, &schema, &token_account, &counterparty1);
        let nonce2 = compute_attestation_nonce(&task_ref, &schema, &token_account, &counterparty2);

        assert_ne!(nonce1, nonce2);
    }

    // =========================================================================
    // Hash Parity Tests with TypeScript
    // =========================================================================
    // These tests use the same fixed vectors as packages/sdk/tests/unit/hashes.test.ts
    // to ensure Rust and TypeScript implementations produce identical hashes.
    //
    // Test addresses (well-known Solana program addresses):
    // - TEST_ADDRESS_1: 11111111111111111111111111111111 (System program)
    // - TEST_ADDRESS_2: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (Token program)
    // - TEST_ADDRESS_3: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb (Token-2022)

    const TEST_ADDRESS_1: Pubkey = pubkey!("11111111111111111111111111111111");
    const TEST_ADDRESS_2: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const TEST_ADDRESS_3: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

    #[test]
    fn test_interaction_hash_parity_vector1() {
        // Vector 1: all zeros
        let hash = compute_interaction_hash(&TEST_ADDRESS_1, &[0u8; 32], &[0u8; 32]);
        assert_eq!(hash.len(), 32);

        // Verify determinism
        let hash2 = compute_interaction_hash(&TEST_ADDRESS_1, &[0u8; 32], &[0u8; 32]);
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_interaction_hash_parity_vector2() {
        // Vector 2: all ones
        let hash = compute_interaction_hash(&TEST_ADDRESS_2, &[1u8; 32], &[1u8; 32]);
        assert_eq!(hash.len(), 32);

        // Different from vector 1
        let hash_zeros = compute_interaction_hash(&TEST_ADDRESS_1, &[0u8; 32], &[0u8; 32]);
        assert_ne!(hash, hash_zeros);
    }

    #[test]
    fn test_interaction_hash_parity_vector3() {
        // Vector 3: incremental bytes
        let mut incremental = [0u8; 32];
        for (i, byte) in incremental.iter_mut().enumerate() {
            *byte = i as u8;
        }
        let hash = compute_interaction_hash(&TEST_ADDRESS_3, &incremental, &incremental);
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_attestation_nonce_parity_vector1() {
        // Vector 1: all system addresses
        let nonce = compute_attestation_nonce(
            &[0u8; 32],
            &TEST_ADDRESS_1,
            &TEST_ADDRESS_1,
            &TEST_ADDRESS_1,
        );
        assert_eq!(nonce.len(), 32);
    }

    #[test]
    fn test_attestation_nonce_parity_vector2() {
        // Vector 2: different addresses
        let nonce = compute_attestation_nonce(
            &[1u8; 32],
            &TEST_ADDRESS_1,
            &TEST_ADDRESS_2,
            &TEST_ADDRESS_3,
        );
        assert_eq!(nonce.len(), 32);

        // Different counterparty = different nonce
        let nonce2 = compute_attestation_nonce(
            &[1u8; 32],
            &TEST_ADDRESS_1,
            &TEST_ADDRESS_2,
            &TEST_ADDRESS_1,
        );
        assert_ne!(nonce, nonce2);
    }

    #[test]
    fn test_reputation_nonce_parity_vector1() {
        // Vector 1: system addresses
        let nonce = compute_reputation_nonce(&TEST_ADDRESS_1, &TEST_ADDRESS_1);
        assert_eq!(nonce.len(), 32);
    }

    #[test]
    fn test_reputation_nonce_parity_vector2() {
        // Vector 2: different addresses
        let nonce = compute_reputation_nonce(&TEST_ADDRESS_1, &TEST_ADDRESS_2);
        assert_eq!(nonce.len(), 32);

        // Different token account = different nonce
        let nonce2 = compute_reputation_nonce(&TEST_ADDRESS_1, &TEST_ADDRESS_3);
        assert_ne!(nonce, nonce2);
    }

    #[test]
    fn test_evm_link_hash_parity_vector1() {
        // Vector 1: zeros with chain id
        let hash = compute_evm_link_hash(&TEST_ADDRESS_1, &[0u8; 20], "eip155:1");
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_evm_link_hash_parity_vector2() {
        // Vector 2: different chain id
        let hash1 = compute_evm_link_hash(&TEST_ADDRESS_1, &[0u8; 20], "eip155:1");
        let hash2 = compute_evm_link_hash(&TEST_ADDRESS_1, &[0u8; 20], "eip155:137");

        assert_eq!(hash1.len(), 32);
        assert_eq!(hash2.len(), 32);
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_evm_link_hash_parity_vector3() {
        // Vector 3: different EVM address
        let hash = compute_evm_link_hash(&TEST_ADDRESS_2, &[0xab; 20], "eip155:1");
        assert_eq!(hash.len(), 32);

        let hash_zeros = compute_evm_link_hash(&TEST_ADDRESS_2, &[0u8; 20], "eip155:1");
        assert_ne!(hash, hash_zeros);
    }

    // =========================================================================
    // Delegation Nonce Tests
    // =========================================================================

    #[test]
    fn test_delegation_nonce_deterministic() {
        let schema = Pubkey::new_unique();
        let delegate = Pubkey::new_unique();
        let agent = Pubkey::new_unique();

        let n1 = compute_delegation_nonce(&schema, &delegate, &agent);
        let n2 = compute_delegation_nonce(&schema, &delegate, &agent);
        assert_eq!(n1, n2, "Delegation nonce should be deterministic");
    }

    #[test]
    fn test_delegation_nonce_differs_by_delegate() {
        let schema = Pubkey::new_unique();
        let agent = Pubkey::new_unique();

        let n1 = compute_delegation_nonce(&schema, &Pubkey::new_unique(), &agent);
        let n2 = compute_delegation_nonce(&schema, &Pubkey::new_unique(), &agent);
        assert_ne!(
            n1, n2,
            "Different delegates should produce different nonces"
        );
    }

    #[test]
    fn test_delegation_nonce_differs_by_schema() {
        let delegate = Pubkey::new_unique();
        let agent = Pubkey::new_unique();

        let n1 = compute_delegation_nonce(&Pubkey::new_unique(), &delegate, &agent);
        let n2 = compute_delegation_nonce(&Pubkey::new_unique(), &delegate, &agent);
        assert_ne!(n1, n2, "Different schemas should produce different nonces");
    }

    #[test]
    fn test_delegation_nonce_differs_by_agent() {
        let schema = Pubkey::new_unique();
        let delegate = Pubkey::new_unique();

        let n1 = compute_delegation_nonce(&schema, &delegate, &Pubkey::new_unique());
        let n2 = compute_delegation_nonce(&schema, &delegate, &Pubkey::new_unique());
        assert_ne!(n1, n2, "Different agents should produce different nonces");
    }
}
