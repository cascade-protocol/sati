# Appendix A: Implementation Details

This appendix contains detailed implementation guidance extracted from the main specification.

---

## Registry Program Implementation

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_NAME_LENGTH` | 32 | Maximum agent name (bytes) |
| `MAX_SYMBOL_LENGTH` | 10 | Maximum agent symbol (bytes) |
| `MAX_URI_LENGTH` | 200 | Maximum URI (bytes) |
| `MAX_METADATA_ENTRIES` | 10 | Maximum additional metadata pairs |
| `MAX_METADATA_KEY_LENGTH` | 32 | Maximum metadata key (bytes) |
| `MAX_METADATA_VALUE_LENGTH` | 200 | Maximum metadata value (bytes) |
| `MAX_CONTENT_SIZE` | 512 | Maximum content field size (bytes) |
| `MAX_ATTESTATION_DATA_SIZE` | 768 | Maximum total attestation data (bytes) |
| `MIN_BASE_LAYOUT_SIZE` | 96 | Minimum size for base layout (task_ref + token_account + counterparty) |

### Account Sizes

**RegistryConfig**: 81 bytes (8 discriminator + 32 group_mint + 32 authority + 8 total_agents + 1 bump)

### Checked Arithmetic

Agent registration must use checked arithmetic when incrementing `total_agents`:

```rust
registry.total_agents = registry.total_agents
    .checked_add(1)
    .ok_or(SatiError::Overflow)?;
```

This prevents overflow in the theoretical case of 2^64 agent registrations.

### Events Implementation

Events use Anchor's `emit_cpi!` macro for reliable indexing:

| Approach | Mechanism | Truncation Risk | CU Cost |
|----------|-----------|-----------------|---------|
| `emit!` | `sol_log_data` syscall | Yes (10KB log limit) | ~1K |
| `emit_cpi!` | Self-CPI to `innerInstructions` | No | ~5K |

**Per-program choice:**
- **Registry Program**: Can use `emit!` — events are small (~200 bytes), one per tx
- **Attestation Program**: Must use `emit_cpi!` — attestation data is critical, future batching may increase event volume

Account structs requiring event emission include the `#[event_cpi]` attribute, which automatically adds `event_authority` and `program` accounts.

#### Registry Program Events

```rust
/// Emitted when a new agent is registered
#[event]
pub struct AgentRegistered {
    /// Agent's token mint address (agent ID)
    pub mint: Pubkey,
    /// Initial owner of the agent NFT
    pub owner: Pubkey,
    /// Auto-incrementing member number in the TokenGroup
    pub member_number: u64,
    /// Agent display name
    pub name: String,
    /// URI pointing to registration file
    pub uri: String,
    /// Whether the agent is soulbound (non-transferable)
    pub non_transferable: bool,
}

/// Emitted when registry authority is updated or renounced
#[event]
pub struct RegistryAuthorityUpdated {
    /// Previous authority (None if immutable)
    pub old_authority: Option<Pubkey>,
    /// New authority (None = renounced/immutable)
    pub new_authority: Option<Pubkey>,
}
```

#### Attestation Program Events

```rust
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
```

#### Event Emission Pattern

For `emit_cpi!`, add `#[event_cpi]` to the accounts struct:

```rust
#[event_cpi]
#[derive(Accounts)]
pub struct CreateAttestation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    // ... other accounts
}

pub fn create_attestation(ctx: Context<CreateAttestation>, params: CreateParams) -> Result<()> {
    // ... verification and storage logic

    emit_cpi!(AttestationCreated {
        sas_schema: schema_config.sas_schema,
        token_account: token_account_pubkey,
        counterparty: counterparty_pubkey,
        data_type: params.data_type,
        storage_type: schema_config.storage_type,
        address,
    });

    Ok(())
}
```

**TypeScript event parsing:**

```typescript
import { Program, BorshCoder } from "@coral-xyz/anchor";
import { IDL } from "./sati_attestation";

const coder = new BorshCoder(IDL);

// Parse events from transaction logs
function parseEvents(logs: string[]) {
    const events = [];
    for (const log of logs) {
        if (log.startsWith("Program data: ")) {
            const data = Buffer.from(log.slice(14), "base64");
            const event = coder.events.decode(data.toString("base64"));
            if (event) events.push(event);
        }
    }
    return events;
}

// Subscribe to program events via WebSocket
connection.onLogs(ATTESTATION_PROGRAM_ID, (logs) => {
    const events = parseEvents(logs.logs);
    for (const event of events) {
        if (event.name === "AttestationCreated") {
            console.log("New attestation:", event.data);
        }
    }
});
```

### Agent Removal

No `remove_agent` instruction exists. To "remove" an agent:
1. Transfer to burn address, or
2. Let NFT remain (supply capped at 1, no ongoing cost)

The TokenGroup `size` counter is not decremented — it represents total ever registered, not active count.

### Fees

Registry operations have no protocol fees. Costs are:
- Rent deposits (recoverable when accounts closed)
- Transaction fees (Solana network)

---

## Attestation Program Implementation

### SignatureMode Enum

```rust
pub enum SignatureMode {
    DualSignature,  // 2 signatures: agent + counterparty
    SingleSigner,   // 1 signature: provider signs
}
```

| Mode | Signatures | Use Case |
|------|------------|----------|
| DualSignature | 2 | Feedback, Validation (blind feedback model) |
| SingleSigner | 1 | ReputationScore (provider signs) |

### StorageType Enum

```rust
pub enum StorageType {
    Compressed, // Light Protocol (Feedback, Validation)
    Regular,    // SAS attestation (ReputationScore)
}
```

### SchemaConfig Struct

```rust
#[account]
pub struct SchemaConfig {
    pub sas_schema: Pubkey,           // SAS schema address
    pub signature_mode: SignatureMode,
    pub storage_type: StorageType,
    pub closeable: bool,              // Whether attestations can be closed
    pub bump: u8,
}
```

**Closeable semantics:**
- `false` for Feedback/Validation — immutable once created
- `true` for ReputationScore — provider can close to update

### CompressedAttestation Struct

```rust
use light_sdk::{LightDiscriminator, LightHasher};

#[derive(Clone, Debug, Default, LightDiscriminator, LightHasher)]
pub struct CompressedAttestation {
    #[hash]
    pub sas_schema: Pubkey,
    #[hash]
    pub token_account: Pubkey,
    pub data_type: u8,
    pub data: Vec<u8>,
    pub signatures: Vec<[u8; 64]>,
}
```

**Light Protocol derives:**
- `LightDiscriminator` — generates 8-byte discriminator for account identification
- `LightHasher` — enables Poseidon hashing for merkle tree leaves
- `#[hash]` attribute marks fields included in the account hash for filtering

### register_schema_config Context

```rust
#[derive(Accounts)]
#[instruction(sas_schema: Pubkey)]
pub struct RegisterSchemaConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        has_one = authority,  // Only registry authority can register schemas
    )]
    pub registry: Account<'info, RegistryConfig>,

    pub authority: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + SchemaConfig::INIT_SPACE,
        seeds = [b"schema_config", sas_schema.as_ref()],
        bump,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    pub system_program: Program<'info, System>,
}
```

**Security**: `has_one = authority` ensures only the registry authority can register new schema configurations. This prevents unauthorized parties from creating arbitrary schemas.

### CreateAttestation Context (Compressed)

```rust
#[event_cpi]
#[derive(Accounts)]
pub struct CreateAttestation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    /// CHECK: Verified via Ed25519 introspection
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    // Light Protocol accounts passed via remaining_accounts
    // See "Light SDK remaining_accounts" section below
}
```

### CloseAttestation Context (Compressed)

```rust
#[event_cpi]
#[derive(Accounts)]
pub struct CloseAttestation<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,  // Must be counterparty (provider for ReputationScore)

    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    // Light Protocol accounts passed via remaining_accounts
}
```

### CreateRegularAttestation Context (SAS)

```rust
#[event_cpi]
#[derive(Accounts)]
pub struct CreateRegularAttestation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    /// CHECK: SATI Attestation Program PDA, authorized signer on SAS credential
    #[account(
        seeds = [b"sati_attestation"],
        bump,
    )]
    pub sati_pda: AccountInfo<'info>,

    /// CHECK: SATI SAS credential account
    pub sati_credential: AccountInfo<'info>,

    /// CHECK: SAS schema account
    pub sas_schema: AccountInfo<'info>,

    /// CHECK: Attestation PDA to be created
    #[account(mut)]
    pub attestation: AccountInfo<'info>,

    /// CHECK: Verified via Ed25519 introspection
    #[account(address = solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    pub sas_program: Program<'info, SolanaAttestationService>,
    pub system_program: Program<'info, System>,
}
```

### CloseRegularAttestation Context (SAS)

```rust
#[event_cpi]
#[derive(Accounts)]
pub struct CloseRegularAttestation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub signer: Signer<'info>,  // Must be counterparty (provider)

    #[account(
        seeds = [b"schema_config", schema_config.sas_schema.as_ref()],
        bump = schema_config.bump,
    )]
    pub schema_config: Account<'info, SchemaConfig>,

    /// CHECK: SATI Attestation Program PDA
    #[account(
        seeds = [b"sati_attestation"],
        bump,
    )]
    pub sati_pda: AccountInfo<'info>,

    /// CHECK: SATI SAS credential account
    pub sati_credential: AccountInfo<'info>,

    /// CHECK: Attestation to be closed
    #[account(mut)]
    pub attestation: AccountInfo<'info>,

    pub sas_program: Program<'info, SolanaAttestationService>,
}
```

