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
