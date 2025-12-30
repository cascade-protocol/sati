use anchor_lang::prelude::*;
use light_sdk::{cpi::CpiSigner, derive_light_cpi_signer};
use solana_security_txt::security_txt;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod signature;
pub mod state;

use instructions::*;
use state::*;

declare_id!("satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz");

/// Light Protocol CPI signer for compressed account operations
pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz");

security_txt! {
    name: "SATI",
    project_url: "https://github.com/cascade-protocol/sati",
    contacts: "email:security@cascade.fyi",
    policy: "https://github.com/cascade-protocol/sati/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/cascade-protocol/sati",
    auditors: "N/A"
}

#[program]
pub mod sati {
    use super::*;

    // =========================================================================
    // Registry Instructions
    // =========================================================================

    /// Initialize the SATI registry.
    /// Validates a pre-initialized TokenGroup mint and stores registry configuration.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::registry::initialize::handler(ctx)
    }

    /// Register a new agent in the SATI registry.
    /// Creates a Token-2022 NFT with TokenMetadata and TokenGroupMember extensions.
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        symbol: String,
        uri: String,
        additional_metadata: Option<Vec<MetadataEntry>>,
        non_transferable: bool,
    ) -> Result<()> {
        instructions::registry::register_agent::handler(
            ctx,
            name,
            symbol,
            uri,
            additional_metadata,
            non_transferable,
        )
    }

    /// Update or renounce registry authority.
    /// Pass None to renounce (makes registry immutable).
    pub fn update_registry_authority(
        ctx: Context<UpdateRegistryAuthority>,
        new_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::registry::update_authority::handler(ctx, new_authority)
    }

    /// Link an EVM address to an agent via secp256k1 signature verification.
    /// Proves the agent owner controls the specified EVM address.
    pub fn link_evm_address(
        ctx: Context<LinkEvmAddress>,
        params: LinkEvmAddressParams,
    ) -> Result<()> {
        instructions::registry::link_evm_address::handler(ctx, params)
    }

    // =========================================================================
    // Attestation Instructions
    // =========================================================================

    /// Register a schema configuration. Authority only.
    /// Creates a SchemaConfig PDA that determines signature mode and storage type.
    pub fn register_schema_config(
        ctx: Context<RegisterSchemaConfig>,
        sas_schema: Pubkey,
        signature_mode: SignatureMode,
        storage_type: StorageType,
        closeable: bool,
    ) -> Result<()> {
        instructions::attestation::register_schema_config::handler(
            ctx,
            sas_schema,
            signature_mode,
            storage_type,
            closeable,
        )
    }

    /// Create a compressed attestation via Light Protocol.
    /// Verifies Ed25519 signatures via instruction introspection.
    pub fn create_attestation<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateAttestation<'info>>,
        params: CreateParams,
    ) -> Result<()> {
        instructions::attestation::create_attestation::handler(ctx, params)
    }

    /// Create a regular attestation via SAS.
    /// Used for ReputationScore which requires on-chain queryability.
    pub fn create_regular_attestation<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateRegularAttestation<'info>>,
        params: CreateRegularParams,
    ) -> Result<()> {
        instructions::attestation::create_regular_attestation::handler(ctx, params)
    }

    /// Close a compressed attestation.
    /// Only allowed if schema config has closeable=true.
    pub fn close_attestation<'info>(
        ctx: Context<'_, '_, '_, 'info, CloseAttestation<'info>>,
        params: CloseParams,
    ) -> Result<()> {
        instructions::attestation::close_attestation::handler(ctx, params)
    }

    /// Close a regular (SAS) attestation.
    /// Only allowed if schema config has closeable=true.
    pub fn close_regular_attestation<'info>(
        ctx: Context<'_, '_, '_, 'info, CloseRegularAttestation<'info>>,
    ) -> Result<()> {
        instructions::attestation::close_regular_attestation::handler(ctx)
    }
}
