//! Instruction builders using Anchor's InstructionData and ToAccountMetas traits
//!
//! This follows the pattern used by Light Protocol and Solana program-examples:
//! - Use Anchor-generated instruction types
//! - Call .data() for automatic discriminator handling
//! - Call .to_account_metas() for proper account metadata

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

use crate::common::setup::SATI_PROGRAM_ID;

/// System program ID
const SYSTEM_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("11111111111111111111111111111111");

// Re-export instruction and account types from the sati crate
pub use sati::accounts;
pub use sati::instruction;
pub use sati::state::{SignatureMode, StorageType};

/// Build initialize instruction using Anchor's generated types
pub fn build_initialize_ix(
    authority: &Pubkey,
    registry_config: &Pubkey,
    group_mint: &Pubkey,
) -> Instruction {
    let instruction_data = instruction::Initialize {};
    let accounts = accounts::Initialize {
        authority: *authority,
        registry_config: *registry_config,
        group_mint: *group_mint,
        system_program: SYSTEM_PROGRAM_ID,
    };

    Instruction {
        program_id: SATI_PROGRAM_ID,
        accounts: accounts.to_account_metas(None),
        data: instruction_data.data(),
    }
}

/// Build register_schema_config instruction using Anchor's generated types
#[allow(clippy::too_many_arguments)]
pub fn build_register_schema_config_ix(
    payer: &Pubkey,
    registry_config: &Pubkey,
    authority: &Pubkey,
    schema_config: &Pubkey,
    sas_schema: &Pubkey,
    signature_mode: SignatureMode,
    storage_type: StorageType,
    closeable: bool,
) -> Instruction {
    let instruction_data = instruction::RegisterSchemaConfig {
        sas_schema: *sas_schema,
        signature_mode,
        storage_type,
        closeable,
    };
    let accounts = accounts::RegisterSchemaConfig {
        payer: *payer,
        registry_config: *registry_config,
        authority: *authority,
        schema_config: *schema_config,
        system_program: SYSTEM_PROGRAM_ID,
    };

    Instruction {
        program_id: SATI_PROGRAM_ID,
        accounts: accounts.to_account_metas(None),
        data: instruction_data.data(),
    }
}

/// Build update_registry_authority instruction using Anchor's generated types
pub fn build_update_authority_ix(
    authority: &Pubkey,
    registry_config: &Pubkey,
    new_authority: Option<Pubkey>,
) -> Instruction {
    let instruction_data = instruction::UpdateRegistryAuthority { new_authority };
    let accounts = accounts::UpdateRegistryAuthority {
        authority: *authority,
        registry_config: *registry_config,
    };

    Instruction {
        program_id: SATI_PROGRAM_ID,
        accounts: accounts.to_account_metas(None),
        data: instruction_data.data(),
    }
}

// ============================================================================
// Attestation Instructions (Compressed - Light Protocol)
// ============================================================================

pub use sati::state::{CloseParams, CompressedAttestation, CreateParams, SignatureData};

/// Derive the Anchor event authority PDA for CPI events
fn derive_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &SATI_PROGRAM_ID).0
}

/// Build create_attestation instruction for compressed storage
///
/// Note: This instruction requires Ed25519 signature verification instructions
/// to be included BEFORE this instruction in the same transaction.
pub fn build_create_attestation_ix(
    payer: &Pubkey,
    schema_config: &Pubkey,
    params: CreateParams,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let instruction_data = instruction::CreateAttestation { params };
    let mut account_metas = accounts::CreateAttestation {
        payer: *payer,
        schema_config: *schema_config,
        instructions_sysvar: solana_sdk::sysvar::instructions::ID,
        event_authority: derive_event_authority(),
        program: SATI_PROGRAM_ID,
    }
    .to_account_metas(None);

    // Add Light Protocol remaining accounts
    account_metas.extend(remaining_accounts);

    Instruction {
        program_id: SATI_PROGRAM_ID,
        accounts: account_metas,
        data: instruction_data.data(),
    }
}

/// Build close_attestation instruction for compressed storage
pub fn build_close_attestation_ix(
    signer: &Pubkey,
    schema_config: &Pubkey,
    params: CloseParams,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let instruction_data = instruction::CloseAttestation { params };
    let mut account_metas = accounts::CloseAttestation {
        signer: *signer,
        schema_config: *schema_config,
        event_authority: derive_event_authority(),
        program: SATI_PROGRAM_ID,
    }
    .to_account_metas(None);

    // Add Light Protocol remaining accounts
    account_metas.extend(remaining_accounts);

    Instruction {
        program_id: SATI_PROGRAM_ID,
        accounts: account_metas,
        data: instruction_data.data(),
    }
}
