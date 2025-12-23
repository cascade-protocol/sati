use anchor_lang::prelude::*;

#[error_code]
pub enum SatiError {
    // ========================================================================
    // Registry Errors
    // ========================================================================
    #[msg("Invalid group mint - must be owned by Token-2022 with TokenGroup extension")]
    InvalidGroupMint,

    #[msg("Invalid authority")]
    InvalidAuthority,

    #[msg("Authority is immutable (renounced)")]
    ImmutableAuthority,

    #[msg("Name too long (max 32 bytes)")]
    NameTooLong,

    #[msg("Symbol too long (max 10 bytes)")]
    SymbolTooLong,

    #[msg("URI too long (max 200 bytes)")]
    UriTooLong,

    #[msg("Too many metadata entries (max 10)")]
    TooManyMetadataEntries,

    #[msg("Metadata key too long (max 32 bytes)")]
    MetadataKeyTooLong,

    #[msg("Metadata value too long (max 200 bytes)")]
    MetadataValueTooLong,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Failed to renounce mint authority - supply guarantee violated")]
    MintAuthorityNotRenounced,

    // ========================================================================
    // Attestation Errors
    // ========================================================================
    #[msg("Schema config not found")]
    SchemaConfigNotFound,

    #[msg("Invalid signature count for signature mode")]
    InvalidSignatureCount,

    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,

    #[msg("Storage type not supported for this operation")]
    StorageTypeNotSupported,

    #[msg("Storage type mismatch")]
    StorageTypeMismatch,

    #[msg("Attestation data too small (minimum 96 bytes for base layout)")]
    AttestationDataTooSmall,

    #[msg("Attestation data exceeds maximum size")]
    AttestationDataTooLarge,

    #[msg("Content exceeds maximum size (512 bytes)")]
    ContentTooLarge,

    #[msg("Signature pubkey does not match expected account")]
    SignatureMismatch,

    #[msg("Self-attestation is not allowed (token_account == counterparty)")]
    SelfAttestationNotAllowed,

    #[msg("Unauthorized to close attestation")]
    UnauthorizedClose,

    #[msg("Attestation cannot be closed for this schema")]
    AttestationNotCloseable,

    #[msg("Invalid outcome value (must be 0-2)")]
    InvalidOutcome,

    #[msg("Invalid content type (must be 0-4)")]
    InvalidContentType,

    #[msg("Invalid data type")]
    InvalidDataType,

    #[msg("Invalid score value (must be 0-100)")]
    InvalidScore,

    #[msg("Invalid validation response (must be 0-100)")]
    InvalidResponse,

    #[msg("Tag string exceeds maximum length (32 chars)")]
    TagTooLong,

    #[msg("Invalid data layout")]
    InvalidDataLayout,

    #[msg("Light Protocol CPI invocation failed")]
    LightCpiInvocationFailed,

    #[msg("Invalid Ed25519 instruction format")]
    InvalidEd25519Instruction,

    #[msg("Missing required Ed25519 signatures in transaction")]
    MissingSignatures,

    #[msg("Message hash mismatch - signature was for different data")]
    MessageMismatch,

    #[msg("Invalid instructions sysvar")]
    InvalidInstructionsSysvar,

    #[msg("Duplicate signers not allowed for dual signature mode")]
    DuplicateSigners,
}
