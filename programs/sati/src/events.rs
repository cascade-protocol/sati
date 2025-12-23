use anchor_lang::prelude::*;

use crate::state::{SignatureMode, StorageType};

// ============================================================================
// Registry Events
// ============================================================================

#[event]
pub struct RegistryInitialized {
    pub authority: Pubkey,
    pub group_mint: Pubkey,
}

#[event]
pub struct AgentRegistered {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub member_number: u64,
    pub name: String,
    pub uri: String,
    pub non_transferable: bool,
}

#[event]
pub struct RegistryAuthorityUpdated {
    pub old_authority: Pubkey,
    pub new_authority: Option<Pubkey>,
}

// ============================================================================
// Attestation Events
// ============================================================================

/// Emitted when a schema config is registered
#[event]
pub struct SchemaConfigRegistered {
    /// SAS schema address
    pub schema: Pubkey,
    /// Signature mode (DualSignature or SingleSigner)
    pub signature_mode: SignatureMode,
    /// Storage type (Compressed or Regular)
    pub storage_type: StorageType,
    /// Whether attestations can be closed
    pub closeable: bool,
}

/// Emitted when an attestation is created (compressed or regular)
#[event]
pub struct AttestationCreated {
    /// SAS schema address
    pub sas_schema: Pubkey,
    /// Agent being attested
    pub token_account: Pubkey,
    /// Counterparty (client for Feedback, validator for Validation, provider for ReputationScore)
    pub counterparty: Pubkey,
    /// Schema data type (0=Feedback, 1=Validation, 2=ReputationScore)
    pub data_type: u8,
    /// Storage type used
    pub storage_type: StorageType,
    /// Attestation address (Light address for compressed, PDA for regular)
    pub address: Pubkey,
}

/// Emitted when an attestation is closed
#[event]
pub struct AttestationClosed {
    /// SAS schema address
    pub sas_schema: Pubkey,
    /// Agent that was attested
    pub token_account: Pubkey,
    /// Attestation address that was closed
    pub address: Pubkey,
}
