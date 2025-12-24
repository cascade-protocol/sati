//! Tests for the update_registry_authority instruction

use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer, transaction::Transaction};

use crate::common::{
    accounts::{create_funded_keypair, create_initialized_registry, create_mock_group_mint},
    instructions::build_update_authority_ix,
    setup::{derive_registry_config_pda, setup_litesvm},
};

/// Test successful authority transfer
#[test]
fn test_transfer_authority() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let new_authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, bump) = derive_registry_config_pda();

    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);
    create_initialized_registry(
        &mut svm,
        &registry_config,
        &authority.pubkey(),
        &group_mint.pubkey(),
        bump,
    );

    // Transfer authority
    let ix = build_update_authority_ix(
        &authority.pubkey(),
        &registry_config,
        Some(new_authority.pubkey()),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Authority transfer should succeed: {:?}",
        result.err()
    );

    // Verify new authority is set
    let account = svm.get_account(&registry_config).unwrap();
    let stored_authority = &account.data[40..72];
    assert_eq!(
        stored_authority,
        new_authority.pubkey().as_ref(),
        "Authority should be updated"
    );

    println!("✅ test_transfer_authority passed");
}

/// Test renouncing authority (setting to default/immutable)
#[test]
fn test_renounce_authority() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, bump) = derive_registry_config_pda();

    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);
    create_initialized_registry(
        &mut svm,
        &registry_config,
        &authority.pubkey(),
        &group_mint.pubkey(),
        bump,
    );

    // Renounce authority by passing None
    let ix = build_update_authority_ix(
        &authority.pubkey(),
        &registry_config,
        None, // Renounce
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Renouncing authority should succeed: {:?}",
        result.err()
    );

    // Verify authority is now default (Pubkey::default())
    let account = svm.get_account(&registry_config).unwrap();
    let stored_authority = &account.data[40..72];
    assert_eq!(
        stored_authority,
        Pubkey::default().as_ref(),
        "Authority should be default (renounced)"
    );

    println!("✅ test_renounce_authority passed");
}

/// Test that wrong signer fails
#[test]
fn test_update_wrong_signer() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let wrong_signer = create_funded_keypair(&mut svm, 10_000_000_000);
    let new_authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, bump) = derive_registry_config_pda();

    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);
    create_initialized_registry(
        &mut svm,
        &registry_config,
        &authority.pubkey(),
        &group_mint.pubkey(),
        bump,
    );

    // Try to update with wrong signer
    let ix = build_update_authority_ix(
        &wrong_signer.pubkey(), // Wrong signer!
        &registry_config,
        Some(new_authority.pubkey()),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&wrong_signer.pubkey()),
        &[&wrong_signer],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Update with wrong signer should fail");

    println!("✅ test_update_wrong_signer passed");
}

/// Test that immutable registry cannot be updated
#[test]
fn test_update_immutable_registry() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let new_authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, bump) = derive_registry_config_pda();

    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);

    // Create registry with default authority (immutable)
    create_initialized_registry(
        &mut svm,
        &registry_config,
        &Pubkey::default(), // Immutable!
        &group_mint.pubkey(),
        bump,
    );

    // Try to update immutable registry
    let ix = build_update_authority_ix(
        &authority.pubkey(),
        &registry_config,
        Some(new_authority.pubkey()),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Update on immutable registry should fail");

    println!("✅ test_update_immutable_registry passed");
}
