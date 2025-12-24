use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    cpi::{
        v1::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
};

use crate::errors::SatiError;
use crate::events::AttestationClosed;
use crate::state::{CloseParams, CompressedAttestation, SchemaConfig, StorageType};
use crate::LIGHT_CPI_SIGNER;
use crate::ID;

/// Accounts for close_attestation instruction (compressed storage)
#[event_cpi]
#[derive(Accounts)]
pub struct CloseAttestation<'info> {
    /// Signer must be the counterparty (provider for ReputationScore)
    #[account(mut)]
    pub signer: Signer<'info>,

    /// Schema config PDA
    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
        constraint = schema_config.storage_type == StorageType::Compressed @ SatiError::StorageTypeMismatch,
        constraint = schema_config.closeable @ SatiError::AttestationNotCloseable,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    // Light Protocol accounts are passed via remaining_accounts
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CloseAttestation<'info>>,
    params: CloseParams,
) -> Result<()> {
    let schema_config = &ctx.accounts.schema_config;

    // 1. Parse token_account and counterparty from current_data
    require!(
        params.current_data.len() >= 96,
        SatiError::AttestationDataTooSmall
    );

    let token_account_bytes: [u8; 32] = params.current_data[32..64]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;
    let counterparty_bytes: [u8; 32] = params.current_data[64..96]
        .try_into()
        .map_err(|_| SatiError::InvalidDataLayout)?;

    let token_account = Pubkey::new_from_array(token_account_bytes);
    let counterparty = Pubkey::new_from_array(counterparty_bytes);

    // 2. Authorization: Only the counterparty can close
    require!(
        ctx.accounts.signer.key() == counterparty,
        SatiError::UnauthorizedClose
    );

    // 3. Initialize Light Protocol CPI accounts
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.signer.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    // 4. Reconstruct the attestation for closing with actual data from params
    let attestation = LightAccount::<CompressedAttestation>::new_close(
        &ID,
        &params.account_meta,
        CompressedAttestation {
            sas_schema: schema_config.sas_schema.to_bytes(),
            token_account: token_account_bytes,
            data_type: params.data_type,
            data: params.current_data.clone(),
            num_signatures: params.num_signatures,
            signature1: params.signature1,
            signature2: params.signature2,
        },
    )?;

    // 5. CPI to Light System Program to close
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, params.proof)
        .with_light_account(attestation)?
        .invoke(light_cpi_accounts)
        .map_err(|_| SatiError::LightCpiInvocationFailed)?;

    // 6. Emit event with actual address from params
    emit_cpi!(AttestationClosed {
        sas_schema: schema_config.sas_schema,
        token_account,
        address: params.address,
    });

    Ok(())
}
