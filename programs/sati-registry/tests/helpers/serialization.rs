//! Serialization helpers for Anchor structs
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! Anchor structs use 8-byte discriminator prefix

use solana_sdk::pubkey::Pubkey;

/// RegistryConfig size: discriminator(8) + group_mint(32) + authority(32) + total_agents(8) + bump(1)
pub const REGISTRY_CONFIG_SIZE: usize = 8 + 32 + 32 + 8 + 1; // 81 bytes

/// Anchor discriminator for RegistryConfig (sha256("account:RegistryConfig")[0..8])
pub const REGISTRY_CONFIG_DISCRIMINATOR: [u8; 8] = [0x17, 0x76, 0x0a, 0xf6, 0xad, 0xe7, 0xf3, 0x9c];

/// Serialize RegistryConfig for test account data
///
/// Layout:
/// - 8 bytes: discriminator
/// - 32 bytes: group_mint
/// - 32 bytes: authority
/// - 8 bytes: total_agents
/// - 1 byte: bump
pub fn serialize_registry_config(
    group_mint: Pubkey,
    authority: Pubkey,
    total_agents: u64,
    bump: u8,
) -> Vec<u8> {
    let mut data = vec![0u8; REGISTRY_CONFIG_SIZE];

    // Discriminator
    data[0..8].copy_from_slice(&REGISTRY_CONFIG_DISCRIMINATOR);

    // Group mint
    data[8..40].copy_from_slice(&group_mint.to_bytes());

    // Authority
    data[40..72].copy_from_slice(&authority.to_bytes());

    // Total agents
    data[72..80].copy_from_slice(&total_agents.to_le_bytes());

    // Bump
    data[80] = bump;

    data
}
