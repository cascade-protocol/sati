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
/// Includes universal base layout (130) + variable content.
pub const MAX_ATTESTATION_DATA_SIZE: usize = 768;

/// Minimum size for universal base layout (bytes).
/// All schemas use: task_ref(32) + token_account(32) + counterparty(32) +
/// outcome(1) + data_hash(32) + content_type(1) = 130 bytes.
///
/// NAMING CONVENTION: `token_account` = agent's **MINT ADDRESS** (stable identity).
/// Authorization for agent signatures is verified via ATA ownership, not pubkey == mint.
pub const MIN_BASE_LAYOUT_SIZE: usize = 130;

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

/// Universal base layout offsets (all schemas).
/// All schemas share identical first 130 bytes.
pub mod offsets {
    /// task_ref offset (32 bytes) - CAIP-220 tx hash or task identifier
    pub const TASK_REF: usize = 0;
    /// token_account (agent mint address) offset (32 bytes)
    pub const TOKEN_ACCOUNT: usize = 32;
    /// counterparty offset (32 bytes)
    pub const COUNTERPARTY: usize = 64;
    /// outcome offset (1 byte) - 0=Negative, 1=Neutral, 2=Positive (only 0-2 valid)
    pub const OUTCOME: usize = 96;
    /// data_hash offset (32 bytes) - agent's blind commitment (zeros for SingleSigner)
    pub const DATA_HASH: usize = 97;
    /// content_type offset (1 byte) - format: 0=None, 1=JSON, 2=UTF-8, etc. (6-15 reserved)
    pub const CONTENT_TYPE: usize = 129;
    /// content offset (variable length, up to 512 bytes)
    pub const CONTENT: usize = 130;
}

/// Maximum valid outcome value (0=Negative, 1=Neutral, 2=Positive)
pub const MAX_OUTCOME_VALUE: u8 = 2;

/// Maximum valid content_type value (0-5 defined, 6-15 reserved for future)
pub const MAX_CONTENT_TYPE_VALUE: u8 = 15;
