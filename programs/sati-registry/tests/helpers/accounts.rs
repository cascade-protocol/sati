//! Account creation helpers for Mollusk tests
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! All imports from solana_sdk::*, not modular crates

use {
    mollusk_svm::Mollusk,
    mollusk_svm_programs_token::token2022,
    solana_sdk::{
        account::Account, bpf_loader_upgradeable, pubkey::Pubkey, rent::Rent, system_program,
    },
};

/// Create a system-owned account with given lamports
pub fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: vec![],
        owner: system_program::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Create an uninitialized account (for init)
pub fn uninitialized_account() -> Account {
    Account {
        lamports: 0,
        data: vec![],
        owner: system_program::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a program-owned account with data
pub fn program_account(lamports: u64, data: Vec<u8>, owner: Pubkey) -> Account {
    Account {
        lamports,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a mock program_data account for BPF upgradeable loader
/// This simulates the UpgradeableLoaderState::ProgramData layout
pub fn program_data_account(upgrade_authority: Pubkey) -> Account {
    // UpgradeableLoaderState::ProgramData layout:
    // - 4 bytes: discriminant (3 for ProgramData)
    // - 8 bytes: slot
    // - 1 byte: Option discriminant for upgrade_authority (1 = Some)
    // - 32 bytes: upgrade_authority pubkey
    let mut data = vec![0u8; 45];
    data[0] = 3; // ProgramData discriminant
                 // bytes 1-11: slot (zero)
    data[12] = 1; // Some(upgrade_authority)
    data[13..45].copy_from_slice(&upgrade_authority.to_bytes());

    Account {
        lamports: 1_000_000,
        data,
        owner: bpf_loader_upgradeable::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Get rent from Mollusk
pub fn get_rent(mollusk: &Mollusk) -> Rent {
    mollusk.sysvars.rent.clone()
}

/// Create a system program account tuple for test setup
pub fn system_program_account() -> (Pubkey, Account) {
    (
        system_program::id(),
        Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        },
    )
}

/// Create a Token-2022 program account tuple for test setup
pub fn token2022_program_account() -> (Pubkey, Account) {
    (token2022::ID, token2022::account())
}
