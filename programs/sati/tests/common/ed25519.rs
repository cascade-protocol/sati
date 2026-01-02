//! Ed25519 signature helpers for attestation tests
//!
//! Provides utilities to:
//! - Generate Ed25519 keypairs for signing
//! - Create Ed25519 program instructions for signature verification
//! - Compute message hashes matching on-chain signature verification

use ed25519_dalek::{Signer, SigningKey};
use rand::RngCore;
use sha3::{Digest, Keccak256};
use solana_sdk::{bs58, instruction::Instruction, pubkey::Pubkey};

// Domain separator matching constants.rs
// (feedback, validation, reputation domains removed - counterparty now signs SIWS message)
const DOMAIN_INTERACTION: &[u8] = b"SATI:interaction:v1";

/// Generate a new Ed25519 keypair for testing
pub fn generate_ed25519_keypair() -> SigningKey {
    let mut secret_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret_bytes);
    SigningKey::from_bytes(&secret_bytes)
}

/// Sign a message with an Ed25519 keypair
pub fn sign_message(keypair: &SigningKey, message: &[u8]) -> [u8; 64] {
    keypair.sign(message).to_bytes()
}

/// Get the public key from an Ed25519 keypair as a Solana Pubkey
pub fn keypair_to_pubkey(keypair: &SigningKey) -> Pubkey {
    Pubkey::new_from_array(keypair.verifying_key().to_bytes())
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
///
/// Note: Universal layout migration removed token_account from hash.
/// Token account binding is now done via ATA ownership verification.
pub fn compute_interaction_hash(
    sas_schema: &Pubkey,
    task_ref: &[u8; 32],
    data_hash: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(DOMAIN_INTERACTION);
    hasher.update(sas_schema.as_ref());
    hasher.update(task_ref);
    hasher.update(data_hash);
    hasher.finalize().into()
}

// NOTE: compute_feedback_hash, compute_validation_hash, compute_reputation_hash
// were removed in the universal base layout migration. Counterparty now signs
// a human-readable SIWS message (passed as counterparty_message parameter).
// For SingleSigner mode, the provider signs the interaction_hash.

/// Build a SIWS-style counterparty message for signature verification.
/// This message is human-readable and contains key attestation fields.
/// MUST match on-chain build_siws_message() in create_attestation.rs exactly!
pub fn build_counterparty_message(
    schema_name: &str,
    token_account: &Pubkey,
    task_ref: &[u8; 32],
    outcome: u8,
    details: Option<&str>,
) -> Vec<u8> {
    let outcome_label = match outcome {
        0 => "Negative",
        1 => "Neutral",
        2 => "Positive",
        _ => "Reserved",
    };

    let task_b58 = bs58::encode(task_ref).into_string();
    let agent_b58 = token_account.to_string();

    // Must match on-chain format: always includes "Details:" line
    let details_text = details.map_or("(none)".to_string(), |d| d.to_string());

    let text = format!(
        "SATI {schema_name}\n\nAgent: {agent_b58}\nTask: {task_b58}\nOutcome: {outcome_label}\nDetails: {details_text}\n\nSign to create this attestation."
    );

    text.into_bytes()
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
        assert_eq!(pubkey.to_bytes(), keypair.verifying_key().to_bytes());
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
        let data_hash = [2u8; 32];

        let hash1 = compute_interaction_hash(&schema, &task_ref, &data_hash);
        let hash2 = compute_interaction_hash(&schema, &task_ref, &data_hash);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_interaction_hash_varies_by_data_hash() {
        let schema = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let data_hash1 = [1u8; 32];
        let data_hash2 = [2u8; 32];

        let hash1 = compute_interaction_hash(&schema, &task_ref, &data_hash1);
        let hash2 = compute_interaction_hash(&schema, &task_ref, &data_hash2);

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_counterparty_message_format() {
        let token_account = Pubkey::new_unique();
        let task_ref = [1u8; 32];
        let outcome = 2; // Positive

        let msg = build_counterparty_message("Feedback", &token_account, &task_ref, outcome, None);
        let text = String::from_utf8(msg).unwrap();

        assert!(text.starts_with("SATI Feedback\n"));
        assert!(text.contains("Agent:"));
        assert!(text.contains("Task:"));
        assert!(text.contains("Outcome: Positive"));
        assert!(text.contains("Details: (none)")); // Always includes Details line
        assert!(text.ends_with("Sign to create this attestation."));
    }
}