### Parameter Structs

```rust
/// Parameters for creating a compressed attestation
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateParams {
    pub data_type: u8,              // 0=Feedback, 1=Validation, 2=ReputationScore
    pub data: Vec<u8>,              // Schema-conformant bytes (96+ bytes)
    pub signatures: Vec<SignatureData>,  // Ed25519 signatures
}

/// Parameters for creating a regular (SAS) attestation
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateRegularParams {
    pub data_type: u8,              // Always 2 for ReputationScore
    pub data: Vec<u8>,              // Schema-conformant bytes
    pub signatures: Vec<SignatureData>,  // Single signature for SingleSigner mode
    pub expiry: i64,                // 0 = never expires
}

/// Ed25519 signature with public key
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SignatureData {
    pub pubkey: Pubkey,
    pub sig: [u8; 64],
}
```

### Ed25519 Signature Verification via Instruction Introspection

SATI uses Solana's Ed25519 precompile for signature verification. The calling transaction must include Ed25519 program instructions, which are verified via the instructions sysvar.

```rust
use solana_program::{
    ed25519_program::ID as ED25519_PROGRAM_ID,
    sysvar::instructions::{load_instruction_at_checked, ID as SYSVAR_INSTRUCTIONS_ID},
};

/// Ed25519 instruction data format (per signature)
#[derive(Clone, Debug)]
pub struct Ed25519SignatureOffsets {
    pub signature_offset: u16,           // Offset to 64-byte signature
    pub signature_instruction_index: u16, // Instruction index (0xFFFF = same instruction)
    pub public_key_offset: u16,          // Offset to 32-byte pubkey
    pub public_key_instruction_index: u16,
    pub message_data_offset: u16,        // Offset to message
    pub message_data_size: u16,          // Message size
    pub message_instruction_index: u16,
}

/// Verify Ed25519 signatures by checking the transaction's Ed25519 program instructions
pub fn verify_ed25519_signatures(
    instructions_sysvar: &AccountInfo,
    expected_signatures: &[SignatureData],
    expected_messages: &[Vec<u8>],
) -> Result<()> {
    require!(
        instructions_sysvar.key == &SYSVAR_INSTRUCTIONS_ID,
        SatiError::InvalidInstructionsSysvar
    );

    // Find and validate Ed25519 program instructions
    let mut verified_count = 0;
    let mut index = 0;

    loop {
        match load_instruction_at_checked(index, instructions_sysvar) {
            Ok(instruction) => {
                if instruction.program_id == ED25519_PROGRAM_ID {
                    // Parse Ed25519 instruction format
                    // First byte: number of signatures
                    // Then: 14 bytes per signature (offsets structure)
                    // Then: actual signature data, pubkeys, and messages

                    let data = &instruction.data;
                    require!(data.len() >= 2, SatiError::InvalidEd25519Instruction);

                    let num_signatures = data[0] as usize;
                    require!(num_signatures > 0, SatiError::InvalidEd25519Instruction);

                    // Each signature has 14-byte offset structure (7 u16 fields)
                    const OFFSETS_SIZE: usize = 14;
                    let offsets_start = 2;  // After num_signatures byte and padding

                    for i in 0..num_signatures {
                        let offset_pos = offsets_start + (i * OFFSETS_SIZE);
                        require!(
                            data.len() >= offset_pos + OFFSETS_SIZE,
                            SatiError::InvalidEd25519Instruction
                        );

                        // Parse offsets
                        let sig_offset = u16::from_le_bytes(
                            data[offset_pos..offset_pos + 2].try_into().unwrap()
                        ) as usize;
                        let pubkey_offset = u16::from_le_bytes(
                            data[offset_pos + 4..offset_pos + 6].try_into().unwrap()
                        ) as usize;
                        let msg_offset = u16::from_le_bytes(
                            data[offset_pos + 8..offset_pos + 10].try_into().unwrap()
                        ) as usize;
                        let msg_size = u16::from_le_bytes(
                            data[offset_pos + 10..offset_pos + 12].try_into().unwrap()
                        ) as usize;

                        // Extract and verify pubkey matches expected
                        require!(
                            data.len() >= pubkey_offset + 32,
                            SatiError::InvalidEd25519Instruction
                        );
                        let pubkey_bytes: [u8; 32] = data[pubkey_offset..pubkey_offset + 32]
                            .try_into()
                            .unwrap();
                        let pubkey = Pubkey::new_from_array(pubkey_bytes);

                        // Check if this pubkey matches any expected signature
                        for (j, expected) in expected_signatures.iter().enumerate() {
                            if expected.pubkey == pubkey {
                                // Verify message matches expected
                                require!(
                                    data.len() >= msg_offset + msg_size,
                                    SatiError::InvalidEd25519Instruction
                                );
                                let msg = &data[msg_offset..msg_offset + msg_size];
                                require!(
                                    msg == expected_messages[j].as_slice(),
                                    SatiError::MessageMismatch
                                );

                                // Verify signature matches (Ed25519 precompile validates crypto)
                                require!(
                                    data.len() >= sig_offset + 64,
                                    SatiError::InvalidEd25519Instruction
                                );
                                let sig: [u8; 64] = data[sig_offset..sig_offset + 64]
                                    .try_into()
                                    .unwrap();
                                require!(sig == expected.sig, SatiError::SignatureMismatch);

                                verified_count += 1;
                            }
                        }
                    }
                }
                index += 1;
            }
            Err(_) => break,  // No more instructions
        }
    }

    // Ensure all expected signatures were found
    require!(
        verified_count == expected_signatures.len(),
        SatiError::MissingSignatures
    );

    Ok(())
}
```

**SDK usage**: The SDK must include Ed25519 program instructions in the transaction **before** calling SATI. The transaction structure is:

```typescript
// Build transaction with Ed25519 instructions first
const ed25519Ix1 = Ed25519Program.createInstructionWithPublicKey({
    publicKey: agentPubkey.toBytes(),
    message: interactionHash,
    signature: agentSignature,
});

const ed25519Ix2 = Ed25519Program.createInstructionWithPublicKey({
    publicKey: clientPubkey.toBytes(),
    message: feedbackHash,
    signature: clientSignature,
});

const createAttestationIx = await satiProgram.methods
    .createAttestation(params)
    .accounts({ /* ... */ })
    .instruction();

// Transaction must have Ed25519 instructions before SATI instruction
const tx = new Transaction()
    .add(ed25519Ix1)
    .add(ed25519Ix2)
    .add(createAttestationIx);
```

**Security**: This approach is more gas-efficient than calling `ed25519_program` directly because:
1. Ed25519 precompile runs at ~1,400 CU per signature
2. Verification happens atomically in the same transaction
3. No additional CPI overhead

### Full Signature Verification Implementation

