use anchor_lang::prelude::*;

#[error_code]
pub enum SatiError {
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
}
