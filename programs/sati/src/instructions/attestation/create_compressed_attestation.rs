use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{
        v1::CpiAccounts, v2::lowlevel::InstructionDataInvokeCpiWithReadOnly,
        InvokeLightSystemProgram, LightCpiInstruction,
    },
};
use solana_program::sysvar::instructions as instructions_sysvar;

use std::ops::Deref;

use crate::constants::*;
use crate::errors::SatiError;
use crate::events::AttestationCreated;
use crate::signature::{
    compute_attestation_nonce, compute_interaction_hash, extract_ed25519_signatures,
    verify_agent_authorization,
};
use crate::state::{CompressedAttestation, CreateParams, SchemaConfig, SignatureMode, StorageType};
use crate::ID;
use crate::LIGHT_CPI_SIGNER;

/// Accounts for create_compressed_attestation instruction (compressed storage)
#[event_cpi]
#[derive(Accounts)]
pub struct CreateCompressedAttestation<'info> {
    /// Payer for transaction fees
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Schema config PDA
    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
        constraint = schema_config.storage_type == StorageType::Compressed @ SatiError::StorageTypeMismatch,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    /// Instructions sysvar for Ed25519 signature verification
    /// CHECK: Verified in handler via address check
    #[account(address = instructions_sysvar::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    /// Agent's ATA that holds the NFT - proves signer owns the agent identity.
    /// Required for DualSignature and AgentOwnerSigned modes.
    /// Optional for CounterpartySigned mode (not validated).
    ///
    /// The mint must match token_account from attestation data (the agent's MINT address),
    /// amount must be >= 1, and owner must match signatures[0].pubkey.
    /// Note: token_account in data is the MINT address; this is the holder's ATA.
    pub agent_ata: Option<InterfaceAccount<'info, TokenAccount>>,

    /// Token-2022 program for ATA verification.
    /// Required when agent_ata is provided.
    pub token_program: Option<Interface<'info, TokenInterface>>,

    /// Delegation attestation (optional).
    /// Required when signer != agent ATA owner for AgentOwnerSigned mode.
    /// Must be a valid DelegateV1 SAS attestation proving the signer's delegation.
    /// CHECK: Validated in verify_agent_authorization
    pub delegation_attestation: Option<AccountInfo<'info>>,

    /// SATI SAS credential for delegation PDA derivation.
    /// Required when delegation_attestation is provided.
    /// CHECK: Used for PDA derivation
    pub sati_credential: Option<AccountInfo<'info>>,

    /// Clock sysvar for delegation expiry verification.
    /// Required when delegation_attestation is provided.
    pub clock: Option<Sysvar<'info, Clock>>,
    // Light Protocol accounts are passed via remaining_accounts
    // and parsed by CpiAccounts::new()
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateCompressedAttestation<'info>>,
    params: CreateParams,
) -> Result<()> {
    let schema_config = &ctx.accounts.schema_config;

    // 1. Verify data length
    require!(
        params.data.len() >= MIN_BASE_LAYOUT_SIZE,
        SatiError::AttestationDataTooSmall
    );
    require!(
        params.data.len() <= MAX_ATTESTATION_DATA_SIZE,
        SatiError::AttestationDataTooLarge
    );

    // 2b. Verify layout version
    let layout_version = params.data[offsets::LAYOUT_VERSION];
    require!(
        layout_version == CURRENT_LAYOUT_VERSION,
        SatiError::UnsupportedLayoutVersion
    );

    // 3. Parse base layout for signature binding
    // token_account stores the agent's MINT ADDRESS (stable identity),
    // NOT a wallet address. Authorization is verified via agent_ata account.
    let task_ref: [u8; 32] = params.data[offsets::TASK_REF..offsets::TOKEN_ACCOUNT]
        .try_into()
        .map_err(|_| SatiError::InvalidSignature)?;
    let token_account_bytes: [u8; 32] = params.data[offsets::TOKEN_ACCOUNT..offsets::COUNTERPARTY]
        .try_into()
        .map_err(|_| SatiError::InvalidSignature)?;
    let counterparty_bytes: [u8; 32] = params.data[offsets::COUNTERPARTY..offsets::OUTCOME]
        .try_into()
        .map_err(|_| SatiError::InvalidSignature)?;

    let token_account_pubkey = Pubkey::new_from_array(token_account_bytes);
    let counterparty_pubkey = Pubkey::new_from_array(counterparty_bytes);

    // 4. Self-attestation prevention
    require!(
        token_account_pubkey != counterparty_pubkey,
        SatiError::SelfAttestationNotAllowed
    );

    // 5. Determine expected pubkeys for signature extraction
    let expected_agent_pubkey = match schema_config.signature_mode {
        SignatureMode::DualSignature | SignatureMode::AgentOwnerSigned => {
            let agent_ata = ctx
                .accounts
                .agent_ata
                .as_ref()
                .ok_or(SatiError::AgentAtaRequired)?;
            require!(
                agent_ata.mint == token_account_pubkey,
                SatiError::AgentAtaMintMismatch
            );
            require!(agent_ata.amount >= 1, SatiError::AgentAtaEmpty);
            Some(agent_ata.owner)
        }
        SignatureMode::CounterpartySigned => None,
    };

    // 6. Validate universal base layout fields
    validate_universal_base(&params.data)?;

    // 7. Construct expected message hashes for signature verification
    let expected_messages = build_expected_messages(&params, schema_config, &task_ref)?;

    // 8. Extract and verify Ed25519 signatures
    let extracted_signatures = extract_ed25519_signatures(
        &ctx.accounts.instructions_sysvar,
        expected_agent_pubkey.as_ref(),
        &counterparty_pubkey,
        schema_config.signature_mode,
        &expected_messages,
    )?;

    // 9. Additional authorization for delegation (AgentOwnerSigned only)
    if schema_config.signature_mode == SignatureMode::AgentOwnerSigned {
        let agent_ata = ctx.accounts.agent_ata.as_ref().unwrap(); // Already validated above
        let signer_pubkey = &extracted_signatures[0].pubkey;

        // Get clock for delegation verification (only if not owner)
        let clock = if signer_pubkey != &agent_ata.owner {
            ctx.accounts
                .clock
                .as_ref()
                .ok_or(SatiError::DelegationAttestationRequired)?
                .deref()
        } else {
            &Clock::default()
        };

        let sati_credential = ctx
            .accounts
            .sati_credential
            .as_ref()
            .map(|c| c.key())
            .unwrap_or_default();

        // Verify agent authorization (owner fast path or delegation)
        verify_agent_authorization(
            signer_pubkey,
            &token_account_pubkey,
            &agent_ata.owner,
            schema_config.delegation_schema.as_ref(),
            ctx.accounts.delegation_attestation.as_ref(),
            &sati_credential,
            clock,
        )?;
    }

    // 10. Derive deterministic address
    let nonce = compute_attestation_nonce(
        &task_ref,
        &schema_config.sas_schema,
        &token_account_pubkey,
        &counterparty_pubkey,
    );

    // 11. Initialize Light Protocol CPI accounts
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    // 12. Get address tree pubkey from params
    let address_tree_pubkey = params
        .address_tree_info
        .get_tree_pubkey(&light_cpi_accounts)
        .map_err(|_| SatiError::LightCpiInvocationFailed)?;

    let (address, address_seed) = derive_address(
        &[
            b"attestation",
            schema_config.sas_schema.as_ref(),
            token_account_pubkey.as_ref(),
            &nonce,
        ],
        &address_tree_pubkey,
        &ID,
    );

    // 13. Initialize compressed account with proper tree index
    let mut attestation = LightAccount::<CompressedAttestation>::new_init(
        &ID,
        Some(address),
        params.output_state_tree_index,
    );

    attestation.sas_schema = schema_config.sas_schema.to_bytes();
    attestation.token_account = token_account_bytes;
    attestation.data = params.data.clone();
    attestation.num_signatures = extracted_signatures.len() as u8;
    attestation.signature1 = extracted_signatures
        .first()
        .map(|s| s.sig)
        .unwrap_or([0u8; 64]);
    attestation.signature2 = extracted_signatures
        .get(1)
        .map(|s| s.sig)
        .unwrap_or([0u8; 64]);

    // 14. Compute new address params from params
    let new_address_params = params
        .address_tree_info
        .into_new_address_params_assigned_packed(address_seed, Some(0));

    // 15. CPI to Light System Program with proof from params
    InstructionDataInvokeCpiWithReadOnly::new_cpi(LIGHT_CPI_SIGNER, params.proof)
        .mode_v1()
        .with_light_account(attestation)?
        .with_new_addresses(&[new_address_params])
        .invoke(light_cpi_accounts)
        .map_err(|_| SatiError::LightCpiInvocationFailed)?;

    // 16. Emit event
    emit_cpi!(AttestationCreated {
        sas_schema: schema_config.sas_schema,
        token_account: token_account_pubkey,
        counterparty: counterparty_pubkey,
        storage_type: StorageType::Compressed,
        address: Pubkey::new_from_array(address),
    });

    Ok(())
}

