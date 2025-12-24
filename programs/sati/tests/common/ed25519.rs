//! Ed25519 signature helpers for attestation tests
//!
//! Provides utilities to:
//! - Generate Ed25519 keypairs for signing
//! - Create Ed25519 program instructions for signature verification
//! - Compute message hashes matching on-chain signature verification

use ed25519_dalek::{Keypair, Signer};
use sha3::{Digest, Keccak256};
use solana_sdk::{instruction::Instruction, pubkey::Pubkey};

// Domain separators matching constants.rs
const DOMAIN_INTERACTION: &[u8] = b"SATI:interaction:v1";
const DOMAIN_FEEDBACK: &[u8] = b"SATI:feedback:v1";
const DOMAIN_VALIDATION: &[u8] = b"SATI:validation:v1";
const DOMAIN_REPUTATION: &[u8] = b"SATI:reputation:v1";

/// Generate a new Ed25519 keypair for testing
pub fn generate_ed25519_keypair() -> Keypair {
    Keypair::generate(&mut rand::thread_rng())
}

/// Sign a message with an Ed25519 keypair
pub fn sign_message(keypair: &Keypair, message: &[u8]) -> [u8; 64] {
    keypair.sign(message).to_bytes()
}

/// Get the public key from an Ed25519 keypair as a Solana Pubkey
pub fn keypair_to_pubkey(keypair: &Keypair) -> Pubkey {
    Pubkey::new_from_array(keypair.public.to_bytes())
}

/// Create an Ed25519 program instruction for signature verification
///
/// Data layout matches solana_sdk::ed25519_instruction format:
/// - Header: num_signatures (1) + padding (1)
/// - Offset struct: 14 bytes
/// - Payload: pubkey (32) + signature (64) + message (variable)
pub fn create_ed25519_ix(pubkey: &Pubkey, message: &[u8], signature: &[u8; 64]) -> Instruction {
    let num_signatures: u8 = 1;

    // Data layout after header (2 bytes) and offset struct (14 bytes):
    // Offset 16: public key (32 bytes)
    // Offset 48: signature (64 bytes)
    // Offset 112: message (variable)

    let public_key_offset: u16 = 16;
    let signature_offset: u16 = 48;
    let message_offset: u16 = 112;
    let message_size: u16 = message.len() as u16;

    let mut data = Vec::with_capacity(112 + message.len());

    // Header
    data.push(num_signatures);
    data.push(0); // padding

    // Offset structure (order: sig_offset, sig_ix, pk_offset, pk_ix, msg_offset, msg_size, msg_ix)
    data.extend_from_slice(&signature_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // signature instruction index (this instruction)
    data.extend_from_slice(&public_key_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // pubkey instruction index
    data.extend_from_slice(&message_offset.to_le_bytes());
    data.extend_from_slice(&message_size.to_le_bytes()); // message SIZE comes before instruction index
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // message instruction index

    // Payload: pubkey, signature, message
    data.extend_from_slice(pubkey.as_ref());
    data.extend_from_slice(signature);
    data.extend_from_slice(message);

    Instruction {
        program_id: solana_sdk::ed25519_program::ID,
        accounts: vec![],
        data,
    }
}

/// Create Ed25519 instruction for multiple signatures
///
/// Data layout matches solana_sdk::ed25519_instruction format:
/// - Header: num_signatures (1) + padding (1)
/// - Offset structs: 14 bytes each (signature_offset, sig_ix, pubkey_offset, pk_ix, msg_offset, msg_ix, msg_size)
/// - Payloads: pubkey (32) + signature (64) + message (variable) for each
pub fn create_multi_ed25519_ix(
    signatures: &[(&Pubkey, &[u8], &[u8; 64])], // (pubkey, message, signature)
) -> Instruction {
    let num_signatures = signatures.len() as u8;
    let offsets_size = 14 * signatures.len();
    let payloads_start = 2 + offsets_size;

    // Build offset structs and payloads in a single pass
    let mut offset_data = Vec::with_capacity(offsets_size);
    let mut payload_data = Vec::new();
    let mut current_offset = payloads_start;

    for &(pubkey, message, signature) in signatures {
        // Order in payload: pubkey, signature, message (matches solana_sdk)
        let public_key_offset = current_offset as u16;
        let signature_offset = (current_offset + 32) as u16;
        let message_offset = (current_offset + 32 + 64) as u16;
        let message_size = message.len() as u16;

        offset_data.extend_from_slice(&signature_offset.to_le_bytes());
        offset_data.extend_from_slice(&u16::MAX.to_le_bytes()); // signature instruction index
        offset_data.extend_from_slice(&public_key_offset.to_le_bytes());
        offset_data.extend_from_slice(&u16::MAX.to_le_bytes()); // pubkey instruction index
        offset_data.extend_from_slice(&message_offset.to_le_bytes());
        offset_data.extend_from_slice(&message_size.to_le_bytes()); // message SIZE before instruction index
        offset_data.extend_from_slice(&u16::MAX.to_le_bytes()); // message instruction index

        // Build payload: pubkey, signature, message
        payload_data.extend_from_slice(pubkey.as_ref());
        payload_data.extend_from_slice(signature);
        payload_data.extend_from_slice(message);

        current_offset += 32 + 64 + message.len();
    }

    // Combine: header + offsets + payloads
    let mut data = Vec::with_capacity(2 + offset_data.len() + payload_data.len());
    data.push(num_signatures);
    data.push(0); // padding
    data.extend(offset_data);
    data.extend(payload_data);

    Instruction {
        program_id: solana_sdk::ed25519_program::ID,
        accounts: vec![],
        data,
    }
}

// ============================================================================
// Hash computation functions matching on-chain implementation
// ============================================================================

/// Compute the interaction hash that the agent signs (blind to outcome).
/// Domain: SATI:interaction:v1
pub fn compute_interaction_hash(
    sas_schema: &Pubkey,
    task_ref: &[u8; 32],
    token_account: &Pubkey,
    data_hash: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_INTERACTION);
    hasher.update(sas_schema.as_ref());
    hasher.update(task_ref);
    hasher.update(token_account.as_ref());
    hasher.update(data_hash);
    hasher.finalize().into()
}

/// Compute the feedback hash that the counterparty signs (with outcome).
/// Domain: SATI:feedback:v1
pub fn compute_feedback_hash(
    sas_schema: &Pubkey,
    task_ref: &[u8; 32],
    token_account: &Pubkey,
    outcome: u8,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_FEEDBACK);
    hasher.update(sas_schema.as_ref());
    hasher.update(task_ref);
    hasher.update(token_account.as_ref());
    hasher.update([outcome]);
    hasher.finalize().into()
}

