use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};
use light_sdk::instruction::{
    account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof,
};
use light_sdk::{LightDiscriminator, LightHasher};

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

/// Agent index for enumeration via member_number.
/// Enables listing all agents without external indexing.
/// PDA seeds: [b"agent_index", member_number.to_le_bytes()]
#[account]
pub struct AgentIndex {
    /// Agent mint address
    pub mint: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

impl AgentIndex {
    /// Account discriminator (8) + mint (32) + bump (1) = 41 bytes
    pub const SIZE: usize = 8 + 32 + 1;
}

// ============================================================================
// Attestation State
// ============================================================================

/// Signature mode determines how many signatures are required and who signs
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SignatureMode {
    /// Two signatures required: agent + counterparty (blind feedback model)
    /// Used for: FeedbackV1, ValidationV1
    DualSignature,
    /// Single signature from counterparty only (no agent authorization required)
    /// Used for: FeedbackPublicV1, ReputationScoreV1
    CounterpartySigned,
    /// Single signature from agent owner or delegate
    /// Used for: DelegateV1 only
    AgentOwnerSigned,
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
    /// Schema for delegation verification.
    /// If Some: owner OR valid delegate can sign (AgentOwnerSigned mode).
    /// If None: only owner can sign (or anyone for CounterpartySigned mode).
    pub delegation_schema: Option<Pubkey>,
    /// Whether attestations can be closed/nullified
    pub closeable: bool,
    /// Schema name for signing messages (max 32 chars)
    #[max_len(32)]
    pub name: String,
    /// PDA bump seed
    pub bump: u8,
}

// Account size: 8 (discriminator) + 32 + 1 + 1 + 1 + 32 + 1 + 4 + 32 + 1 = 113 bytes (with Option overhead)

/// Compressed attestation stored via Light Protocol.
///
/// The account hash is computed by Light SDK using the LightHasher trait.
/// Fields marked with `#[hash]` are included in the Poseidon hash for account verification.
///
/// Schema type is determined solely by `sas_schema` field - no separate data_type discriminator.
#[derive(Clone, Debug, LightDiscriminator, LightHasher, BorshSerialize, BorshDeserialize)]
pub struct CompressedAttestation {
    /// SAS schema address (indexed via memcmp at offset 8).
    /// Determines attestation type (Feedback, Validation, etc.)
    #[hash]
    pub sas_schema: [u8; 32],
    /// Agent's MINT ADDRESS (stable identity). Indexed via memcmp at offset 40.
    ///
    /// NAMING CONVENTION: Named `token_account` for SAS wire format compatibility,
    /// but this is the agent's **MINT ADDRESS**, NOT an ATA.
    ///
    /// Authorization is verified via `agent_ata` account in the instruction, NOT by
    /// checking `signature.pubkey == token_account`. The NFT owner signs.
    #[hash]
    pub token_account: [u8; 32],
    /// Schema-conformant data bytes (130+ bytes, universal base layout)
    #[hash]
    pub data: Vec<u8>,
    /// Number of signatures stored (1 or 2 depending on SignatureMode)
    #[hash]
    pub num_signatures: u8,
    /// First signature (agent for DualSignature, counterparty for CounterpartySigned, owner for AgentOwnerSigned)
    #[hash]
    pub signature1: [u8; 64],
    /// Second signature (counterparty for DualSignature, zeroed for single-signature modes)
    #[hash]
    pub signature2: [u8; 64],
}

impl Default for CompressedAttestation {
    fn default() -> Self {
        Self {
            sas_schema: [0u8; 32],
            token_account: [0u8; 32],
            data: Vec::new(),
            num_signatures: 0,
            signature1: [0u8; 64],
            signature2: [0u8; 64],
        }
    }
}

/// Parameters for creating a compressed attestation
///
/// Uses Light Protocol types directly for proof and address tree info,
/// following the recommended pattern from Light SDK.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateParams {
    /// Schema-conformant data bytes (130+ bytes, universal base layout)
    pub data: Vec<u8>,
    /// Output state tree index for the new compressed account
    pub output_state_tree_index: u8,
    /// Light Protocol validity proof (None for new address creation)
    pub proof: ValidityProof,
    /// Light Protocol address tree info
    pub address_tree_info: PackedAddressTreeInfo,
}

