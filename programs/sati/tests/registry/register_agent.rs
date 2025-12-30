//! Tests for register_agent instruction
//!
//! Note: Full integration tests require Token-2022 with TokenGroup extensions
//! which have complex setup requirements. These tests focus on:
//! - Input validation (name/symbol/uri length)
//! - Account constraints (via expected errors)
//!
//! For full E2E testing, use the TypeScript SDK tests against devnet/localnet.

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction, pubkey::Pubkey, signature::Keypair, signer::Signer,
    transaction::Transaction,
};

use crate::common::instructions::{accounts, build_initialize_ix, instruction};
use crate::common::setup::{
    derive_registry_config_pda, setup_litesvm, ATA_PROGRAM_ID, SATI_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
};

use sati::state::MetadataEntry;

const SYSTEM_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("11111111111111111111111111111111");

/// Build register_agent instruction
#[allow(clippy::too_many_arguments)]
fn build_register_agent_ix(
    payer: &Pubkey,
    owner: &Pubkey,
    registry_config: &Pubkey,
    group_mint: &Pubkey,
    agent_mint: &Pubkey,
    agent_token_account: &Pubkey,
    name: String,
    symbol: String,
    uri: String,
    additional_metadata: Option<Vec<MetadataEntry>>,
    non_transferable: bool,
) -> Instruction {
    let instruction_data = instruction::RegisterAgent {
        name,
        symbol,
        uri,
        additional_metadata,
        non_transferable,
    };
    let accts = accounts::RegisterAgent {
        payer: *payer,
        owner: *owner,
        registry_config: *registry_config,
        group_mint: *group_mint,
        agent_mint: *agent_mint,
        agent_token_account: *agent_token_account,
        token_2022_program: TOKEN_2022_PROGRAM_ID,
        associated_token_program: ATA_PROGRAM_ID,
        system_program: SYSTEM_PROGRAM_ID,
    };

    Instruction {
        program_id: SATI_PROGRAM_ID,
        accounts: accts.to_account_metas(None),
        data: instruction_data.data(),
    }
}

/// Initialize registry for testing using proper Token-2022 mock
fn initialize_test_registry(svm: &mut LiteSVM, authority: &Keypair) -> (Pubkey, Pubkey) {
    use crate::common::accounts::create_mock_group_mint;

    let (registry_pda, _bump) = derive_registry_config_pda();

    // Create a group mint with proper TokenGroup extension
    let group_mint = Keypair::new();
    create_mock_group_mint(svm, &group_mint, &registry_pda);

    // Initialize registry - group_mint is NOT a signer
    let init_ix = build_initialize_ix(&authority.pubkey(), &registry_pda, &group_mint.pubkey());

    let tx = Transaction::new_signed_with_payer(
        &[init_ix],
        Some(&authority.pubkey()),
        &[authority], // Only authority signs, not group_mint
        svm.latest_blockhash(),
    );

    svm.send_transaction(tx)
        .expect("Registry init should succeed");

    (registry_pda, group_mint.pubkey())
}

#[test]
fn test_register_agent_name_too_long() {
    let mut svm = setup_litesvm();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let (registry_pda, group_mint) = initialize_test_registry(&mut svm, &authority);

    let agent_mint = Keypair::new();
    let owner = authority.pubkey();

    // Derive ATA
    let (agent_ata, _) = Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            agent_mint.pubkey().as_ref(),
        ],
        &ATA_PROGRAM_ID,
    );

    // Name longer than 32 bytes
    let long_name = "A".repeat(33);

    let ix = build_register_agent_ix(
        &authority.pubkey(),
        &owner,
        &registry_pda,
        &group_mint,
        &agent_mint.pubkey(),
        &agent_ata,
        long_name,
        "SYM".to_string(),
        "https://example.com".to_string(),
        None,
        false,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority, &agent_mint],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Should fail with name too long");
}