```rust
pub fn create_compressed_attestation<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateAttestation<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    params: CreateParams,
    schema_config: &SchemaConfig,
) -> Result<()> {
    // 1. Verify signature count per signature_mode
    match schema_config.signature_mode {
        SignatureMode::DualSignature => require!(params.signatures.len() == 2),
        SignatureMode::SingleSigner => require!(params.signatures.len() == 1),
    }

    // 2. Verify data length
    require!(
        params.data.len() >= MIN_BASE_LAYOUT_SIZE,  // 96 bytes for base layout
        SatiError::AttestationDataTooSmall
    );
    require!(
        params.data.len() <= MAX_ATTESTATION_DATA_SIZE,  // 768 bytes
        SatiError::AttestationDataTooLarge
    );

    // 3. Parse base layout for signature binding
    let token_account_pubkey = Pubkey::try_from(&params.data[32..64])?;
    let counterparty_pubkey = Pubkey::try_from(&params.data[64..96])?;

    // 5. Verify signature-data binding
    if params.signatures.len() == 2 {
        require!(params.signatures[0].pubkey == token_account_pubkey, SignatureMismatch);
        require!(params.signatures[1].pubkey == counterparty_pubkey, SignatureMismatch);
    }

    // 6. Self-attestation prevention
    require!(token_account_pubkey != counterparty_pubkey, SelfAttestationNotAllowed);

    // 4. Verify content size based on schema layout
    // Feedback: content at variable offset (after string tags), Validation: content at 131, ReputationScore: content at 98
    let content_offset = match params.data_type {
        0 => {
            // Feedback: tags are variable-length strings (1-byte len + UTF-8)
            // Base offset 130, then skip tag1 and tag2 string lengths
            let tag1_len = params.data[130] as usize;
            let tag2_start = 131 + tag1_len;
            let tag2_len = params.data[tag2_start] as usize;
            tag2_start + 1 + tag2_len  // Content starts after tag2
        }
        1 => 131,  // Validation: after data_hash(32) + content_type(1) + validation_type(1) + response(1)
        2 => 98,   // ReputationScore: after score(1) + content_type(1)
        _ => return Err(SatiError::InvalidDataType.into()),
    };

    if params.data.len() >= content_offset + 4 {
        let content_len = u32::from_le_bytes(
            params.data[content_offset..content_offset + 4].try_into()?
        ) as usize;
        require!(
            content_len <= MAX_CONTENT_SIZE,  // 512 bytes
            SatiError::ContentTooLarge
        );
    }

    // 5. Validate schema-specific fields at fixed offsets
    match params.data_type {
        0 => {
            // Feedback: content_type at 128, outcome at 129, tag1/tag2 are variable-length strings
            if params.data.len() >= 132 {
                let content_type = params.data[128];
                require!(content_type <= 4, SatiError::InvalidContentType);  // 0-4 valid

                let outcome = params.data[129];
                require!(outcome <= 2, SatiError::InvalidOutcome);  // 0=Negative, 1=Neutral, 2=Positive

                // Validate tag string lengths (max 32 chars each)
                let tag1_len = params.data[130] as usize;
                require!(tag1_len <= 32, SatiError::TagTooLong);
                let tag2_start = 131 + tag1_len;
                require!(params.data.len() > tag2_start, SatiError::InvalidDataLayout);
                let tag2_len = params.data[tag2_start] as usize;
                require!(tag2_len <= 32, SatiError::TagTooLong);
            }
        }
        1 => {
            // Validation: content_type at 128, validation_type at 129, response at 130
            if params.data.len() >= 131 {
                let content_type = params.data[128];
                require!(content_type <= 4, SatiError::InvalidContentType);  // 0-4 valid

                let response = params.data[130];
                require!(response <= 100, SatiError::InvalidResponse);  // 0-100 range
            }
        }
        2 => {
            // ReputationScore: score at 96, content_type at 97
            if params.data.len() >= 98 {
                let score = params.data[96];
                require!(score <= 100, SatiError::InvalidScore);  // 0-100 range

                let content_type = params.data[97];
                require!(content_type <= 4, SatiError::InvalidContentType);  // 0-4 valid
            }
        }
        _ => return Err(SatiError::InvalidDataType.into()),
    }

    // 6. Construct expected message hashes for signature verification
    // For DualSignature mode, each party signs a DIFFERENT hash:
    // Agent: hash(sas_schema, task_ref, token_account, data_hash)
    // Counterparty: hash(sas_schema, task_ref, token_account, outcome)
    let task_ref: [u8; 32] = params.data[0..32].try_into()?;
    let data_hash: [u8; 32] = params.data[96..128].try_into()?;

    let expected_messages = match params.data_type {
        0 => {  // Feedback
            let outcome = params.data[129];
            vec![
                compute_interaction_hash(&schema_config.sas_schema, &task_ref, &token_account_pubkey, &data_hash),
                compute_feedback_hash(&schema_config.sas_schema, &task_ref, &token_account_pubkey, outcome),
            ]
        }
        1 => {  // Validation
            let response = params.data[130];
            vec![
                compute_interaction_hash(&schema_config.sas_schema, &task_ref, &token_account_pubkey, &data_hash),
                compute_validation_hash(&schema_config.sas_schema, &task_ref, &token_account_pubkey, response),
            ]
        }
        2 => {  // ReputationScore (single signer)
            let score = params.data[96];
            vec![
                compute_reputation_hash(&schema_config.sas_schema, &token_account_pubkey, &counterparty_pubkey, score),
            ]
        }
        _ => return Err(SatiError::InvalidDataType.into()),
    };

    // 7. Verify Ed25519 signatures via instruction introspection
    verify_ed25519_signatures(
        &ctx.accounts.instructions_sysvar,
        &params.signatures,
        &expected_messages,
    )?;

    // 9. Derive deterministic address using task_ref
    // Note: Use schema_config.sas_schema (authoritative) instead of params.sas_schema
    let task_ref = &params.data[0..32];
    let nonce = keccak256(&[
        task_ref,
        schema_config.sas_schema.as_ref(),
        token_account_pubkey.as_ref(),
        counterparty_pubkey.as_ref(),  // Include counterparty for uniqueness
    ].concat());
    let (address, address_seed) = derive_address(
        &[b"attestation", schema_config.sas_schema.as_ref(), token_account_pubkey.as_ref(), &nonce],
        &address_tree_info.get_tree_pubkey(&light_cpi_accounts)?,
        &crate::ID,
    );

    // 10. Initialize compressed account via LightAccount wrapper
    let mut attestation = LightAccount::<CompressedAttestation>::new_init(
        &crate::ID,
        Some(address),
        output_state_tree_index,
    );

    attestation.sas_schema = schema_config.sas_schema;  // Use schema_config, not params
    attestation.token_account = token_account_pubkey;
    attestation.data_type = params.data_type;
    attestation.data = params.data;
    attestation.signatures = params.signatures.iter().map(|s| s.sig).collect();

    // 11. CPI to Light System Program
    let new_address_params = address_tree_info.into_new_address_params_packed(address_seed);

    LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
        .with_light_account(attestation)?
        .with_new_addresses(&[new_address_params])
        .invoke(light_cpi_accounts)?;

    Ok(())
}
```

### close_attestation Implementation

```rust
pub fn close_compressed_attestation<'info>(
    ctx: Context<'_, '_, '_, 'info, CloseAttestation<'info>>,
    proof: ValidityProof,
    account_meta: CompressedAccountMeta,
    current_data: Vec<u8>,
    data_type: u8,  // Pass data_type explicitly
    schema_config: &SchemaConfig,
) -> Result<()> {
    // 1. Check if schema allows closing
    require!(schema_config.closeable, SatiError::AttestationNotCloseable);

    // 2. Parse token_account and counterparty from current_data
    let token_account = Pubkey::try_from(&current_data[32..64])?;
    let counterparty = Pubkey::try_from(&current_data[64..96])?;

    // 3. Authorization depends on schema type
    // - Feedback/Validation: NOT closeable (closeable=false, checked above)
    // - ReputationScore: Only the provider (counterparty) can close
    require!(
        ctx.accounts.signer.key() == counterparty,
        SatiError::UnauthorizedClose
    );

    // 4. Close via Light Protocol
    let attestation = LightAccount::<CompressedAttestation>::new_close(
        &crate::ID,
        &account_meta,
        CompressedAttestation {
            sas_schema: schema_config.sas_schema,
            token_account,
            data_type,  // Passed as parameter
            data: current_data.clone(),
            signatures: vec![],
        },
    )?;

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.signer.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
        .with_light_account(attestation)?
        .invoke(light_cpi_accounts)?;

    Ok(())
}
```

**Close vs Burn**: SATI uses **close** (not burn) for attestations:
- Close produces a zero-valued hash, marking the account as closed
- The nullifier prevents reuse of the same address
- Burn would remove from tree entirely (not supported by Light v1)

**Authorization model:**
- Feedback/Validation: `closeable=false` — cannot be closed (immutable)
- ReputationScore: `closeable=true` — only provider (counterparty) can close to update

---

## Squads Integration (Smart Accounts)

Agents can be owned by Squads smart accounts for multisig control, key rotation, and organizational ownership.

### Why Squads for Agent Ownership

| Aspect | Regular Wallet | Squads |
|--------|---------------|--------|
| Key compromise | Agent lost | Rotate member keys |
| Organizational control | Single person | Multi-signature approval |
| Soulbound agents | Permanently locked | Can still change control via member updates |
| Succession planning | Manual transfer | Built-in member management |

### Registering an Agent with Squads Ownership

```typescript
import { Multisig } from "@sqds/sdk";

// 1. Create or use existing Squads multisig
const multisig = await Multisig.create({
    connection,
    threshold: 2,           // 2-of-3 approval
    members: [member1, member2, member3],
    createKey: Keypair.generate(),
});

// 2. Get the Squads vault ATA (will own the agent NFT)
const squadsVault = multisig.getDefaultVaultPda();

// 3. Register agent with Squads as owner
// The vault becomes the token account holder
await sati.registerAgent({
    name: "OrgAgent",
    symbol: "SATI",
    uri: "ipfs://...",
    owner: squadsVault,           // Squads vault owns the agent
    nonTransferable: false,       // Can transfer within Squads control
    additionalMetadata: [
        ["agentWallet", `solana:5eykt4...:${agentWallet.toBase58()}`],
        ["managedBy", "squads"],
    ],
});
```

### Updating Agent Metadata via Squads

```typescript
// 1. Create transaction to update metadata
const updateIx = await sati.updateAgentMetadataInstruction({
    mint: agentMint,
    field: "uri",
    value: "ipfs://new-registration-file",
});

// 2. Create Squads proposal
const proposalPda = await multisig.createTransactionProposal({
    transactionIndex: await multisig.getNextTransactionIndex(),
    creator: member1,
    instructions: [updateIx],
});

// 3. Members approve
await multisig.approveProposal(proposalPda, member1);
await multisig.approveProposal(proposalPda, member2);  // Meets threshold

// 4. Execute
await multisig.executeTransaction(proposalPda);
```

### Soulbound Agents with Squads

For soulbound agents that need organizational control:

```typescript
// Register as soulbound but owned by Squads
await sati.registerAgent({
    name: "OrgSoulboundAgent",
    owner: squadsVault,
    nonTransferable: true,  // Cannot transfer...
    // ...but Squads members can be rotated
});

// Key rotation: add new member, remove compromised member
await multisig.addMember(newMember);
await multisig.removeMember(compromisedMember);
// Agent control is updated without transferring
```

---

## Token-2022 Implementation

