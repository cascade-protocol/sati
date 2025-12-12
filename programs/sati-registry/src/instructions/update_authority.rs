use anchor_lang::prelude::*;

use crate::errors::SatiError;
use crate::events::RegistryAuthorityUpdated;
use crate::state::RegistryConfig;

#[derive(Accounts)]
pub struct UpdateRegistryAuthority<'info> {
    /// Current authority (must sign)
    pub authority: Signer<'info>,

    /// Registry configuration
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry_config.bump,
        has_one = authority @ SatiError::InvalidAuthority,
        constraint = !registry_config.is_immutable() @ SatiError::ImmutableAuthority
    )]
    pub registry_config: Account<'info, RegistryConfig>,
}

pub fn handler(ctx: Context<UpdateRegistryAuthority>, new_authority: Option<Pubkey>) -> Result<()> {
    let registry = &mut ctx.accounts.registry_config;
    let old_authority = registry.authority;

    // None = renounce (set to default pubkey = immutable)
    registry.authority = new_authority.unwrap_or(Pubkey::default());

    emit!(RegistryAuthorityUpdated {
        old_authority,
        new_authority,
    });

    Ok(())
}
