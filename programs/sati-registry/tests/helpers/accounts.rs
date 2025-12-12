//! Account creation helpers for Mollusk tests
//!
//! These helpers are shared across multiple test files. Each test binary
//! only uses a subset, so dead_code warnings are expected and suppressed.

#![allow(dead_code)]

use {
    mollusk_svm_programs_token::token2022,
    solana_sdk::{account::Account, pubkey::Pubkey},
    solana_system_interface::program as system_program,
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