### Extension Initialization Order (CRITICAL)

Token-2022 requires extensions to be initialized in a specific order:

1. `MetadataPointer` — Must be initialized FIRST (before mint)
2. `GroupMemberPointer` — Before mint
3. `NonTransferable` — Before mint (if soulbound)
4. Initialize mint
5. `TokenMetadata` — AFTER mint, AFTER MetadataPointer
6. `TokenGroupMember` — AFTER mint, AFTER GroupMemberPointer

Incorrect ordering causes silent failures or runtime errors.

### TokenGroup Structure

| Field | Type | Description |
|-------|------|-------------|
| `updateAuthority` | Pubkey | Registry PDA |
| `mint` | Pubkey | SATI collection mint |
| `size` | u64 | Current number of agents |
| `maxSize` | u64 | Max agents (0 = unlimited) |

### TokenGroupMember Structure

| Field | Type | Description |
|-------|------|-------------|
| `mint` | Pubkey | Agent NFT mint (= agentId) |
| `group` | Pubkey | SATI Registry group mint |
| `memberNumber` | u64 | Auto-incrementing (like ERC-721 tokenId) |

### Common additionalMetadata Keys

- `agentWallet` — CAIP-10 format wallet address
- `did` — DID document reference
- `a2a` — A2A agent card URL
- `mcp` — MCP endpoint URL

### Agent Wallet vs Token Account (Multi-Chain)

SATI distinguishes between two identifiers:

| Identifier | Purpose | Format |
|-----------|---------|--------|
| `token_account` | On-chain identity (Solana NFT mint) | Solana Pubkey |
| `agentWallet` | Operational wallet for payments/signing | CAIP-10 (any chain) |

**Why separate?**
- Agent may operate on multiple chains with different wallets
- Identity (NFT) is Solana-native, but payments can be on Base, Ethereum, etc.
- Allows same agent identity across x402 payments on different chains

**Example multi-chain agent:**

```typescript
// Register with Solana operational wallet
await sati.registerAgent({
    name: "MultiChainAgent",
    additionalMetadata: [
        // Solana wallet for Solana x402 payments
        ["agentWallet", "solana:5eykt4...:7S3P4HxJpy..."],
        // Base wallet for Base x402 payments
        ["agentWallet:base", "eip155:8453:0x742d35Cc6634..."],
        // Ethereum wallet
        ["agentWallet:ethereum", "eip155:1:0xAbC123..."],
    ],
});
```

**Feedback binding:**
- `task_ref` uses CAIP-220 format: includes chain ID where payment occurred
- `token_account` always references Solana NFT mint (agent identity)
- Counterparty can be on any chain (CAIP-10 in registration file)

```typescript
// Feedback for x402 payment on Base
await sati.createFeedback({
    tokenAccount: agentMint,              // Solana identity
    taskRef: hashFromBasePayment,         // CAIP-220 from Base tx
    counterparty: clientSolanaPubkey,     // Client's Solana signing key
    // ...
});
```

---

## Light Protocol Integration

### Light Protocol Programs

| Program | Address | Purpose |
|---------|---------|---------|
| Light System | `SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7` | Compressed account operations |
| Account Compression | `compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq` | State tree management |
| Noop | `noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV` | Event logging for indexer |

### CPI Signer Setup

```rust
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{v1::{CpiAccounts, LightSystemProgramCpi}, CpiSigner, InvokeLightSystemProgram, LightCpiInstruction},
    derive_light_cpi_signer,
    instruction::{PackedAddressTreeInfo, ValidityProof},
    LightDiscriminator, LightHasher,
};

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("satiATTN...");
```

### Key Patterns

- `CpiAccounts::new()` parses accounts for the Light System Program CPI
- `derive_address()` returns both address and seed needed for CPI
- `LightAccount::new_init()` wraps struct for creation
- `LightAccount::new_mut()` for updates
- `LightAccount::new_close()` for closing
- `LightSystemProgramCpi` builder chains `.with_light_account()` and `.with_new_addresses()`

### State Trees

Light Protocol uses **concurrent merkle trees** for state storage:

| Property | Value |
|----------|-------|
| Tree depth | 26 (supports ~67M leaves) |
| Changelog size | 2400 (concurrent updates) |
| Canopy depth | 10 (reduced proof size) |

SATI uses shared public state trees (no tree deployment needed).

### Light SDK remaining_accounts

The SATI Attestation Program does not explicitly list Light Protocol accounts in its Anchor context. Instead, they are passed via `remaining_accounts` and parsed by `CpiAccounts::new()`. This is by design:

**Why SDK handles remaining_accounts:**
1. **Off-chain query required**: The SDK must query Photon to determine which state/address trees to use
2. **Dynamic account selection**: Tree selection depends on current tree capacity and network conditions
3. **Validity proof generation**: Proofs are generated off-chain and include tree-specific data
4. **Program cannot query**: On-chain programs cannot query Photon or determine optimal trees

The typical accounts passed via `remaining_accounts`:
- Light System Program
- Account Compression Program
- Noop Program (for event logging)
- State tree account(s)
- Address tree account(s)
- Nullifier queue(s)

The SDK handles all of this transparently via `createRpc()` from `@lightprotocol/stateless.js`.

### CPI Validation Note

The program does not explicitly validate Light System Program IDs in `remaining_accounts`. This is intentional — passing incorrect program IDs causes transaction failure with no benefit to attackers (they just waste SOL). Light SDK's `CpiAccounts::new()` validates internally.

---

## SAS Integration (Regular Storage)

### SAS Program

| Program | Address | Purpose |
|---------|---------|---------|
| SAS | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | Regular attestation storage |

### SATI SAS Credential

SATI operates a single SAS credential controlled by SATI governance. All core schemas live under this credential.

```
SATI SAS Credential
├── authority: SATI multisig (schema management only)
└── authorized_signers: [SATI_ATTESTATION_PROGRAM_PDA]  // ONLY this!
```

**Critical**: SATI Attestation Program PDA is the **sole authorized signer**. All signature verification happens in SATI Attestation Program, then it CPIs to SAS using `invoke_signed`.

### SAS Account Structures

**Credential Account** (PDA: `["credential", authority, name]`):
```
Layout:
├─ Discriminator (1 byte) = 0
├─ Authority (32 bytes) - SATI multisig
├─ Name Length (4 bytes) - u32 little-endian
├─ Name Data (variable) - "sati-core"
├─ Authorized Signers Count (4 bytes)
└─ Authorized Signers Array (32 bytes × count) - [SATI_ATTESTATION_PDA]
```

**Schema Account** (PDA: `["schema", credential, name, version]`):
```
Layout:
├─ Discriminator (1 byte) = 1
├─ Credential (32 bytes)
├─ Name/Description/Layout/FieldNames (variable)
├─ Is Paused (1 byte)
└─ Version (1 byte)
```

**Attestation Account** (PDA: `["attestation", credential, schema, nonce]`):
```
Layout:
├─ Discriminator (1 byte) = 2
├─ Nonce (32 bytes) - Deterministic per schema type
├─ Credential (32 bytes) - SATI credential
├─ Schema (32 bytes) - ReputationScore
├─ Data Length (4 bytes)
├─ Data (variable) - Schema-conformant bytes
├─ Signer (32 bytes) - SATI Attestation Program PDA
├─ Expiry (8 bytes) - i64 Unix timestamp (0 = never)
└─ Token Account (32 bytes) - Always zero for non-tokenized
```

### create_regular_attestation Implementation

```rust
use solana_attestation_service_client::instructions::CreateAttestationCpiBuilder;

pub fn create_regular_attestation<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateRegularAttestation<'info>>,
    params: CreateRegularParams,
    schema_config: &SchemaConfig,
) -> Result<()> {
    require!(
        schema_config.storage_type == StorageType::Regular,
        SatiError::StorageTypeMismatch
    );

    // 1. Verify signature count (SingleSigner mode for regular attestations)
    require!(params.signatures.len() == 1, SatiError::InvalidSignatureCount);

    // Provider must match counterparty field in data
    let counterparty = Pubkey::try_from(&params.data[64..96])?;
    require!(
        params.signatures[0].pubkey == counterparty,
        SatiError::SignatureMismatch
    );

    // Verify provider's signature
    let message_hash = compute_single_signer_hash(&params)?;
    verify_ed25519(params.signatures[0].pubkey, params.signatures[0].sig, message_hash)?;

    // 2. Verify base layout
    require!(params.data.len() >= MIN_BASE_LAYOUT_SIZE, SatiError::AttestationDataTooSmall);

    let token_account = Pubkey::try_from(&params.data[32..64])?;
    let counterparty = Pubkey::try_from(&params.data[64..96])?;
    require!(token_account != counterparty, SatiError::SelfAttestationNotAllowed);

    // 3. Compute deterministic nonce
    let nonce = compute_regular_nonce(&params, schema_config)?;

    // 4. CPI to SAS using SATI PDA as authorized signer
    let sati_pda_seeds: &[&[u8]] = &[
        b"sati_attestation",
        &[ctx.bumps.sati_pda],
    ];

    CreateAttestationCpiBuilder::new(&ctx.accounts.sas_program)
        .payer(&ctx.accounts.payer)
        .authority(&ctx.accounts.sati_pda)
        .credential(&ctx.accounts.sati_credential)
        .schema(&ctx.accounts.sas_schema)
        .attestation(&ctx.accounts.attestation)
        .system_program(&ctx.accounts.system_program)
        .nonce(nonce)
        .data(params.data.clone())
        .expiry(params.expiry)
        .invoke_signed(&[sati_pda_seeds])?;

    // 5. Emit event
    emit_cpi!(AttestationCreated {
        sas_schema: schema_config.sas_schema,
        token_account,
        counterparty,
        data_type: params.data_type,
        storage_type: StorageType::Regular,
        address: ctx.accounts.attestation.key(),
    });

    Ok(())
}
```

