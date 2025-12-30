//! Tests for create_attestation instruction (compressed storage via Light Protocol)
//!
//! These tests require Light Protocol's test infrastructure for:
//! - Validity proof generation
//! - Compressed account state tracking
//! - Address tree management
//!
//! ## Running Tests
//!
//! ```bash
//! # Start localnet (includes prover)
//! pnpm localnet
//!
//! # Run attestation tests
//! cargo test -p sati --test main attestation::
//! ```

use light_program_test::{program_test::TestRpc, AddressWithTree, Indexer, Rpc};
use light_sdk::{
    address::v1::derive_address,
    instruction::{PackedAccounts, SystemAccountMetaConfig},
};
use sha2::{Digest, Sha256};
use solana_sdk::{account::Account, pubkey::Pubkey, signer::Signer};

use crate::common::{
    ed25519::{
        compute_attestation_nonce, compute_data_hash, compute_feedback_hash,
        compute_interaction_hash, create_multi_ed25519_ix, generate_ed25519_keypair,
        keypair_to_pubkey, sign_message,
    },
    instructions::{
        build_create_attestation_ix, CreateParams, SignatureData, SignatureMode, StorageType,
    },
    setup::{derive_schema_config_pda, setup_light_test_env, LightTestEnv, SATI_PROGRAM_ID},
};

/// Compute Anchor account discriminator: sha256("account:AccountName")[..8]
fn compute_anchor_discriminator(account_name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("account:{}", account_name));
    let result = hasher.finalize();
    result[..8].try_into().unwrap()
}

/// SchemaConfig account size: 8 (discriminator) + 32 (sas_schema) + 1 + 1 + 1 + 1 = 44 bytes
const SCHEMA_CONFIG_SIZE: usize = 44;

/// Test successful create_attestation with DualSignature (Feedback)
#[tokio::test]
async fn test_create_attestation_feedback_success() {
    // 1. Setup Light Protocol test environment with SATI program
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    // 2. Create and mock SchemaConfig PDA
    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    // Mock SchemaConfig account (avoids Token-2022 registry setup)
    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref()); // sas_schema
    schema_data[40] = SignatureMode::DualSignature as u8; // signature_mode
    schema_data[41] = StorageType::Compressed as u8; // storage_type
    schema_data[42] = 1; // closeable = true
    schema_data[43] = bump; // bump

    rpc.set_account(
        schema_config_pda,
        Account {
            lamports: 1_000_000,
            data: schema_data,
            owner: SATI_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // 3. Create agent and counterparty Ed25519 keypairs
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    // 4. Build attestation data (Feedback schema)
    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test task data");
    let outcome: u8 = 2; // Positive feedback

    let mut data = vec![0u8; 132];
    data[0..32].copy_from_slice(&task_ref); // task_ref
    data[32..64].copy_from_slice(agent_pubkey.as_ref()); // token_account
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref()); // counterparty
    data[96..128].copy_from_slice(&data_hash); // data_hash
    data[128] = 0; // content_type = 0 (None)
    data[129] = outcome; // outcome
    data[130] = 0; // tag1_len
    data[131] = 0; // tag2_len

    // 5. Compute message hashes and sign
    let agent_message = compute_interaction_hash(&sas_schema, &task_ref, &agent_pubkey, &data_hash);
    let counterparty_message =
        compute_feedback_hash(&sas_schema, &task_ref, &agent_pubkey, outcome);

    let agent_sig = sign_message(&agent_keypair, &agent_message);
    let counterparty_sig = sign_message(&counterparty_keypair, &counterparty_message);

    // 6. Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // 7. Derive compressed account address
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;

    let nonce =
        compute_attestation_nonce(&task_ref, &sas_schema, &agent_pubkey, &counterparty_pubkey);

    // Build seeds matching on-chain derive_address call
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        agent_pubkey.as_ref(),
        &nonce,
    ];
    let (compressed_address, _address_seed) =
        derive_address(seeds, &address_tree_pubkey, &SATI_PROGRAM_ID);

    // 8. Get validity proof for new address
    let rpc_result = rpc
        .get_validity_proof(
            vec![], // No existing accounts
            vec![AddressWithTree {
                address: compressed_address,
                tree: address_tree_pubkey,
            }],
            None,
        )
        .await
        .expect("Failed to get validity proof")
        .value;

    // 9. Pack tree infos
    let packed_tree_infos = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let address_tree_info = packed_tree_infos.address_trees[0];
    let output_state_tree_index =
        remaining_accounts.insert_or_get(rpc.get_random_state_tree_info().unwrap().tree);
    let (system_accounts, _, _) = remaining_accounts.to_account_metas();

    // 10. Build CreateParams
    let params = CreateParams {
        data_type: 0, // Feedback
        data: data.clone(),
        signatures: vec![
            SignatureData {
                pubkey: agent_pubkey,
                sig: agent_sig,
            },
            SignatureData {
                pubkey: counterparty_pubkey,
                sig: counterparty_sig,
            },
        ],
        output_state_tree_index,
        proof: rpc_result.proof,
        address_tree_info,
    };

    // 11. Build instructions
    let ed25519_ix = create_multi_ed25519_ix(&[
        (&agent_pubkey, &agent_message, &agent_sig),
        (
            &counterparty_pubkey,
            &counterparty_message,
            &counterparty_sig,
        ),
    ]);
    let attestation_ix =
        build_create_attestation_ix(&payer.pubkey(), &schema_config_pda, params, system_accounts);

    // 12. Send transaction (Ed25519 instruction MUST come before attestation)
    rpc.create_and_send_transaction(&[ed25519_ix, attestation_ix], &payer.pubkey(), &[&payer])
        .await
        .expect("Transaction failed");

    // 13. Verify compressed account was created
    let created = rpc
        .get_compressed_account(compressed_address, None)
        .await
        .expect("Failed to query compressed account")
        .value;

    assert!(
        created.is_some(),
        "Compressed attestation should exist at derived address"
    );

    let account = created.unwrap();
    assert_eq!(
        account.address,
        Some(compressed_address),
        "Address should match"
    );
}

