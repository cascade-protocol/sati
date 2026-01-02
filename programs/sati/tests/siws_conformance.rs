//! SIWS Message Format Conformance Tests
//!
//! These tests verify that the Rust SIWS message builder produces output
//! matching the shared test vectors. The same vectors are used by TypeScript
//! tests to ensure cross-language consistency.
//!
//! If these tests fail after a format change, update the vectors file and
//! verify TypeScript tests also pass with the new expected values.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use solana_sdk::pubkey::Pubkey;

/// Build a SIWS-style counterparty message for signature verification.
/// This message is human-readable and contains key attestation fields.
/// MUST match on-chain build_siws_message() in create_attestation.rs exactly!
fn build_counterparty_message(
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

#[derive(Debug, Deserialize)]
struct Vector {
    name: String,
    #[serde(rename = "schemaName")]
    schema_name: String,
    #[serde(rename = "tokenAccountHex")]
    token_account_hex: String,
    #[serde(rename = "taskRefHex")]
    task_ref_hex: String,
    outcome: u8,
    #[serde(rename = "contentType")]
    content_type: u8,
    #[serde(rename = "contentHex")]
    content_hex: String,
    #[serde(rename = "expectedBase64")]
    expected_base64: String,
}

#[derive(Debug, Deserialize)]
struct VectorsFile {
    vectors: Vec<Vector>,
}

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    if hex.is_empty() {
        return Vec::new();
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

fn decode_content_for_display(content: &[u8], content_type: u8) -> String {
    if content.is_empty() {
        return "(none)".to_string();
    }

    match content_type {
        0 => "(none)".to_string(),
        1 | 2 => String::from_utf8(content.to_vec())
            .unwrap_or_else(|_| format!("({} bytes)", content.len())),
        3 => format!("ipfs://{}", bs58::encode(content).into_string()),
        4 => format!("ar://{}", bs58::encode(content).into_string()),
        5 => "(encrypted)".to_string(),
        _ => format!("({} bytes)", content.len()),
    }
}

#[test]
fn siws_message_matches_test_vectors() {
    let vectors_json = include_str!("fixtures/siws-vectors.json");
    let vectors_file: VectorsFile =
        serde_json::from_str(vectors_json).expect("Failed to parse siws-vectors.json");

    for vector in vectors_file.vectors {
        // Parse inputs
        let token_account_bytes = hex_to_bytes(&vector.token_account_hex);
        let task_ref_bytes = hex_to_bytes(&vector.task_ref_hex);
        let content_bytes = hex_to_bytes(&vector.content_hex);

        let token_account = Pubkey::new_from_array(
            token_account_bytes
                .try_into()
                .expect("token_account must be 32 bytes"),
        );
        let task_ref: [u8; 32] = task_ref_bytes
            .try_into()
            .expect("task_ref must be 32 bytes");

        // Decode content for display
        let details = decode_content_for_display(&content_bytes, vector.content_type);
        let details_opt = if details == "(none)" {
            None
        } else {
            Some(details.as_str())
        };

        // Build SIWS message using test helper
        let result = build_counterparty_message(
            &vector.schema_name,
            &token_account,
            &task_ref,
            vector.outcome,
            details_opt,
        );

        // Encode result as base64 for comparison
        let result_base64 = BASE64.encode(&result);

        assert_eq!(
            result_base64, vector.expected_base64,
            "\n\nVector '{}' failed!\n\nExpected:\n{}\n\nGot:\n{}\n\nDecoded expected:\n{}\n\nDecoded got:\n{}\n",
            vector.name,
            vector.expected_base64,
            result_base64,
            String::from_utf8_lossy(&BASE64.decode(&vector.expected_base64).unwrap_or_default()),
            String::from_utf8_lossy(&result)
        );
    }
}

/// Test that helps generate expected values for new vectors.
/// Run with: cargo test -p sati --test siws_conformance generate_vector_expected -- --nocapture
#[test]
#[ignore]
fn generate_vector_expected() {
    // Generate expected values for all vectors in the file
    let vectors_json = include_str!("fixtures/siws-vectors.json");
    let vectors_file: VectorsFile =
        serde_json::from_str(vectors_json).expect("Failed to parse siws-vectors.json");

    for vector in vectors_file.vectors {
        let token_account_bytes = hex_to_bytes(&vector.token_account_hex);
        let task_ref_bytes = hex_to_bytes(&vector.task_ref_hex);
        let content_bytes = hex_to_bytes(&vector.content_hex);

        let token_account = Pubkey::new_from_array(
            token_account_bytes
                .try_into()
                .expect("token_account must be 32 bytes"),
        );
        let task_ref: [u8; 32] = task_ref_bytes
            .try_into()
            .expect("task_ref must be 32 bytes");

        let details = decode_content_for_display(&content_bytes, vector.content_type);
        let details_opt = if details == "(none)" {
            None
        } else {
            Some(details.as_str())
        };

        let result = build_counterparty_message(
            &vector.schema_name,
            &token_account,
            &task_ref,
            vector.outcome,
            details_opt,
        );

        println!("=== {} ===", vector.name);
        println!("\"expectedBase64\": \"{}\"", BASE64.encode(&result));
        println!();
    }
}