### Regular Attestation Nonce Strategy

Deterministic nonce ensures one ReputationScore per (provider, agent) pair:

```rust
fn compute_regular_nonce(params: &CreateRegularParams) -> Result<Pubkey> {
    let token_account = &params.data[32..64];
    let counterparty = &params.data[64..96];  // For ReputationScore, counterparty = provider

    // One ReputationScore per (provider, agent) pair
    let nonce_bytes = keccak256(&[counterparty, token_account].concat());

    Ok(Pubkey::new_from_array(nonce_bytes.try_into()?))
}
```

Provider updates by closing old attestation + creating new one with same deterministic nonce (rent neutral).

### Expiry Patterns

SAS attestations support an `expiry` field for time-limited validity:

```rust
// Create with 30-day expiry
CreateAttestationCpiBuilder::new(&ctx.accounts.sas_program)
    .nonce(nonce)
    .data(params.data.clone())
    .expiry(Clock::get()?.unix_timestamp + 30 * 24 * 60 * 60)  // 30 days
    .invoke_signed(&[sati_pda_seeds])?;

// Create with no expiry (0 = never expires)
CreateAttestationCpiBuilder::new(&ctx.accounts.sas_program)
    .nonce(nonce)
    .data(params.data.clone())
    .expiry(0)
    .invoke_signed(&[sati_pda_seeds])?;
```

**Expiry use cases:**

| Schema | Recommended Expiry | Rationale |
|--------|-------------------|-----------|
| Feedback | 0 (never) | Historical record, immutable |
| Validation | 0 or 90 days | May want to re-validate periodically |
| ReputationScore | 30 days | Scores should be refreshed regularly |

**Checking expiry client-side:**

```typescript
const attestation = await getReputationScore(provider, agent);

// Check if expired
const now = Math.floor(Date.now() / 1000);
if (attestation.expiry > 0 && attestation.expiry < now) {
    console.log("ReputationScore expired, request fresh score");
}
```

**Note**: Expiry is not enforced on-chain for reads — any program can read expired attestations. Enforcement is at the application layer (consumers should check expiry).

### close_regular_attestation Implementation

```rust
pub fn close_regular_attestation<'info>(
    ctx: Context<'_, '_, '_, 'info, CloseRegularAttestation<'info>>,
) -> Result<()> {
    // 1. Check if schema allows closing
    require!(
        ctx.accounts.schema_config.closeable,
        SatiError::AttestationNotCloseable
    );

    // 2. Parse token_account and counterparty (provider) from attestation data
    // SAS layout: discriminator(1) + nonce(32) + credential(32) + schema(32) + data_len(4) + data
    // Data layout: task_ref(32) + token_account(32) + counterparty(32) + ...
    let attestation_data = &ctx.accounts.attestation.data.borrow();
    let data_start = 1 + 32 + 32 + 32 + 4;  // After SAS header
    let token_account = Pubkey::try_from(&attestation_data[data_start + 32..data_start + 64])?;
    let counterparty = Pubkey::try_from(&attestation_data[data_start + 64..data_start + 96])?;

    // 3. Authorization: Only the provider (counterparty) can close ReputationScore
    require!(
        ctx.accounts.signer.key() == counterparty,
        SatiError::UnauthorizedClose
    );

    // 4. CPI to SAS CloseAttestation
    let sati_pda_seeds: &[&[u8]] = &[b"sati_attestation", &[ctx.bumps.sati_pda]];

    CloseAttestationCpiBuilder::new(&ctx.accounts.sas_program)
        .payer(&ctx.accounts.payer)
        .authority(&ctx.accounts.sati_pda)
        .credential(&ctx.accounts.sati_credential)
        .attestation(&ctx.accounts.attestation)
        .invoke_signed(&[sati_pda_seeds])?;

    emit_cpi!(AttestationClosed {
        sas_schema: ctx.accounts.schema_config.sas_schema,
        token_account,
        address: ctx.accounts.attestation.key(),
    });

    Ok(())
}
```

### Regular Attestation Queries (RPC)

Regular attestations use standard Solana RPC (not Photon):

```typescript
import { Connection, PublicKey } from "@solana/web3.js";

const SAS_PROGRAM_ID = new PublicKey("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

// Derive attestation PDA
function deriveAttestationPda(
    credential: PublicKey,
    schema: PublicKey,
    nonce: PublicKey
): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("attestation"), credential.toBuffer(), schema.toBuffer(), nonce.toBuffer()],
        SAS_PROGRAM_ID
    );
    return pda;
}

// Get single ReputationScore by provider + agent
async function getReputationScore(
    connection: Connection,
    provider: PublicKey,
    tokenAccount: PublicKey
): Promise<ReputationScore | null> {
    const nonce = computeReputationNonce(provider, tokenAccount);
    const pda = deriveAttestationPda(SATI_CREDENTIAL, REPUTATION_SCHEMA, nonce);

    const account = await connection.getAccountInfo(pda);
    if (!account) return null;

    return parseReputationScore(account.data);
}

// List all ReputationScores for an agent
async function listReputationScores(
    connection: Connection,
    tokenAccount: PublicKey
): Promise<ReputationScore[]> {
    const accounts = await connection.getProgramAccounts(SAS_PROGRAM_ID, {
        filters: [
            // Note: dataSize filter not reliable for variable-length schemas
            { memcmp: { offset: 33, bytes: SATI_CREDENTIAL.toBase58() } },
            { memcmp: { offset: 65, bytes: REPUTATION_SCHEMA.toBase58() } },
            // Filter by token_account in data (offset varies by SAS structure)
            { memcmp: { offset: 101 + 32, bytes: tokenAccount.toBase58() } },
        ],
    });

    return accounts.map(({ account }) => parseReputationScore(account.data));
}
```

---

## Serialization Format

All attestation data uses **Borsh serialization** (Binary Object Representation Serializer for Hashing).

**Key characteristics:**
- Fixed-size fields serialized directly (no length prefixes)
- Variable-size fields (Vec, String) use 4-byte little-endian length prefix
- Structs serialized in field order (no field names)
- Enums use 1-byte variant index followed by variant data

### SAS Layout Types

| Type Code | Name | Size |
|-----------|------|------|
| 0 | Bool | 1 byte |
| 1 | U8 | 1 byte |
| 2 | U16 | 2 bytes |
| 3 | U32 | 4 bytes |
| 4 | U64 | 8 bytes |
| 5 | U128 | 16 bytes |
| 6 | I8 | 1 byte |
| 7 | I16 | 2 bytes |
| 8 | I32 | 4 bytes |
| 9 | I64 | 8 bytes |
| 10 | I128 | 16 bytes |
| 11 | Pubkey | 32 bytes |
| 12 | String | 4 + N bytes |
| 13 | VecU8 | 4 + N bytes |

### Feedback Struct Example (variable length)

```
Offset   Size      Field
0        32        task_ref: [u8; 32]
32       32        token_account: Pubkey
64       32        counterparty: Pubkey
96       32        data_hash: [u8; 32]
128      1         content_type: u8
129      1         outcome: u8            // Fixed offset for memcmp filtering
130      1+M       tag1: String           // 1-byte len + UTF-8, max 32 chars
var      1+N       tag2: String           // 1-byte len + UTF-8, max 32 chars
var      4+K       content: Vec<u8>       // Borsh: 4-byte len prefix + K bytes
```

**String encoding**: `[length: u8][data: UTF-8 × length]` (max 32 chars per tag)

**Fixed offset benefit**: `outcome` at offset 129 enables Photon memcmp filtering by feedback sentiment. Tags are variable-length for ERC-8004 compatibility (e.g., `"quality"`, `"latency"`).

**Minimum size**: 132 bytes (empty tags: 1+0 each, empty content: 4-byte length prefix)
**Example with tags "quality"(7) + "speed"(5) + 50-byte JSON**: 198 bytes (130 + 8 + 6 + 4 + 50)

---

## Photon Indexing Implementation

### Response Structure

```typescript
interface CompressedAccountValue {
  owner: PublicKey;           // Always SATI Attestation Program
  lamports: number;           // Always 0 for compressed
  data: Uint8Array;           // Full attestation data
  address: PublicKey;         // Derived address
  hash: string;               // Account hash (for proofs)
}

interface PaginatedResponse<T> {
  context: { slot: number };
  value: {
    items: T[];
    cursor: string | null;    // For pagination
  };
}
```

### Query Examples

