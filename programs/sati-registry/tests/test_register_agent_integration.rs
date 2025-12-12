//! Integration tests for register_agent instruction
//!
//! These tests exercise the full Token-2022 CPI flow, unlike the validation
//! tests in test_register_agent.rs which only test input validation.

mod helpers;

use helpers::{
    accounts::{
        program_account, system_account, system_program_account, token2022_program_account,
    },
    instructions::{
        build_register_agent, derive_ata_token2022, derive_registry_config, PROGRAM_ID,
    },
    serialization::{serialize_registry_config, REGISTRY_CONFIG_SIZE},
    setup_mollusk,
};
use mollusk_svm::result::Check;
use mollusk_svm_programs_token::{associated_token, token2022};
use solana_sdk::{pubkey::Pubkey, rent::Rent, signature::Keypair, signer::Signer};
use spl_token_2022::{
    extension::{
        group_pointer::GroupPointer, BaseStateWithExtensionsMut, ExtensionType,
        StateWithExtensionsMut,
    },
    state::Mint,
};
use spl_token_group_interface::state::TokenGroup;

/// Serialize a Token-2022 mint with GroupPointer and TokenGroup extensions
fn serialize_token2022_group_mint(
    group_mint_pubkey: Pubkey,
    mint_authority: Option<Pubkey>,
    update_authority: Pubkey,
    max_size: u32,
) -> Vec<u8> {
    let extensions = [ExtensionType::GroupPointer, ExtensionType::TokenGroup];
    let space = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
    let mut data = vec![0u8; space];

    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();

    state.base.mint_authority = mint_authority.into();
    state.base.supply = 0;
    state.base.decimals = 0;
    state.base.is_initialized = true;
    state.base.freeze_authority = None.into();

    let group_pointer = state.init_extension::<GroupPointer>(true).unwrap();
    group_pointer.authority = Some(update_authority).try_into().unwrap();
    group_pointer.group_address = Some(group_mint_pubkey).try_into().unwrap();

    let token_group = state.init_extension::<TokenGroup>(true).unwrap();
    token_group.update_authority = Some(update_authority).try_into().unwrap();
    token_group.mint = group_mint_pubkey;
    token_group.size = 0.into();
    token_group.max_size = (max_size as u64).into();

    state.pack_base();
    state.init_account_type().unwrap();

    data
}

/// Test that register_agent succeeds with properly initialized group mint
///
/// This test verifies the full Token-2022 CPI flow:
/// 1. Create agent mint account
/// 2. Initialize pointer extensions
/// 3. Initialize mint
/// 4. Initialize metadata
/// 5. Initialize group member
/// 6. Create ATA
/// 7. Mint token
/// 8. Renounce mint authority
#[test]
fn test_register_agent_full_flow_succeeds() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry config
    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    // Create properly initialized group mint with TokenGroup extension
    // max_size = u32::MAX allows unlimited members
    let group_mint_data = serialize_token2022_group_mint(
        group_mint,            // the group mint pubkey
        Some(registry_config), // mint authority = registry PDA
        registry_config,       // update authority = registry PDA
        u32::MAX,              // max_size = unlimited
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    // Build register_agent instruction
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        "AGENT",
        "https://example.com/agent.json",
        Some(&[("version".to_string(), "1.0.0".to_string())]),
        false, // transferable
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)), // 10 SOL
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)), // Will be created by instruction
        (agent_token_account, system_account(0)), // Will be created by instruction
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    // Should succeed
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

/// Test that register_agent fails when group has max_size = 0
///
/// This catches the bug where the group was initialized with maxSize: 0
/// which prevents any members from being added.
#[test]
fn test_register_agent_fails_with_zero_max_size_group() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry config
    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    // Create group mint with max_size = 0 (BUG: no members allowed!)
    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        0, // max_size = 0 means NO MEMBERS ALLOWED
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    // Build register_agent instruction
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        "AGENT",
        "https://example.com/agent.json",
        None,
        false,
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    // Should fail with SizeExceedsMaxSize (TokenGroupError)
    // Error code 3_406_457_177 = 0xcb0a6959
    let checks = vec![Check::err(solana_sdk::program_error::ProgramError::Custom(
        3_406_457_177,
    ))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
