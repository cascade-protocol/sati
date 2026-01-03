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
    /// Signature mode (DualSignature, CounterpartySigned, or AgentOwnerSigned)
    pub signature_mode: SignatureMode,
    /// Storage type (Compressed or Regular)
    pub storage_type: StorageType,
    /// Schema for delegation verification (None = owner only)
    pub delegation_schema: Option<Pubkey>,
    /// Whether attestations can be closed
    pub closeable: bool,
    /// Human-readable schema name (max 32 chars)
    pub name: String,
}

/// Emitted when an attestation is created (compressed or regular)
#[event]
pub struct AttestationCreated {
    /// SAS schema address
    pub sas_schema: Pubkey,
    /// Agent's MINT ADDRESS (stable identity). Named `token_account` for SAS compatibility.
    pub token_account: Pubkey,
    /// Counterparty (client for Feedback, validator for Validation, provider for ReputationScore)
    pub counterparty: Pubkey,
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
    /// Agent's MINT ADDRESS (stable identity). Named `token_account` for SAS compatibility.
    pub token_account: Pubkey,
    /// Attestation address that was closed
    pub address: Pubkey,
}

// ============================================================================
// EVM Linking Events
// ============================================================================

/// Emitted when an EVM address is linked to an agent
#[event]
pub struct EvmAddressLinked {
    /// Agent mint address
    pub agent_mint: Pubkey,
    /// EVM address (20 bytes)
    pub evm_address: [u8; 20],
    /// CAIP-2 chain identifier (e.g., "eip155:1")
    pub chain_id: String,
    /// Unix timestamp when linked
    pub linked_at: i64,
}
