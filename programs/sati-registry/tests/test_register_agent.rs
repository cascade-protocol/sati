//! Tests for register_agent instruction
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//!
//! The register_agent instruction performs many Token-2022 CPIs which are complex
//! to test with Mollusk. These tests focus on input validation errors that occur
//! before the CPIs are executed.

mod helpers;

use helpers::{
    accounts::{
        program_account, system_account, system_program_account, token2022_program_account,
        uninitialized_account,
    },
    errors::{error_code, SatiError},
    instructions::{
        build_register_agent, derive_ata_token2022, derive_group_mint, derive_registry_config,
        PROGRAM_ID,
    },
    serialization::{serialize_registry_config, REGISTRY_CONFIG_SIZE},
    setup_mollusk,
};
use mollusk_svm::result::Check;
use solana_sdk::{
    program_error::ProgramError, pubkey::Pubkey, rent::Rent, signature::Keypair, signer::Signer,
};

/// Helper to create an initialized registry config account
fn initialized_registry_config(authority: Pubkey, bump: u8) -> (Vec<u8>, u64) {
    let (group_mint, _) = derive_group_mint();
    let data = serialize_registry_config(group_mint, authority, 0, bump);
    let lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);
    (data, lamports)
}

/// Helper to create associated token program account
fn associated_token_program_account() -> (Pubkey, solana_sdk::account::Account) {
    (
        spl_associated_token_account::id(),
        solana_sdk::account::Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        },
    )
}

#[test]
fn test_register_agent_name_too_long_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry
    let (registry_data, registry_lamports) = initialized_registry_config(payer, bump);

    // Name too long (max 32 bytes)
    let long_name = "x".repeat(33);

    // Build instruction with long name
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        &long_name,
        "AGENT",
        "https://example.com/agent.json",
        None,
        false,
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (group_mint, uninitialized_account()), // Would be initialized in real test
        (agent_mint.pubkey(), uninitialized_account()),
        (agent_token_account, uninitialized_account()),
        token2022_program_account(),
        associated_token_program_account(),
        system_program_account(),
    ];

    // Should fail with NameTooLong
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::NameTooLong,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_register_agent_symbol_too_long_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry
    let (registry_data, registry_lamports) = initialized_registry_config(payer, bump);

    // Symbol too long (max 10 bytes)
    let long_symbol = "X".repeat(11);

    // Build instruction with long symbol
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        &long_symbol,
        "https://example.com/agent.json",
        None,
        false,
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (group_mint, uninitialized_account()),
        (agent_mint.pubkey(), uninitialized_account()),
        (agent_token_account, uninitialized_account()),
        token2022_program_account(),
        associated_token_program_account(),
        system_program_account(),
    ];

    // Should fail with SymbolTooLong
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::SymbolTooLong,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_register_agent_uri_too_long_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry
    let (registry_data, registry_lamports) = initialized_registry_config(payer, bump);

    // URI too long (max 200 bytes)
    let long_uri = format!("https://example.com/{}", "x".repeat(200));

    // Build instruction with long URI
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        "AGENT",
        &long_uri,
        None,
        false,
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (group_mint, uninitialized_account()),
        (agent_mint.pubkey(), uninitialized_account()),
        (agent_token_account, uninitialized_account()),
        token2022_program_account(),
        associated_token_program_account(),
        system_program_account(),
    ];

    // Should fail with UriTooLong
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::UriTooLong,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_register_agent_too_many_metadata_entries_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry
    let (registry_data, registry_lamports) = initialized_registry_config(payer, bump);

    // Too many metadata entries (max 10)
    let metadata: Vec<(String, String)> = (0..11)
        .map(|i| (format!("key{}", i), format!("value{}", i)))
        .collect();

    // Build instruction with too many metadata entries
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        "AGENT",
        "https://example.com/agent.json",
        Some(&metadata),
        false,
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (group_mint, uninitialized_account()),
        (agent_mint.pubkey(), uninitialized_account()),
        (agent_token_account, uninitialized_account()),
        token2022_program_account(),
        associated_token_program_account(),
        system_program_account(),
    ];

    // Should fail with TooManyMetadataEntries
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::TooManyMetadataEntries,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_register_agent_metadata_key_too_long_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry
    let (registry_data, registry_lamports) = initialized_registry_config(payer, bump);

    // Metadata key too long (max 32 bytes)
    let long_key = "k".repeat(33);
    let metadata: Vec<(String, String)> = vec![(long_key, "value".to_string())];

    // Build instruction with long metadata key
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        "AGENT",
        "https://example.com/agent.json",
        Some(&metadata),
        false,
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (group_mint, uninitialized_account()),
        (agent_mint.pubkey(), uninitialized_account()),
        (agent_token_account, uninitialized_account()),
        token2022_program_account(),
        associated_token_program_account(),
        system_program_account(),
    ];

    // Should fail with MetadataKeyTooLong
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::MetadataKeyTooLong,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

#[test]
fn test_register_agent_metadata_value_too_long_fails() {
    let mollusk = setup_mollusk();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let (group_mint, _) = derive_group_mint();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Create initialized registry
    let (registry_data, registry_lamports) = initialized_registry_config(payer, bump);

    // Metadata value too long (max 200 bytes)
    let long_value = "v".repeat(201);
    let metadata: Vec<(String, String)> = vec![("key".to_string(), long_value)];

    // Build instruction with long metadata value
    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        "AGENT",
        "https://example.com/agent.json",
        Some(&metadata),
        false,
    );

    // Setup account states
    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (group_mint, uninitialized_account()),
        (agent_mint.pubkey(), uninitialized_account()),
        (agent_token_account, uninitialized_account()),
        token2022_program_account(),
        associated_token_program_account(),
        system_program_account(),
    ];

    // Should fail with MetadataValueTooLong
    let checks = vec![Check::err(ProgramError::Custom(error_code(
        SatiError::MetadataValueTooLong,
    )))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}
