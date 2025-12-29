use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{
        v1::CpiAccounts, v2::lowlevel::InstructionDataInvokeCpiWithReadOnly,
        InvokeLightSystemProgram, LightCpiInstruction,
    },
};
use solana_program::sysvar::instructions as instructions_sysvar;

use crate::constants::*;
use crate::errors::SatiError;
use crate::events::AttestationCreated;
use crate::signature::{
    compute_attestation_nonce, compute_feedback_hash, compute_interaction_hash,
    compute_validation_hash, verify_ed25519_signatures,
};
use crate::state::{CompressedAttestation, CreateParams, SchemaConfig, SignatureMode, StorageType};
use crate::ID;
use crate::LIGHT_CPI_SIGNER;

/// Accounts for create_attestation instruction (compressed storage)
#[event_cpi]
#[derive(Accounts)]
pub struct CreateAttestation<'info> {
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
    // Light Protocol accounts are passed via remaining_accounts
    // and parsed by CpiAccounts::new()
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateAttestation<'info>>,
    params: CreateParams,
) -> Result<()> {
    let schema_config = &ctx.accounts.schema_config;

    // 1. Verify signature count matches signature mode
    match schema_config.signature_mode {
        SignatureMode::DualSignature => {
            require!(
                params.signatures.len() == 2,
                SatiError::InvalidSignatureCount
            );
        }
        SignatureMode::SingleSigner => {
            require!(
                params.signatures.len() == 1,
                SatiError::InvalidSignatureCount
            );
        }
    }

    // 2. Verify data length
    require!(
        params.data.len() >= MIN_BASE_LAYOUT_SIZE,
        SatiError::AttestationDataTooSmall
    );
    require!(
        params.data.len() <= MAX_ATTESTATION_DATA_SIZE,
        SatiError::AttestationDataTooLarge
    );

    // 3. Parse base layout for signature binding
    let task_ref: [u8; 32] = params.data[0..32]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;
    let token_account_bytes: [u8; 32] = params.data[32..64]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;
    let counterparty_bytes: [u8; 32] = params.data[64..96]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;

    let token_account_pubkey = Pubkey::new_from_array(token_account_bytes);
    let counterparty_pubkey = Pubkey::new_from_array(counterparty_bytes);

    // 4. Self-attestation prevention
    require!(
        token_account_pubkey != counterparty_pubkey,
        SatiError::SelfAttestationNotAllowed
    );

    // 5. Verify signature-data binding
    if params.signatures.len() == 2 {
        require!(
            params.signatures[0].pubkey == token_account_pubkey,
            SatiError::SignatureMismatch
        );
        require!(
            params.signatures[1].pubkey == counterparty_pubkey,
            SatiError::SignatureMismatch
        );
    }

    // 6. Validate schema-specific fields
    validate_schema_fields(&params)?;

    // 7. Construct expected message hashes for signature verification
    let expected_messages =
        build_expected_messages(&params, schema_config, &task_ref, &token_account_pubkey)?;

    // 8. Verify Ed25519 signatures via instruction introspection
    verify_ed25519_signatures(
        &ctx.accounts.instructions_sysvar,
        &params.signatures,
        &expected_messages,
    )?;

    // 9. Derive deterministic address
    let nonce = compute_attestation_nonce(
        &task_ref,
        &schema_config.sas_schema,
        &token_account_pubkey,
        &counterparty_pubkey,
    );

    // 10. Initialize Light Protocol CPI accounts
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    // 11. Get address tree pubkey from params
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

    // 11b. Initialize compressed account with proper tree index
    let mut attestation = LightAccount::<CompressedAttestation>::new_init(
        &ID,
        Some(address),
        params.output_state_tree_index,
    );

    attestation.sas_schema = schema_config.sas_schema.to_bytes();
    attestation.token_account = token_account_bytes;
    attestation.data_type = params.data_type;
    attestation.data = params.data.clone();
    attestation.num_signatures = params.signatures.len() as u8;
    attestation.signature1 = params
        .signatures
        .first()
        .map(|s| s.sig)
        .unwrap_or([0u8; 64]);
    attestation.signature2 = params.signatures.get(1).map(|s| s.sig).unwrap_or([0u8; 64]);

    // 12. Compute new address params from params
    let new_address_params = params
        .address_tree_info
        .into_new_address_params_assigned_packed(address_seed, Some(0));

    // 13. CPI to Light System Program with proof from params
    InstructionDataInvokeCpiWithReadOnly::new_cpi(LIGHT_CPI_SIGNER, params.proof)
        .mode_v1()
        .with_light_account(attestation)?
        .with_new_addresses(&[new_address_params])
        .invoke(light_cpi_accounts)
        .map_err(|_| SatiError::LightCpiInvocationFailed)?;

    // 14. Emit event
    emit_cpi!(AttestationCreated {
        sas_schema: schema_config.sas_schema,
        token_account: token_account_pubkey,
        counterparty: counterparty_pubkey,
        data_type: params.data_type,
        storage_type: StorageType::Compressed,
        address: Pubkey::new_from_array(address),
    });

    Ok(())
}

