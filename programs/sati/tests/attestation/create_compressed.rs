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
        build_counterparty_message, compute_attestation_nonce, compute_data_hash,
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

/// SchemaConfig account size with "Feedback" name (8 bytes):
/// 8 (discriminator) + 32 (sas_schema) + 1 (signature_mode) + 1 (storage_type) + 1 (closeable) + 4 (name len) + 8 (name "Feedback") + 1 (bump) = 56 bytes
const SCHEMA_CONFIG_SIZE: usize = 56;

/// Schema name used in SIWS messages - must match build_counterparty_message calls
const SCHEMA_NAME: &str = "Feedback";

/// Token-2022 program ID
const TOKEN_2022_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// ATA program ID
const ATA_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// Derive ATA address for Token-2022
fn derive_token22_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            owner.as_ref(),
            TOKEN_2022_PROGRAM_ID.as_ref(),
            mint.as_ref(),
        ],
        &ATA_PROGRAM_ID,
    )
    .0
}

/// Create mock Token-2022 mint account data
fn create_mock_mint_data(mint_authority: &Pubkey) -> Vec<u8> {
    use spl_token_2022::{extension::StateWithExtensionsMut, state::Mint};

    let space = 82; // Mint::LEN
    let mut data = vec![0u8; space];

    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();
    state.base.mint_authority = solana_sdk::program_option::COption::Some(*mint_authority);
    state.base.supply = 1; // NFT
    state.base.decimals = 0;
    state.base.is_initialized = true;
    state.base.freeze_authority = solana_sdk::program_option::COption::None;
    state.pack_base();

    data
}

/// Create mock Token-2022 ATA account data
fn create_mock_ata_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let space = 165; // Token account size for Token-2022
    let mut data = vec![0u8; space];

    // mint (0..32)
    data[0..32].copy_from_slice(mint.as_ref());
    // owner (32..64)
    data[32..64].copy_from_slice(owner.as_ref());
    // amount (64..72)
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    // delegate option (72..76) - 0 = None
    data[72..76].copy_from_slice(&[0, 0, 0, 0]);
    // state (108) - 1 = Initialized
    data[108] = 1;

    data
}

