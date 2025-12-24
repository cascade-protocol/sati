use anchor_lang::prelude::*;
use solana_attestation_service_client::instructions::CreateAttestationCpiBuilder;
use solana_program::sysvar::instructions as instructions_sysvar;

use crate::constants::*;
use crate::errors::SatiError;
use crate::events::AttestationCreated;
use crate::signature::{
    compute_reputation_hash, compute_reputation_nonce, verify_ed25519_signatures,
};
use crate::state::{CreateRegularParams, SchemaConfig, StorageType};

/// Accounts for create_regular_attestation instruction (SAS storage)
#[event_cpi]
#[derive(Accounts)]
pub struct CreateRegularAttestation<'info> {
    /// Payer for account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Schema config PDA
    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
        constraint = schema_config.storage_type == StorageType::Regular @ SatiError::StorageTypeMismatch,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    /// SATI Attestation Program PDA - authorized signer on SAS credential
    /// CHECK: Seeds verified
    #[account(
        seeds = [b"sati_attestation"],
        bump,
    )]
    pub sati_pda: AccountInfo<'info>,

    /// SATI SAS credential account
    /// CHECK: Validated by SAS program
    pub sati_credential: AccountInfo<'info>,

    /// SAS schema account
    /// CHECK: Validated by SAS program
    pub sas_schema: AccountInfo<'info>,

    /// Attestation PDA to be created
    /// CHECK: Validated by SAS program
    #[account(mut)]
    pub attestation: AccountInfo<'info>,

    /// Instructions sysvar for Ed25519 signature verification
    /// CHECK: Verified via address
    #[account(address = instructions_sysvar::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    /// SAS program
    /// CHECK: Program ID verified
    #[account(address = solana_attestation_service_client::programs::SOLANA_ATTESTATION_SERVICE_ID)]
    pub sas_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateRegularAttestation<'info>>,
    params: CreateRegularParams,
) -> Result<()> {
    let schema_config = &ctx.accounts.schema_config;

    // 1. Verify signature count (SingleSigner mode for ReputationScore)
    require!(
        params.signatures.len() == 1,
        SatiError::InvalidSignatureCount
    );

    // 2. Verify data length
    require!(
        params.data.len() >= MIN_BASE_LAYOUT_SIZE,
        SatiError::AttestationDataTooSmall
    );
    require!(
        params.data.len() <= MAX_ATTESTATION_DATA_SIZE,
        SatiError::AttestationDataTooLarge
    );

    // 3. Parse base layout
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

    // 5. Provider (counterparty) must be the signer
    require!(
        params.signatures[0].pubkey == counterparty_pubkey,
        SatiError::SignatureMismatch
    );

    // 6. Validate ReputationScore-specific fields
    // data_type must be 2
    require!(params.data_type == 2, SatiError::InvalidDataType);

    if params.data.len() >= 98 {
        let score = params.data[96];
        require!(score <= 100, SatiError::InvalidScore);

        let content_type = params.data[97];
        require!(content_type <= 4, SatiError::InvalidContentType);

        // Validate content size if present
        if params.data.len() >= 102 {
            let content_len = u32::from_le_bytes(params.data[98..102].try_into().unwrap()) as usize;
            require!(content_len <= MAX_CONTENT_SIZE, SatiError::ContentTooLarge);
        }
    }

    // 7. Build expected message hash
    let score = params.data[96];
    let expected_message = compute_reputation_hash(
        &schema_config.sas_schema,
        &token_account_pubkey,
        &counterparty_pubkey,
        score,
    );

    // 8. Verify Ed25519 signature
    verify_ed25519_signatures(
        &ctx.accounts.instructions_sysvar,
        &params.signatures,
        &[expected_message.to_vec()],
    )?;

    // 9. Compute deterministic nonce
    let nonce = compute_reputation_nonce(&counterparty_pubkey, &token_account_pubkey);

    // 10. CPI to SAS using SATI PDA as authorized signer
    let sati_pda_seeds: &[&[u8]] = &[b"sati_attestation", &[ctx.bumps.sati_pda]];

    CreateAttestationCpiBuilder::new(&ctx.accounts.sas_program)
        .payer(&ctx.accounts.payer)
        .authority(&ctx.accounts.sati_pda)
        .credential(&ctx.accounts.sati_credential)
        .schema(&ctx.accounts.sas_schema)
        .attestation(&ctx.accounts.attestation)
        .system_program(&ctx.accounts.system_program)
        .nonce(Pubkey::new_from_array(nonce))
        .data(params.data.clone())
        .expiry(params.expiry)
        .invoke_signed(&[sati_pda_seeds])?;

    // 11. Emit event
    emit_cpi!(AttestationCreated {
        sas_schema: schema_config.sas_schema,
        token_account: token_account_pubkey,
        counterparty: counterparty_pubkey,
        data_type: params.data_type,
        storage_type: StorageType::Regular,
        address: ctx.accounts.attestation.key(),
    });

    Ok(())
}
