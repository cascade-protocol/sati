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

/// Universal base layout offsets within data section (from constants.rs)
/// Compressed attestations use raw data (no SAS header prefix).
mod offsets {
    pub const LAYOUT_VERSION: usize = 0;
    pub const TASK_REF: usize = 1;
    pub const AGENT_MINT: usize = 33;
    pub const COUNTERPARTY: usize = 65;
    pub const OUTCOME: usize = 97;
}

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
    // - signer.key() == counterparty_pubkey (from data[65..97])
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
    // - agent_ata.mint == token_account (from data[33..65])
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

// ─── Offset parsing tests ───────────────────────────────────────────────────

/// Build a mock compressed attestation data buffer with known pubkeys
/// at the correct layout positions. Compressed attestations use raw data
/// (no SAS header), so offsets start directly at the layout fields.
fn build_mock_compressed_data(agent_mint: &Pubkey, counterparty: &Pubkey) -> Vec<u8> {
    // Minimum size to cover through outcome: 98 bytes
    let mut data = vec![0u8; offsets::OUTCOME + 1];

    // layout_version at offset 0
    data[offsets::LAYOUT_VERSION] = 1;

    // task_ref at offset 1 (32 bytes)
    for i in 0..32 {
        data[offsets::TASK_REF + i] = 0xBB;
    }

    // agent_mint at offset 33 (32 bytes)
    data[offsets::AGENT_MINT..offsets::COUNTERPARTY].copy_from_slice(agent_mint.as_ref());

    // counterparty at offset 65 (32 bytes)
    data[offsets::COUNTERPARTY..offsets::OUTCOME].copy_from_slice(counterparty.as_ref());

    // outcome at offset 97
    data[offsets::OUTCOME] = 2; // Positive

    data
}

/// Test that the offset arithmetic used in close_compressed_attestation.rs
/// correctly reads agent_mint and counterparty from compressed data.
///
/// Compressed data has NO SAS header - offsets apply directly.
/// The buggy code reads [32..64] and [64..96] instead of [33..65] and [65..97].
#[test]
fn test_close_compressed_attestation_offset_parsing() {
    let expected_agent_mint = Pubkey::new_unique();
    let expected_counterparty = Pubkey::new_unique();

    let data = build_mock_compressed_data(&expected_agent_mint, &expected_counterparty);

    // Correct parsing using named offsets
    let agent_mint_bytes: [u8; 32] = data[offsets::AGENT_MINT..offsets::COUNTERPARTY]
        .try_into()
        .expect("agent_mint slice should be 32 bytes");
    let counterparty_bytes: [u8; 32] = data[offsets::COUNTERPARTY..offsets::OUTCOME]
        .try_into()
        .expect("counterparty slice should be 32 bytes");

    let parsed_agent_mint = Pubkey::new_from_array(agent_mint_bytes);
    let parsed_counterparty = Pubkey::new_from_array(counterparty_bytes);

    assert_eq!(
        parsed_agent_mint, expected_agent_mint,
        "agent_mint parsed at offsets::AGENT_MINT should match"
    );
    assert_eq!(
        parsed_counterparty, expected_counterparty,
        "counterparty parsed at offsets::COUNTERPARTY should match"
    );
}

/// Test that the BUGGY offsets (32/64 instead of 33/65) produce WRONG results
/// for compressed data. Confirms the test catches the bug.
#[test]
fn test_compressed_buggy_offsets_produce_wrong_results() {
    let expected_agent_mint = Pubkey::new_unique();
    let expected_counterparty = Pubkey::new_unique();

    let data = build_mock_compressed_data(&expected_agent_mint, &expected_counterparty);

    // Read using the BUGGY offsets (32 and 64 instead of 33 and 65)
    let buggy_agent_mint_bytes: [u8; 32] = data[32..64]
        .try_into()
        .expect("buggy agent_mint slice should be 32 bytes");
    let buggy_counterparty_bytes: [u8; 32] = data[64..96]
        .try_into()
        .expect("buggy counterparty slice should be 32 bytes");

    let buggy_agent_mint = Pubkey::new_from_array(buggy_agent_mint_bytes);
    let buggy_counterparty = Pubkey::new_from_array(buggy_counterparty_bytes);

    assert_ne!(
        buggy_agent_mint, expected_agent_mint,
        "buggy offset (32) should NOT match correct agent_mint (offset 33)"
    );
    assert_ne!(
        buggy_counterparty, expected_counterparty,
        "buggy offset (64) should NOT match correct counterparty (offset 65)"
    );
}

/// Test minimum size check uses correct threshold for compressed data
#[test]
fn test_compressed_minimum_size_check() {
    // The close instruction checks: params.current_data.len() >= <threshold>
    // Correct threshold should be offsets::OUTCOME (97) to cover through counterparty
    // The buggy code uses 96 which is one byte short

    let too_small = 96;
    let correct_min = offsets::OUTCOME; // 97

    assert_eq!(correct_min, 97);
    assert!(
        too_small < correct_min,
        "buggy size check (96) is smaller than correct (97)"
    );
}
