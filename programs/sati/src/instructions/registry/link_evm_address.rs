use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::errors::SatiError;
use crate::events::EvmAddressLinked;
use crate::signature::{compute_evm_link_hash, verify_secp256k1_signature};

/// Parameters for linking an EVM address to a SATI agent.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LinkEvmAddressParams {
    /// EVM address (20 bytes)
    pub evm_address: [u8; 20],
    /// CAIP-2 chain identifier (e.g., "eip155:1", "eip155:8453")
    pub chain_id: String,
    /// secp256k1 signature (64 bytes: r || s)
    pub signature: [u8; 64],
    /// Recovery ID (0 or 1)
    pub recovery_id: u8,
}

#[derive(Accounts)]
pub struct LinkEvmAddress<'info> {
    /// Agent owner (must sign)
    pub owner: Signer<'info>,

    /// Agent mint account
    /// CHECK: Validated by checking owner has ATA with balance
    pub agent_mint: UncheckedAccount<'info>,

    /// Owner's associated token account for this mint
    /// Validated to be correct ATA for the agent_mint and have balance > 0
    #[account(
        associated_token::mint = agent_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub ata: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program for ATA verification
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<LinkEvmAddress>, params: LinkEvmAddressParams) -> Result<()> {
    let agent_mint = ctx.accounts.agent_mint.key();

    // Verify owner holds the agent NFT (balance check)
    // The ATA constraint already verified it's the correct ATA
    require!(ctx.accounts.ata.amount > 0, SatiError::InvalidAuthority);

    // Compute the message hash
    let message_hash = compute_evm_link_hash(&agent_mint, &params.evm_address, &params.chain_id);

    // Verify secp256k1 signature
    verify_secp256k1_signature(
        &message_hash,
        &params.signature,
        params.recovery_id,
        &params.evm_address,
    )?;

    // Emit event as proof of verification
    let clock = Clock::get()?;
    emit!(EvmAddressLinked {
        agent_mint,
        evm_address: params.evm_address,
        chain_id: params.chain_id,
        linked_at: clock.unix_timestamp,
    });

    Ok(())
}
