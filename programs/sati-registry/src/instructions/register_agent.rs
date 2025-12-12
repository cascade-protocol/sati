use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::{
    extension::ExtensionType,
    instruction::{initialize_mint2, mint_to, set_authority, AuthorityType},
    state::Mint as Token2022Mint,
};
use spl_token_group_interface::instruction::initialize_member;
use spl_token_metadata_interface::instruction::initialize as initialize_metadata;

use crate::constants::*;
use crate::errors::SatiError;
use crate::events::AgentRegistered;
use crate::state::{MetadataEntry, RegistryConfig};

#[derive(Accounts)]
#[instruction(name: String, symbol: String, uri: String)]
pub struct RegisterAgent<'info> {
    /// Pays for account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Agent NFT owner (default: payer)
    /// CHECK: Can be any valid pubkey
    pub owner: UncheckedAccount<'info>,

    /// Registry configuration
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// TokenGroup mint (for membership)
    /// CHECK: Validated against registry_config.group_mint
    #[account(
        mut,
        address = registry_config.group_mint
    )]
    pub group_mint: UncheckedAccount<'info>,

    /// New agent NFT mint (randomly generated keypair)
    #[account(mut)]
    pub agent_mint: Signer<'info>,

    /// Owner's ATA for agent NFT
    /// CHECK: Initialized via CPI
    #[account(mut)]
    pub agent_token_account: UncheckedAccount<'info>,

    /// CHECK: Token-2022 program
    #[account(address = anchor_spl::token_2022::ID)]
    pub token_2022_program: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterAgent>,
    name: String,
    symbol: String,
    uri: String,
    additional_metadata: Option<Vec<MetadataEntry>>,
    non_transferable: bool,
) -> Result<()> {
    // === Input Validation ===
    require!(name.len() <= MAX_NAME_LENGTH, SatiError::NameTooLong);
    require!(symbol.len() <= MAX_SYMBOL_LENGTH, SatiError::SymbolTooLong);
    require!(uri.len() <= MAX_URI_LENGTH, SatiError::UriTooLong);

    if let Some(ref metadata) = additional_metadata {
        require!(
            metadata.len() <= MAX_METADATA_ENTRIES,
            SatiError::TooManyMetadataEntries
        );
        for entry in metadata {
            require!(
                entry.key.len() <= MAX_METADATA_KEY_LENGTH,
                SatiError::MetadataKeyTooLong
            );
            require!(
                entry.value.len() <= MAX_METADATA_VALUE_LENGTH,
                SatiError::MetadataValueTooLong
            );
        }
    }

    // === PHASE 1: Read state and prepare CPI parameters ===
    let (_group_mint, registry_bump, current_count) = {
        let registry = &ctx.accounts.registry_config;
        (registry.group_mint, registry.bump, registry.total_agents)
    };
    // Borrow is now dropped - safe to make CPIs

    // === PHASE 2: Execute all CPIs ===

    // 2a. Determine extensions and calculate space
    let mut extensions = vec![
        ExtensionType::MetadataPointer,
        ExtensionType::GroupMemberPointer,
    ];

    if non_transferable {
        extensions.push(ExtensionType::NonTransferable);
    }

    // Calculate base mint space (without variable-length metadata)
    let mint_len = ExtensionType::try_calculate_account_len::<Token2022Mint>(&extensions)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    // Add space for TokenMetadata (variable length)
    // TokenMetadata base: 64 bytes + name + symbol + uri + additional_metadata
    let metadata_space = 64
        + name.len()
        + symbol.len()
        + uri.len()
        + additional_metadata
            .as_ref()
            .map(|m| m.iter().map(|e| 4 + e.key.len() + 4 + e.value.len()).sum())
            .unwrap_or(0);

    // Add space for TokenGroupMember: 72 bytes
    let group_member_space = 72;

    let total_len = mint_len + metadata_space + group_member_space + 100; // +100 padding for TLV overhead

    // Create the agent_mint account
    let lamports = Rent::get()?.minimum_balance(total_len);

    anchor_lang::solana_program::program::invoke(
        &anchor_lang::solana_program::system_instruction::create_account(
            &ctx.accounts.payer.key(),
            &ctx.accounts.agent_mint.key(),
            lamports,
            total_len as u64,
            &anchor_spl::token_2022::ID,
        ),
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // 2b. Initialize MetadataPointer (points to self)
    let init_metadata_pointer_ix =
        spl_token_2022::extension::metadata_pointer::instruction::initialize(
            &anchor_spl::token_2022::ID,
            &ctx.accounts.agent_mint.key(),
            Some(ctx.accounts.owner.key()), // authority is the owner
            Some(ctx.accounts.agent_mint.key()), // metadata address is the mint itself
        )?;

    anchor_lang::solana_program::program::invoke(
        &init_metadata_pointer_ix,
        &[ctx.accounts.agent_mint.to_account_info()],
    )?;

    // 2c. Initialize GroupMemberPointer (points to self)
    let init_group_member_pointer_ix =
        spl_token_2022::extension::group_member_pointer::instruction::initialize(
            &anchor_spl::token_2022::ID,
            &ctx.accounts.agent_mint.key(),
            Some(ctx.accounts.registry_config.key()), // authority is registry PDA
            Some(ctx.accounts.agent_mint.key()), // member address is the mint itself
        )?;

    anchor_lang::solana_program::program::invoke(
        &init_group_member_pointer_ix,
        &[ctx.accounts.agent_mint.to_account_info()],
    )?;

    // 2d. Initialize NonTransferable if requested
    if non_transferable {
        let init_non_transferable_ix =
            spl_token_2022::instruction::initialize_non_transferable_mint(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.agent_mint.key(),
            )?;

        anchor_lang::solana_program::program::invoke(
            &init_non_transferable_ix,
            &[ctx.accounts.agent_mint.to_account_info()],
        )?;
    }

    // 2e. Initialize the mint
    let init_mint_ix = initialize_mint2(
        &anchor_spl::token_2022::ID,
        &ctx.accounts.agent_mint.key(),
        &ctx.accounts.payer.key(), // mint authority = payer (temporary, will renounce)
        None,                      // no freeze authority
        0,                         // decimals = 0 for NFT
    )?;

    anchor_lang::solana_program::program::invoke(
        &init_mint_ix,
        &[ctx.accounts.agent_mint.to_account_info()],
    )?;

    // 2f. Initialize TokenMetadata
    let init_token_metadata_ix = initialize_metadata(
        &anchor_spl::token_2022::ID,
        &ctx.accounts.agent_mint.key(),      // metadata account
        &ctx.accounts.owner.key(),           // update authority
        &ctx.accounts.agent_mint.key(),      // mint
        &ctx.accounts.payer.key(),           // mint authority
        name.clone(),
        symbol.clone(),
        uri.clone(),
    );

    anchor_lang::solana_program::program::invoke(
        &init_token_metadata_ix,
        &[
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.payer.to_account_info(),
        ],
    )?;

    // 2g. Add additional metadata fields if provided
    if let Some(ref metadata) = additional_metadata {
        for entry in metadata {
            let update_field_ix = spl_token_metadata_interface::instruction::update_field(
                &anchor_spl::token_2022::ID,
                &ctx.accounts.agent_mint.key(),
                &ctx.accounts.owner.key(),
                spl_token_metadata_interface::state::Field::Key(entry.key.clone()),
                entry.value.clone(),
            );

            anchor_lang::solana_program::program::invoke(
                &update_field_ix,
                &[
                    ctx.accounts.agent_mint.to_account_info(),
                    ctx.accounts.owner.to_account_info(),
                ],
            )?;
        }
    }

    // 2h. Initialize GroupMember (registry PDA signs as update_authority)
    let registry_seeds: &[&[u8]] = &[b"registry", &[registry_bump]];

    let init_member_ix = initialize_member(
        &anchor_spl::token_2022::ID,
        &ctx.accounts.agent_mint.key(),      // member (mint)
        &ctx.accounts.agent_mint.key(),      // member mint
        &ctx.accounts.payer.key(),           // member mint authority
        &ctx.accounts.group_mint.key(),      // group
        &ctx.accounts.registry_config.key(), // group update authority
    );

    invoke_signed(
        &init_member_ix,
        &[
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.group_mint.to_account_info(),
            ctx.accounts.registry_config.to_account_info(),
        ],
        &[registry_seeds],
    )?;

    // 2i. Create owner's ATA
    anchor_lang::solana_program::program::invoke(
        &spl_associated_token_account::instruction::create_associated_token_account(
            &ctx.accounts.payer.key(),
            &ctx.accounts.owner.key(),
            &ctx.accounts.agent_mint.key(),
            &anchor_spl::token_2022::ID,
        ),
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.agent_token_account.to_account_info(),
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.token_2022_program.to_account_info(),
        ],
    )?;

    // 2j. Mint exactly 1 token to owner's ATA
    let mint_to_ix = mint_to(
        &anchor_spl::token_2022::ID,
        &ctx.accounts.agent_mint.key(),
        &ctx.accounts.agent_token_account.key(),
        &ctx.accounts.payer.key(), // mint authority
        &[],
        1, // exactly 1 NFT
    )?;

    anchor_lang::solana_program::program::invoke(
        &mint_to_ix,
        &[
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.agent_token_account.to_account_info(),
            ctx.accounts.payer.to_account_info(),
        ],
    )?;

    // 2k. Renounce mint authority (supply=1 forever)
    let set_authority_ix = set_authority(
        &anchor_spl::token_2022::ID,
        &ctx.accounts.agent_mint.key(),
        None, // new authority = None (renounce)
        AuthorityType::MintTokens,
        &ctx.accounts.payer.key(),
        &[],
    )?;

    anchor_lang::solana_program::program::invoke(
        &set_authority_ix,
        &[
            ctx.accounts.agent_mint.to_account_info(),
            ctx.accounts.payer.to_account_info(),
        ],
    )?;

    // === PHASE 3: Write state after CPIs succeed ===
    let registry = &mut ctx.accounts.registry_config;
    registry.total_agents = current_count
        .checked_add(1)
        .ok_or(SatiError::Overflow)?;

    // === Emit Event ===
    emit!(AgentRegistered {
        mint: ctx.accounts.agent_mint.key(),
        owner: ctx.accounts.owner.key(),
        member_number: registry.total_agents,
        name,
        uri,
        non_transferable,
    });

    Ok(())
}
