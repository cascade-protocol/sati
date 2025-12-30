//! Tests for the link_evm_address instruction
//!
//! Tests secp256k1 signature verification for EVM address linking.
//! Uses k256 crate following Anza/Solana SDK recommendations.

use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use sha3::{Digest, Keccak256};
use solana_sdk::{signature::Keypair, signer::Signer, transaction::Transaction};

use crate::common::{
    accounts::{
        create_funded_keypair, create_mock_token22_ata, create_mock_token22_mint,
        derive_token22_ata,
    },
    instructions::build_link_evm_address_ix,
    setup::setup_litesvm,
};

/// Domain separator for EVM link hash (matches program constant)
const DOMAIN_EVM_LINK: &[u8] = b"SATI:evm_link:v1";

/// Compute the EVM link hash that will be verified by the program
fn compute_evm_link_hash(
    agent_mint: &solana_sdk::pubkey::Pubkey,
    evm_address: &[u8; 20],
    chain_id: &str,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_EVM_LINK);
    hasher.update(agent_mint.as_ref());
    hasher.update(evm_address);
    hasher.update(chain_id.as_bytes());
    hasher.finalize().into()
}

/// Derive Ethereum address from secp256k1 public key
fn eth_address_from_pubkey(verifying_key: &VerifyingKey) -> [u8; 20] {
    // Get uncompressed public key (65 bytes: 0x04 || x || y)
    let pubkey_uncompressed = verifying_key.to_encoded_point(false);
    let pubkey_bytes = pubkey_uncompressed.as_bytes();

    // Hash the 64-byte public key (without 0x04 prefix)
    let hash = Keccak256::digest(&pubkey_bytes[1..]);

    // Take last 20 bytes
    hash[12..32].try_into().unwrap()
}

/// Sign a message hash with secp256k1 and return signature + recovery ID
fn sign_message_hash(signing_key: &SigningKey, message_hash: &[u8; 32]) -> ([u8; 64], u8) {
    let (signature, recovery_id): (Signature, RecoveryId) = signing_key
        .sign_prehash_recoverable(message_hash)
        .expect("Signing should succeed");

    let signature_bytes: [u8; 64] = signature.to_bytes().into();
    let recovery_id_byte = recovery_id.to_byte();

    (signature_bytes, recovery_id_byte)
}

/// Helper to set up an agent with Token-2022 mint and ATA
fn setup_agent(
    svm: &mut litesvm::LiteSVM,
    owner: &Keypair,
) -> (solana_sdk::pubkey::Pubkey, solana_sdk::pubkey::Pubkey) {
    let agent_mint = Keypair::new();
    let mint_pubkey = agent_mint.pubkey();

    // Create mock mint
    create_mock_token22_mint(svm, &mint_pubkey, &owner.pubkey());

    // Derive and create ATA with balance of 1 (NFT)
    let ata = derive_token22_ata(&owner.pubkey(), &mint_pubkey);
    create_mock_token22_ata(svm, &ata, &mint_pubkey, &owner.pubkey(), 1);

    (mint_pubkey, ata)
}

/// Test successful EVM address linking with valid signature
#[test]
fn test_link_evm_address_success() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);

    // Set up agent
    let (agent_mint, ata) = setup_agent(&mut svm, &owner);

    // Generate secp256k1 keypair
    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let evm_address = eth_address_from_pubkey(verifying_key);

    // Chain ID for Ethereum mainnet
    let chain_id = "eip155:1";

    // Compute message hash and sign
    let message_hash = compute_evm_link_hash(&agent_mint, &evm_address, chain_id);
    let (signature, recovery_id) = sign_message_hash(&signing_key, &message_hash);

    // Build and execute instruction
    let ix = build_link_evm_address_ix(
        &owner.pubkey(),
        &agent_mint,
        &ata,
        evm_address,
        chain_id.to_string(),
        signature,
        recovery_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Link EVM address should succeed: {:?}",
        result.err()
    );

    println!("✅ test_link_evm_address_success passed");
    println!("   EVM address: 0x{}", hex::encode(evm_address));
    println!("   Chain ID: {}", chain_id);
}

