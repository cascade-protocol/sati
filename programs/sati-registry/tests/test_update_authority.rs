//! Tests for update_registry_authority instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use helpers::{
    accounts::{program_account, system_account},
    errors::{error_code, SatiError},
    instructions::{
        build_update_registry_authority, derive_group_mint, derive_registry_config, PROGRAM_ID,
    },
    serialization::{serialize_registry_config, REGISTRY_CONFIG_SIZE},
    setup_mollusk,
};
use mollusk_svm::result::Check;
use solana_sdk::{program_error::ProgramError, pubkey::Pubkey, rent::Rent};

/// Helper to create an initialized registry config account
fn initialized_registry_config(authority: Pubkey, bump: u8) -> (Vec<u8>, u64) {
    let (group_mint, _) = derive_group_mint();
    let data = serialize_registry_config(group_mint, authority, 0, bump);
    let lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);
    (data, lamports)
}

#[test]
fn test_update_authority_transfer_success() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();

    // Create initialized registry
    let (data, lamports) = initialized_registry_config(authority, bump);

    // Build instruction
    let instruction =
        build_update_registry_authority(authority, registry_config, Some(new_authority));

    // Setup account states
    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (registry_config, program_account(lamports, data, PROGRAM_ID)),
    ];

    // Validate success
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_update_authority_renounce_success() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();

    // Create initialized registry
    let (data, lamports) = initialized_registry_config(authority, bump);

    // Build instruction - None means renounce
    let instruction = build_update_registry_authority(authority, registry_config, None);

    // Setup account states
    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (registry_config, program_account(lamports, data, PROGRAM_ID)),
    ];

    // Validate success
    let checks = vec![Check::success()];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_update_authority_wrong_signer_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();

    // Create initialized registry with authority
    let (data, lamports) = initialized_registry_config(authority, bump);

    // Build instruction with wrong authority signing
    let instruction =
        build_update_registry_authority(wrong_authority, registry_config, Some(new_authority));

    // Setup account states
    let accounts = vec![
        (wrong_authority, system_account(10_000_000_000)),
        (registry_config, program_account(lamports, data, PROGRAM_ID)),
    ];

    // Should fail with InvalidAuthority
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::InvalidAuthority,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_update_authority_immutable_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();

    // Create registry with authority = default (immutable)
    let data = serialize_registry_config(group_mint, Pubkey::default(), 0, bump);
    let lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    // Build instruction - trying to update immutable registry
    let instruction =
        build_update_registry_authority(authority, registry_config, Some(new_authority));

    // Setup account states
    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (registry_config, program_account(lamports, data, PROGRAM_ID)),
    ];

    // Note: has_one constraint is checked before is_immutable(), so we get InvalidAuthority
    // because our signer doesn't match Pubkey::default(). In practice, an immutable registry
    // is protected because nobody can sign as Pubkey::default().
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::InvalidAuthority,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