```typescript
import { createHelius } from "@helius-dev/sdk";

const helius = createHelius({ apiKey });

// Query feedbacks for an agent with cursor pagination
const feedbacks = await helius.zk.getCompressedAccountsByOwner({
    owner: SATI_ATTESTATION_PROGRAM.toBase58(),
    filters: [
        { memcmp: { offset: 8, bytes: feedbackSchemaAddress.toBase58() } },  // sas_schema
        { memcmp: { offset: 40, bytes: tokenAccount.toBase58() } },          // token_account
    ],
    limit: 50,
    cursor: null,
});

// Iterate with cursor
let cursor = feedbacks.value.cursor;
while (cursor) {
    const next = await helius.zk.getCompressedAccountsByOwner({
        owner: SATI_ATTESTATION_PROGRAM.toBase58(),
        filters: [...],
        cursor,
    });
    cursor = next.value.cursor;
}

// Get validity proof for creating/updating attestation
const proof = await helius.zk.getValidityProof({
    hashes: [existingAccountHash],           // For updates
    newAddressesWithTrees: [{ address, tree }], // For new addresses
});

// Get merkle proof for escrow verification
const accountProof = await helius.zk.getCompressedAccountProof({
    hash: attestationHash,
});
```

**Note on byte offsets**: The 8-byte discriminator is INCLUDED in memcmp filtering:
- `sas_schema`: offset 8 (after discriminator)
- `token_account`: offset 40 (8 + 32)
- `outcome` (Feedback): offset 137 (8 + 129)
- `response` (Validation): offset 138 (8 + 130)

**Client-side aggregation**: SATI stores complete feedback histories rather than on-chain aggregates. Aggregation (averages, weighted scores, time-decay) is performed client-side via Photon cursor pagination. This design enables:
- Spam detection via pattern analysis
- Reviewer reputation weighting
- Custom scoring algorithms per consumer
- No on-chain upgrade required for algorithm changes

### Helius Photon Endpoints

| Network | Endpoint |
|---------|----------|
| Mainnet | `https://mainnet.helius-rpc.com/?api-key=<KEY>` |
| Devnet | `https://devnet.helius-rpc.com/?api-key=<KEY>` |

Photon is available via Helius RPC endpoints. Free tier includes Photon access.

---

## SDK Implementation Details

### Full createFeedback Parameters

```typescript
await sati.createFeedback({
  tokenAccount,                          // Agent's token mint
  counterparty: clientPubkey,            // Client who received service
  outcome: Outcome.Positive,
  tag1: "quality",                       // Free-form string (max 32 chars)
  tag2: "speed",                         // Free-form string (max 32 chars)
  dataHash: requestHash,                 // Hash of the request (agent's blind commitment)
  taskRef: paymentTxHash,                // CAIP-220 tx hash or arbitrary ID
  content: {                             // Optional extended content
    type: ContentType.JSON,              // 0=None, 1=JSON, 2=UTF8, 3=IPFS, 4=Arweave
    data: JSON.stringify({
      text: "Fast and accurate",
      latency_ms: 180,
    }),
  },
  signatures: [
    { pubkey: agentPubkey, sig: agentSig },       // Agent's blind signature
    { pubkey: clientPubkey, sig: clientSig },    // Client's feedback signature
  ],
});
```

**Content types:**
- `ContentType.None` (0): No extended content, just outcome + tags
- `ContentType.JSON` (1): Inline JSON object
- `ContentType.UTF8` (2): Plain text
- `ContentType.IPFS` (3): IPFS CIDv1 (~36 bytes)
- `ContentType.Arweave` (4): Arweave transaction ID (32 bytes)

### createFeedbackBatch

Batches multiple feedbacks into a single transaction. Validity proof cost (~100K CU) is amortized across all feedbacks, reducing per-feedback cost by ~70%.

```typescript
// Batch up to 5 feedbacks per transaction
// ~170K CU total vs 5 × 120K = 600K CU for individual calls
const { addresses, signature } = await sati.createFeedbackBatch([
  {
    tokenAccount: agent1,
    counterparty: client1,
    outcome: Outcome.Positive,
    signatures: [agentSig1, clientSig1],
    // ... other fields
  },
  {
    tokenAccount: agent1,  // Can be same or different agents
    counterparty: client2,
    outcome: Outcome.Positive,
    signatures: [agentSig2, clientSig2],
    // ... other fields
  },
  // ... up to 5 feedbacks
]);
```

**When to use batching:**
- Agent processing multiple client feedbacks
- Bulk import of historical feedbacks
- High-volume agents optimizing costs

Batching is an SDK optimization using Light Protocol's multi-recipient compress pattern. The on-chain program processes single attestations — batching combines multiple program instructions per transaction.

### createReputationScore Parameters

```typescript
await sati.createReputationScore({
  tokenAccount,                         // Agent being scored
  provider: providerPubkey,             // Reputation provider (counterparty)
  score: 85,                            // 0-100 normalized score
  content: {                            // Optional: methodology/details
    type: ContentType.JSON,
    data: JSON.stringify({
      methodology: "weighted_feedback",
      feedback_count: 127,
      time_window_days: 30,
    }),
  },
  signature: {                          // Provider's signature (SingleSigner mode)
    pubkey: providerPubkey,
    sig: providerSig,
  },
});
```

**Signature message** (provider signs):
```
hash(sas_schema, token_account, provider, score)
```

### updateReputationScore Parameters

```typescript
// Update = close old + create new (rent neutral)
await sati.updateReputationScore({
  tokenAccount,
  provider: providerPubkey,
  score: 88,                            // New score
  content: {                            // Optional: updated details
    type: ContentType.JSON,
    data: JSON.stringify({
      methodology: "weighted_feedback",
      feedback_count: 142,
      time_window_days: 30,
    }),
  },
  signature: {
    pubkey: providerPubkey,
    sig: newProviderSig,                // New signature on new data
  },
});
```

### Event Parsing Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `parseAgentRegistered(logs)` | Parse AgentRegistered events | `AgentRegistered[]` |
| `parseAttestationCreated(logs)` | Parse AttestationCreated events | `AttestationCreated[]` |
| `subscribeToAgentEvents(callback)` | WebSocket subscription | `Subscription` |
| `subscribeToAttestationEvents(callback)` | WebSocket subscription | `Subscription` |

### SDK Helper Signatures

**Hash construction helpers:**

```typescript
// Compute the hash agent signs (blind to outcome)
function computeInteractionHash(params: {
    sasSchema: PublicKey;
    taskRef: Uint8Array;
    tokenAccount: PublicKey;
    dataHash: Uint8Array;
}): Uint8Array;

// Compute the hash counterparty signs (with outcome)
function computeFeedbackHash(params: {
    sasSchema: PublicKey;
    taskRef: Uint8Array;
    tokenAccount: PublicKey;
    outcome: Outcome;
}): Uint8Array;

// Compute the hash provider signs
function computeReputationHash(params: {
    sasSchema: PublicKey;
    tokenAccount: PublicKey;
    provider: PublicKey;
    score: number;
}): Uint8Array;
```

**Address derivation helpers:**

```typescript
// Derive compressed attestation address
function deriveAttestationAddress(params: {
    taskRef: Uint8Array;
    sasSchema: PublicKey;
    tokenAccount: PublicKey;
    counterparty: PublicKey;
    addressTree: PublicKey;
}): PublicKey;

// Derive ReputationScore PDA
function deriveReputationScorePda(params: {
    provider: PublicKey;
    tokenAccount: PublicKey;
}): PublicKey;

// Derive agent token account from mint
function deriveAgentTokenAccount(params: {
    mint: PublicKey;
    owner: PublicKey;
}): PublicKey;
```

**Instruction builders (for custom transaction construction):**

```typescript
// Build register_agent instruction
function registerAgentInstruction(params: RegisterAgentParams): TransactionInstruction;

// Build create_attestation instruction
function createAttestationInstruction(params: CreateAttestationParams): TransactionInstruction;

// Build close_attestation instruction
function closeAttestationInstruction(params: CloseAttestationParams): TransactionInstruction;

// Build update_metadata instruction (direct Token-2022)
function updateAgentMetadataInstruction(params: {
    mint: PublicKey;
    field: string;
    value: string;
}): TransactionInstruction;
```

**Verification helpers:**

```typescript
// Verify Ed25519 signature locally
function verifySignature(params: {
    publicKey: PublicKey;
    message: Uint8Array;
    signature: Uint8Array;
}): boolean;

// Verify attestation signatures match expected hashes
function verifyAttestationSignatures(attestation: Attestation): boolean;

// Check if ReputationScore is expired
function isExpired(attestation: ReputationScore): boolean;
```

**Why SDK verifies signatures locally**: The SDK validates signatures before submitting transactions to fail fast and avoid wasted network round-trips. On-chain verification via Ed25519 introspection is the authoritative check, but local verification provides immediate feedback to developers.

---

## Security Implementation Details

### Program Security

| Aspect | Approach |
|--------|----------|
| Account validation | Anchor constraints validate seeds, bumps, authority, mutability |
| Checked arithmetic | All operations use `checked_*` methods to prevent overflow |
| PDA security | Bumps stored for efficient CPI signing; agent mints are random keypairs |
| CPI security | Target program IDs validated via `Program<'info, T>` |
| Input validation | All strings validated against maximum lengths |

### Token-2022 Security

| Aspect | Guarantee |
|--------|-----------|
| Supply | Mint authority renounced atomically after minting 1 token |
| Freeze | No freeze authority (set to `None` at creation) |
| Ownership | Uses Token-2022's proven ownership model |

### Signature Security