/// Parameters for creating a regular (SAS) attestation
/// Used for Delegation schemas (AgentOwnerSigned mode)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateRegularParams {
    /// Schema-conformant data bytes (130+ bytes, universal base layout)
    pub data: Vec<u8>,
    /// Expiry timestamp (0 = never expires)
    pub expiry: i64,
}

/// Parameters for closing a compressed attestation
///
/// Uses Light Protocol types directly for proof and account metadata,
/// following the recommended pattern from Light SDK.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CloseParams {
    /// Current attestation data (for hash verification)
    pub current_data: Vec<u8>,
    /// Number of signatures in the attestation
    pub num_signatures: u8,
    /// First signature (required)
    pub signature1: [u8; 64],
    /// Second signature (zeroed for single-signature modes)
    pub signature2: [u8; 64],
    /// The compressed account address being closed (for event emission)
    pub address: Pubkey,
    /// Light Protocol validity proof
    pub proof: ValidityProof,
    /// Light Protocol compressed account metadata
    pub account_meta: CompressedAccountMeta,
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_config_size() {
        // Verify SIZE constant matches actual serialized size
        // 8 (discriminator) + 32 (group_mint) + 32 (authority) + 8 (total_agents) + 1 (bump) = 81
        assert_eq!(RegistryConfig::SIZE, 81);
    }

    #[test]
    fn test_registry_config_is_immutable() {
        let mut config = RegistryConfig {
            group_mint: Pubkey::new_unique(),
            authority: Pubkey::new_unique(),
            total_agents: 0,
            bump: 255,
        };

        // Non-default authority = mutable
        assert!(!config.is_immutable());

        // Default authority = immutable (renounced)
        config.authority = Pubkey::default();
        assert!(config.is_immutable());
    }

    #[test]
    fn test_signature_mode_values() {
        // Verify all three enum variants are distinct
        assert_ne!(
            SignatureMode::DualSignature,
            SignatureMode::CounterpartySigned
        );
        assert_ne!(
            SignatureMode::DualSignature,
            SignatureMode::AgentOwnerSigned
        );
        assert_ne!(
            SignatureMode::CounterpartySigned,
            SignatureMode::AgentOwnerSigned
        );

        // Verify Copy trait
        let dual = SignatureMode::DualSignature;
        let counterparty = SignatureMode::CounterpartySigned;
        let agent_owner = SignatureMode::AgentOwnerSigned;

        let _dual_copy = dual;
        let _counterparty_copy = counterparty;
        let _agent_owner_copy = agent_owner;

        // Verify Debug trait works
        assert!(format!("{:?}", dual).contains("DualSignature"));
        assert!(format!("{:?}", counterparty).contains("CounterpartySigned"));
        assert!(format!("{:?}", agent_owner).contains("AgentOwnerSigned"));
    }

    #[test]
    fn test_agent_index_size() {
        // Verify SIZE constant matches actual serialized size
        // 8 (discriminator) + 32 (mint) + 1 (bump) = 41
        assert_eq!(AgentIndex::SIZE, 41);
    }

    #[test]
    fn test_storage_type_values() {
        // Verify enum variants are distinct
        assert_ne!(StorageType::Compressed, StorageType::Regular);

        // Verify Copy and Debug
        let compressed = StorageType::Compressed;
        let regular = StorageType::Regular;

        let _compressed_copy = compressed;
        let _regular_copy = regular;

        assert!(format!("{:?}", compressed).contains("Compressed"));
        assert!(format!("{:?}", regular).contains("Regular"));
    }

    #[test]
    fn test_compressed_attestation_default() {
        let attestation = CompressedAttestation::default();

        assert_eq!(attestation.sas_schema, [0u8; 32]);
        assert_eq!(attestation.token_account, [0u8; 32]);
        assert!(attestation.data.is_empty());
        assert_eq!(attestation.num_signatures, 0);
        assert_eq!(attestation.signature1, [0u8; 64]);
        assert_eq!(attestation.signature2, [0u8; 64]);
    }

    #[test]
    fn test_metadata_entry_clone() {
        let entry = MetadataEntry {
            key: "test_key".to_string(),
            value: "test_value".to_string(),
        };

        let cloned = entry.clone();
        assert_eq!(cloned.key, "test_key");
        assert_eq!(cloned.value, "test_value");
    }
}
