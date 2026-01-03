//! Tests for the register_schema_config instruction

use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer, transaction::Transaction};

use crate::common::{
    accounts::{create_funded_keypair, create_initialized_registry, create_mock_group_mint},
    instructions::{build_register_schema_config_ix, SignatureMode, StorageType},
    setup::{derive_registry_config_pda, derive_schema_config_pda, setup_litesvm},
};

/// Test successful schema config registration
#[test]
fn test_register_schema_config_success() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, bump) = derive_registry_config_pda();

    // Create a mock group mint (needed for registry)
    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);

    // Create initialized registry
    create_initialized_registry(
        &mut svm,
        &registry_config,
        &authority.pubkey(),
        &group_mint.pubkey(),
        bump,
    );

    // Create a fake SAS schema address
    let sas_schema = Pubkey::new_unique();
    let (schema_config, _schema_bump) = derive_schema_config_pda(&sas_schema);

    // Build and send register_schema_config instruction
    let ix = build_register_schema_config_ix(
        &authority.pubkey(),
        &registry_config,
        &authority.pubkey(),
        &schema_config,
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Compressed,
        None, // no delegation schema for this test
        true, // closeable
        "TestFeedback".to_string(),
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
        "register_schema_config should succeed: {:?}",
        result.err()
    );

    // Verify schema config was created
    let schema_account = svm.get_account(&schema_config);
    assert!(schema_account.is_some(), "Schema config should exist");

    let account = schema_account.unwrap();
    // Size: 8 (discriminator) + 32 (sas_schema) + 1 (sig_mode) + 1 (storage_type)
    //       + 33 (delegation_schema Option<Pubkey>) + 1 (closeable) + 36 (name String) + 1 (bump) = 113 bytes
    assert_eq!(account.data.len(), 113, "Schema config should be 113 bytes");

    // Verify fields (after 8-byte discriminator)
    let stored_sas_schema = &account.data[8..40];
    assert_eq!(
        stored_sas_schema,
        sas_schema.as_ref(),
        "SAS schema should match"
    );

    let signature_mode = account.data[40];
    assert_eq!(
        signature_mode, 0,
        "Signature mode should be DualSignature (0)"
    );

    let storage_type = account.data[41];
    assert_eq!(storage_type, 0, "Storage type should be Compressed (0)");

    // delegation_schema at [42] = 0 for None
    assert_eq!(account.data[42], 0, "delegation_schema should be None (0)");

    let closeable = account.data[43];
    assert_eq!(closeable, 1, "Closeable should be true");

    println!("✅ test_register_schema_config_success passed");
}

/// Test schema config with SingleSigner mode and Regular storage
#[test]
fn test_register_schema_config_single_signer_regular() {
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

    let sas_schema = Pubkey::new_unique();
    let (schema_config, _) = derive_schema_config_pda(&sas_schema);

    let ix = build_register_schema_config_ix(
        &authority.pubkey(),
        &registry_config,
        &authority.pubkey(),
        &schema_config,
        &sas_schema,
        SignatureMode::CounterpartySigned,
        StorageType::Regular,
        None,  // no delegation schema for CounterpartySigned
        false, // not closeable
        "TestReputation".to_string(),
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
        "register_schema_config with CounterpartySigned should succeed: {:?}",
        result.err()
    );

    let account = svm.get_account(&schema_config).unwrap();
    assert_eq!(
        account.data[40], 1,
        "Signature mode should be CounterpartySigned (1)"
    );
    assert_eq!(account.data[41], 1, "Storage type should be Regular (1)");
    assert_eq!(account.data[42], 0, "delegation_schema should be None (0)");
    assert_eq!(account.data[43], 0, "Closeable should be false");

    println!("✅ test_register_schema_config_single_signer_regular passed");
}

/// Test that wrong authority fails
#[test]
fn test_register_schema_config_wrong_authority() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let wrong_authority = create_funded_keypair(&mut svm, 10_000_000_000);
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

    let sas_schema = Pubkey::new_unique();
    let (schema_config, _) = derive_schema_config_pda(&sas_schema);

    // Try to register with wrong authority
    let ix = build_register_schema_config_ix(
        &wrong_authority.pubkey(),
        &registry_config,
        &wrong_authority.pubkey(), // Wrong authority!
        &schema_config,
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Compressed,
        None,
        true,
        "TestFeedback".to_string(),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&wrong_authority.pubkey()),
        &[&wrong_authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_err(),
        "register_schema_config with wrong authority should fail"
    );

    println!("✅ test_register_schema_config_wrong_authority passed");
}

/// Test that immutable registry fails
#[test]
fn test_register_schema_config_immutable_registry() {
    let mut svm = setup_litesvm();

    let authority = create_funded_keypair(&mut svm, 10_000_000_000);
    let (registry_config, bump) = derive_registry_config_pda();

    let group_mint = Keypair::new();
    create_mock_group_mint(&mut svm, &group_mint, &registry_config);

    // Create registry with authority set to default (immutable)
    create_initialized_registry(
        &mut svm,
        &registry_config,
        &Pubkey::default(), // Immutable!
        &group_mint.pubkey(),
        bump,
    );

    let sas_schema = Pubkey::new_unique();
    let (schema_config, _) = derive_schema_config_pda(&sas_schema);

    let ix = build_register_schema_config_ix(
        &authority.pubkey(),
        &registry_config,
        &authority.pubkey(),
        &schema_config,
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Compressed,
        None,
        true,
        "TestFeedback".to_string(),
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_err(),
        "register_schema_config on immutable registry should fail"
    );

    println!("✅ test_register_schema_config_immutable_registry passed");
}