/// Validate universal base layout fields at fixed offsets.
/// All schemas share the same 130-byte universal layout.
fn validate_universal_base(data: &[u8]) -> Result<()> {
    // Validate outcome at offset 96 (0-2 defined, 3-7 reserved)
    let outcome = data[offsets::OUTCOME];
    require!(outcome <= MAX_OUTCOME_VALUE, SatiError::InvalidOutcome);

    // Validate content_type at offset 129 (0-5 defined, 6-15 reserved)
    let content_type = data[offsets::CONTENT_TYPE];
    require!(
        content_type <= MAX_CONTENT_TYPE_VALUE,
        SatiError::InvalidContentType
    );

    // Validate content size if present
    let content_len = data.len().saturating_sub(offsets::CONTENT);
    require!(content_len <= MAX_CONTENT_SIZE, SatiError::ContentTooLarge);

    Ok(())
}

/// Build expected message hashes based on signature mode.
/// - Agent always signs interaction_hash (verified against expected)
/// - Counterparty (DualSignature) signs SIWS message (built on-chain and verified)
///
/// Returns Vec<Vec<u8>> with the expected messages for each signature role.
fn build_expected_messages(
    params: &CreateParams,
    schema_config: &SchemaConfig,
    task_ref: &[u8; 32],
) -> Result<Vec<Vec<u8>>> {
    // data_hash is at offset 97-129 in universal layout
    let data_hash: [u8; 32] = params.data[offsets::DATA_HASH..offsets::CONTENT_TYPE]
        .try_into()
        .map_err(|_| SatiError::InvalidSignature)?;

    // Compute interaction hash (agent/owner's signature)
    let interaction_hash =
        compute_interaction_hash(&schema_config.sas_schema, task_ref, &data_hash).to_vec();

    match schema_config.signature_mode {
        SignatureMode::DualSignature => {
            // - Agent (signatures[0]): verify they signed the interaction_hash
            // - Counterparty (signatures[1]): verify they signed the expected SIWS message
            //
            // SECURITY: We must verify the counterparty's message content matches the data.
            // Otherwise an attacker could sign "Positive" but submit "Negative" data.
            let siws_message = build_siws_message(&schema_config.name, &params.data)?;
            Ok(vec![interaction_hash, siws_message])
        }
        SignatureMode::CounterpartySigned => {
            // Counterparty signs the SIWS message (no agent signature)
            let siws_message = build_siws_message(&schema_config.name, &params.data)?;
            Ok(vec![siws_message])
        }
        SignatureMode::AgentOwnerSigned => {
            // Agent owner/delegate signs the interaction_hash
            Ok(vec![interaction_hash])
        }
    }
}