| Aspect | Guarantee |
|--------|-----------|
| Ed25519 verification | ~1800 CU per signature via Solana's ed25519_program |
| Domain separation | Distinct hashes for agent vs counterparty signatures |
| Blind feedback | Agent signs with response (before outcome known) |
| Signature-data binding | On-chain verification that pubkeys match data |
| Self-attestation prevention | On-chain check: `token_account != counterparty` |
| Replay protection | Deterministic nonce from `keccak256(task_ref, schema, token_account, counterparty)` |
| Canonical signatures | Ed25519 signatures must be in canonical form (s < L/2) |

**Note on Ed25519 verification**: Solana's `ed25519_program` precompile is used via instruction introspection. The calling transaction must include Ed25519 program instructions with signatures, which the SATI program verifies via the instructions sysvar.

### Signature Message Construction

For DualSignature mode (Feedback, Validation), agent and counterparty sign **different** messages:

**Agent's Interaction Hash** (signed with response, blind to outcome):
```rust
/// Agent signs this hash when responding to the request (before knowing outcome)
fn compute_interaction_hash(
    sas_schema: &Pubkey,
    task_ref: &[u8; 32],
    token_account: &Pubkey,
    data_hash: &[u8; 32],  // Hash of request data (agent's commitment)
) -> [u8; 32] {
    // Domain separator prevents cross-schema replay
    let domain = b"SATI:interaction:v1";

    let message = [
        domain.as_slice(),
        sas_schema.as_ref(),      // 32 bytes
        task_ref.as_ref(),        // 32 bytes
        token_account.as_ref(),   // 32 bytes
        data_hash.as_ref(),       // 32 bytes
    ].concat();

    keccak256(&message)
}
```

**Counterparty's Feedback Hash** (signed after receiving service):
```rust
/// Counterparty signs this hash when providing feedback (after service complete)
fn compute_feedback_hash(
    sas_schema: &Pubkey,
    task_ref: &[u8; 32],
    token_account: &Pubkey,
    outcome: u8,  // 0=Negative, 1=Neutral, 2=Positive
) -> [u8; 32] {
    // Domain separator prevents cross-schema replay
    let domain = b"SATI:feedback:v1";

    let message = [
        domain.as_slice(),
        sas_schema.as_ref(),      // 32 bytes
        task_ref.as_ref(),        // 32 bytes
        token_account.as_ref(),   // 32 bytes
        &[outcome],               // 1 byte
    ].concat();

    keccak256(&message)
}
```

**SingleSigner Mode** (ReputationScore):
```rust
/// Provider signs this hash when publishing a score
fn compute_reputation_hash(
    sas_schema: &Pubkey,
    token_account: &Pubkey,
    provider: &Pubkey,
    score: u8,  // 0-100
) -> [u8; 32] {
    let domain = b"SATI:reputation:v1";

    let message = [
        domain.as_slice(),
        sas_schema.as_ref(),      // 32 bytes
        token_account.as_ref(),   // 32 bytes
        provider.as_ref(),        // 32 bytes
        &[score],                 // 1 byte
    ].concat();

    keccak256(&message)
}
```

**TypeScript SDK equivalent:**
```typescript
import { keccak_256 } from "@noble/hashes/sha3";

function computeInteractionHash(
    sasSchema: PublicKey,
    taskRef: Uint8Array,      // 32 bytes
    tokenAccount: PublicKey,
    dataHash: Uint8Array,     // 32 bytes
): Uint8Array {
    const domain = new TextEncoder().encode("SATI:interaction:v1");
    const message = new Uint8Array([
        ...domain,
        ...sasSchema.toBytes(),
        ...taskRef,
        ...tokenAccount.toBytes(),
        ...dataHash,
    ]);
    return keccak_256(message);
}

function computeFeedbackHash(
    sasSchema: PublicKey,
    taskRef: Uint8Array,
    tokenAccount: PublicKey,
    outcome: number,          // 0, 1, or 2
): Uint8Array {
    const domain = new TextEncoder().encode("SATI:feedback:v1");
    const message = new Uint8Array([
        ...domain,
        ...sasSchema.toBytes(),
        ...taskRef,
        ...tokenAccount.toBytes(),
        outcome,
    ]);
    return keccak_256(message);
}
```

**Security properties:**
- Domain separation (`SATI:interaction:v1` vs `SATI:feedback:v1`) prevents replay across message types
- Schema inclusion prevents cross-schema replay
- Agent signs before knowing outcome (blind feedback model)
- Counterparty cannot forge agent's signature (requires agent's private key)
- Agent cannot forge counterparty's feedback (requires counterparty's private key)

### Light Protocol Security

| Aspect | Guarantee |
|--------|-----------|
| ZK proofs | Cryptographic verification of compressed account existence |
| Address derivation | Deterministic seeds prevent address collisions |
| State integrity | Merkle tree roots verify all account states |
| Nullification | Closed attestations properly nullified in state tree |

### Governance Security

| Aspect | Approach |
|--------|----------|
| Multisig authority | Registry, Attestation Program, and SAS credential use Squads smart accounts |
| Immutability option | Can renounce authority after stable |
| Separation of concerns | Registry vs Attestation Program vs SAS credential managed independently |

### Error Codes

```rust
#[error_code]
pub enum SatiError {
    // Registry errors
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Registry authority is immutable")]
    ImmutableAuthority,
    #[msg("Name exceeds maximum length")]
    NameTooLong,
    #[msg("Symbol exceeds maximum length")]
    SymbolTooLong,
    #[msg("URI exceeds maximum length")]
    UriTooLong,
    #[msg("Too many metadata entries")]
    TooManyMetadataEntries,
    #[msg("Arithmetic overflow")]
    Overflow,

    // Attestation errors
    #[msg("Schema config not found")]
    SchemaConfigNotFound,
    #[msg("Invalid signature count for signature mode")]
    InvalidSignatureCount,
    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,
    #[msg("Storage type not supported for this operation")]
    StorageTypeNotSupported,
    #[msg("Storage type mismatch")]
    StorageTypeMismatch,
    #[msg("Attestation data too small")]
    AttestationDataTooSmall,
    #[msg("Attestation data exceeds maximum size")]
    AttestationDataTooLarge,
    #[msg("Content exceeds maximum size")]
    ContentTooLarge,
    #[msg("Signature pubkey does not match expected account")]
    SignatureMismatch,
    #[msg("Self-attestation is not allowed")]
    SelfAttestationNotAllowed,
    #[msg("Unauthorized to close attestation")]
    UnauthorizedClose,
    #[msg("Attestation cannot be closed for this schema")]
    AttestationNotCloseable,
    #[msg("Invalid outcome value (must be 0-2)")]
    InvalidOutcome,
    #[msg("Invalid content type (must be 0-4)")]
    InvalidContentType,
    #[msg("Invalid data type")]
    InvalidDataType,
    #[msg("Invalid score value (must be 0-100)")]
    InvalidScore,
    #[msg("Invalid validation response (must be 0-100)")]
    InvalidResponse,
    #[msg("Tag string exceeds maximum length (32 chars)")]
    TagTooLong,
    #[msg("Invalid data layout")]
    InvalidDataLayout,
    #[msg("Light Protocol CPI invocation failed")]
    LightCpiInvocationFailed,
}
```

---

## Full Cost Reference

| Category | Operation | Cost (SOL) | CU | Notes |
|----------|-----------|------------|-----|-------|
| **Infrastructure (one-time)** | | | | |
| | Initialize registry | ~0.005 | 10,918 | One-time global setup |
| | Setup SAS credential | ~0.003 | — | One-time |
| | Setup SAS schemas (3 core) | ~0.009 | — | One-time |
| | Register schema config | ~0.0003 | — | One-time per schema |
| **Agent Registration** | | | | |
| | register_agent (minimal) | ~0.003 | 58,342 | Mint + metadata + group |
| | register_agent (3 fields) | ~0.0035 | 82,877 | +additional metadata |
| | register_agent (10 fields) | ~0.005 | 168,097 | Maximum metadata |
| | register_agent (soulbound) | ~0.003 | 79,255 | NonTransferable extension |
| | Update metadata | tx fee | — | Direct Token-2022 call |
| | Transfer agent | tx fee | — | Direct Token-2022 call |
| **Compressed Attestations** | | | | |
| | Create feedback (single) | ~0.00001 | ~120,000 | Proof verify + tree append |
| | Create feedback (batched 5/tx) | ~0.000003 | ~35,000/ea | Amortized proof cost |
| | Create validation | ~0.00001 | ~120,000 | Proof verify + tree append |
| | Close compressed attestation | tx fee | ~100,000 | Nullify in state tree |
| **Regular Attestations** | | | | |
| | Create ReputationScore | ~0.002 | ~30,000 | SAS attestation (variable, 102+ bytes) |
| | Update ReputationScore | tx fee | ~30,000 | Close+create (rent neutral) |
| | Close regular attestation | tx fee | ~20,000 | SAS close + rent return |
| **Per-operation overhead** | | | | |
| | Validity proof verification | — | ~100,000 | ZK proof (constant per tx) |
| | Poseidon hashing (system) | — | ~6,000 | Per compressed account |
| | Noop CPI (per event) | — | ~2,000 | Event logging for Photon |
| | Ed25519 verify (per sig) | — | ~1,400 | Signature verification |

