//! Tests for initialize instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2

mod helpers;

use helpers::{
    accounts::{system_account, system_program_account, uninitialized_account},
    instructions::{build_initialize, derive_group_mint, derive_registry_config, PROGRAM_ID},
    setup_mollusk,
};
use mollusk_svm::result::Check;
use solana_sdk::pubkey::Pubkey;

// NOTE: test_initialize_success is skipped in Mollusk tests.
// The initialize instruction performs complex Token-2022 CPIs (GroupPointer + TokenGroup)
// that require specific account setup not easily achievable with Mollusk's bundled programs.
// Full E2E testing should be done on devnet.
//
// The test_initialize_already_initialized_fails test below validates the Anchor constraint
// logic works correctly.

#[test]
fn test_initialize_already_initialized_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();

    // Create already initialized registry config data
    use helpers::serialization::serialize_registry_config;
    let existing_data = serialize_registry_config(group_mint, authority, 0, bump);

    // Build instruction
    let instruction = build_initialize(authority, registry_config, group_mint);

    // Setup accounts - registry_config already exists with data
    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (
            registry_config,
            helpers::accounts::program_account(1_000_000, existing_data, PROGRAM_ID),
        ),
        (group_mint, uninitialized_account()),
        system_program_account(),
    ];

    // Should fail because registry is already initialized
    // Anchor init constraint error
    let checks = vec![Check::err(solana_sdk::program_error::ProgramError::Custom(
        0,
    ))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
