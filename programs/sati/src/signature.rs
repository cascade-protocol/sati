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
    ed25519_program::ID as ED25519_PROGRAM_ID,
    secp256k1_recover::secp256k1_recover,
    sysvar::instructions::{load_instruction_at_checked, ID as SYSVAR_INSTRUCTIONS_ID},
};

use crate::constants::*;
use crate::errors::SatiError;
use crate::state::SignatureData;

/// Size of Ed25519 signature offset structure (7 u16 fields = 14 bytes)
const ED25519_OFFSETS_SIZE: usize = 14;

/// Verify Ed25519 signatures by checking the transaction's Ed25519 program instructions.
/// The calling transaction must include Ed25519 program instructions BEFORE the SATI instruction.
///
/// # Arguments
/// * `instructions_sysvar` - The instructions sysvar account
/// * `expected_signatures` - Array of expected signature data (pubkey + sig)
/// * `expected_messages` - Optional messages to verify for each signature.
///   - Some(msg) = verify the signed message matches this value (e.g., agent's interaction_hash)
///   - None = only verify signature exists, don't check message content (e.g., counterparty's SIWS)
///
/// For DualSignature mode:
/// - signatures[0] (agent): Pass Some(interaction_hash) to verify they signed the correct hash
/// - signatures[1] (counterparty): Pass None since Ed25519 precompile already verified the sig
///
/// This approach saves ~300 bytes by not requiring counterparty_message in instruction params.
pub fn verify_ed25519_signatures(
    instructions_sysvar: &AccountInfo,
    expected_signatures: &[SignatureData],
    expected_messages: &[Option<Vec<u8>>],
) -> Result<()> {
    require!(
        instructions_sysvar.key == &SYSVAR_INSTRUCTIONS_ID,
        SatiError::InvalidInstructionsSysvar
    );

    require!(
        expected_signatures.len() == expected_messages.len(),
        SatiError::InvalidSignatureCount
    );

    // SECURITY: For dual signatures, ensure pubkeys are distinct
    // Prevents same signer from signing both messages
    if expected_signatures.len() == 2 {
        require!(
            expected_signatures[0].pubkey != expected_signatures[1].pubkey,
            SatiError::DuplicateSigners
        );
    }

    let mut verified_count = 0;
    let mut index = 0;

    // Iterate through all instructions in the transaction
    while let Ok(instruction) = load_instruction_at_checked(index, instructions_sysvar) {
        if instruction.program_id == ED25519_PROGRAM_ID {
            // Parse Ed25519 instruction format:
            // [0]: number of signatures
            // [1]: padding
            // [2..2+14*n]: offset structures (14 bytes each)
            // [remainder]: actual data (signatures, pubkeys, messages)
            let data = &instruction.data;
            require!(data.len() >= 2, SatiError::InvalidEd25519Instruction);

            let num_signatures = data[0] as usize;
            require!(num_signatures > 0, SatiError::InvalidEd25519Instruction);

            let offsets_start = 2; // After num_signatures byte and padding

            for i in 0..num_signatures {
                let offset_pos = offsets_start + (i * ED25519_OFFSETS_SIZE);
                require!(
                    data.len() >= offset_pos + ED25519_OFFSETS_SIZE,
                    SatiError::InvalidEd25519Instruction
                );

                // Parse offsets from the structure
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

                // Extract and verify pubkey
                require!(
                    data.len() >= pubkey_offset + 32,
                    SatiError::InvalidEd25519Instruction
                );
                let pubkey_bytes: [u8; 32] = data[pubkey_offset..pubkey_offset + 32]
                    .try_into()
                    .map_err(|_| SatiError::InvalidEd25519Instruction)?;
                let pubkey = Pubkey::new_from_array(pubkey_bytes);

                // Check if this pubkey matches any expected signature
                for (j, expected) in expected_signatures.iter().enumerate() {
                    if expected.pubkey == pubkey {
                        // Verify signature matches
                        require!(
                            data.len() >= sig_offset + 64,
                            SatiError::InvalidEd25519Instruction
                        );
                        let sig: [u8; 64] = data[sig_offset..sig_offset + 64]
                            .try_into()
                            .map_err(|_| SatiError::InvalidEd25519Instruction)?;
                        require!(sig == expected.sig, SatiError::SignatureMismatch);

                        // If expected message is provided, verify it matches
                        if let Some(expected_msg) = &expected_messages[j] {
                            require!(
                                data.len() >= msg_offset + msg_size,
                                SatiError::InvalidEd25519Instruction
                            );
                            let msg = &data[msg_offset..msg_offset + msg_size];
                            require!(
                                msg == expected_msg.as_slice(),
                                SatiError::MessageMismatch
                            );
                        }
                        // If expected_message is None, we only verify signature exists
                        // (Ed25519 precompile already verified sig against whatever message was signed)

                        verified_count += 1;
                    }
                }
            }
        }
        index += 1;
    }

    // Ensure all expected signatures were found and verified
    require!(
        verified_count == expected_signatures.len(),
        SatiError::MissingSignatures
    );

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