/// Test successful create_attestation with DualSignature (Feedback)
#[tokio::test]
async fn test_create_attestation_feedback_success() {
    // 1. Setup Light Protocol test environment with SATI program
    let LightTestEnv { mut rpc, payer, .. } = setup_light_test_env().await;

    // 2. Create and mock SchemaConfig PDA
    let sas_schema = Pubkey::new_unique();
    let (schema_config_pda, bump) = derive_schema_config_pda(&sas_schema);

    // Mock SchemaConfig account (avoids Token-2022 registry setup)
    // Layout: discriminator(8) + sas_schema(32) + signature_mode(1) + storage_type(1) + closeable(1) + name_len(4) + name(N) + bump(1)
    let mut schema_data = vec![0u8; SCHEMA_CONFIG_SIZE];
    let discriminator = compute_anchor_discriminator("SchemaConfig");
    schema_data[0..8].copy_from_slice(&discriminator);
    schema_data[8..40].copy_from_slice(sas_schema.as_ref()); // sas_schema
    schema_data[40] = SignatureMode::DualSignature as u8; // signature_mode
    schema_data[41] = StorageType::Compressed as u8; // storage_type
    schema_data[42] = 1; // closeable = true
    schema_data[43..47].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes()); // name length
    schema_data[47..47 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes()); // name
    schema_data[47 + SCHEMA_NAME.len()] = bump; // bump

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
    // agent_keypair = NFT OWNER (the signer)
    // agent_mint = agent's NFT identity (token_account in data)
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair); // Owner who signs
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    // Create agent's NFT mint (the stable identity)
    let agent_mint = Pubkey::new_unique();

    // 3b. Mock the agent's Token-2022 mint and ATA
    // The ATA proves agent_pubkey owns the agent_mint NFT
    let agent_ata = derive_token22_ata(&agent_pubkey, &agent_mint);

    // Create mock mint account
    rpc.set_account(
        agent_mint,
        Account {
            lamports: 1_000_000,
            data: create_mock_mint_data(&agent_pubkey),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Create mock ATA with 1 token (NFT)
    rpc.set_account(
        agent_ata,
        Account {
            lamports: 1_000_000,
            data: create_mock_ata_data(&agent_mint, &agent_pubkey, 1),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // 4. Build attestation data (Universal 130-byte layout)
    // Layout: task_ref(32) + token_account(32) + counterparty(32) + outcome(1) + data_hash(32) + content_type(1) + content(N)
    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test task data");
    let outcome: u8 = 2; // Positive feedback

    let mut data = vec![0u8; 130]; // Minimum universal layout
    data[0..32].copy_from_slice(&task_ref); // task_ref
    data[32..64].copy_from_slice(agent_mint.as_ref()); // token_account = MINT address
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref()); // counterparty
    data[96] = outcome; // outcome
    data[97..129].copy_from_slice(&data_hash); // data_hash
    data[129] = 0; // content_type = 0 (None) - no content

    // 5. Compute message hashes and sign
    // Agent signs interaction_hash (no token_account in hash)
    // Counterparty signs SIWS message
    let agent_message = compute_interaction_hash(&sas_schema, &task_ref, &data_hash);
    let counterparty_msg = build_counterparty_message(SCHEMA_NAME, &agent_mint, &task_ref, outcome, None);

    let agent_sig = sign_message(&agent_keypair, &agent_message);
    let counterparty_sig = sign_message(&counterparty_keypair, &counterparty_msg);

    // 6. Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // 7. Derive compressed account address
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;

    // Nonce uses agent_mint (identity), not agent_pubkey
    let nonce =
        compute_attestation_nonce(&task_ref, &sas_schema, &agent_mint, &counterparty_pubkey);

    // Build seeds matching on-chain derive_address call
    // Uses agent_mint (the stable identity)
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        agent_mint.as_ref(),
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

    // 11. agent_ata was already derived and mocked in step 3b

    // Build instructions
    let ed25519_ix = create_multi_ed25519_ix(&[
        (&agent_pubkey, &agent_message, &agent_sig),
        (&counterparty_pubkey, &counterparty_msg, &counterparty_sig),
    ]);
    let attestation_ix = build_create_attestation_ix(
        &payer.pubkey(),
        &schema_config_pda,
        &agent_ata,
        params,
        system_accounts,
    );

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
    schema_data[43..47].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes()); // name length
    schema_data[47..47 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes()); // name
    schema_data[47 + SCHEMA_NAME.len()] = bump; // bump

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

    // Create keypairs and mock Token-2022 accounts
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    let agent_mint = Pubkey::new_unique();
    let agent_ata = derive_token22_ata(&agent_pubkey, &agent_mint);

    rpc.set_account(
        agent_mint,
        Account {
            lamports: 1_000_000,
            data: create_mock_mint_data(&agent_pubkey),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    rpc.set_account(
        agent_ata,
        Account {
            lamports: 1_000_000,
            data: create_mock_ata_data(&agent_mint, &agent_pubkey, 1),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Build attestation data (Universal 130-byte layout)
    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 140];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_mint.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());
    data[96] = outcome;
    data[97..129].copy_from_slice(&data_hash);
    data[129] = 0; // content_type = None (no content)

    // Build signatures
    let interaction_hash = compute_interaction_hash(&sas_schema, &task_ref, &data_hash);
    let counterparty_msg = build_counterparty_message(SCHEMA_NAME, &agent_mint, &task_ref, outcome, None);
    let agent_sig = sign_message(&agent_keypair, &interaction_hash);
    let counterparty_sig = sign_message(&counterparty_keypair, &counterparty_msg);

    // Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // Derive compressed account address
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;
    let nonce =
        compute_attestation_nonce(&task_ref, &sas_schema, &agent_mint, &counterparty_pubkey);
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        agent_mint.as_ref(),
        &nonce,
    ];
    let (compressed_address, _) = derive_address(seeds, &address_tree_pubkey, &SATI_PROGRAM_ID);

    // Get validity proof
    let rpc_result = rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: compressed_address,
                tree: address_tree_pubkey,
            }],
            None,
        )
        .await
        .expect("Failed to get validity proof")
        .value;

    let packed_tree_infos = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let address_tree_info = packed_tree_infos.address_trees[0];
    let output_state_tree_index =
        remaining_accounts.insert_or_get(rpc.get_random_state_tree_info().unwrap().tree);
    let (system_accounts, _, _) = remaining_accounts.to_account_metas();

    let params = CreateParams {
        data_type: 0,
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

    // Build ONLY attestation instruction (no Ed25519 instruction)
    let attestation_ix = build_create_attestation_ix(
        &payer.pubkey(),
        &schema_config_pda,
        &agent_ata,
        params,
        system_accounts,
    );

    // Send transaction WITHOUT Ed25519 instruction - should fail with MissingSignatures
    let result = rpc
        .create_and_send_transaction(&[attestation_ix], &payer.pubkey(), &[&payer])
        .await;

    assert!(
        result.is_err(),
        "Transaction should fail without Ed25519 instruction"
    );
    let err_str = format!("{:?}", result.unwrap_err());
    // MissingSignatures = error code 6029
    assert!(
        err_str.contains("MissingSignatures") || err_str.contains("6029"),
        "Expected MissingSignatures error (6029), got: {}",
        err_str
    );
}