/// Validate schema-specific fields at fixed offsets
fn validate_schema_fields(params: &CreateParams) -> Result<()> {
    match params.data_type {
        0 => {
            // Feedback: content_type at 128, outcome at 129, tags are variable-length
            if params.data.len() >= 132 {
                let content_type = params.data[128];
                require!(content_type <= 4, SatiError::InvalidContentType);

                let outcome = params.data[129];
                require!(outcome <= 2, SatiError::InvalidOutcome);

                // Validate tag string lengths (max 32 chars each)
                let tag1_len = params.data[130] as usize;
                require!(tag1_len <= MAX_TAG_LENGTH, SatiError::TagTooLong);

                let tag2_start = 131 + tag1_len;
                require!(params.data.len() > tag2_start, SatiError::InvalidDataLayout);
                let tag2_len = params.data[tag2_start] as usize;
                require!(tag2_len <= MAX_TAG_LENGTH, SatiError::TagTooLong);

                // Validate content size if present
                let content_start = tag2_start + 1 + tag2_len;
                if params.data.len() >= content_start + 4 {
                    let content_len = u32::from_le_bytes(
                        params.data[content_start..content_start + 4]
                            .try_into()
                            .unwrap(),
                    ) as usize;
                    require!(content_len <= MAX_CONTENT_SIZE, SatiError::ContentTooLarge);
                }
            }
        }
        1 => {
            // Validation: content_type at 128, validation_type at 129, response at 130
            if params.data.len() >= 131 {
                let content_type = params.data[128];
                require!(content_type <= 4, SatiError::InvalidContentType);

                let response = params.data[130];
                require!(response <= 100, SatiError::InvalidResponse);

                // Validate content size if present
                if params.data.len() >= 135 {
                    let content_len =
                        u32::from_le_bytes(params.data[131..135].try_into().unwrap()) as usize;
                    require!(content_len <= MAX_CONTENT_SIZE, SatiError::ContentTooLarge);
                }
            }
        }
        _ => {
            return Err(SatiError::InvalidDataType.into());
        }
    }

    Ok(())
}

