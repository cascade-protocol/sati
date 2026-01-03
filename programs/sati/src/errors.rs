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

    #[msg("Attestation data too small (minimum 130 bytes for universal base layout)")]
    AttestationDataTooSmall,

    #[msg("Attestation data exceeds maximum size")]
    AttestationDataTooLarge,

    #[msg("Content exceeds maximum size (512 bytes)")]
    ContentTooLarge,

    #[msg("Signature pubkey does not match expected account")]
    SignatureMismatch,

    #[msg("Self-attestation is not allowed (token_account == counterparty)")]
    SelfAttestationNotAllowed,

    #[msg("Agent ATA mint does not match token_account in attestation data")]
    AgentAtaMintMismatch,

    #[msg("Agent ATA is empty - signer does not own the agent NFT")]
    AgentAtaEmpty,

    #[msg("Agent ATA required for this signature mode")]
    AgentAtaRequired,

    #[msg("Unauthorized to close attestation")]
    UnauthorizedClose,

    #[msg("Attestation cannot be closed for this schema")]
    AttestationNotCloseable,

    #[msg("Invalid outcome value (must be 0, 1, or 2)")]
    InvalidOutcome,

    #[msg("Invalid content type (must be 0-15)")]
    InvalidContentType,

    #[msg("Unsupported layout version")]
    UnsupportedLayoutVersion,

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

    #[msg("No Ed25519 instruction found in transaction")]
    Ed25519InstructionNotFound,

    #[msg("Agent's Ed25519 signature not found (message content mismatch)")]
    AgentSignatureNotFound,

    #[msg("Counterparty's Ed25519 signature not found (message content mismatch)")]
    CounterpartySignatureNotFound,

    // ========================================================================
    // Delegation Errors
    // ========================================================================
    #[msg("Schema requires owner signature but delegate attempted")]
    OwnerOnly,

    #[msg("Delegate signed but no delegation attestation provided")]
    DelegationAttestationRequired,

    #[msg("Delegation attestation PDA doesn't match expected derivation")]
    InvalidDelegationPDA,

    #[msg("Delegation attestation delegate doesn't match signer")]
    DelegateMismatch,

    #[msg("Delegation attestation agent doesn't match target agent")]
    AgentMintMismatch,

    #[msg("Delegation was created by different owner (NFT was transferred)")]
    DelegationOwnerMismatch,

    #[msg("Delegation attestation has expired")]
    DelegationExpired,

    // ========================================================================
    // EVM Linking Errors
    // ========================================================================
    #[msg("Invalid secp256k1 signature")]
    InvalidSecp256k1Signature,

    #[msg("Secp256k1 recovery failed")]
    Secp256k1RecoveryFailed,

    #[msg("EVM address mismatch - recovered address does not match expected")]
    EvmAddressMismatch,

    #[msg("Failed to extract EVM address from secp256k1 key recovery")]
    InvalidEvmAddressRecovery,
}
