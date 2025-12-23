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

    // 3. Verify content size (content starts at offset 129, Vec<u8> has 4-byte length prefix)
    // IMPORTANT: Check len >= 133 before accessing [129..133]
    if params.data.len() >= 133 {
        let content_len = u32::from_le_bytes(params.data[129..133].try_into()?) as usize;
        require!(
            content_len <= MAX_CONTENT_SIZE,  // 512 bytes
            SatiError::ContentTooLarge
        );
    }

    // 4. Parse base layout for signature binding
    let token_account_pubkey = Pubkey::try_from(&params.data[32..64])?;
    let counterparty_pubkey = Pubkey::try_from(&params.data[64..96])?;

    // 5. Verify signature-data binding
    if params.signatures.len() == 2 {
        require!(params.signatures[0].pubkey == token_account_pubkey, SignatureMismatch);
        require!(params.signatures[1].pubkey == counterparty_pubkey, SignatureMismatch);
    }

    // 6. Self-attestation prevention
    require!(token_account_pubkey != counterparty_pubkey, SelfAttestationNotAllowed);

    // 7. Validate outcome and content_type ranges
    // For Feedback (data_type=0): outcome at variable offset after content
    // For Validation (data_type=1): validation_type and status at variable offset
    if params.data_type == 0 && params.data.len() >= 133 {
        let content_len = u32::from_le_bytes(params.data[129..133].try_into()?) as usize;
        let outcome_offset = 133 + content_len;
        if params.data.len() > outcome_offset {
            let outcome = params.data[outcome_offset];
            require!(outcome <= 2, SatiError::InvalidOutcome);  // 0=Negative, 1=Neutral, 2=Positive
        }
        // Validate content_type at offset 128
        let content_type = params.data[128];
        require!(content_type <= 4, SatiError::InvalidContentType);  // 0-4 valid
    }

    // 8. Verify Ed25519 signatures
    // For DualSignature mode, each party signs a DIFFERENT hash:
    // Agent: hash(sas_schema, task_ref, token_account, data_hash)
    // Counterparty: hash(sas_schema, task_ref, token_account, outcome)
    verify_ed25519(params.signatures[0].pubkey, params.signatures[0].sig, interaction_hash)?;
    verify_ed25519(params.signatures[1].pubkey, params.signatures[1].sig, feedback_hash)?;

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
            data_type: current_data[64], // data_type offset
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
        data_type: params.data_type,
        storage_type: StorageType::Regular,
        address: ctx.accounts.attestation.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
```

### Regular Attestation Nonce Strategy

Deterministic nonce ensures one ReputationScore per (provider, agent) pair:

```rust
fn compute_regular_nonce(params: &CreateRegularParams) -> Result<Pubkey> {
    let token_account = &params.data[32..64];
    let counterparty = &params.data[64..96];  // provider

    // One ReputationScore per (provider, agent) pair
    let nonce_bytes = keccak256(&[counterparty, token_account].concat());

    Ok(Pubkey::new_from_array(nonce_bytes.try_into()?))
}
```

Provider updates by closing old attestation + creating new one with same deterministic nonce (rent neutral).

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
129      4+N       content: Vec<u8>        // Borsh: 4-byte len prefix + N bytes
129+4+N  1         outcome: u8
130+4+N  1         tag1: u8
131+4+N  1         tag2: u8
```

**Borsh Vec<u8> encoding**: `[length: u32 LE][data: u8 × length]`

**Minimum size**: 136 bytes (empty content: 4-byte length prefix with N=0)
**Example with 50-byte JSON**: 186 bytes (136 + 50)

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
  tag1: TagCategory.Quality,
  tag2: TagCategory.Speed,
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

Compressed attestations enable automatic escrow release via ZK proofs:

```rust
// Escrow contract verifies validation before releasing funds
fn release_escrow(
    attestation_proof: ValidityProof,    // From Photon (Groth16 ZK proof)
    attestation_data: Vec<u8>,           // Parsed attestation
) -> Result<()> {
    // Verify compressed account exists via Light CPI
    light_system_program::verify_compressed_account(
        &attestation_proof,
        &expected_address,
    )?;

    // Parse attestation data (escrow knows Validation data structure)
    let attestation: CompressedAttestation = parse_attestation(&attestation_data)?;
    require!(attestation.data_type == 1, InvalidDataType);  // Must be validation

    let validation: Validation = parse_data(&attestation.data)?;
    require!(validation.status >= PASS_THRESHOLD, ValidationFailed);

    // Release escrow
    transfer_funds(escrow, recipient)?;

    Ok(())
}
```

**SDK interface:**

```typescript
// Get proof from Photon (works for any attestation type)
const { proof, attestation } = await sati.getAttestationProof(tokenAccount, dataType, taskRef);

// Verify and use for escrow release
const valid = await sati.verifyAttestation(proof, attestation);
```

---

## Full Deployment Addresses

### Programs

| Program | Devnet | Mainnet | Status |
|---------|--------|---------|--------|
| Registry Program | `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` | `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` | **Deployed** |
| Attestation Program | TBD | TBD | Pending |
| SAS Program | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | External |

### Registry Accounts

| Account | Devnet | Mainnet |
|---------|--------|---------|
| Registry Config (PDA) | `5tMXnDjqVsvQoem8tZ74nAMU1KYntUSTNEnMDoGFjnij` | `5tMXnDjqVsvQoem8tZ74nAMU1KYntUSTNEnMDoGFjnij` |
| Group Mint | `4W3mJSqV6xkQXz1W1BW6ue3RBcMrY54tKnkpZ63ePMJ3` | `A1jEZyAasuU7D8NrcaQn7PD9To8eG2i9gxyFjy6Mii9q` |

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

*Registry Program verified via solana-verify on-chain.*

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