/// Test linking with Base chain ID
#[test]
fn test_link_evm_address_base_chain() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);

    let (agent_mint, ata) = setup_agent(&mut svm, &owner);

    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let evm_address = eth_address_from_pubkey(verifying_key);

    // Base mainnet chain ID
    let chain_id = "eip155:8453";

    let message_hash = compute_evm_link_hash(&agent_mint, &evm_address, chain_id);
    let (signature, recovery_id) = sign_message_hash(&signing_key, &message_hash);

    let ix = build_link_evm_address_ix(
        &owner.pubkey(),
        &agent_mint,
        &ata,
        evm_address,
        chain_id.to_string(),
        signature,
        recovery_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_ok(),
        "Link EVM address with Base chain should succeed: {:?}",
        result.err()
    );

    println!("✅ test_link_evm_address_base_chain passed");
}

/// Test that wrong recovery ID fails
#[test]
fn test_link_evm_address_wrong_recovery_id() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);

    let (agent_mint, ata) = setup_agent(&mut svm, &owner);

    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let evm_address = eth_address_from_pubkey(verifying_key);

    let chain_id = "eip155:1";

    let message_hash = compute_evm_link_hash(&agent_mint, &evm_address, chain_id);
    let (signature, recovery_id) = sign_message_hash(&signing_key, &message_hash);

    // Use wrong recovery ID (flip 0 <-> 1)
    let wrong_recovery_id = if recovery_id == 0 { 1 } else { 0 };

    let ix = build_link_evm_address_ix(
        &owner.pubkey(),
        &agent_mint,
        &ata,
        evm_address,
        chain_id.to_string(),
        signature,
        wrong_recovery_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Link with wrong recovery ID should fail");

    println!("✅ test_link_evm_address_wrong_recovery_id passed");
}

/// Test that mismatched EVM address fails
#[test]
fn test_link_evm_address_mismatch() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);

    let (agent_mint, ata) = setup_agent(&mut svm, &owner);

    let signing_key = SigningKey::random(&mut rand::thread_rng());

    // Generate a different EVM address (not matching the signing key)
    let wrong_evm_address: [u8; 20] = [
        0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA,
        0xBB, 0xCC, 0xDD, 0xEE, 0xFF,
    ];

    let chain_id = "eip155:1";

    // Sign with the wrong address in the hash
    let message_hash = compute_evm_link_hash(&agent_mint, &wrong_evm_address, chain_id);
    let (signature, recovery_id) = sign_message_hash(&signing_key, &message_hash);

    let ix = build_link_evm_address_ix(
        &owner.pubkey(),
        &agent_mint,
        &ata,
        wrong_evm_address,
        chain_id.to_string(),
        signature,
        recovery_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(
        result.is_err(),
        "Link with mismatched EVM address should fail"
    );

    println!("✅ test_link_evm_address_mismatch passed");
}

/// Test that non-owner fails (wrong ATA)
#[test]
fn test_link_evm_address_non_owner() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);
    let non_owner = create_funded_keypair(&mut svm, 10_000_000_000);

    let (agent_mint, ata) = setup_agent(&mut svm, &owner);

    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let evm_address = eth_address_from_pubkey(verifying_key);

    let chain_id = "eip155:1";

    let message_hash = compute_evm_link_hash(&agent_mint, &evm_address, chain_id);
    let (signature, recovery_id) = sign_message_hash(&signing_key, &message_hash);

    // Non-owner tries to link (will fail because their ATA doesn't match)
    let ix = build_link_evm_address_ix(
        &non_owner.pubkey(), // Wrong signer
        &agent_mint,
        &ata, // Still using owner's ATA
        evm_address,
        chain_id.to_string(),
        signature,
        recovery_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&non_owner.pubkey()),
        &[&non_owner],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Link by non-owner should fail");

    println!("✅ test_link_evm_address_non_owner passed");
}