/// Test that create_attestation fails with wrong signature (message mismatch)
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
    schema_data[43..47].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes()); // name length
    schema_data[47..47 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes()); // name
    schema_data[47 + SCHEMA_NAME.len()] = bump; // bump

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

    // Create keypairs and mock Token-2022 accounts
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    let agent_mint = Pubkey::new_unique();
    let agent_ata = derive_token22_ata(&agent_pubkey, &agent_mint);

    rpc.set_account(
        agent_mint,
        Account {
            lamports: 1_000_000,
            data: create_mock_mint_data(&agent_pubkey),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    rpc.set_account(
        agent_ata,
        Account {
            lamports: 1_000_000,
            data: create_mock_ata_data(&agent_mint, &agent_pubkey, 1),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Build attestation data
    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 140];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_mint.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());
    data[96] = outcome;
    data[97..129].copy_from_slice(&data_hash);
    data[129] = 0; // content_type = None (no content)

    // Define correct counterparty message (needed for CreateParams)
    let counterparty_msg = build_counterparty_message(SCHEMA_NAME, &agent_mint, &task_ref, outcome, None);

    // Sign WRONG message hashes (valid signatures, but for wrong messages)
    let wrong_hash = compute_data_hash(b"wrong message");
    let agent_sig = sign_message(&agent_keypair, &wrong_hash);
    let counterparty_sig = sign_message(&counterparty_keypair, &wrong_hash);

    // Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // Derive compressed account address
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;
    let nonce =
        compute_attestation_nonce(&task_ref, &sas_schema, &agent_mint, &counterparty_pubkey);
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        agent_mint.as_ref(),
        &nonce,
    ];
    let (compressed_address, _) = derive_address(seeds, &address_tree_pubkey, &SATI_PROGRAM_ID);

    // Get validity proof
    let rpc_result = rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: compressed_address,
                tree: address_tree_pubkey,
            }],
            None,
        )
        .await
        .expect("Failed to get validity proof")
        .value;

    let packed_tree_infos = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let address_tree_info = packed_tree_infos.address_trees[0];
    let output_state_tree_index =
        remaining_accounts.insert_or_get(rpc.get_random_state_tree_info().unwrap().tree);
    let (system_accounts, _, _) = remaining_accounts.to_account_metas();

    let params = CreateParams {
        data_type: 0,
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

    let attestation_ix = build_create_attestation_ix(
        &payer.pubkey(),
        &schema_config_pda,
        &agent_ata,
        params,
        system_accounts,
    );

    // Ed25519 instruction with valid signatures but for WRONG messages
    let ed25519_ix = create_multi_ed25519_ix(&[
        (&agent_pubkey, &wrong_hash, &agent_sig),
        (&counterparty_pubkey, &wrong_hash, &counterparty_sig),
    ]);

    // Send transaction - should fail with MessageMismatch
    let result = rpc
        .create_and_send_transaction(&[ed25519_ix, attestation_ix], &payer.pubkey(), &[&payer])
        .await;

    assert!(
        result.is_err(),
        "Transaction should fail with wrong message hash"
    );
    let err_str = format!("{:?}", result.unwrap_err());
    // MessageMismatch = error code 6030
    assert!(
        err_str.contains("MessageMismatch") || err_str.contains("6030"),
        "Expected MessageMismatch error (6030), got: {}",
        err_str
    );
}

