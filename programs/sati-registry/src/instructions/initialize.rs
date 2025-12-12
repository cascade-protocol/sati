use anchor_lang::prelude::*;

use crate::errors::SatiError;
use crate::state::RegistryConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Initial registry authority (will be multisig in production)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Registry configuration PDA
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::SIZE,
        seeds = [b"registry"],
        bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// TokenGroup mint - created and initialized by client, then finalized here
    /// CHECK: Must be owned by Token-2022 and have registry_config as mint authority
    #[account(mut)]
    pub group_mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    // The group_mint must be pre-initialized by the client with:
    // 1. GroupPointer extension (pointing to itself)
    // 2. Mint initialized with registry_config as mint authority
    // 3. TokenGroup extension initialized
    //
    // This is required because Token-2022 cannot reallocate accounts during CPI,
    // and the client can send all Token-2022 instructions as top-level.

    let registry_bump = ctx.bumps.registry_config;
    let group_mint_key = ctx.accounts.group_mint.key();
    let authority_key = ctx.accounts.authority.key();

    // Verify the group_mint is owned by Token-2022
    require!(
        ctx.accounts.group_mint.owner == &anchor_spl::token_2022::ID,
        SatiError::InvalidGroupMint
    );

    // Store registry configuration
    let registry = &mut ctx.accounts.registry_config;
    registry.authority = authority_key;
    registry.group_mint = group_mint_key;
    registry.total_agents = 0;
    registry.bump = registry_bump;

    Ok(())
}
