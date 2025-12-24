//! Tests for the initialize instruction

use solana_sdk::{
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};

use crate::common::{
    setup::{setup_litesvm, derive_registry_config_pda},
    accounts::{create_funded_keypair, create_mock_group_mint},
    instructions::build_initialize_ix,
};

/// Test successful registry initialization
///
/// NOTE: This test is ignored because it requires complex Token-2022 setup.
/// The initialize instruction validates that group_mint has registry_config_pda
/// as both mint_authority and TokenGroup update_authority. Setting this up requires
/// either:
/// 1. Using real Token-2022 CPI with authority transfers (complex)
/// 2. Running in an environment where PDAs can sign (localnet with program)
///
/// For now, we test initialize via SDK integration tests.
#[test]
#[ignore = "requires complex Token-2022 setup - test via SDK integration tests"]
fn test_initialize_success() {
    let mut svm = setup_litesvm();

    // Create authority with SOL
    let authority = create_funded_keypair(&mut svm, 10_000_000_000);

    // Derive registry config PDA
    let (registry_config, _bump) = derive_registry_config_pda();

    // Create group mint
    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);

    // Build and send initialize instruction
    let ix = build_initialize_ix(
        &authority.pubkey(),
        &registry_config,
        &group_mint.pubkey(),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Initialize should succeed: {:?}", result.err());

    // Verify registry config was created
    let registry_account = svm.get_account(&registry_config);
    assert!(registry_account.is_some(), "Registry config should exist");

    let account = registry_account.unwrap();
    assert_eq!(account.data.len(), 81, "Registry config should be 81 bytes");

    // Verify authority is set correctly (at offset 40 after discriminator + group_mint)
    let stored_authority = &account.data[40..72];
    assert_eq!(stored_authority, authority.pubkey().as_ref(), "Authority should match");

    // Verify group_mint is set correctly (at offset 8 after discriminator)
    let stored_group_mint = &account.data[8..40];
    assert_eq!(stored_group_mint, group_mint.pubkey().as_ref(), "Group mint should match");

    // Verify total_agents is 0 (at offset 72)
    let total_agents = u64::from_le_bytes(account.data[72..80].try_into().unwrap());
    assert_eq!(total_agents, 0, "Total agents should be 0");

    println!("✅ test_initialize_success passed");
}

/// Test that initialize fails if registry already exists
#[test]
#[ignore = "requires complex Token-2022 setup - test via SDK integration tests"]
fn test_initialize_already_initialized() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, _bump) = derive_registry_config_pda();
    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);

    // First initialization should succeed
    let ix = build_initialize_ix(
        &authority.pubkey(),
        &registry_config,
        &group_mint.pubkey(),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix.clone()],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "First initialize should succeed");

    // Second initialization should fail
    let tx2 = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result2 = svm.send_transaction(tx2);
    assert!(result2.is_err(), "Second initialize should fail (account already exists)");

    println!("✅ test_initialize_already_initialized passed");
}

/// Test that initialize fails with invalid group mint (wrong owner)
#[test]
fn test_initialize_invalid_group_mint_owner() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, _bump) = derive_registry_config_pda();

    // Create a group mint owned by system program (invalid)
    let group_mint = Keypair::new();
    let lamports = svm.minimum_balance_for_rent_exemption(100);
    let invalid_account = solana_sdk::account::Account {
        lamports,
        data: vec![0u8; 100],
        owner: solana_sdk::system_program::ID, // Wrong owner!
        executable: false,
        rent_epoch: 0,
    };
    svm.set_account(group_mint.pubkey(), invalid_account).unwrap();

    let ix = build_initialize_ix(
        &authority.pubkey(),
        &registry_config,
        &group_mint.pubkey(),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Initialize should fail with invalid group mint owner");

    println!("✅ test_initialize_invalid_group_mint_owner passed");
}
