use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};
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
use crate::ID;
use crate::LIGHT_CPI_SIGNER;

/// Accounts for close_compressed_attestation instruction (compressed storage)
#[event_cpi]
#[derive(Accounts)]
pub struct CloseCompressedAttestation<'info> {
    /// Signer must be either the agent (NFT owner via ATA) or the counterparty
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

    /// Optional: Agent's ATA (required if signer is NFT owner, not counterparty).
    /// If provided, must hold the agent NFT (mint matches agent_mint from data).
    pub agent_ata: Option<InterfaceAccount<'info, TokenAccount>>,

    /// Token-2022 program for ATA verification (optional, required with agent_ata)
    pub token_program: Option<Interface<'info, TokenInterface>>,

    /// Agent mint (Token-2022 NFT) for Solscan indexing.
    /// Must match agent_mint in attestation data (bytes 33-64).
    /// CHECK: Validated against attestation data in handler.
    pub agent_mint: AccountInfo<'info>,
    // Light Protocol accounts are passed via remaining_accounts
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CloseCompressedAttestation<'info>>,
    params: CloseParams,
) -> Result<()> {
    let schema_config = &ctx.accounts.schema_config;

    // 1. Parse agent_mint and counterparty from current_data
    require!(
        params.current_data.len() >= 96,
        SatiError::AttestationDataTooSmall
    );

    let agent_mint_bytes: [u8; 32] = params.current_data[32..64]
        .try_into()
        .map_err(|_| SatiError::InvalidSignature)?;
    let counterparty_bytes: [u8; 32] = params.current_data[64..96]
        .try_into()
        .map_err(|_| SatiError::InvalidSignature)?;

    let agent_mint_pubkey = Pubkey::new_from_array(agent_mint_bytes);
    let counterparty = Pubkey::new_from_array(counterparty_bytes);

    // 2. Validate agent_mint account matches attestation data
    require!(
        ctx.accounts.agent_mint.key() == agent_mint_pubkey,
        SatiError::AgentMintAccountMismatch
    );

    // 3. Authorization check based on signature mode
    let signer_key = ctx.accounts.signer.key();
    let is_counterparty = signer_key == counterparty;

    match schema_config.signature_mode {
        crate::state::SignatureMode::DualSignature => {
            // DualSignature: Either party can close (both participated in creation)
            let is_agent_owner = ctx.accounts.agent_ata.as_ref().is_some_and(|ata| {
                ata.mint == agent_mint_pubkey && ata.amount >= 1 && ata.owner == signer_key
            });
            require!(
                is_counterparty || is_agent_owner,
                SatiError::UnauthorizedClose
            );
        }
        crate::state::SignatureMode::CounterpartySigned => {
            // CounterpartySigned (e.g., FeedbackPublic, ReputationScore): Only counterparty can close
            // For ReputationScore: prevents agents from deleting unfavorable scores
            require!(is_counterparty, SatiError::UnauthorizedClose);
        }
        crate::state::SignatureMode::AgentOwnerSigned => {
            // AgentOwnerSigned (e.g., DelegateV1): Only agent owner can close
            // Agent controls their own delegations
            let is_agent_owner = ctx.accounts.agent_ata.as_ref().is_some_and(|ata| {
                ata.mint == agent_mint_pubkey && ata.amount >= 1 && ata.owner == signer_key
            });
            require!(is_agent_owner, SatiError::UnauthorizedClose);
        }
    }

    // 4. Initialize Light Protocol CPI accounts
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.signer.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    // 5. Reconstruct the attestation for closing with actual data from params
    let attestation = LightAccount::<CompressedAttestation>::new_close(
        &ID,
        &params.account_meta,
        CompressedAttestation {
            sas_schema: schema_config.sas_schema.to_bytes(),
            agent_mint: agent_mint_bytes,
            data: params.current_data.clone(),
            num_signatures: params.num_signatures,
            signature1: params.signature1,
            signature2: params.signature2,
        },
    )?;

    // 6. CPI to Light System Program to close
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, params.proof)
        .with_light_account(attestation)?
        .invoke(light_cpi_accounts)
        .map_err(|_| SatiError::LightCpiInvocationFailed)?;

    // 7. Emit event with actual address from params
    emit_cpi!(AttestationClosed {
        sas_schema: schema_config.sas_schema,
        agent_mint: agent_mint_pubkey,
        address: params.address,
    });

    Ok(())
}