/// Build the expected SIWS message that counterparty should have signed.
/// Must match the SDK's buildCounterpartyMessage() exactly.
///
/// Format:
/// ```text
/// SATI {schema_name}
///
/// Agent: {token_account_base58}
/// Task: {task_ref_base58}
/// Outcome: {Negative|Neutral|Positive}
/// Details: {content_text}
///
/// Sign to create this attestation.
/// ```
fn build_siws_message(schema_name: &str, data: &[u8]) -> Result<Vec<u8>> {
    use bs58;

    // Extract fields from universal layout
    let task_ref = &data[offsets::TASK_REF..offsets::TOKEN_ACCOUNT];
    let token_account = &data[offsets::TOKEN_ACCOUNT..offsets::COUNTERPARTY];
    let outcome = data[offsets::OUTCOME];
    let content_type = data[offsets::CONTENT_TYPE];
    let content = &data[offsets::CONTENT..];

    // Convert to base58
    let token_account_b58 = bs58::encode(token_account).into_string();
    let task_ref_b58 = bs58::encode(task_ref).into_string();

    // Map outcome to label
    let outcome_label = match outcome {
        0 => "Negative",
        1 => "Neutral",
        2 => "Positive",
        _ => return Err(SatiError::InvalidOutcome.into()),
    };

    // Decode content for display
    let details_text = decode_content_for_display(content, content_type);

    // Build SIWS message (must match SDK exactly!)
    let message = format!(
        "SATI {schema_name}\n\nAgent: {token_account_b58}\nTask: {task_ref_b58}\nOutcome: {outcome_label}\nDetails: {details_text}\n\nSign to create this attestation."
    );

    Ok(message.into_bytes())
}

