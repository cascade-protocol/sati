//! Account creation helpers for LiteSVM tests
//!
//! Following the pattern from Light Protocol and SAS:
//! - Use actual program instructions instead of manual account mocking
//! - Only mock accounts when absolutely necessary (and compute discriminators correctly)

use litesvm::LiteSVM;
use solana_sdk::{
    account::Account,
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
};

use crate::common::setup::{SATI_PROGRAM_ID, TOKEN_2022_PROGRAM_ID};

/// RegistryConfig account size (matches Rust struct)
pub const REGISTRY_CONFIG_SIZE: usize = 8 + 32 + 32 + 8 + 1; // 81 bytes

/// SchemaConfig account size (matches Rust struct)
pub const SCHEMA_CONFIG_SIZE: usize = 8 + 32 + 1 + 1 + 1 + 1; // 44 bytes

/// Airdrop SOL to an account
pub fn airdrop(svm: &mut LiteSVM, pubkey: &Pubkey, lamports: u64) {
    svm.airdrop(pubkey, lamports).expect("Airdrop failed");
}

/// Create a new keypair and airdrop SOL to it
pub fn create_funded_keypair(svm: &mut LiteSVM, lamports: u64) -> Keypair {
    let keypair = Keypair::new();
    airdrop(svm, &keypair.pubkey(), lamports);
    keypair
}

/// Create a dummy Token-2022 mint account
///
/// Note: This creates a minimal account that passes owner checks but may not
/// pass full Token-2022 validation. For tests that mock RegistryConfig directly,
/// this is sufficient since the group_mint is only used as a reference.
///
/// For tests that need actual Token-2022 functionality (like initialize),
/// use proper Token-2022 setup or mark tests as #[ignore].
pub fn create_mock_group_mint(
    svm: &mut LiteSVM,
    mint_keypair: &Keypair,
    _registry_config_pda: &Pubkey,
) {
    // Create a minimal Token-2022 account
    // This won't pass full Token-2022 validation but is enough for tests
    // that only reference the pubkey via a mocked RegistryConfig
    let space = 200; // Minimal space
    let lamports = svm.minimum_balance_for_rent_exemption(space);

    let account = Account {
        lamports,
        data: vec![0u8; space],
        owner: TOKEN_2022_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    };

    svm.set_account(mint_keypair.pubkey(), account).expect("Failed to set group mint account");
}

/// Compute Anchor account discriminator: sha256("account:AccountName")[..8]
fn compute_anchor_account_discriminator(account_name: &str) -> [u8; 8] {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(format!("account:{}", account_name));
    let result = hasher.finalize();
    result[..8].try_into().unwrap()
}

/// Create an initialized RegistryConfig account for testing
///
/// This mocks an already-initialized registry config, useful for testing
/// instructions that require an existing registry without going through initialize.
pub fn create_initialized_registry(
    svm: &mut LiteSVM,
    registry_pda: &Pubkey,
    authority: &Pubkey,
    group_mint: &Pubkey,
    bump: u8,
) {
    let mut data = vec![0u8; REGISTRY_CONFIG_SIZE];

    // Compute correct Anchor discriminator for RegistryConfig
    let discriminator = compute_anchor_account_discriminator("RegistryConfig");
    data[0..8].copy_from_slice(&discriminator);

    // group_mint (32 bytes) at offset 8
    data[8..40].copy_from_slice(group_mint.as_ref());

    // authority (32 bytes) at offset 40
    data[40..72].copy_from_slice(authority.as_ref());

    // total_agents (8 bytes) at offset 72
    data[72..80].copy_from_slice(&0u64.to_le_bytes());

    // bump (1 byte) at offset 80
    data[80] = bump;

    let lamports = svm.minimum_balance_for_rent_exemption(REGISTRY_CONFIG_SIZE);
    let account = Account {
        lamports,
        data,
        owner: SATI_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    };

    svm.set_account(*registry_pda, account).expect("Failed to set registry config");
}
