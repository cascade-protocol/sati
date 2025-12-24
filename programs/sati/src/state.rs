use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};
use light_sdk::instruction::{
    account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof,
};
use light_sdk::LightDiscriminator;

// ============================================================================
// Registry State
// ============================================================================

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

// ============================================================================
// Attestation State
// ============================================================================

/// Signature mode determines how many signatures are required
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SignatureMode {
    /// Two signatures required: agent + counterparty (blind feedback model)
    DualSignature,
    /// Single signature required: provider signs (ReputationScore)
    SingleSigner,
}

/// Storage type determines where attestations are stored
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum StorageType {
    /// Light Protocol compressed accounts (Feedback, Validation)
    Compressed,
    /// SAS regular accounts (ReputationScore)
    Regular,
}

/// Schema configuration for a registered attestation type.
/// PDA seeds: ["schema_config", sas_schema]
#[account]
#[derive(InitSpace)]
pub struct SchemaConfig {
    /// SAS schema address this config applies to
    pub sas_schema: Pubkey,
    /// Signature verification mode
    pub signature_mode: SignatureMode,
    /// Storage backend type
    pub storage_type: StorageType,
    /// Whether attestations can be closed/nullified
    pub closeable: bool,
    /// PDA bump seed
    pub bump: u8,
}

// Account size: 8 (discriminator) + 32 + 1 + 1 + 1 + 1 = 44 bytes

/// Compressed attestation stored via Light Protocol.
///
/// The account hash is computed by Light SDK using the LightDiscriminator trait,
/// which uses a unique 8-byte discriminator followed by the Borsh-serialized data.
#[derive(Clone, Debug, LightDiscriminator, BorshSerialize, BorshDeserialize)]
pub struct CompressedAttestation {
    /// SAS schema address (indexed via memcmp at offset 8)
    pub sas_schema: [u8; 32],
    /// Agent token account being attested (indexed via memcmp at offset 40)
    pub token_account: [u8; 32],
    /// Attestation data type discriminator:
    /// - 0: Feedback (agent-counterparty blind feedback)
    /// - 1: Validation (third-party validation request/response)
    /// Note: ReputationScore (type 2) uses Regular storage, not Compressed
    pub data_type: u8,
    /// Schema-conformant data bytes (96+ bytes, includes base layout)
    pub data: Vec<u8>,
    /// Number of signatures stored
    pub num_signatures: u8,
    /// First signature (agent for DualSignature, provider for SingleSigner)
    pub signature1: [u8; 64],
    /// Second signature (counterparty for DualSignature, zeroed for SingleSigner)
    pub signature2: [u8; 64],
}

impl Default for CompressedAttestation {
    fn default() -> Self {
        Self {
            sas_schema: [0u8; 32],
            token_account: [0u8; 32],
            data_type: 0,
            data: Vec::new(),
            num_signatures: 0,
            signature1: [0u8; 64],
            signature2: [0u8; 64],
        }
    }
}

/// Ed25519 signature with associated public key
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SignatureData {
    /// Public key that signed
    pub pubkey: Pubkey,
    /// 64-byte Ed25519 signature
    pub sig: [u8; 64],
}

/// Parameters for creating a compressed attestation
///
/// Uses Light Protocol types directly for proof and address tree info,
/// following the recommended pattern from Light SDK.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateParams {
    /// Data type: 0=Feedback, 1=Validation
    pub data_type: u8,
    /// Schema-conformant data bytes (96+ bytes)
    pub data: Vec<u8>,
    /// Ed25519 signatures with public keys
    pub signatures: Vec<SignatureData>,
    /// Output state tree index for the new compressed account
    pub output_state_tree_index: u8,
    /// Light Protocol validity proof (None for new address creation)
    pub proof: ValidityProof,
    /// Light Protocol address tree info
    pub address_tree_info: PackedAddressTreeInfo,
}

/// Parameters for creating a regular (SAS) attestation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateRegularParams {
    /// Data type: 2=ReputationScore
    pub data_type: u8,
    /// Schema-conformant data bytes
    pub data: Vec<u8>,
    /// Single signature (provider)
    pub signatures: Vec<SignatureData>,
    /// Expiry timestamp (0 = never expires)
    pub expiry: i64,
}

/// Parameters for closing a compressed attestation
///
/// Uses Light Protocol types directly for proof and account metadata,
/// following the recommended pattern from Light SDK.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CloseParams {
    /// Data type of the attestation being closed
    pub data_type: u8,
    /// Current attestation data (for hash verification)
    pub current_data: Vec<u8>,
    /// Number of signatures in the attestation
    pub num_signatures: u8,
    /// First signature (required)
    pub signature1: [u8; 64],
    /// Second signature (zeroed for SingleSigner mode)
    pub signature2: [u8; 64],
    /// The compressed account address being closed (for event emission)
    pub address: Pubkey,
    /// Light Protocol validity proof
    pub proof: ValidityProof,
    /// Light Protocol compressed account metadata
    pub account_meta: CompressedAccountMeta,
}