/// Test that zero balance ATA fails
#[test]
fn test_link_evm_address_zero_balance() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);

    let agent_mint = Keypair::new();
    let mint_pubkey = agent_mint.pubkey();

    // Create mock mint
    create_mock_token22_mint(&mut svm, &mint_pubkey, &owner.pubkey());

    // Create ATA with ZERO balance
    let ata = derive_token22_ata(&owner.pubkey(), &mint_pubkey);
    create_mock_token22_ata(&mut svm, &ata, &mint_pubkey, &owner.pubkey(), 0);

    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let evm_address = eth_address_from_pubkey(verifying_key);

    let chain_id = "eip155:1";

    let message_hash = compute_evm_link_hash(&mint_pubkey, &evm_address, chain_id);
    let (signature, recovery_id) = sign_message_hash(&signing_key, &message_hash);

    let ix = build_link_evm_address_ix(
        &owner.pubkey(),
        &mint_pubkey,
        &ata,
        evm_address,
        chain_id.to_string(),
        signature,
        recovery_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Link with zero balance should fail");

    println!("✅ test_link_evm_address_zero_balance passed");
}

/// Test that corrupted signature fails
#[test]
fn test_link_evm_address_corrupted_signature() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);

    let (agent_mint, ata) = setup_agent(&mut svm, &owner);

    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let evm_address = eth_address_from_pubkey(verifying_key);

    let chain_id = "eip155:1";

    let message_hash = compute_evm_link_hash(&agent_mint, &evm_address, chain_id);
    let (mut signature, recovery_id) = sign_message_hash(&signing_key, &message_hash);

    // Corrupt the signature
    signature[0] ^= 0xFF;
    signature[31] ^= 0xFF;

    let ix = build_link_evm_address_ix(
        &owner.pubkey(),
        &agent_mint,
        &ata,
        evm_address,
        chain_id.to_string(),
        signature,
        recovery_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Link with corrupted signature should fail");

    println!("✅ test_link_evm_address_corrupted_signature passed");
}

/// Test multiple EVM addresses can be linked to same agent
#[test]
fn test_link_multiple_evm_addresses() {
    let mut svm = setup_litesvm();
    let owner = create_funded_keypair(&mut svm, 10_000_000_000);

    let (agent_mint, ata) = setup_agent(&mut svm, &owner);

    // Link first EVM address (Ethereum mainnet)
    let signing_key1 = SigningKey::random(&mut rand::thread_rng());
    let verifying_key1 = signing_key1.verifying_key();
    let evm_address1 = eth_address_from_pubkey(verifying_key1);
    let chain_id1 = "eip155:1";

    let message_hash1 = compute_evm_link_hash(&agent_mint, &evm_address1, chain_id1);
    let (signature1, recovery_id1) = sign_message_hash(&signing_key1, &message_hash1);

    let ix1 = build_link_evm_address_ix(
        &owner.pubkey(),
        &agent_mint,
        &ata,
        evm_address1,
        chain_id1.to_string(),
        signature1,
        recovery_id1,
    );

    let tx1 = Transaction::new_signed_with_payer(
        &[ix1],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result1 = svm.send_transaction(tx1);
    assert!(
        result1.is_ok(),
        "First link should succeed: {:?}",
        result1.err()
    );

    // Link second EVM address (Base)
    let signing_key2 = SigningKey::random(&mut rand::thread_rng());
    let verifying_key2 = signing_key2.verifying_key();
    let evm_address2 = eth_address_from_pubkey(verifying_key2);
    let chain_id2 = "eip155:8453";

    let message_hash2 = compute_evm_link_hash(&agent_mint, &evm_address2, chain_id2);
    let (signature2, recovery_id2) = sign_message_hash(&signing_key2, &message_hash2);

    let ix2 = build_link_evm_address_ix(
        &owner.pubkey(),
        &agent_mint,
        &ata,
        evm_address2,
        chain_id2.to_string(),
        signature2,
        recovery_id2,
    );

    let tx2 = Transaction::new_signed_with_payer(
        &[ix2],
        Some(&owner.pubkey()),
        &[&owner],
        svm.latest_blockhash(),
    );

    let result2 = svm.send_transaction(tx2);
    assert!(
        result2.is_ok(),
        "Second link should succeed: {:?}",
        result2.err()
    );

    println!("✅ test_link_multiple_evm_addresses passed");
}
