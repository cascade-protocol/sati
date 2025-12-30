// ============================================================================
// Registry Constants
// ============================================================================

/// Maximum length for agent name (bytes)
pub const MAX_NAME_LENGTH: usize = 32;

/// Maximum length for agent symbol (bytes)
pub const MAX_SYMBOL_LENGTH: usize = 10;

/// Maximum length for URI (bytes)
pub const MAX_URI_LENGTH: usize = 200;

/// Maximum number of additional metadata entries
pub const MAX_METADATA_ENTRIES: usize = 10;

/// Maximum length for metadata key (bytes)
pub const MAX_METADATA_KEY_LENGTH: usize = 32;

/// Maximum length for metadata value (bytes)
pub const MAX_METADATA_VALUE_LENGTH: usize = 200;

/// TLV overhead padding for Token-2022 extensions.
///
/// Each extension adds ~8-12 bytes header (2-byte type + 2-byte length + alignment).
/// With 4-5 extensions (MetadataPointer, GroupMemberPointer, NonTransferable,
/// TokenMetadata, GroupMember), 100 bytes provides a safe margin for:
/// - Extension headers and padding
/// - Future Token-2022 format changes
/// - Account data alignment requirements
pub const TLV_OVERHEAD_PADDING: usize = 100;

/// Threshold for metadata entries that may require additional compute units.
/// Beyond this, clients should request 400k CUs via SetComputeUnitLimit.
pub const LARGE_METADATA_THRESHOLD: usize = 5;

// ============================================================================
// Attestation Constants
// ============================================================================

/// Maximum size for the content field in attestations (bytes).
/// For larger content, use IPFS or Arweave references.
pub const MAX_CONTENT_SIZE: usize = 512;

/// Maximum total size for attestation data (bytes).
/// Includes base layout (96) + schema-specific fields + content.
pub const MAX_ATTESTATION_DATA_SIZE: usize = 768;

/// Minimum size for base layout (bytes).
/// All schemas start with: task_ref(32) + token_account(32) + counterparty(32) = 96 bytes.
///
/// NAMING CONVENTION: `token_account` = agent's **MINT ADDRESS** (stable identity).
/// Authorization for agent signatures is verified via ATA ownership, not pubkey == mint.
pub const MIN_BASE_LAYOUT_SIZE: usize = 96;

/// Maximum length for tag strings in Feedback schema (chars).
pub const MAX_TAG_LENGTH: usize = 32;

/// Domain separator for interaction hash (agent signs blind).
pub const DOMAIN_INTERACTION: &[u8] = b"SATI:interaction:v1";

/// Domain separator for feedback hash (counterparty signs with outcome).
pub const DOMAIN_FEEDBACK: &[u8] = b"SATI:feedback:v1";

/// Domain separator for validation hash (counterparty signs with response).
pub const DOMAIN_VALIDATION: &[u8] = b"SATI:validation:v1";

/// Domain separator for reputation hash (provider signs).
pub const DOMAIN_REPUTATION: &[u8] = b"SATI:reputation:v1";

/// Domain separator for EVM address linking.
pub const DOMAIN_EVM_LINK: &[u8] = b"SATI:evm_link:v1";

// ============================================================================
// SAS (Solana Attestation Service) Layout Constants
// ============================================================================

/// SAS attestation header layout:
/// - discriminator: 1 byte
/// - nonce: 32 bytes
/// - credential: 32 bytes
/// - schema: 32 bytes
/// - data_len: 4 bytes (u32)
///
/// Total header size before data payload.
pub const SAS_HEADER_SIZE: usize = 1 + 32 + 32 + 32 + 4; // 101 bytes

/// Offset to the data payload in SAS attestation account.
pub const SAS_DATA_OFFSET: usize = SAS_HEADER_SIZE;

// ============================================================================
// Data Layout Offsets (must match SDK schemas.ts)
// ============================================================================

/// Base layout offsets (all schemas).
/// All schemas start with: task_ref(32) + token_account(32) + counterparty(32).
pub mod offsets {
    /// task_ref offset (32 bytes)
    pub const TASK_REF: usize = 0;
    /// token_account (agent mint address) offset (32 bytes)
    pub const TOKEN_ACCOUNT: usize = 32;
    /// counterparty offset (32 bytes)
    pub const COUNTERPARTY: usize = 64;

    /// Feedback schema offsets (data_type = 0)
    pub mod feedback {
        /// data_hash offset (32 bytes)
        pub const DATA_HASH: usize = 96;
        /// content_type offset (1 byte)
        pub const CONTENT_TYPE: usize = 128;
        /// outcome offset (1 byte) - fixed for memcmp filtering
        pub const OUTCOME: usize = 129;
        /// tag1_len offset (1 byte, variable-length string follows)
        pub const TAG1_LEN: usize = 130;
    }

    /// Validation schema offsets (data_type = 1)
    pub mod validation {
        /// data_hash offset (32 bytes)
        pub const DATA_HASH: usize = 96;
        /// content_type offset (1 byte)
        pub const CONTENT_TYPE: usize = 128;
        /// validation_type offset (1 byte)
        pub const VALIDATION_TYPE: usize = 129;
        /// response offset (1 byte) - fixed for memcmp filtering
        pub const RESPONSE: usize = 130;
        /// content_len offset (4 bytes u32)
        pub const CONTENT_LEN: usize = 131;
    }

    /// ReputationScore schema offsets (data_type = 2)
    pub mod reputation_score {
        /// score offset (1 byte, 0-100)
        pub const SCORE: usize = 96;
        /// content_type offset (1 byte)
        pub const CONTENT_TYPE: usize = 97;
        /// content_len offset (4 bytes u32)
        pub const CONTENT_LEN: usize = 98;
    }
}
