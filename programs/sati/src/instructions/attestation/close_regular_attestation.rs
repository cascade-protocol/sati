use anchor_lang::prelude::*;
use solana_attestation_service_client::instructions::CloseAttestationCpiBuilder;

use crate::constants::SAS_DATA_OFFSET;
use crate::errors::SatiError;
use crate::events::AttestationClosed;
use crate::state::{SchemaConfig, StorageType};

/// Accounts for close_regular_attestation instruction (SAS storage)
#[event_cpi]
#[derive(Accounts)]
pub struct CloseRegularAttestation<'info> {
    /// Payer receives rent back
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Signer must be the counterparty (provider for ReputationScore)
    pub signer: Signer<'info>,

    /// Schema config PDA
    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
        constraint = schema_config.storage_type == StorageType::Regular @ SatiError::StorageTypeMismatch,
        constraint = schema_config.closeable @ SatiError::AttestationNotCloseable,
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

    /// Attestation account to be closed
    /// CHECK: Validated by SAS program
    #[account(mut)]
    pub attestation: AccountInfo<'info>,

    /// SAS program
    /// CHECK: Program ID verified
    #[account(address = solana_attestation_service_client::programs::SOLANA_ATTESTATION_SERVICE_ID)]
    pub sas_program: AccountInfo<'info>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CloseRegularAttestation<'info>>,
) -> Result<()> {
    let schema_config = &ctx.accounts.schema_config;

    // 1. Parse attestation data to verify authorization
    // SAS layout: discriminator(1) + nonce(32) + credential(32) + schema(32) + data_len(4) + data
    // Data layout: task_ref(32) + token_account(32) + counterparty(32) + ...
    let attestation_data = ctx.accounts.attestation.try_borrow_data()?;

    require!(
        attestation_data.len() >= SAS_DATA_OFFSET + 96,
        SatiError::AttestationDataTooSmall
    );

    let token_account_bytes: [u8; 32] = attestation_data
        [SAS_DATA_OFFSET + 32..SAS_DATA_OFFSET + 64]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;
    let counterparty_bytes: [u8; 32] = attestation_data[SAS_DATA_OFFSET + 64..SAS_DATA_OFFSET + 96]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;

    let token_account = Pubkey::new_from_array(token_account_bytes);
    let counterparty = Pubkey::new_from_array(counterparty_bytes);

    // Drop borrow before CPI
    drop(attestation_data);

    // 2. Authorization: Only the counterparty (provider) can close
    require!(
        ctx.accounts.signer.key() == counterparty,
        SatiError::UnauthorizedClose
    );

    // 3. CPI to SAS CloseAttestation
    let sati_pda_seeds: &[&[u8]] = &[b"sati_attestation", &[ctx.bumps.sati_pda]];

    CloseAttestationCpiBuilder::new(&ctx.accounts.sas_program)
        .payer(&ctx.accounts.payer)
        .authority(&ctx.accounts.sati_pda)
        .credential(&ctx.accounts.sati_credential)
        .attestation(&ctx.accounts.attestation)
        .invoke_signed(&[sati_pda_seeds])?;

    // 4. Emit event
    emit_cpi!(AttestationClosed {
        sas_schema: schema_config.sas_schema,
        token_account,
        address: ctx.accounts.attestation.key(),
    });

    Ok(())
}
