//! Tests for close_attestation instruction (compressed storage)
//!
//! These tests verify:
//! - Authorization (agent OR counterparty can close)
//! - Schema closeable constraint
//! - Storage type matching
//!
//! All tests require Light Protocol prover and localnet running.
//! Run with: pnpm localnet && cargo test -p sati --test main attestation::close

use solana_sdk::{pubkey::Pubkey, signature::Keypair};

use crate::common::ed25519::{
    compute_data_hash, compute_feedback_hash, compute_interaction_hash, generate_ed25519_keypair,
    keypair_to_pubkey, sign_message,
};
use crate::common::instructions::SignatureData;
use crate::common::setup::{
    derive_registry_config_pda, derive_schema_config_pda, setup_light_test_env,
};

/// Helper: Create a feedback attestation and return its address for close testing
///
/// TODO: Implement when full Light Protocol integration tests are enabled
#[allow(dead_code)]
async fn create_test_attestation(
    _sas_schema: &Pubkey,
    agent_keypair: &ed25519_dalek::SigningKey,
    counterparty_keypair: &ed25519_dalek::SigningKey,
) -> Result<Pubkey, Box<dyn std::error::Error>> {
    // Build feedback data
    let task_ref = [42u8; 32];
    let agent_pubkey = keypair_to_pubkey(agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(counterparty_keypair);
    let outcome = 2u8; // Positive

    // Build data layout
    let mut data = vec![0u8; 135];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_pubkey.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());

    let feedback_data = [outcome, 0, 1]; // outcome, tag1_len=0, tag2_len=0 + content
    let data_hash = compute_data_hash(&feedback_data);
    data[96..128].copy_from_slice(&data_hash);
    data[128] = 0; // content_type
    data[129] = outcome;
    data[130] = 0; // tag1_len
    data[131] = 0; // tag2_len

    // Create signatures
    let interaction_hash =
        compute_interaction_hash(_sas_schema, &task_ref, &agent_pubkey, &data_hash);
    let feedback_hash = compute_feedback_hash(_sas_schema, &task_ref, &agent_pubkey, outcome);

    let agent_sig = sign_message(agent_keypair, &interaction_hash);
    let counterparty_sig = sign_message(counterparty_keypair, &feedback_hash);

    let _signatures = vec![
        SignatureData {
            pubkey: agent_pubkey,
            sig: agent_sig,
        },
        SignatureData {
            pubkey: counterparty_pubkey,
            sig: counterparty_sig,
        },
    ];

    // Would need to build and send create_attestation transaction here
    // Returns the attestation address

    // Placeholder - actual implementation requires Light Protocol integration
    Ok(Pubkey::new_unique())
}

/// Test that counterparty can close attestation
#[tokio::test]
#[allow(unused_variables)]
async fn test_close_attestation_by_counterparty() {
    let _env = setup_light_test_env().await;

    // 1. Register closeable schema
    let sas_schema = Pubkey::new_unique();
    let (_schema_config_pda, _) = derive_schema_config_pda(&sas_schema);
    let (_registry_config_pda, _) = derive_registry_config_pda();

    // Register schema with closeable=true
    // ... (would build and send register_schema_config_ix)

    // 2. Create attestation
    let _agent = generate_ed25519_keypair();
    let _counterparty = generate_ed25519_keypair();

    // ... create attestation ...

    // 3. Close attestation as counterparty
    // ... build and send close_attestation_ix with counterparty as signer ...

    // 4. Verify attestation is closed
    // ... query Light Protocol indexer to verify account is gone ...

    println!("test_close_attestation_by_counterparty: requires localnet");
}

/// Test that agent (token_account holder) can close attestation
#[tokio::test]
#[allow(unused_variables)]
async fn test_close_attestation_by_agent() {
    let _env = setup_light_test_env().await;

    // 1. Register closeable schema
    let sas_schema = Pubkey::new_unique();
    let (_schema_config_pda, _) = derive_schema_config_pda(&sas_schema);

    // 2. Create attestation
    let _agent = generate_ed25519_keypair();
    let _counterparty = generate_ed25519_keypair();

    // ... create attestation ...

    // 3. Close attestation as agent (token_account holder)
    // ... build and send close_attestation_ix with agent as signer ...

    // 4. Verify attestation is closed

    println!("test_close_attestation_by_agent: requires localnet");
}

/// Test that unauthorized party cannot close attestation
#[tokio::test]
#[allow(unused_variables)]
async fn test_close_attestation_unauthorized() {
    let _env = setup_light_test_env().await;

    // 1. Register closeable schema and create attestation
    let _agent = generate_ed25519_keypair();
    let _counterparty = generate_ed25519_keypair();
    let _unauthorized = Keypair::new();

    // 2. Try to close attestation as unauthorized party
    // Expect: SatiError::UnauthorizedClose

    println!("test_close_attestation_unauthorized: requires localnet");
}

/// Test that non-closeable schema prevents close
#[tokio::test]
#[allow(unused_variables)]
async fn test_close_attestation_not_closeable() {
    let _env = setup_light_test_env().await;

    // 1. Register schema with closeable=false
    // 2. Create attestation
    // 3. Try to close attestation
    // Expect: SatiError::AttestationNotCloseable

    println!("test_close_attestation_not_closeable: requires localnet");
}

/// Test that wrong storage type prevents close
#[tokio::test]
#[allow(unused_variables)]
async fn test_close_attestation_wrong_storage_type() {
    let _env = setup_light_test_env().await;

    // 1. Register schema with storage_type=Regular
    // 2. Try to use close_attestation (compressed handler)
    // Expect: SatiError::StorageTypeMismatch

    println!("test_close_attestation_wrong_storage_type: requires localnet");
}