/// Decode content bytes for human-readable display in SIWS message.
/// Must match SDK's decodeContentForDisplay() exactly.
fn decode_content_for_display(content: &[u8], content_type: u8) -> String {
    if content.is_empty() {
        return "(none)".to_string();
    }

    match content_type {
        0 => "(none)".to_string(), // ContentType::None
        1 | 2 => {
            // ContentType::JSON or UTF8
            String::from_utf8(content.to_vec())
                .unwrap_or_else(|_| format!("({} bytes)", content.len()))
        }
        3 => format!("ipfs://{}", bs58::encode(content).into_string()), // ContentType::IPFS
        4 => format!("ar://{}", bs58::encode(content).into_string()),   // ContentType::Arweave
        5 => "(encrypted)".to_string(),                                 // ContentType::Encrypted
        _ => format!("({} bytes)", content.len()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use light_sdk::instruction::PackedAddressTreeInfo;

    /// Create minimal test CreateParams with universal layout (131 bytes)
    /// Layout: layout_version(1) + task_ref(32) + token_account(32) + counterparty(32) + outcome(1) + data_hash(32) + content_type(1)
    fn make_test_params(outcome: u8) -> CreateParams {
        let mut data = vec![0u8; 141]; // 131 min + some content

        // Set layout version at offset 0
        data[offsets::LAYOUT_VERSION] = CURRENT_LAYOUT_VERSION;

        // Set outcome at offset 97
        data[offsets::OUTCOME] = outcome;

        // Set content_type at offset 130
        data[offsets::CONTENT_TYPE] = 1; // JSON

        CreateParams {
            data,
            proof: Default::default(),
            address_tree_info: PackedAddressTreeInfo::default(),
            output_state_tree_index: 0,
        }
    }

    fn make_test_schema_config(signature_mode: SignatureMode) -> SchemaConfig {
        SchemaConfig {
            sas_schema: Pubkey::new_unique(),
            signature_mode,
            storage_type: StorageType::Compressed,
            delegation_schema: None,
            closeable: false,
            name: "test".to_string(),
            bump: 255,
        }
    }

    #[test]
    fn test_build_expected_messages_agent_owner_signed_returns_one_hash() {
        let params = make_test_params(2); // Positive outcome
        let schema_config = make_test_schema_config(SignatureMode::AgentOwnerSigned);
        let task_ref = [1u8; 32];

        let result = build_expected_messages(&params, &schema_config, &task_ref);
        assert!(result.is_ok());

        let messages = result.unwrap();
        assert_eq!(
            messages.len(),
            1,
            "AgentOwnerSigned mode should return exactly 1 message (interaction_hash)"
        );
        assert!(
            !messages[0].is_empty(),
            "AgentOwnerSigned should have non-empty interaction_hash"
        );
    }

    #[test]
    fn test_build_expected_messages_counterparty_signed_returns_one_siws() {
        let params = make_test_params(2); // Positive outcome
        let schema_config = make_test_schema_config(SignatureMode::CounterpartySigned);
        let task_ref = [1u8; 32];

        let result = build_expected_messages(&params, &schema_config, &task_ref);
        assert!(result.is_ok());

        let messages = result.unwrap();
        assert_eq!(
            messages.len(),
            1,
            "CounterpartySigned mode should return exactly 1 message (siws_message)"
        );
        assert!(
            !messages[0].is_empty(),
            "CounterpartySigned should have non-empty siws_message"
        );
        // Verify it's a SIWS message (contains the expected format)
        let siws_str = std::str::from_utf8(&messages[0]).unwrap();
        assert!(
            siws_str.contains("SATI"),
            "CounterpartySigned message should be a SIWS message"
        );
    }

    #[test]
    fn test_build_expected_messages_dual_signature_returns_two_entries() {
        let params = make_test_params(2); // Positive outcome
        let schema_config = make_test_schema_config(SignatureMode::DualSignature);
        let task_ref = [1u8; 32];

        let result = build_expected_messages(&params, &schema_config, &task_ref);
        assert!(result.is_ok());

        let messages = result.unwrap();
        assert_eq!(
            messages.len(),
            2,
            "DualSignature mode should return 2 entries"
        );
        // First entry should be interaction_hash for agent verification
        assert!(
            !messages[0].is_empty(),
            "Agent message should be non-empty interaction_hash"
        );
        // Second entry should be siws_message for counterparty verification
        // SECURITY: We verify the SIWS message content matches the data
        assert!(
            !messages[1].is_empty(),
            "Counterparty message should be non-empty siws_message"
        );
        // Verify the SIWS message contains expected outcome
        let siws_str = std::str::from_utf8(&messages[1]).unwrap();
        assert!(
            siws_str.contains("Outcome: Positive"),
            "SIWS message should contain the correct outcome"
        );
    }

    #[test]
    fn test_build_expected_messages_agent_owner_signed_returns_interaction_hash() {
        let params = make_test_params(2);
        let schema_config = make_test_schema_config(SignatureMode::AgentOwnerSigned);
        let task_ref = [1u8; 32];

        // Extract data_hash from params.data at universal offset
        let data_hash: [u8; 32] = params.data[offsets::DATA_HASH..offsets::CONTENT_TYPE]
            .try_into()
            .unwrap();

        // Compute expected interaction hash (now 3 params, no token_account)
        let expected_hash =
            compute_interaction_hash(&schema_config.sas_schema, &task_ref, &data_hash);

        let result = build_expected_messages(&params, &schema_config, &task_ref);
        let messages = result.unwrap();

        assert_eq!(
            &messages[0],
            &expected_hash.to_vec(),
            "AgentOwnerSigned should return interaction_hash"
        );
    }

    #[test]
    fn test_siws_message_format_matches_test_helper() {
        // This test verifies that build_siws_message produces the same output
        // as the test helper build_counterparty_message
        use bs58;

        let schema_name = "Feedback";
        let token_account = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let outcome: u8 = 2; // Positive
        let content_type: u8 = 0; // None

        // Build data array matching test setup (131 bytes minimum)
        let mut data = vec![0u8; 131];
        data[offsets::LAYOUT_VERSION] = CURRENT_LAYOUT_VERSION;
        data[offsets::TASK_REF..offsets::TOKEN_ACCOUNT].copy_from_slice(&task_ref);
        data[offsets::TOKEN_ACCOUNT..offsets::COUNTERPARTY].copy_from_slice(token_account.as_ref());
        data[offsets::COUNTERPARTY..offsets::OUTCOME]
            .copy_from_slice(Pubkey::new_unique().as_ref()); // counterparty
        data[offsets::OUTCOME] = outcome;
        data[offsets::CONTENT_TYPE] = content_type;

        // Build on-chain message
        let onchain_msg = build_siws_message(schema_name, &data).unwrap();
        let onchain_str = String::from_utf8(onchain_msg.clone()).unwrap();

        // Build test helper message manually (same logic as ed25519.rs test helper)
        let outcome_label = "Positive";
        let task_b58 = bs58::encode(&task_ref).into_string();
        let agent_b58 = token_account.to_string();
        let details_text = "(none)";

        let test_msg_str = format!(
            "SATI {schema_name}\n\nAgent: {agent_b58}\nTask: {task_b58}\nOutcome: {outcome_label}\nDetails: {details_text}\n\nSign to create this attestation."
        );

        // Print both for debugging if they don't match
        if onchain_str != test_msg_str {
            println!("ON-CHAIN MESSAGE:\n{}", onchain_str);
            println!("---");
            println!("TEST HELPER MESSAGE:\n{}", test_msg_str);
            println!("---");
            println!("ON-CHAIN BYTES: {:?}", onchain_msg);
            println!("TEST HELPER BYTES: {:?}", test_msg_str.as_bytes());
        }

        assert_eq!(
            onchain_str, test_msg_str,
            "SIWS messages should match exactly"
        );
    }

    #[test]
    fn test_validate_universal_base_valid() {
        let mut data = vec![0u8; 140];
        data[offsets::OUTCOME] = 2; // Positive
        data[offsets::CONTENT_TYPE] = 1; // JSON

        let result = validate_universal_base(&data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_universal_base_invalid_outcome() {
        let mut data = vec![0u8; 140];
        data[offsets::OUTCOME] = 10; // Invalid (> 7)
        data[offsets::CONTENT_TYPE] = 1;

        let result = validate_universal_base(&data);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_universal_base_invalid_content_type() {
        let mut data = vec![0u8; 140];
        data[offsets::OUTCOME] = 2;
        data[offsets::CONTENT_TYPE] = 20; // Invalid (> 15)

        let result = validate_universal_base(&data);
        assert!(result.is_err());
    }
}
