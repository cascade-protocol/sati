use anchor_lang::prelude::*;

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
    /// CHECK: Validated to be correct ATA and have balance > 0
    #[account(
        constraint = {
            // Verify this is the correct ATA for Token-2022
            let expected_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
                owner.key,
                agent_mint.key,
                &spl_token_2022::ID,
            );
            ata.key() == expected_ata
        } @ SatiError::InvalidAuthority
    )]
    pub ata: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<LinkEvmAddress>, params: LinkEvmAddressParams) -> Result<()> {
    let agent_mint = ctx.accounts.agent_mint.key();

    // Verify owner holds the agent NFT (balance check)
    // The ATA constraint already verified it's the correct ATA
    let ata_data = ctx.accounts.ata.try_borrow_data()?;
    require!(ata_data.len() >= 72, SatiError::InvalidAuthority); // Token account min size

    // Token amount is at offset 64, 8 bytes (u64)
    let amount = u64::from_le_bytes(ata_data[64..72].try_into().unwrap());
    require!(amount > 0, SatiError::InvalidAuthority);
    drop(ata_data);

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