**Key insights:**
- Agent registration costs are rent deposits (recoverable when burned)
- Compressed attestations cost ~$0.002 each (200x cheaper than regular accounts)
- Validity proof cost (~100K CU) is **per transaction**, not per account — batching amortizes this
- Photon indexing is free (included in Helius RPC)

---

## Governance Implementation

### Authority Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Launch    │ ──▶ │   Stable    │ ──▶ │  Immutable  │
│  (Multisig) │     │  (Multisig) │     │  (No Auth)  │
└─────────────┘     └─────────────┘     └─────────────┘
     │                    │                    │
     │ - Fix bugs         │ - Monitor usage    │ - Fully trustless
     │ - Emergency fixes  │ - Community trust  │ - Cannot be changed
     │                    │ - Prepare renounce │ - Forever
```

### Program Upgrade Strategy

```
Development:  Upgradeable (BPF Upgradeable Loader)
               ↓
Stable:       Upgradeable (multisig controls upgrade authority)
               ↓
Mature:       Immutable (renounce upgrade authority)
```

**Upgrade authority** is separate from **registry authority**:
- Registry authority: Controls `update_registry_authority()` only
- Upgrade authority: Controls program code deployment

Both start as multisig, both can be renounced independently.

### Renounce Authority

To make the registry immutable, call `updateRegistryAuthority(null)`. This sets authority to `Pubkey::default()`, making the registry permanently trustless.

---

## Escrow Integration

Compressed attestations enable automatic escrow release via ZK proofs. An escrow program can verify that a validation attestation exists and meets release criteria.

### Escrow Program with Light CPI Verification

```rust
use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v1::derive_address,
    cpi::{v1::CpiAccounts, CpiSigner},
    derive_light_cpi_signer,
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof},
    LightDiscriminator, LightHasher,
};

declare_id!("EscrowProgramID...");

pub const LIGHT_CPI_SIGNER: CpiSigner = derive_light_cpi_signer!("EscrowProgramID...");

/// Minimum validation response score required to release escrow (0-100 scale)
pub const PASS_THRESHOLD: u8 = 80;

#[program]
pub mod escrow {
    use super::*;
    use light_sdk::cpi::{v1::LightSystemProgramCpi, InvokeLightSystemProgram};

    /// Release escrow funds if valid validation attestation exists
    pub fn release_escrow<'info>(
        ctx: Context<'_, '_, '_, 'info, ReleaseEscrow<'info>>,
        proof: ValidityProof,
        account_meta: CompressedAccountMeta,
        attestation_data: Vec<u8>,           // Current attestation state
        expected_task_ref: [u8; 32],          // Task this escrow is for
        expected_agent: Pubkey,               // Agent who should be validated
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // 1. Reconstruct the compressed attestation from provided data
        let attestation = CompressedAttestation {
            sas_schema: ctx.accounts.validation_schema.key(),
            token_account: expected_agent,
            data_type: 1,  // Validation
            data: attestation_data.clone(),
            signatures: vec![],  // Signatures stored but not needed for verification
        };

        // 2. Verify the compressed account exists via Light System Program
        // This proves the attestation is in the merkle tree with the given hash
        let account = LightAccount::<CompressedAttestation>::new_mut(
            &SATI_ATTESTATION_PROGRAM_ID,
            &account_meta,
            attestation,
        )?;

        // The proof verification happens in LightSystemProgramCpi
        // If the account doesn't exist or data doesn't match, this fails
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(account)?
            .invoke(light_cpi_accounts)?;

        // 3. Parse and validate the attestation data
        // Base layout: task_ref(32) + token_account(32) + counterparty(32)
        require!(attestation_data.len() >= 96, EscrowError::InvalidAttestation);

        let task_ref: [u8; 32] = attestation_data[0..32].try_into()?;
        let token_account = Pubkey::try_from(&attestation_data[32..64])?;

        // Verify task_ref matches expected
        require!(task_ref == expected_task_ref, EscrowError::TaskMismatch);

        // Verify agent matches expected
        require!(token_account == expected_agent, EscrowError::AgentMismatch);

        // 4. Parse validation-specific fields at fixed offsets
        // Validation layout: base(96) + data_hash(32) + content_type(1) + validation_type(1) + response(1) + content(4+N)
        require!(attestation_data.len() >= 131, EscrowError::InvalidAttestation);

        let response = attestation_data[130];  // Fixed offset for memcmp filtering
        require!(response >= PASS_THRESHOLD, EscrowError::ValidationFailed);

        // 5. Release escrow funds
        let escrow_seeds = &[
            b"escrow",
            expected_task_ref.as_ref(),
            &[ctx.bumps.escrow],
        ];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                },
                &[escrow_seeds],
            ),
            ctx.accounts.escrow.lamports(),
        )?;

        emit!(EscrowReleased {
            task_ref: expected_task_ref,
            agent: expected_agent,
            recipient: ctx.accounts.recipient.key(),
            amount: ctx.accounts.escrow.lamports(),
            validation_response: response,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(expected_task_ref: [u8; 32])]
pub struct ReleaseEscrow<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: Validation schema account for verification
    pub validation_schema: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", expected_task_ref.as_ref()],
        bump,
    )]
    pub escrow: SystemAccount<'info>,

    /// CHECK: Recipient receives the escrowed funds
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct EscrowReleased {
    pub task_ref: [u8; 32],
    pub agent: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub validation_response: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Invalid attestation data")]
    InvalidAttestation,
    #[msg("Task reference mismatch")]
    TaskMismatch,
    #[msg("Agent mismatch")]
    AgentMismatch,
    #[msg("Validation response below threshold")]
    ValidationFailed,
}
```

### TypeScript Client for Escrow Release

```typescript
import { createRpc } from "@lightprotocol/stateless.js";
import { PublicKey } from "@solana/web3.js";

const rpc = createRpc("https://mainnet.helius-rpc.com?api-key=YOUR_KEY");

async function releaseEscrowWithValidation(
    taskRef: Uint8Array,
    agent: PublicKey,
    validationSchema: PublicKey,
) {
    // 1. Find the validation attestation for this task
    const attestations = await rpc.getCompressedAccountsByOwner({
        owner: SATI_ATTESTATION_PROGRAM_ID.toBase58(),
        filters: [
            { memcmp: { offset: 8, bytes: validationSchema.toBase58() } },  // schema
            { memcmp: { offset: 40, bytes: agent.toBase58() } },            // token_account
        ],
    });

    // 2. Find matching task_ref in attestation data
    const matching = attestations.value.items.find((item) => {
        const data = item.data;
        const attestationTaskRef = data.slice(0, 32);
        return Buffer.compare(attestationTaskRef, taskRef) === 0;
    });

    if (!matching) {
        throw new Error("No validation attestation found for this task");
    }

    // 3. Get validity proof for the attestation
    const proof = await rpc.getValidityProof({
        hashes: [matching.hash],
    });

    // 4. Build and send release transaction
    const tx = await escrowProgram.methods
        .releaseEscrow(
            proof.compressedProof,
            matching.accountMeta,
            matching.data,
            Array.from(taskRef),
            agent,
        )
        .accounts({
            validationSchema,
            escrow: deriveEscrowPda(taskRef),
            recipient: agent,
        })
        .remainingAccounts(proof.remainingAccounts)
        .rpc();

    return tx;
}
```

**Key security properties:**
- ZK proof ensures attestation exists in merkle tree and wasn't forged
- `account_meta` ties the proof to specific account hash
- Light CPI verification fails if data doesn't match the proven state
- Task_ref check ensures escrow is released for the correct task

---

## Full Deployment Addresses

### Programs

| Program | Devnet | Mainnet | Status |
|---------|--------|---------|--------|
| Registry Program | TBD | TBD | Pending |
| Attestation Program | TBD | TBD | Pending |
| SAS Program | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | External |

### Registry Accounts

| Account | Devnet | Mainnet |
|---------|--------|---------|
| Registry Config (PDA) | TBD | TBD |
| Group Mint | TBD | TBD |

### SAS Accounts

| Account | Devnet | Mainnet | Notes |
|---------|--------|---------|-------|
| SATI SAS Credential | TBD | TBD | Authority: SATI multisig |
| SATI Attestation PDA | TBD | TBD | Sole authorized signer on credential |
| Schema: Feedback | TBD | TBD | Variable (136+ bytes), Compressed storage |
| Schema: Validation | TBD | TBD | Variable (135+ bytes), Compressed storage |
| Schema: ReputationScore | TBD | TBD | Variable (102+ bytes), Regular storage |

### Address Derivation Reference

```
Registry Config PDA:    ["registry"]
Agent Token Account:    Random keypair (used as mint)
Attestation PDA:        ["sati_attestation"]
SchemaConfig PDA:       ["schema_config", sas_schema]
SAS Credential PDA:     ["credential", authority, "sati-core"]
SAS Schema PDA:         ["schema", credential, name, version]
SAS Attestation PDA:    ["attestation", credential, schema, nonce]
```

*Programs will be verified via solana-verify upon deployment.*

### Off-Chain Storage

Registration files (referenced by `TokenMetadata.uri`) should be stored on **IPFS**:

```
ipfs://QmYourRegistrationFileHash
```

**Why IPFS:**
- Content-addressed (immutable once published)
- Decentralized (no single point of failure)
- Cross-chain standard for agent registries
- Free to pin via Pinata, web3.storage, etc.
