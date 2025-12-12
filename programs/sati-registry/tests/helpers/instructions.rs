//! Instruction builders for Mollusk tests
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! All imports from solana_sdk::*, not modular crates

use {
    mollusk_svm_programs_token::token2022,
    solana_sdk::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        system_program,
    },
    spl_associated_token_account,
};

/// Program ID - must match lib.rs
pub const PROGRAM_ID: Pubkey = solana_sdk::pubkey!("satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF");

// Anchor discriminators (first 8 bytes of sha256("global:function_name"))
// These must match the IDL/program
pub const DISCRIMINATOR_INITIALIZE: [u8; 8] = [0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed];
pub const DISCRIMINATOR_REGISTER_AGENT: [u8; 8] = [0x87, 0x9d, 0x42, 0xc3, 0x02, 0x71, 0xaf, 0x1e];
pub const DISCRIMINATOR_UPDATE_REGISTRY_AUTHORITY: [u8; 8] =
    [0x24, 0x67, 0x0f, 0x95, 0x75, 0x86, 0x1a, 0x29];

/// Derive registry config PDA
pub fn derive_registry_config() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"registry"], &PROGRAM_ID)
}

/// Derive group mint PDA
pub fn derive_group_mint() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"group_mint"], &PROGRAM_ID)
}

/// Derive ATA for Token-2022
pub fn derive_ata_token2022(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account::get_associated_token_address_with_program_id(
        wallet,
        mint,
        &token2022::ID,
    )
}

/// Build initialize instruction
///
/// Accounts:
/// 0. authority (writable, signer) - Initial registry authority
/// 1. registry_config (writable) - PDA to initialize
/// 2. group_mint (writable) - TokenGroup mint PDA
/// 3. token_2022_program
/// 4. system_program
pub fn build_initialize(
    authority: Pubkey,
    registry_config: Pubkey,
    group_mint: Pubkey,
) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new(registry_config, false),
            AccountMeta::new(group_mint, false),
            AccountMeta::new_readonly(token2022::ID, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: DISCRIMINATOR_INITIALIZE.to_vec(),
    }
}

/// Build register_agent instruction
///
/// Accounts:
/// 0. payer (writable, signer)
/// 1. owner
/// 2. registry_config (writable)
/// 3. group_mint (writable)
/// 4. agent_mint (writable, signer)
/// 5. agent_token_account (writable)
/// 6. token_2022_program
/// 7. associated_token_program
/// 8. system_program
pub fn build_register_agent(
    payer: Pubkey,
    owner: Pubkey,
    registry_config: Pubkey,
    group_mint: Pubkey,
    agent_mint: Pubkey,
    agent_token_account: Pubkey,
    name: &str,
    symbol: &str,
    uri: &str,
    additional_metadata: Option<&[(String, String)]>,
    non_transferable: bool,
) -> Instruction {
    let mut data = Vec::new();
    data.extend_from_slice(&DISCRIMINATOR_REGISTER_AGENT);

    // name: String (4-byte length prefix + bytes)
    data.extend_from_slice(&(name.len() as u32).to_le_bytes());
    data.extend_from_slice(name.as_bytes());

    // symbol: String
    data.extend_from_slice(&(symbol.len() as u32).to_le_bytes());
    data.extend_from_slice(symbol.as_bytes());

    // uri: String
    data.extend_from_slice(&(uri.len() as u32).to_le_bytes());
    data.extend_from_slice(uri.as_bytes());

    // additional_metadata: Option<Vec<MetadataEntry>>
    match additional_metadata {
        None => data.push(0), // None variant
        Some(entries) => {
            data.push(1); // Some variant
            data.extend_from_slice(&(entries.len() as u32).to_le_bytes());
            for (key, value) in entries {
                data.extend_from_slice(&(key.len() as u32).to_le_bytes());
                data.extend_from_slice(key.as_bytes());
                data.extend_from_slice(&(value.len() as u32).to_le_bytes());
                data.extend_from_slice(value.as_bytes());
            }
        }
    }

    // non_transferable: bool
    data.push(if non_transferable { 1 } else { 0 });

    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(owner, false),
            AccountMeta::new(registry_config, false),
            AccountMeta::new(group_mint, false),
            AccountMeta::new(agent_mint, true),
            AccountMeta::new(agent_token_account, false),
            AccountMeta::new_readonly(token2022::ID, false),
            AccountMeta::new_readonly(spl_associated_token_account::id(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// Build update_registry_authority instruction
///
/// Accounts:
/// 0. authority (signer)
/// 1. registry_config (writable)
pub fn build_update_registry_authority(
    authority: Pubkey,
    registry_config: Pubkey,
    new_authority: Option<Pubkey>,
) -> Instruction {
    let mut data = Vec::new();
    data.extend_from_slice(&DISCRIMINATOR_UPDATE_REGISTRY_AUTHORITY);

    // new_authority: Option<Pubkey>
    match new_authority {
        None => data.push(0),
        Some(pk) => {
            data.push(1);
            data.extend_from_slice(&pk.to_bytes());
        }
    }

    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(registry_config, false),
        ],
        data,
    }
}
