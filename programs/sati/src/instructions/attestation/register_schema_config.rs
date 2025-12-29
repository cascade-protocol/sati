use anchor_lang::prelude::*;

use crate::errors::SatiError;
use crate::events::SchemaConfigRegistered;
use crate::state::{RegistryConfig, SchemaConfig, SignatureMode, StorageType};

/// Accounts for register_schema_config instruction
#[derive(Accounts)]
#[instruction(sas_schema: Pubkey)]
pub struct RegisterSchemaConfig<'info> {
    /// Payer for account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Registry config - validates authority and checks mutability
    #[account(
        seeds = [b"registry"],
        bump = registry_config.bump,
        has_one = authority @ SatiError::InvalidAuthority,
        constraint = !registry_config.is_immutable() @ SatiError::ImmutableAuthority,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// Authority that can register schemas (validated against registry_config)
    pub authority: Signer<'info>,

    /// Schema config PDA to be created
    #[account(
        init,
        payer = payer,
        space = 8 + SchemaConfig::INIT_SPACE,
        seeds = [b"schema_config", sas_schema.as_ref()],
        bump,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterSchemaConfig>,
    sas_schema: Pubkey,
    signature_mode: SignatureMode,
    storage_type: StorageType,
    closeable: bool,
) -> Result<()> {
    let schema_config = &mut ctx.accounts.schema_config;

    schema_config.sas_schema = sas_schema;
    schema_config.signature_mode = signature_mode;
    schema_config.storage_type = storage_type;
    schema_config.closeable = closeable;
    schema_config.bump = ctx.bumps.schema_config;

    emit!(SchemaConfigRegistered {
        schema: sas_schema,
        signature_mode,
        storage_type,
        closeable,
    });

    Ok(())
}