/// Test that create_attestation fails with wrong signer (signature verification fails)
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
    schema_data[43..47].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes()); // name length
    schema_data[47..47 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes()); // name
    schema_data[47 + SCHEMA_NAME.len()] = bump; // bump

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

    // Create keypairs - wrong_keypair is different from agent_keypair
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let wrong_keypair = generate_ed25519_keypair();

    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    // Mock Token-2022 accounts
    let agent_mint = Pubkey::new_unique();
    let agent_ata = derive_token22_ata(&agent_pubkey, &agent_mint);

    rpc.set_account(
        agent_mint,
        Account {
            lamports: 1_000_000,
            data: create_mock_mint_data(&agent_pubkey),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    rpc.set_account(
        agent_ata,
        Account {
            lamports: 1_000_000,
            data: create_mock_ata_data(&agent_mint, &agent_pubkey, 1),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 140];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_mint.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());
    data[96] = outcome;
    data[97..129].copy_from_slice(&data_hash);
    data[129] = 0; // content_type = None (no content)

    // Sign with correct hashes but WRONG keypair for agent
    let interaction_hash = compute_interaction_hash(&sas_schema, &task_ref, &data_hash);
    let counterparty_msg = build_counterparty_message(SCHEMA_NAME, &agent_mint, &task_ref, outcome, None);

    // Sign with wrong_keypair instead of agent_keypair
    let agent_sig = sign_message(&wrong_keypair, &interaction_hash);
    let counterparty_sig = sign_message(&counterparty_keypair, &counterparty_msg);

    // Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // Derive compressed account address
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;
    let nonce =
        compute_attestation_nonce(&task_ref, &sas_schema, &agent_mint, &counterparty_pubkey);
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        agent_mint.as_ref(),
        &nonce,
    ];
    let (compressed_address, _) = derive_address(seeds, &address_tree_pubkey, &SATI_PROGRAM_ID);

    // Get validity proof
    let rpc_result = rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: compressed_address,
                tree: address_tree_pubkey,
            }],
            None,
        )
        .await
        .expect("Failed to get validity proof")
        .value;

    let packed_tree_infos = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let address_tree_info = packed_tree_infos.address_trees[0];
    let output_state_tree_index =
        remaining_accounts.insert_or_get(rpc.get_random_state_tree_info().unwrap().tree);
    let (system_accounts, _, _) = remaining_accounts.to_account_metas();

    let params = CreateParams {
        data_type: 0,
        data: data.clone(),
        signatures: vec![
            SignatureData {
                pubkey: agent_pubkey, // Claims to be agent_pubkey
                sig: agent_sig,       // But signed by wrong_keypair
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

    let attestation_ix = build_create_attestation_ix(
        &payer.pubkey(),
        &schema_config_pda,
        &agent_ata,
        params,
        system_accounts,
    );

    // Ed25519 instruction with pubkey that doesn't match the actual signer
    // The Ed25519 precompile will fail because signature was created by wrong_keypair
    let ed25519_ix = create_multi_ed25519_ix(&[
        (&agent_pubkey, &interaction_hash, &agent_sig), // Mismatch: pubkey vs signer
        (&counterparty_pubkey, &counterparty_msg, &counterparty_sig),
    ]);

    // Send transaction - Ed25519 precompile should reject due to signature mismatch
    let result = rpc
        .create_and_send_transaction(&[ed25519_ix, attestation_ix], &payer.pubkey(), &[&payer])
        .await;

    assert!(result.is_err(), "Transaction should fail with wrong signer");
    // Ed25519 precompile returns Custom(2) for signature verification failure
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("Custom(2)")
            || err_str.contains("InvalidAccountData")
            || err_str.contains("SignatureVerificationFailed")
            || err_str.contains("PrecompileError"),
        "Expected Ed25519 signature verification failure, got: {}",
        err_str
    );
}

/// Test that create_attestation fails with self-attestation (token_account == counterparty)
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
    schema_data[43..47].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes()); // name length
    schema_data[47..47 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes()); // name
    schema_data[47 + SCHEMA_NAME.len()] = bump; // bump

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

    // Use SAME identity for both agent (token_account) and counterparty
    let self_keypair = generate_ed25519_keypair();
    let self_pubkey = keypair_to_pubkey(&self_keypair);

    // For self-attestation, we use the same mint for both parties
    let self_mint = Pubkey::new_unique();
    let self_ata = derive_token22_ata(&self_pubkey, &self_mint);

    rpc.set_account(
        self_mint,
        Account {
            lamports: 1_000_000,
            data: create_mock_mint_data(&self_pubkey),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    rpc.set_account(
        self_ata,
        Account {
            lamports: 1_000_000,
            data: create_mock_ata_data(&self_mint, &self_pubkey, 1),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    // token_account = self_mint AND counterparty = self_mint (SAME!)
    let mut data = vec![0u8; 140];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(self_mint.as_ref()); // token_account = self_mint
    data[64..96].copy_from_slice(self_mint.as_ref()); // counterparty = self_mint (SAME!)
    data[96] = outcome;
    data[97..129].copy_from_slice(&data_hash);
    data[129] = 0; // content_type = None (no content)

    // Build signatures (both from same keypair, but for different message types)
    let interaction_hash = compute_interaction_hash(&sas_schema, &task_ref, &data_hash);
    let counterparty_msg = build_counterparty_message(SCHEMA_NAME, &self_mint, &task_ref, outcome, None);
    let agent_sig = sign_message(&self_keypair, &interaction_hash);
    let counterparty_sig = sign_message(&self_keypair, &counterparty_msg);

    // Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // Derive compressed account address
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;
    let nonce = compute_attestation_nonce(&task_ref, &sas_schema, &self_mint, &self_mint);
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        self_mint.as_ref(),
        &nonce,
    ];
    let (compressed_address, _) = derive_address(seeds, &address_tree_pubkey, &SATI_PROGRAM_ID);

    // Get validity proof
    let rpc_result = rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: compressed_address,
                tree: address_tree_pubkey,
            }],
            None,
        )
        .await
        .expect("Failed to get validity proof")
        .value;

    let packed_tree_infos = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let address_tree_info = packed_tree_infos.address_trees[0];
    let output_state_tree_index =
        remaining_accounts.insert_or_get(rpc.get_random_state_tree_info().unwrap().tree);
    let (system_accounts, _, _) = remaining_accounts.to_account_metas();

    let params = CreateParams {
        data_type: 0,
        data: data.clone(),
        signatures: vec![
            SignatureData {
                pubkey: self_pubkey,
                sig: agent_sig,
            },
            SignatureData {
                pubkey: self_pubkey, // Same pubkey for both signatures
                sig: counterparty_sig,
            },
        ],
        output_state_tree_index,
        proof: rpc_result.proof,
        address_tree_info,
    };

    let attestation_ix = build_create_attestation_ix(
        &payer.pubkey(),
        &schema_config_pda,
        &self_ata,
        params,
        system_accounts,
    );

    // Ed25519 instruction with same signer for both
    let ed25519_ix = create_multi_ed25519_ix(&[
        (&self_pubkey, &interaction_hash, &agent_sig),
        (&self_pubkey, &counterparty_msg, &counterparty_sig),
    ]);

    // Send transaction - should fail with SelfAttestationNotAllowed
    let result = rpc
        .create_and_send_transaction(&[ed25519_ix, attestation_ix], &payer.pubkey(), &[&payer])
        .await;

    assert!(
        result.is_err(),
        "Transaction should fail for self-attestation"
    );
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("SelfAttestationNotAllowed")
            || err_str.contains("DuplicateSigners")
            || err_str.contains("6020")
            || err_str.contains("6037"),
        "Expected SelfAttestationNotAllowed or DuplicateSigners error, got: {}",
        err_str
    );
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
    schema_data[43..47].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes()); // name length
    schema_data[47..47 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes()); // name
    schema_data[47 + SCHEMA_NAME.len()] = bump; // bump

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

    // Create keypairs and mock Token-2022 accounts
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    let agent_mint = Pubkey::new_unique();
    let agent_ata = derive_token22_ata(&agent_pubkey, &agent_mint);

    rpc.set_account(
        agent_mint,
        Account {
            lamports: 1_000_000,
            data: create_mock_mint_data(&agent_pubkey),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    rpc.set_account(
        agent_ata,
        Account {
            lamports: 1_000_000,
            data: create_mock_ata_data(&agent_mint, &agent_pubkey, 1),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Data too small (only 64 bytes, need at least 130 for universal layout)
    let data = vec![0u8; 64];

    // Create arbitrary signatures for Ed25519 instruction (to avoid MissingSignatures error)
    let dummy_message = compute_data_hash(b"dummy");
    let agent_sig = sign_message(&agent_keypair, &dummy_message);
    let counterparty_sig = sign_message(&counterparty_keypair, &dummy_message);
    let counterparty_msg = b"dummy message".to_vec(); // Won't be validated since data is too small

    // Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // Use dummy values for address derivation (won't actually be created)
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;
    let task_ref = [1u8; 32];
    let nonce =
        compute_attestation_nonce(&task_ref, &sas_schema, &agent_mint, &counterparty_pubkey);
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        agent_mint.as_ref(),
        &nonce,
    ];
    let (compressed_address, _) = derive_address(seeds, &address_tree_pubkey, &SATI_PROGRAM_ID);

    // Get validity proof
    let rpc_result = rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: compressed_address,
                tree: address_tree_pubkey,
            }],
            None,
        )
        .await
        .expect("Failed to get validity proof")
        .value;

    let packed_tree_infos = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let address_tree_info = packed_tree_infos.address_trees[0];
    let output_state_tree_index =
        remaining_accounts.insert_or_get(rpc.get_random_state_tree_info().unwrap().tree);
    let (system_accounts, _, _) = remaining_accounts.to_account_metas();

    let params = CreateParams {
        data_type: 0,
        data: data.clone(), // Too small!
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

    let attestation_ix = build_create_attestation_ix(
        &payer.pubkey(),
        &schema_config_pda,
        &agent_ata,
        params,
        system_accounts,
    );

    // Ed25519 instruction (signatures are valid but for wrong messages)
    let ed25519_ix = create_multi_ed25519_ix(&[
        (&agent_pubkey, &dummy_message, &agent_sig),
        (&counterparty_pubkey, &dummy_message, &counterparty_sig),
    ]);

    // Send transaction - should fail with AttestationDataTooSmall
    let result = rpc
        .create_and_send_transaction(&[ed25519_ix, attestation_ix], &payer.pubkey(), &[&payer])
        .await;

    assert!(
        result.is_err(),
        "Transaction should fail with data too small"
    );
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("AttestationDataTooSmall") || err_str.contains("6016"),
        "Expected AttestationDataTooSmall error, got: {}",
        err_str
    );
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
    schema_data[43..47].copy_from_slice(&(SCHEMA_NAME.len() as u32).to_le_bytes()); // name length
    schema_data[47..47 + SCHEMA_NAME.len()].copy_from_slice(SCHEMA_NAME.as_bytes()); // name
    schema_data[47 + SCHEMA_NAME.len()] = bump; // bump

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

    // Create keypairs and mock Token-2022 accounts
    let agent_keypair = generate_ed25519_keypair();
    let counterparty_keypair = generate_ed25519_keypair();
    let agent_pubkey = keypair_to_pubkey(&agent_keypair);
    let counterparty_pubkey = keypair_to_pubkey(&counterparty_keypair);

    let agent_mint = Pubkey::new_unique();
    let agent_ata = derive_token22_ata(&agent_pubkey, &agent_mint);

    rpc.set_account(
        agent_mint,
        Account {
            lamports: 1_000_000,
            data: create_mock_mint_data(&agent_pubkey),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    rpc.set_account(
        agent_ata,
        Account {
            lamports: 1_000_000,
            data: create_mock_ata_data(&agent_mint, &agent_pubkey, 1),
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    // Build valid attestation data
    let task_ref = [1u8; 32];
    let data_hash = compute_data_hash(b"test");
    let outcome: u8 = 2;

    let mut data = vec![0u8; 140];
    data[0..32].copy_from_slice(&task_ref);
    data[32..64].copy_from_slice(agent_mint.as_ref());
    data[64..96].copy_from_slice(counterparty_pubkey.as_ref());
    data[96] = outcome;
    data[97..129].copy_from_slice(&data_hash);
    data[129] = 0; // content_type = None (no content)

    // Build valid signatures
    let interaction_hash = compute_interaction_hash(&sas_schema, &task_ref, &data_hash);
    let counterparty_msg = build_counterparty_message(SCHEMA_NAME, &agent_mint, &task_ref, outcome, None);
    let agent_sig = sign_message(&agent_keypair, &interaction_hash);
    let counterparty_sig = sign_message(&counterparty_keypair, &counterparty_msg);

    // Build remaining_accounts for Light Protocol CPI
    let mut remaining_accounts = PackedAccounts::default();
    let system_config = SystemAccountMetaConfig::new(SATI_PROGRAM_ID);
    let _ = remaining_accounts.add_system_accounts(system_config);

    // Derive compressed account address
    let address_tree_info = rpc.get_address_tree_v1();
    let address_tree_pubkey = address_tree_info.tree;
    let nonce =
        compute_attestation_nonce(&task_ref, &sas_schema, &agent_mint, &counterparty_pubkey);
    let seeds: &[&[u8]] = &[
        b"attestation",
        sas_schema.as_ref(),
        agent_mint.as_ref(),
        &nonce,
    ];
    let (compressed_address, _) = derive_address(seeds, &address_tree_pubkey, &SATI_PROGRAM_ID);

    // Get validity proof
    let rpc_result = rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: compressed_address,
                tree: address_tree_pubkey,
            }],
            None,
        )
        .await
        .expect("Failed to get validity proof")
        .value;

    let packed_tree_infos = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let address_tree_info = packed_tree_infos.address_trees[0];
    let output_state_tree_index =
        remaining_accounts.insert_or_get(rpc.get_random_state_tree_info().unwrap().tree);
    let (system_accounts, _, _) = remaining_accounts.to_account_metas();

    let params = CreateParams {
        data_type: 0,
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

    let attestation_ix = build_create_attestation_ix(
        &payer.pubkey(),
        &schema_config_pda,
        &agent_ata,
        params,
        system_accounts,
    );

    // Ed25519 instruction with valid signatures
    let ed25519_ix = create_multi_ed25519_ix(&[
        (&agent_pubkey, &interaction_hash, &agent_sig),
        (&counterparty_pubkey, &counterparty_msg, &counterparty_sig),
    ]);

    // Send transaction - should fail with StorageTypeMismatch
    let result = rpc
        .create_and_send_transaction(&[ed25519_ix, attestation_ix], &payer.pubkey(), &[&payer])
        .await;

    assert!(
        result.is_err(),
        "Transaction should fail with wrong storage type"
    );
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("StorageTypeMismatch") || err_str.contains("6015"),
        "Expected StorageTypeMismatch error, got: {}",
        err_str
    );
}

