//! Account creation helpers for LiteSVM tests
//!
//! Following the pattern from Light Protocol and SAS:
//! - Use actual program instructions instead of manual account mocking
//! - Only mock accounts when absolutely necessary (and compute discriminators correctly)

use litesvm::LiteSVM;
use solana_sdk::{account::Account, pubkey::Pubkey, signature::Keypair, signer::Signer};
use spl_pod::optional_keys::OptionalNonZeroPubkey;
use spl_token_2022::{
    extension::{BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut},
    state::Mint,
};
use spl_token_group_interface::state::TokenGroup;

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

/// Create a Token-2022 mint with TokenGroup extension
///
/// Uses the actual SPL Token-2022 types to ensure correct binary format.
pub fn create_mock_group_mint(
    svm: &mut LiteSVM,
    mint_keypair: &Keypair,
    registry_config_pda: &Pubkey,
) {
    // Calculate space needed for mint with TokenGroup extension
    let extension_types = &[ExtensionType::TokenGroup];
    let space = ExtensionType::try_calculate_account_len::<Mint>(extension_types).unwrap();

    let mut data = vec![0u8; space];
    let lamports = svm.minimum_balance_for_rent_exemption(space);

    // Initialize the mint with extensions using SPL Token-2022's own serialization
    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();

    // Set base mint fields
    state.base.mint_authority = solana_sdk::program_option::COption::Some(*registry_config_pda);
    state.base.supply = 0;
    state.base.decimals = 0;
    state.base.is_initialized = true;
    state.base.freeze_authority = solana_sdk::program_option::COption::None;

    // Pack the base state
    state.pack_base();

    // Set the account type to Mint (required for unpack to work)
    state.init_account_type().unwrap();

    // Initialize the TokenGroup extension
    state.init_extension::<TokenGroup>(true).unwrap();
    let group = state.get_extension_mut::<TokenGroup>().unwrap();
    group.update_authority = OptionalNonZeroPubkey::try_from(Some(*registry_config_pda)).unwrap();
    // TokenGroup uses PodU64 for max_size and size in newer versions
    group.max_size = (u32::MAX as u64).into();
    group.size = 0u64.into();

    let account = Account {
        lamports,
        data,
        owner: TOKEN_2022_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    };

    svm.set_account(mint_keypair.pubkey(), account)
        .expect("Failed to set group mint account");
}

/// Compute Anchor account discriminator: sha256("account:AccountName")[..8]
fn compute_anchor_account_discriminator(account_name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
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

    svm.set_account(*registry_pda, account)
        .expect("Failed to set registry config");
}