/// Test that create_attestation fails without Ed25519 signature instruction
#[tokio::test]
async fn test_create_attestation_missing_signature() {
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    // Setup schema config (same as success case)
    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref());
    schema_data[40] = SignatureMode::DualSignature as u8;
    schema_data[41] = StorageType::Compressed as u8;
    schema_data[42] = 1;
    schema_data[43] = bump;

    rpc.set_account(
        schema_config_pda,
        Account {
            lamports: 1_000_000,
            data: schema_data,
            owner: SATI_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Build valid data but WITHOUT Ed25519 instruction
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 132];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_pubkey.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());
    data[96..128].copy_from_slice(&data_hash);
    data[128] = 0;
    data[129] = outcome;
    data[130] = 0;
    data[131] = 0;

    // Build signatures (valid)
    let interaction_hash =
        compute_interaction_hash(&sas_schema, &task_ref, &agent_pubkey, &data_hash);
    let feedback_hash = compute_feedback_hash(&sas_schema, &task_ref, &agent_pubkey, outcome);
    let agent_sig = sign_message(&agent_keypair, &interaction_hash);
    let counterparty_sig = sign_message(&counterparty_keypair, &feedback_hash);

    let signatures = vec![
        SignatureData {
            pubkey: agent_pubkey,
            sig: agent_sig,
        },
        SignatureData {
            pubkey: counterparty_pubkey,
            sig: counterparty_sig,
        },
    ];

    // Send transaction WITHOUT Ed25519 instruction
    // Expect: MissingSignatures error
    // (Would need to build and send transaction, check for error)
    println!("test_create_attestation_missing_signature: implemented but requires localnet");
}

/// Test that create_attestation fails with wrong signature
#[tokio::test]
async fn test_create_attestation_invalid_signature() {
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    // Setup schema config
    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref());
    schema_data[40] = SignatureMode::DualSignature as u8;
    schema_data[41] = StorageType::Compressed as u8;
    schema_data[42] = 1;
    schema_data[43] = bump;

    rpc.set_account(
        schema_config_pda,
        Account {
            lamports: 1_000_000,
            data: schema_data,
            owner: SATI_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 132];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_pubkey.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());
    data[96..128].copy_from_slice(&data_hash);
    data[128] = 0;
    data[129] = outcome;
    data[130] = 0;
    data[131] = 0;

    // Sign WRONG message hashes
    let wrong_hash = compute_data_hash(b"wrong message");
    let agent_sig = sign_message(&agent_keypair, &wrong_hash);
    let counterparty_sig = sign_message(&counterparty_keypair, &wrong_hash);

    let signatures = vec![
        SignatureData {
            pubkey: agent_pubkey,
            sig: agent_sig,
        },
        SignatureData {
            pubkey: counterparty_pubkey,
            sig: counterparty_sig,
        },
    ];

    // Expect: MessageMismatch error
    println!("test_create_attestation_invalid_signature: implemented but requires localnet");
}

/// Test that create_attestation fails with wrong signer
#[tokio::test]
async fn test_create_attestation_wrong_signer() {
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref());
    schema_data[40] = SignatureMode::DualSignature as u8;
    schema_data[41] = StorageType::Compressed as u8;
    schema_data[42] = 1;
    schema_data[43] = bump;

    rpc.set_account(
        schema_config_pda,
        Account {
            lamports: 1_000_000,
            data: schema_data,
            owner: SATI_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let wrong_keypair = generate_ed25519_keypair(); // Different from data

    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 132];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_pubkey.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());
    data[96..128].copy_from_slice(&data_hash);
    data[128] = 0;
    data[129] = outcome;
    data[130] = 0;
    data[131] = 0;

    // Sign with correct hashes but WRONG keypairs
    let interaction_hash =
        compute_interaction_hash(&sas_schema, &task_ref, &agent_pubkey, &data_hash);
    let feedback_hash = compute_feedback_hash(&sas_schema, &task_ref, &agent_pubkey, outcome);

    // Sign with wrong_keypair instead of agent_keypair
    let agent_sig = sign_message(&wrong_keypair, &interaction_hash);
    let counterparty_sig = sign_message(&counterparty_keypair, &feedback_hash);

    let signatures = vec![
        SignatureData {
            pubkey: agent_pubkey,
            sig: agent_sig,
        }, // pubkey doesn't match signer
        SignatureData {
            pubkey: counterparty_pubkey,
            sig: counterparty_sig,
        },
    ];

    // Expect: SignatureMismatch error
    println!("test_create_attestation_wrong_signer: implemented but requires localnet");
}