// ============================================================================
// Unit tests for test helpers (these can run without Light Protocol)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feedback_data_layout() {
        // Verify our test data layout matches universal base layout specification:
        // Offset 0-31:   task_ref (32 bytes)
        // Offset 32-63:  token_account (32 bytes)
        // Offset 64-95:  counterparty (32 bytes)
        // Offset 96:     outcome (1 byte: 0=Negative, 1=Neutral, 2=Positive)
        // Offset 97-128: data_hash (32 bytes)
        // Offset 129:    content_type (1 byte: 0=None, 1=JSON, etc.)
        // Offset 130+:   content (variable, up to 512 bytes)
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();
        let counterparty = Pubkey::new_unique();
        let data_hash = [2u8; 32];
        let outcome: u8 = 2; // Positive
        let content_type: u8 = 1; // JSON

        // Build 130-byte minimum universal base layout
        let mut data = [0u8; 130];
        data[0..32].copy_from_slice(&task_ref);
        data[32..64].copy_from_slice(token_account.as_ref());
        data[64..96].copy_from_slice(counterparty.as_ref());
        data[96] = outcome;
        data[97..129].copy_from_slice(&data_hash);
        data[129] = content_type;

        // Verify layout matches specification offsets
        assert_eq!(&data[0..32], &task_ref, "task_ref at offset 0-31");
        assert_eq!(&data[32..64], token_account.as_ref(), "token_account at offset 32-63");
        assert_eq!(&data[64..96], counterparty.as_ref(), "counterparty at offset 64-95");
        assert_eq!(data[96], outcome, "outcome at offset 96");
        assert_eq!(&data[97..129], &data_hash, "data_hash at offset 97-128");
        assert_eq!(data[129], content_type, "content_type at offset 129");
        assert_eq!(data.len(), 130, "minimum base layout size");
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
        let token_account = Pubkey::new_unique();
        let data_hash = [2u8; 32];
        let outcome = 2u8;

        // Agent signs interaction_hash (blind commitment)
        let interaction_hash = compute_interaction_hash(&sas_schema, &task_ref, &data_hash);

        // Counterparty signs SIWS message (human-readable)
        let counterparty_message =
            build_counterparty_message(SCHEMA_NAME, &token_account, &task_ref, outcome, None);

        // The two messages should be different (one is hash, one is SIWS text)
        assert_ne!(interaction_hash.to_vec(), counterparty_message);
    }
}