/// Compute the validation hash that the counterparty signs (with response score).
/// Domain: SATI:validation:v1
pub fn compute_validation_hash(
    sas_schema: &Pubkey,
    task_ref: &[u8; 32],
    token_account: &Pubkey,
    response: u8,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_VALIDATION);
    hasher.update(sas_schema.as_ref());
    hasher.update(task_ref);
    hasher.update(token_account.as_ref());
    hasher.update([response]);
    hasher.finalize().into()
}

/// Compute the reputation hash that the provider signs.
/// Domain: SATI:reputation:v1
pub fn compute_reputation_hash(
    sas_schema: &Pubkey,
    token_account: &Pubkey,
    provider: &Pubkey,
    score: u8,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_REPUTATION);
    hasher.update(sas_schema.as_ref());
    hasher.update(token_account.as_ref());
    hasher.update(provider.as_ref());
    hasher.update([score]);
    hasher.finalize().into()
}

/// Compute data hash for attestation data (Keccak256)
pub fn compute_data_hash(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Compute nonce for attestation address derivation (matches on-chain)
///
/// The nonce is a Keccak256 hash of the attestation identifiers,
/// ensuring each attestation gets a unique deterministic address.
pub fn compute_attestation_nonce(
    task_ref: &[u8; 32],
    sas_schema: &Pubkey,
    token_account: &Pubkey,
    counterparty: &Pubkey,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(task_ref);
    hasher.update(sas_schema.as_ref());
    hasher.update(token_account.as_ref());
    hasher.update(counterparty.as_ref());
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_sign() {
        let keypair = generate_ed25519_keypair();
        let message = b"test message";
        let signature = sign_message(&keypair, message);

        // Signature should be 64 bytes
        assert_eq!(signature.len(), 64);

        // Pubkey conversion should work
        let pubkey = keypair_to_pubkey(&keypair);
        assert_eq!(pubkey.to_bytes(), keypair.public.to_bytes());
    }

    #[test]
    fn test_ed25519_instruction_format() {
        let keypair = generate_ed25519_keypair();
        let pubkey = keypair_to_pubkey(&keypair);
        let message = b"test message";
        let signature = sign_message(&keypair, message);

        let ix = create_ed25519_ix(&pubkey, message, &signature);

        // Check program ID
        assert_eq!(ix.program_id, solana_sdk::ed25519_program::ID);

        // Check data length: 2 (header) + 14 (offsets) + 64 (sig) + 32 (pubkey) + message
        let expected_len = 2 + 14 + 64 + 32 + message.len();
        assert_eq!(ix.data.len(), expected_len);

        // Check num_signatures
        assert_eq!(ix.data[0], 1);
    }

    #[test]
    fn test_hash_functions_deterministic() {
        let schema = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();
        let data_hash = [2u8; 32];

        let hash1 = compute_interaction_hash(&schema, &task_ref, &token_account, &data_hash);
        let hash2 = compute_interaction_hash(&schema, &task_ref, &token_account, &data_hash);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_feedback_hash_varies_by_outcome() {
        let schema = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let token_account = Pubkey::new_unique();

        let hash_neg = compute_feedback_hash(&schema, &task_ref, &token_account, 0);
        let hash_pos = compute_feedback_hash(&schema, &task_ref, &token_account, 2);

        assert_ne!(hash_neg, hash_pos);
    }
}
