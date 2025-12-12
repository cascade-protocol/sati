use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::MetadataEntry;

declare_id!("satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF");

// Security contact information (embedded on-chain)
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "SATI Registry",
    project_url: "https://github.com/cascade-protocol/sati",
    contacts: "email:security@cascade.fyi",
    policy: "https://github.com/cascade-protocol/sati/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/cascade-protocol/sati"
}

#[program]
pub mod sati_registry {
    use super::*;

    /// One-time setup to create the registry and TokenGroup
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Canonical entry point for agent registration
    /// Creates Token-2022 NFT with metadata + group membership atomically
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        symbol: String,
        uri: String,
        additional_metadata: Option<Vec<MetadataEntry>>,
        non_transferable: bool,
    ) -> Result<()> {
        instructions::register_agent::handler(
            ctx,
            name,
            symbol,
            uri,
            additional_metadata,
            non_transferable,
        )
    }

    /// Transfer or renounce registry authority
    pub fn update_registry_authority(
        ctx: Context<UpdateRegistryAuthority>,
        new_authority: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update_authority::handler(ctx, new_authority)
    }
}