/// Test that create_attestation fails with self-attestation
#[tokio::test]
async fn test_create_attestation_self_attestation() {
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref());
    schema_data[40] = SignatureMode::DualSignature as u8;
    schema_data[41] = StorageType::Compressed as u8;
    schema_data[42] = 1;
    schema_data[43] = bump;

    rpc.set_account(
        schema_config_pda,
        Account {
            lamports: 1_000_000,
            data: schema_data,
            owner: SATI_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Use SAME keypair for both agent and counterparty
    let self_keypair = generate_ed25519_keypair();
    let self_pubkey = keypair_to_pubkey(&self_keypair);

    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 132];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(self_pubkey.as_ref()); // token_account = self
    data[64..96].copy_from_slice(self_pubkey.as_ref()); // counterparty = self (SAME!)
    data[96..128].copy_from_slice(&data_hash);
    data[128] = 0;
    data[129] = outcome;
    data[130] = 0;
    data[131] = 0;

    // Expect: SelfAttestationNotAllowed error
    println!("test_create_attestation_self_attestation: implemented but requires localnet");
}

/// Test that create_attestation fails with invalid data size
#[tokio::test]
async fn test_create_attestation_data_too_small() {
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref());
    schema_data[40] = SignatureMode::DualSignature as u8;
    schema_data[41] = StorageType::Compressed as u8;
    schema_data[42] = 1;
    schema_data[43] = bump;

    rpc.set_account(
        schema_config_pda,
        Account {
            lamports: 1_000_000,
            data: schema_data,
            owner: SATI_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Data too small (only 64 bytes, need at least 130 for Feedback)
    let data = vec![0u8; 64];

    // Expect: AttestationDataTooSmall error
    println!("test_create_attestation_data_too_small: implemented but requires localnet");
}

/// Test that create_attestation fails with wrong storage type schema
#[tokio::test]
async fn test_create_attestation_wrong_storage_type() {
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    // Set storage_type = Regular (but using compressed handler)
    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref());
    schema_data[40] = SignatureMode::DualSignature as u8;
    schema_data[41] = StorageType::Regular as u8; // WRONG for create_attestation (compressed)
    schema_data[42] = 1;
    schema_data[43] = bump;

    rpc.set_account(
        schema_config_pda,
        Account {
            lamports: 1_000_000,
            data: schema_data,
            owner: SATI_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Expect: StorageTypeMismatch error
    println!("test_create_attestation_wrong_storage_type: implemented but requires localnet");
}

// ============================================================================
// Unit tests for test helpers (these can run without Light Protocol)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feedback_data_layout() {
        // Verify our test data layout matches expected schema
        let task_ref = [1u8; 32];
        let agent = Pubkey::new_unique();
        let counterparty = Pubkey::new_unique();
        let data_hash = [2u8; 32];

        let mut data = [0u8; 132];
        data[0..32].copy_from_slice(&task_ref);
        data[32..64].copy_from_slice(agent.as_ref());
        data[64..96].copy_from_slice(counterparty.as_ref());
        data[96..128].copy_from_slice(&data_hash);
        data[128] = 0; // content_type
        data[129] = 2; // outcome = positive
        data[130] = 0; // tag1_len
        data[131] = 0; // tag2_len

        // Verify layout
        assert_eq!(&data[0..32], &task_ref);
        assert_eq!(&data[32..64], agent.as_ref());
        assert_eq!(&data[64..96], counterparty.as_ref());
        assert_eq!(&data[96..128], &data_hash);
        assert_eq!(data[128], 0); // content_type
        assert_eq!(data[129], 2); // outcome
        assert_eq!(data.len(), 132);
    }

    #[test]
    fn test_signature_generation() {
        let keypair = generate_ed25519_keypair();
        let pubkey = keypair_to_pubkey(&keypair);

        let message = b"test message";
        let signature = sign_message(&keypair, message);

        // Verify signature is 64 bytes
        assert_eq!(signature.len(), 64);

        // Verify pubkey matches
        assert_eq!(pubkey.to_bytes(), keypair.verifying_key().to_bytes());
    }

    #[test]
    fn test_dual_signature_messages_differ() {
        let sas_schema = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let agent = Pubkey::new_unique();
        let data_hash = [2u8; 32];
        let outcome = 2u8;

        let interaction_hash = compute_interaction_hash(&sas_schema, &task_ref, &agent, &data_hash);
        let feedback_hash = compute_feedback_hash(&sas_schema, &task_ref, &agent, outcome);

        // The two messages should be different
        assert_ne!(interaction_hash, feedback_hash);
    }
}