#[test]
fn test_register_agent_symbol_too_long() {
    let mut svm = setup_litesvm();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let (registry_pda, group_mint) = initialize_test_registry(&mut svm, &authority);

    let agent_mint = Keypair::new();
    let owner = authority.pubkey();

    let (agent_ata, _) = Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            agent_mint.pubkey().as_ref(),
        ],
        &ATA_PROGRAM_ID,
    );

    // Symbol longer than 10 bytes
    let long_symbol = "S".repeat(11);

    let ix = build_register_agent_ix(
        &authority.pubkey(),
        &owner,
        &registry_pda,
        &group_mint,
        &agent_mint.pubkey(),
        &agent_ata,
        "TestAgent".to_string(),
        long_symbol,
        "https://example.com".to_string(),
        None,
        false,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority, &agent_mint],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Should fail with symbol too long");
}

#[test]
fn test_register_agent_uri_too_long() {
    let mut svm = setup_litesvm();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let (registry_pda, group_mint) = initialize_test_registry(&mut svm, &authority);

    let agent_mint = Keypair::new();
    let owner = authority.pubkey();

    let (agent_ata, _) = Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            agent_mint.pubkey().as_ref(),
        ],
        &ATA_PROGRAM_ID,
    );

    // URI longer than 200 bytes
    let long_uri = format!("https://example.com/{}", "x".repeat(190));

    let ix = build_register_agent_ix(
        &authority.pubkey(),
        &owner,
        &registry_pda,
        &group_mint,
        &agent_mint.pubkey(),
        &agent_ata,
        "TestAgent".to_string(),
        "SYM".to_string(),
        long_uri,
        None,
        false,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority, &agent_mint],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Should fail with URI too long");
}

#[test]
fn test_register_agent_too_many_metadata_entries() {
    let mut svm = setup_litesvm();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let (registry_pda, group_mint) = initialize_test_registry(&mut svm, &authority);

    let agent_mint = Keypair::new();
    let owner = authority.pubkey();

    let (agent_ata, _) = Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            agent_mint.pubkey().as_ref(),
        ],
        &ATA_PROGRAM_ID,
    );

    // More than 10 metadata entries
    let too_many_entries: Vec<MetadataEntry> = (0..11)
        .map(|i| MetadataEntry {
            key: format!("key{}", i),
            value: format!("value{}", i),
        })
        .collect();

    let ix = build_register_agent_ix(
        &authority.pubkey(),
        &owner,
        &registry_pda,
        &group_mint,
        &agent_mint.pubkey(),
        &agent_ata,
        "TestAgent".to_string(),
        "SYM".to_string(),
        "https://example.com".to_string(),
        Some(too_many_entries),
        false,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority, &agent_mint],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_err(),
        "Should fail with too many metadata entries"
    );
}

#[test]
fn test_register_agent_metadata_key_too_long() {
    let mut svm = setup_litesvm();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let (registry_pda, group_mint) = initialize_test_registry(&mut svm, &authority);

    let agent_mint = Keypair::new();
    let owner = authority.pubkey();

    let (agent_ata, _) = Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            agent_mint.pubkey().as_ref(),
        ],
        &ATA_PROGRAM_ID,
    );

    // Metadata key longer than 32 bytes
    let entries = vec![MetadataEntry {
        key: "k".repeat(33),
        value: "value".to_string(),
    }];

    let ix = build_register_agent_ix(
        &authority.pubkey(),
        &owner,
        &registry_pda,
        &group_mint,
        &agent_mint.pubkey(),
        &agent_ata,
        "TestAgent".to_string(),
        "SYM".to_string(),
        "https://example.com".to_string(),
        Some(entries),
        false,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority, &agent_mint],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Should fail with metadata key too long");
}

#[test]
fn test_register_agent_metadata_value_too_long() {
    let mut svm = setup_litesvm();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let (registry_pda, group_mint) = initialize_test_registry(&mut svm, &authority);

    let agent_mint = Keypair::new();
    let owner = authority.pubkey();

    let (agent_ata, _) = Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            agent_mint.pubkey().as_ref(),
        ],
        &ATA_PROGRAM_ID,
    );

    // Metadata value longer than 200 bytes
    let entries = vec![MetadataEntry {
        key: "key".to_string(),
        value: "v".repeat(201),
    }];

    let ix = build_register_agent_ix(
        &authority.pubkey(),
        &owner,
        &registry_pda,
        &group_mint,
        &agent_mint.pubkey(),
        &agent_ata,
        "TestAgent".to_string(),
        "SYM".to_string(),
        "https://example.com".to_string(),
        Some(entries),
        false,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[&authority, &agent_mint],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Should fail with metadata value too long");
}