/// Build expected message hashes based on data type and signature mode
fn build_expected_messages(
    params: &CreateParams,
    schema_config: &SchemaConfig,
    task_ref: &[u8; 32],
    token_account: &Pubkey,
) -> Result<Vec<Vec<u8>>> {
    // data_hash is at offset 96-128 for Feedback and Validation
    let data_hash: [u8; 32] = params.data[96..128]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;

    // Compute interaction hash (always needed - agent's signature)
    let interaction_hash = compute_interaction_hash(
        &schema_config.sas_schema,
        task_ref,
        token_account,
        &data_hash,
    )
    .to_vec();

    // For SingleSigner mode, only the interaction hash is verified
    if schema_config.signature_mode == SignatureMode::SingleSigner {
        return Ok(vec![interaction_hash]);
    }

    // DualSignature mode: include both hashes
    match params.data_type {
        0 => {
            // Feedback: interaction_hash (agent) + feedback_hash (counterparty)
            let outcome = params.data[129];
            Ok(vec![
                interaction_hash,
                compute_feedback_hash(&schema_config.sas_schema, task_ref, token_account, outcome)
                    .to_vec(),
            ])
        }
        1 => {
            // Validation: interaction_hash (agent) + validation_hash (counterparty)
            let response = params.data[130];
            Ok(vec![
                interaction_hash,
                compute_validation_hash(
                    &schema_config.sas_schema,
                    task_ref,
                    token_account,
                    response,
                )
                .to_vec(),
            ])
        }
        _ => Err(SatiError::InvalidDataType.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use light_sdk::instruction::PackedAddressTreeInfo;

    /// Create minimal test CreateParams with proper data layout
    fn make_test_params(data_type: u8, outcome_or_response: u8) -> CreateParams {
        // Minimum data layout: 132 bytes for Feedback, 131 for Validation
        // [0-32]: task_ref, [32-64]: token_account, [64-96]: counterparty
        // [96-128]: data_hash, [128]: content_type, [129]: outcome/validation_type, [130]: response (validation only)
        let mut data = vec![0u8; 135];

        // Set outcome at offset 129 (Feedback) or response at offset 130 (Validation)
        if data_type == 0 {
            data[129] = outcome_or_response; // outcome for Feedback
        } else {
            data[130] = outcome_or_response; // response for Validation
        }

        CreateParams {
            data_type,
            data,
            signatures: vec![],
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
            closeable: false,
            bump: 255,
        }
    }

    #[test]
    fn test_build_expected_messages_single_signer_feedback_returns_one_hash() {
        let params = make_test_params(0, 2); // Feedback with Positive outcome
        let schema_config = make_test_schema_config(SignatureMode::SingleSigner);
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();

        let result = build_expected_messages(&params, &schema_config, &task_ref, &token_account);
        assert!(result.is_ok());

        let messages = result.unwrap();
        assert_eq!(
            messages.len(),
            1,
            "SingleSigner mode should return exactly 1 message (interaction_hash only)"
        );
    }

    #[test]
    fn test_build_expected_messages_single_signer_validation_returns_one_hash() {
        let params = make_test_params(1, 50); // Validation with response=50
        let schema_config = make_test_schema_config(SignatureMode::SingleSigner);
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();

        let result = build_expected_messages(&params, &schema_config, &task_ref, &token_account);
        assert!(result.is_ok());

        let messages = result.unwrap();
        assert_eq!(
            messages.len(),
            1,
            "SingleSigner mode should return exactly 1 message regardless of data_type"
        );
    }

    #[test]
    fn test_build_expected_messages_dual_signature_feedback_returns_two_hashes() {
        let params = make_test_params(0, 2); // Feedback with Positive outcome
        let schema_config = make_test_schema_config(SignatureMode::DualSignature);
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();

        let result = build_expected_messages(&params, &schema_config, &task_ref, &token_account);
        assert!(result.is_ok());

        let messages = result.unwrap();
        assert_eq!(
            messages.len(),
            2,
            "DualSignature mode should return 2 messages (interaction_hash + feedback_hash)"
        );
    }

    #[test]
    fn test_build_expected_messages_dual_signature_validation_returns_two_hashes() {
        let params = make_test_params(1, 50); // Validation with response=50
        let schema_config = make_test_schema_config(SignatureMode::DualSignature);
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();

        let result = build_expected_messages(&params, &schema_config, &task_ref, &token_account);
        assert!(result.is_ok());

        let messages = result.unwrap();
        assert_eq!(
            messages.len(),
            2,
            "DualSignature mode should return 2 messages (interaction_hash + validation_hash)"
        );
    }

    #[test]
    fn test_build_expected_messages_single_signer_returns_interaction_hash() {
        let params = make_test_params(0, 2);
        let schema_config = make_test_schema_config(SignatureMode::SingleSigner);
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();

        // Extract data_hash from params.data[96..128]
        let data_hash: [u8; 32] = params.data[96..128].try_into().unwrap();

        // Compute expected interaction hash
        let expected_hash = compute_interaction_hash(
            &schema_config.sas_schema,
            &task_ref,
            &token_account,
            &data_hash,
        );

        let result = build_expected_messages(&params, &schema_config, &task_ref, &token_account);
        let messages = result.unwrap();

        assert_eq!(
            messages[0],
            expected_hash.to_vec(),
            "SingleSigner should return the interaction_hash"
        );
    }
}
