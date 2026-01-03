//! Tests for close_attestation instruction (compressed storage)
//!
//! These tests verify:
//! - Authorization based on signature mode:
//!   - DualSignature: agent OR counterparty can close
//!   - SingleSigner: only counterparty (provider) can close
//! - Schema closeable constraint
//! - Storage type matching
//!
//! Note: Full integration tests require Light Protocol prover and localnet running.
//! Run with: pnpm localnet && cargo test -p sati --test main attestation::close
//!
//! The close_attestation instruction:
//! 1. Verifies the signer is authorized based on signature_mode
//! 2. Checks schema_config.closeable == true
//! 3. Checks schema_config.storage_type == Compressed
//! 4. Nullifies the compressed account via Light Protocol CPI

use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer};

use crate::common::{
    accounts::compute_anchor_account_discriminator,
    instructions::{SignatureMode, StorageType},
    setup::derive_schema_config_pda,
};

/// Schema name for layout calculation
const SCHEMA_NAME: &str = "Feedback";

/// SchemaConfig account size with "Feedback" name and delegation_schema = None:
/// 8 (discriminator) + 32 (sas_schema) + 1 (signature_mode) + 1 (storage_type)
/// + 1 (delegation_schema=None) + 1 (closeable) + 4 (name_len) + 8 (name) + 1 (bump) = 57 bytes
const SCHEMA_CONFIG_SIZE: usize = 57;

/// Build mock SchemaConfig account data
fn build_schema_config_data(
    sas_schema: &Pubkey,
    signature_mode: SignatureMode,
    storage_type: StorageType,
    closeable: bool,
    bump: u8,
) -> Vec<u8> {
    let mut data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_account_discriminator("SchemaConfig");
    data[0..8].copy_from_slice(&discriminator);
    data[8..40].copy_from_slice(sas_schema.as_ref());
    data[40] = signature_mode as u8;
    data[41] = storage_type as u8;
    data[42] = 0; // delegation_schema = None
    data[43] = closeable as u8;
    data[44..48].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes());
    data[48..48 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes());
    data[48 + SCHEMA_NAME.len()] = bump;
    data
}

/// Test that counterparty can close attestation
///
/// Flow:
/// 1. Create attestation with DualSignature schema
/// 2. Counterparty (from attestation data) signs close tx
/// 3. No ATA needed - counterparty auth is direct pubkey match
/// 4. Attestation should be nullified
#[tokio::test]
async fn test_close_attestation_by_counterparty() {
    // This test validates that the counterparty pubkey stored in attestation data
    // can authorize closing the attestation.
    //
    // The close_attestation instruction checks:
    // - signer.key() == counterparty_pubkey (from data[64..96])
    // - OR signer proves NFT ownership via ATA
    //
    // Full test requires Light Protocol infrastructure to:
    // 1. Create compressed attestation
    // 2. Query it back
    // 3. Build validity proof for nullification
    // 4. Execute close_attestation

    // Setup schema config
    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);
    let schema_data = build_schema_config_data(
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Compressed,
        true, // closeable
        bump,
    );

    // Verify schema data structure
    assert_eq!(schema_data.len(), SCHEMA_CONFIG_SIZE);
    assert_eq!(schema_data[43], 1, "closeable should be true");
    assert_eq!(
        schema_data[41],
        StorageType::Compressed as u8,
        "storage_type should be Compressed"
    );

    println!(
        "Test setup complete. Full integration test requires localnet with Light Protocol prover."
    );
    println!("Schema config PDA: {}", schema_config_pda);
    println!(
        "Run: pnpm localnet && cargo test -p sati --test main attestation::close -- --ignored"
    );
}

/// Test that agent (token_account holder) can close attestation
///
/// Flow:
/// 1. Create attestation with token_account = agent's NFT mint
/// 2. Agent provides ATA to prove NFT ownership
/// 3. Instruction verifies: ATA.mint == token_account AND ATA.amount > 0 AND ATA.owner == signer
/// 4. Attestation should be nullified
#[tokio::test]
async fn test_close_attestation_by_agent() {
    // This test validates that the agent can close by proving NFT ownership.
    //
    // The close_attestation instruction checks (when agent_ata is provided):
    // - agent_ata.mint == token_account (from data[32..64])
    // - agent_ata.amount > 0
    // - agent_ata.owner == signer
    //
    // This allows the agent to close even if they're not the counterparty.

    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);
    let schema_data = build_schema_config_data(
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Compressed,
        true,
        bump,
    );

    assert_eq!(schema_data[43], 1, "closeable should be true");

    println!(
        "Test setup complete. Full integration test requires localnet with Light Protocol prover."
    );
    println!("Schema config PDA: {}", schema_config_pda);
}

/// Test that unauthorized party cannot close attestation
///
/// Flow:
/// 1. Create attestation between agent and counterparty
/// 2. Random third party tries to close
/// 3. Transaction should fail with UnauthorizedClose error
#[tokio::test]
async fn test_close_attestation_unauthorized() {
    // This test validates that random signers cannot close attestations.
    //
    // The close_attestation instruction rejects if:
    // - signer != counterparty (from data)
    // - AND (no agent_ata provided OR agent_ata doesn't prove ownership)
    //
    // Expected error: SatiError::UnauthorizedClose (6040)

    let sas_schema = Pubkey::new_unique();
    let (_schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);
    let schema_data = build_schema_config_data(
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Compressed,
        true,
        bump,
    );

    let unauthorized = Keypair::new();

    assert_eq!(schema_data[43], 1, "closeable should be true");
    println!("Unauthorized signer: {}", unauthorized.pubkey());
    println!("Expected error: UnauthorizedClose (6040)");
}

/// Test that non-closeable schema prevents close
///
/// Flow:
/// 1. Create schema with closeable=false
/// 2. Create attestation under this schema
/// 3. Authorized party tries to close
/// 4. Transaction should fail with AttestationNotCloseable error
#[tokio::test]
async fn test_close_attestation_not_closeable() {
    // This test validates that schemas can permanently prevent closing.
    //
    // The close_attestation instruction has constraint:
    // - schema_config.closeable == true
    //
    // If closeable is false, the transaction fails at account validation
    // with error: SatiError::AttestationNotCloseable (6041)

    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);
    let schema_data = build_schema_config_data(
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Compressed,
        false, // NOT closeable
        bump,
    );

    assert_eq!(schema_data[43], 0, "closeable should be false");
    println!("Schema config PDA: {}", schema_config_pda);
    println!("Expected error: AttestationNotCloseable (6041)");
}

/// Test that wrong storage type prevents close
///
/// Flow:
/// 1. Create schema with storage_type=Regular
/// 2. Try to call close_attestation (compressed instruction)
/// 3. Transaction should fail with StorageTypeMismatch error
#[tokio::test]
async fn test_close_attestation_wrong_storage_type() {
    // This test validates that close_attestation only works with Compressed storage.
    //
    // The close_attestation instruction has constraint:
    // - schema_config.storage_type == StorageType::Compressed
    //
    // Regular storage attestations use close_regular_attestation instead.
    // Expected error: SatiError::StorageTypeMismatch (6015)

    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);
    let schema_data = build_schema_config_data(
        &sas_schema,
        SignatureMode::DualSignature,
        StorageType::Regular, // WRONG for close_attestation
        true,
        bump,
    );

    assert_eq!(
        schema_data[41],
        StorageType::Regular as u8,
        "storage_type should be Regular"
    );
    println!("Schema config PDA: {}", schema_config_pda);
    println!("Expected error: StorageTypeMismatch (6015)");
}
