use anchor_lang::prelude::*;

/// Metadata key-value pair for agent registration
/// Used as instruction argument (Anchor-compatible)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MetadataEntry {
    pub key: String,
    pub value: String,
}

/// Registry configuration account
/// PDA seeds: [b"registry"]
#[account]
pub struct RegistryConfig {
    /// SATI TokenGroup mint address
    pub group_mint: Pubkey,

    /// Authority that can update registry settings
    /// Set to Pubkey::default() to make immutable
    pub authority: Pubkey,

    /// Total agents registered (counter)
    pub total_agents: u64,

    /// PDA bump seed (stored for efficient CPI signing)
    pub bump: u8,
}

impl RegistryConfig {
    /// Account discriminator (8) + group_mint (32) + authority (32) + total_agents (8) + bump (1)
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1; // 81 bytes

    /// Check if registry is immutable (authority renounced)
    pub fn is_immutable(&self) -> bool {
        self.authority == Pubkey::default()
    }
}
