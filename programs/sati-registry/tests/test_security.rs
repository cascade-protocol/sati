//! Security tests for SATI Registry
//!
//! Tests for security audit findings:
//! 1. TokenGroup update authority validation
//! 2. Unprotected initialization (frontrunning risk)
//! 3. Compute budget with maximum metadata

mod helpers;

use helpers::{
    accounts::{
        program_account, system_account, system_program_account, token2022_program_account,
    },
    instructions::{
        build_initialize, build_register_agent, derive_ata_token2022, derive_registry_config,
        PROGRAM_ID,
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

/// Serialize a Token-2022 group mint with configurable update_authority
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

// =============================================================================
// SECURITY TEST 1: TokenGroup Update Authority Validation
// =============================================================================
// ISSUE: The initialize instruction must verify that the TokenGroup's
// update_authority is the registry PDA. Without this check, an attacker could
// brick the registry by passing a group_mint with wrong authority.
//
// FIX: Added validation in initialize.rs to check group.update_authority == registry PDA

#[test]
fn test_initialize_rejects_wrong_update_authority() {
    let mollusk = setup_mollusk();

    let authority = Pubkey::new_unique();
    let (registry_config, _bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    // ATTACK: Create group mint with WRONG update_authority (attacker, not registry PDA)
    let attacker = Pubkey::new_unique();
    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config), // mint authority correct
        attacker,              // WRONG: update_authority should be registry_config!
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_initialize(authority, registry_config, group_mint);

    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (registry_config, system_account(0)), // Will be created by init
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        system_program_account(),
    ];

    // FIXED: Now rejects with SatiError::InvalidGroupMint (6000 = 0x1770)
    let checks = vec![Check::err(solana_sdk::program_error::ProgramError::Custom(
        6000,
    ))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

// =============================================================================
// SECURITY TEST 2: Unprotected Initialization (Frontrunning Risk)
// =============================================================================
// OBSERVATION: Any account can call initialize and become the authority.
// An attacker watching the mempool could frontrun deployment.
//
// MITIGATION (by design, not a code fix):
// 1. Anchor's `init` constraint ensures only ONE initialization ever
// 2. Use atomic deploy script: deploy + init in single transaction
// 3. Use priority fees to minimize frontrunning window
// 4. If frontrun, redeploy program with different ID
//
// VERDICT: Acceptable design - document deployment best practices.

#[test]
fn test_initialize_allows_any_signer() {
    let mollusk = setup_mollusk();

    // Random attacker tries to initialize
    let attacker = Pubkey::new_unique();
    let (registry_config, _bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    // Attacker creates valid group mint with registry PDA as update_authority
    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config, // Correct update_authority
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_initialize(attacker, registry_config, group_mint);

    let accounts = vec![
        (attacker, system_account(10_000_000_000)),
        (registry_config, system_account(0)),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        system_program_account(),
    ];

    // BUG: Currently SUCCEEDS - any signer can become authority
    // This is a design choice - document or fix based on requirements
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

// =============================================================================
// SECURITY TEST 3: Compute Budget with Maximum Metadata
// =============================================================================
// ISSUE: With 10 metadata entries at max length, register_agent makes many CPIs.
// This could exceed compute budget limits.
//
// EXPECTED: Should complete within compute budget.
// This test verifies the operation doesn't fail due to compute exhaustion.

#[test]
fn test_register_agent_max_metadata_compute_budget() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    // Create maximum metadata: 10 entries with max-length keys and values
    // key: 32 bytes, value: 200 bytes
    let max_metadata: Vec<(String, String)> = (0..10)
        .map(|i| {
            let key = format!("{:0>32}", i); // 32 char key
            let value = "V".repeat(200); // 200 char value
            (key, value)
        })
        .collect();

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        &"A".repeat(32),                                     // max name
        &"S".repeat(10),                                     // max symbol
        &format!("https://example.com/{}", "x".repeat(175)), // max uri (200 bytes)
        Some(&max_metadata),
        false,
    );

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

    // Should succeed - if it fails with ComputationalBudgetExceeded, we have a problem
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

// =============================================================================
// SECURITY TEST 4: Initialize Mint Validation Edge Cases
// =============================================================================
// The initialize instruction validates the group_mint has:
// 1. is_initialized = true
// 2. decimals = 0
// 3. TokenGroup extension present

/// Serialize a Token-2022 group mint with is_initialized = false
fn serialize_uninitialized_group_mint(
    group_mint_pubkey: Pubkey,
    update_authority: Pubkey,
) -> Vec<u8> {
    let extensions = [ExtensionType::GroupPointer, ExtensionType::TokenGroup];
    let space = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
    let mut data = vec![0u8; space];

    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();

    state.base.mint_authority = None.into();
    state.base.supply = 0;
    state.base.decimals = 0;
    state.base.is_initialized = false; // NOT INITIALIZED
    state.base.freeze_authority = None.into();

    let group_pointer = state.init_extension::<GroupPointer>(true).unwrap();
    group_pointer.authority = Some(update_authority).try_into().unwrap();
    group_pointer.group_address = Some(group_mint_pubkey).try_into().unwrap();

    let token_group = state.init_extension::<TokenGroup>(true).unwrap();
    token_group.update_authority = Some(update_authority).try_into().unwrap();
    token_group.mint = group_mint_pubkey;
    token_group.size = 0.into();
    token_group.max_size = u64::MAX.into();

    state.pack_base();
    state.init_account_type().unwrap();

    data
}

/// Serialize a Token-2022 group mint with nonzero decimals
fn serialize_nonzero_decimals_group_mint(
    group_mint_pubkey: Pubkey,
    update_authority: Pubkey,
    decimals: u8,
) -> Vec<u8> {
    let extensions = [ExtensionType::GroupPointer, ExtensionType::TokenGroup];
    let space = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
    let mut data = vec![0u8; space];

    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();

    state.base.mint_authority = Some(update_authority).into();
    state.base.supply = 0;
    state.base.decimals = decimals; // NON-ZERO DECIMALS
    state.base.is_initialized = true;
    state.base.freeze_authority = None.into();

    let group_pointer = state.init_extension::<GroupPointer>(true).unwrap();
    group_pointer.authority = Some(update_authority).try_into().unwrap();
    group_pointer.group_address = Some(group_mint_pubkey).try_into().unwrap();

    let token_group = state.init_extension::<TokenGroup>(true).unwrap();
    token_group.update_authority = Some(update_authority).try_into().unwrap();
    token_group.mint = group_mint_pubkey;
    token_group.size = 0.into();
    token_group.max_size = u64::MAX.into();

    state.pack_base();
    state.init_account_type().unwrap();

    data
}

/// Serialize a Token-2022 mint WITHOUT TokenGroup extension
fn serialize_mint_without_token_group(
    group_mint_pubkey: Pubkey,
    update_authority: Pubkey,
) -> Vec<u8> {
    // Only GroupPointer, no TokenGroup
    let extensions = [ExtensionType::GroupPointer];
    let space = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
    let mut data = vec![0u8; space];

    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();

    state.base.mint_authority = Some(update_authority).into();
    state.base.supply = 0;
    state.base.decimals = 0;
    state.base.is_initialized = true;
    state.base.freeze_authority = None.into();

    let group_pointer = state.init_extension::<GroupPointer>(true).unwrap();
    group_pointer.authority = Some(update_authority).try_into().unwrap();
    group_pointer.group_address = Some(group_mint_pubkey).try_into().unwrap();

    // NO TokenGroup extension initialized

    state.pack_base();
    state.init_account_type().unwrap();

    data
}

#[test]
fn test_initialize_rejects_uninitialized_mint() {
    let mollusk = setup_mollusk();

    let authority = Pubkey::new_unique();
    let (registry_config, _bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    // Create group mint with is_initialized = false
    let group_mint_data = serialize_uninitialized_group_mint(group_mint, registry_config);
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_initialize(authority, registry_config, group_mint);

    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (registry_config, system_account(0)),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        system_program_account(),
    ];

    // Should fail with InvalidGroupMint (6000)
    let checks = vec![Check::err(solana_sdk::program_error::ProgramError::Custom(
        6000,
    ))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_initialize_rejects_nonzero_decimals() {
    let mollusk = setup_mollusk();

    let authority = Pubkey::new_unique();
    let (registry_config, _bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    // Create group mint with decimals = 9 (should be 0 for NFT)
    let group_mint_data = serialize_nonzero_decimals_group_mint(group_mint, registry_config, 9);
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_initialize(authority, registry_config, group_mint);

    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (registry_config, system_account(0)),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        system_program_account(),
    ];

    // Should fail with InvalidGroupMint (6000)
    let checks = vec![Check::err(solana_sdk::program_error::ProgramError::Custom(
        6000,
    ))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_initialize_rejects_missing_token_group() {
    let mollusk = setup_mollusk();

    let authority = Pubkey::new_unique();
    let (registry_config, _bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    // Create mint WITHOUT TokenGroup extension
    let group_mint_data = serialize_mint_without_token_group(group_mint, registry_config);
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_initialize(authority, registry_config, group_mint);

    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (registry_config, system_account(0)),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        system_program_account(),
    ];

    // Should fail with InvalidGroupMint (6000)
    let checks = vec![Check::err(solana_sdk::program_error::ProgramError::Custom(
        6000,
    ))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
