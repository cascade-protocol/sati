# SATI Specification v2.1

## Solana Agent Trust Infrastructure

**Status**: Implementation Ready
**Version**: 2.1.0
**Created**: 2025-12-11
**Updated**: 2025-12-22
**License**: Apache 2.0

---

## Abstract

SATI is open trust infrastructure for AI agents on Solana. It solves the fundamental economics of on-chain feedback:

- **Agent-subsidized feedback** — Dual-signature makes feedback free for clients
- **Censorship-resistant** — Payment-verified mode ensures clients can always submit feedback
- **Infinite scale at fixed cost** — ZK Compression stores attestations at ~$0.002 each (200x cheaper than regular accounts)
- **No reputation monopoly** — Multiple providers compete with different scoring algorithms
- **Extensible by design** — Unified base types enable new trust primitives without program changes

Built on:
- **SATI Registry Program** — Canonical agent registration
- **SATI Attestation Program** — Signature verification + storage abstraction (Light/SAS)
- **Token-2022** — Agent identity as NFTs with native metadata
- **Solana Attestation Service (SAS)** — Schema definitions + regular attestation storage
- **Light Protocol ZK Compression** — Compressed attestation storage with Photon indexing

The architecture decouples signature verification from data parsing — the program verifies signatures on opaque bytes, while indexers and escrows parse semantics.

---

## The Economics of Agent Feedback

### The Core Problem

Web2 reviews work because they're **FREE**:
- Google reviews: $0
- Yelp reviews: $0
- Amazon reviews: $0

Users leave reviews for intrinsic reasons — help others, vent frustration, praise good service. Adding any cost kills participation.

**On-chain feedback has inherent cost → friction → low participation → reputation systems fail.**

### Who Actually Benefits?

| Party | Benefit | Willingness to Pay |
|-------|---------|-------------------|
| **Agent** | Reputation → more business | **High** |
| Client | Help others / vent | Zero (altruism) |
| Protocol | Network effects, trust | Medium |

The agent is the only party with strong economic incentive to pay for reputation data.

### SATI's Paradigm Shift

**The party who benefits should pay.**

Dual-signature enables agent-subsidized feedback:

1. **Agent provides service** → signs receipt (proves interaction occurred)
2. **Client gives feedback** → signs rating (free action — just a signature)
3. **Agent submits to chain** → pays the cost (bundled into service pricing)

From client's perspective: **feedback is free** — just like Web2.

From agent's perspective: **reputation cost is bundled into service pricing** — the same way merchants pay for Stripe fees, not customers.

**This is why on-chain agent reputation can finally work.**

### Incentive Alignment: Who Pays?

| Feedback Type | Who Pays | Why |
|---------------|----------|-----|
| **Positive** | Agent | Benefits from reputation boost |
| **Negative (DualSig)** | Client | Motivated to warn others, agent won't submit |
| **Negative (PaymentVerified)** | Client | Already paid via x402, uses payment as proof |

This creates natural incentive alignment:
- Agents pay for positive feedback (they benefit)
- Clients pay for negative feedback (they're motivated to warn others)
- PaymentVerified ensures clients can always submit, even if agent refuses to sign

### The Math

| Approach | Cost per Feedback | 10K Feedbacks | Who Pays |
|----------|-------------------|---------------|----------|
| Regular SAS attestation | ~0.002 SOL (~$0.40) | 20 SOL | Economically unviable |
| Light Protocol (single) | ~0.00001 SOL (~$0.002) | 0.1 SOL | Agent (manageable) |
| Light Protocol (batched 5/tx) | ~0.000003 SOL (~$0.0006) | 0.03 SOL | Agent (negligible) |

*Prices at ~$200/SOL. Batching is SDK-level optimization — program supports single attestation per instruction.*

With ZK Compression, each feedback is stored as a compressed account at ~200x lower cost than regular accounts. Photon provides free indexing — no custom infrastructure needed.

---

## Table of Contents

1. [Motivation](#motivation)
2. [Architecture](#architecture)
3. [Registry Program](#registry-program)
4. [Attestation Program](#attestation-program)
5. [Identity: Token-2022 NFT](#identity-token-2022-nft)
6. [Schema Definitions: SAS](#schema-definitions-sas)
7. [Compressed Storage: Light Protocol](#compressed-storage-light-protocol)
8. [Indexing: Photon](#indexing-photon)
9. [Extensibility](#extensibility)
10. [Cross-Chain Interoperability](#cross-chain-interoperability)
11. [SDK Interface](#sdk-interface)
12. [Security Considerations](#security-considerations)
13. [Deployment](#deployment)
14. [Governance](#governance)
15. [What's NOT Included (Yet)](#whats-not-included-yet)
16. [Summary](#summary)
17. [References](#references)
18. [Appendix A: CAIP and DID Reference](#appendix-a-caip-and-did-reference)

---

## Motivation

### Why Infrastructure?

SATI stands for Solana **Agentic Trust Infrastructure** — emphasis on *infrastructure*. Rather than building a closed agent reputation protocol, SATI provides foundational infrastructure that others can build on:

| Closed Protocol | Open Infrastructure |
|-----------------|---------------------|
| Fixed schemas we define | Extensible schema system |
| Single use case (reputation) | Multiple trust use cases |
| We control everything | Others build on top |
| Limited network effects | Unified indexing, shared tooling |

**What SATI provides:**
- **Permissionless attestation creation** — Anyone can create attestations without pre-authorization
- **Multi-credential support** — Third parties register their SAS credentials with SATI
- **Unified indexing** — All registered credentials indexed together
- **SDK tooling** — Works for any registered credential

**Core schemas** (Feedback, Validation, ReputationScore, Certification) implement the economics-first trust model: dual-signature for agent-subsidized feedback, ZK Compression for infinite scale, and multi-provider reputation to prevent monopolies. Third parties can register their own credentials for custom trust applications.

### Why v2.1?

SATI v2.0 proposed custom merkle root batching with a dedicated indexer. Analysis revealed a better path:

1. **Minimal custom code**: Token-2022 + SAS + Light Protocol provide needed primitives
2. **ZK Compression**: Store attestations as compressed accounts — scalability solved at storage layer
3. **Free indexing**: Photon provides indexing — no custom infrastructure needed
4. **Avoid audit burden**: Less custom code = smaller attack surface

### Why a Registry Program?

Agent discovery requires a canonical address. On Solana:

- Token-2022 TokenGroup requires `update_authority` to sign for membership
- Without a program, someone must manually co-sign every registration (centralized)
- A minimal program holds the authority as a PDA and provides atomic, permissionless registration

The registry program is a **thin wrapper** (~500 lines) around Token-2022, not a replacement.

### Why Token-2022 for Identity?

Agent identity needs to be browsable, transferable, and metadata-rich. Token-2022 provides all three:

- **Wallet support** — Phantom, Solflare, Backpack display agents natively
- **Standard transfers** — Agents can change ownership using native token instructions
- **TokenMetadata extension** — `name`, `symbol`, `uri`, `additionalMetadata` on-chain
- **TokenGroup extension** — Collections with auto-incrementing member IDs

No custom identity program needed. Token-2022 is the identity layer.

### Design Principles

1. **Economics-first** — Feedback must be free for clients to achieve participation
2. **Minimal custom code** — Thin registry + attestation programs + Token-2022 + SAS + Light Protocol
3. **Canonical address** — `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` for discoverability
4. **Wallet support out of the box** — Users see agents in Phantom, Solflare, Backpack
5. **Enterprise ready** — Works with Squads smart accounts
6. **Immutable governance** — Start with multisig, renounce to immutable after stable
7. **Composable authorization** — Each schema defines its auth mode (dual-signature, single-signer, credential authority)
8. **Storage abstraction** — SchemaConfig determines compressed (Light) or regular (SAS) storage per schema

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SATI Registry Program                          │
│             (satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF)            │
├─────────────────────────────────────────────────────────────────────┤
│  initialize()                → Create registry + TokenGroup         │
│  register_agent()            → Token-2022 NFT + group membership    │
│  update_registry_authority() → Transfer/renounce control            │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SATI Attestation Program                        │
├─────────────────────────────────────────────────────────────────────┤
│  register_schema_config()    → Register schema + auth mode + storage│
│  create_attestation()        → Verify sigs → route to storage       │
│  close_attestation()         → Close/nullify attestation            │
└─────────────────────────────────────────────────────────────────────┘
          │                                         │
          ▼                                         ▼
┌───────────────────────────┐         ┌────────────────────────────────┐
│   Light Protocol          │         │   Solana Attestation Service   │
│   (Compressed Storage)    │         │   (Regular Storage)            │
├───────────────────────────┤         ├────────────────────────────────┤
│ • Feedback attestations   │         │ • ReputationScore (future)     │
│ • Validation attestations │         │ • Certification (future)       │
│ • ~$0.002 per attestation │         │ • ~$0.40 per attestation       │
│ • Photon indexing (free)  │         │ • On-chain queryable           │
└───────────────────────────┘         └────────────────────────────────┘
          │
          ▼
┌───────────────────────────┐
│      Token-2022           │
│  • Identity storage       │
│  • TokenMetadata          │
│  • TokenGroup             │
│  • Direct updates/xfers   │
└───────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **SATI Registry** | Canonical entry point, agent registration (deployed) |
| **SATI Attestation** | Schema config, signature verification, storage routing |
| **Token-2022** | Identity storage, metadata, transfers (direct calls) |
| **SAS** | Schema definitions + regular attestation storage (future) |
| **Light Protocol** | Compressed attestation storage |
| **Photon** | Free indexing for compressed accounts |

---

## Registry Program

### Overview

The SATI Registry is a minimal program that:
- Provides a **canonical program address** (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`)
- Holds TokenGroup `update_authority` as a PDA
- Enables **permissionless, atomic agent registration**
- Supports **governance lifecycle** (multisig → immutable)

### Program ID

`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_NAME_LENGTH` | 32 | Maximum agent name (bytes) |
| `MAX_SYMBOL_LENGTH` | 10 | Maximum agent symbol (bytes) |
| `MAX_URI_LENGTH` | 200 | Maximum URI (bytes) |
| `MAX_METADATA_ENTRIES` | 10 | Maximum additional metadata pairs |
| `MAX_METADATA_KEY_LENGTH` | 32 | Maximum metadata key (bytes) |
| `MAX_METADATA_VALUE_LENGTH` | 200 | Maximum metadata value (bytes) |

### Accounts

#### RegistryConfig

PDA seeds: `["registry"]`

| Field | Type | Description |
|-------|------|-------------|
| `group_mint` | Pubkey | SATI TokenGroup mint address |
| `authority` | Pubkey | Registry authority (Pubkey::default() = immutable) |
| `total_agents` | u64 | Total agents registered (counter) |
| `bump` | u8 | PDA bump seed |

**Size**: 81 bytes (8 discriminator + 32 + 32 + 8 + 1)

### Instructions

#### initialize

One-time setup to create the registry and TokenGroup.

| Parameter | Type | Description |
|-----------|------|-------------|
| — | — | No parameters |

**Behavior**:
- Creates RegistryConfig PDA
- Initializes TokenGroup with registry PDA as `update_authority`
- Sets `max_size = 0` (unlimited)

#### register_agent

Canonical entry point for agent registration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | String | Agent name (≤32 bytes) |
| `symbol` | String | Agent symbol (≤10 bytes) |
| `uri` | String | Registration file URI (≤200 bytes) |
| `additional_metadata` | Option<Vec<(String, String)>> | Key-value pairs (≤10 entries) |
| `non_transferable` | bool | Soulbound agent flag |

**Behavior**:
- Creates Token-2022 mint with extensions (MetadataPointer, TokenMetadata, GroupMemberPointer, TokenGroupMember, optionally NonTransferable)
- Mints exactly 1 token to owner
- Renounces mint authority (supply=1 forever)
- Adds to TokenGroup (auto-incrementing `member_number`)
- Increments `total_agents`

#### update_registry_authority

Transfer or renounce registry authority.

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_authority` | Option<Pubkey> | New authority (None = renounce to immutable) |

### Events

Events use Anchor's `emit_cpi!` macro for reliable indexing. Account structs requiring event emission include the `#[event_cpi]` attribute, which automatically adds `event_authority` and `program` accounts.

**Why `emit_cpi!` instead of `emit!`:**

| Approach | Mechanism | Truncation Risk | CU Cost |
|----------|-----------|-----------------|---------|
| `emit!` | `sol_log_data` syscall | Yes (10KB log limit) | ~1K |
| `emit_cpi!` | Self-CPI to `innerInstructions` | No | ~5K |

**Per-program choice:**
- **Registry Program**: Can use `emit!` — events are small (~200 bytes), one per tx
- **Attestation Program**: Must use `emit_cpi!` — attestation data is critical, future batching may increase event volume

Attestation data is critical for reputation integrity — truncation is unacceptable. The 5K CU overhead (~4% of attestation budget) is a worthwhile tradeoff for guaranteed delivery.

#### AgentRegistered

| Field | Type |
|-------|------|
| `mint` | Pubkey |
| `owner` | Pubkey |
| `member_number` | u64 |
| `name` | String |
| `uri` | String |
| `non_transferable` | bool |

#### RegistryAuthorityUpdated

| Field | Type |
|-------|------|
| `old_authority` | Pubkey |
| `new_authority` | Option<Pubkey> |

### Error Codes

| Code | Message |
|------|---------|
| `InvalidAuthority` | Invalid authority |
| `ImmutableAuthority` | Authority is immutable (renounced) |
| `NameTooLong` | Name too long (max 32 bytes) |
| `SymbolTooLong` | Symbol too long (max 10 bytes) |
| `UriTooLong` | URI too long (max 200 bytes) |
| `TooManyMetadataEntries` | Too many metadata entries (max 10) |
| `MetadataKeyTooLong` | Metadata key too long (max 32 bytes) |
| `MetadataValueTooLong` | Metadata value too long (max 200 bytes) |
| `Overflow` | Arithmetic overflow |

### Agent Removal

No `remove_agent` instruction exists. To "remove" an agent:
1. Owner burns the NFT (closes token account)
2. TokenGroupMember remains (historical record preserved)
3. Attestations remain (feedback/validation history preserved)

### Fees

**No registration fees.** Only Solana rent (~0.003 SOL per agent) which goes to the user's account.

---

## Attestation Program

### Overview

The SATI Attestation Program handles all trust attestation operations:
- **Schema configuration** — Registers schemas with auth mode and storage type
- **Signature verification** — Verifies signatures per SchemaConfig auth mode
- **Storage routing** — Routes to Light Protocol (compressed) or SAS (regular)

### Program ID

TBD (vanity address starting with `satiATTN...`)

### Dependencies

| Program | Address | Purpose |
|---------|---------|---------|
| Light System | `SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7` | Compressed account operations |
| Account Compression | `compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq` | State tree management |
| SAS | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | Regular attestation storage (future) |

### Constants

```rust
// Program ID (TBD - vanity address)
declare_id!("satiATTN...");

// CPI signer for Light System Program invocations
// Derived at compile time from program ID with seed b"authority"
pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("satiATTN...");
```

The `LIGHT_CPI_SIGNER` is a PDA derived with seed `b"authority"` that authorizes CPIs to the Light System Program. All compressed account operations require this signer.

### Accounts

#### SchemaConfig

PDA seeds: `["schema_config", sas_schema_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| `sas_schema` | Pubkey | SAS schema address (type definition) |
| `signature_mode` | SignatureMode | Signature requirement for this schema |
| `payment_requirement` | PaymentRequirement | Payment proof requirement |
| `storage_type` | StorageType | Compressed or Regular storage |
| `bump` | u8 | PDA bump seed |

**Size**: 44 bytes (8 discriminator + 32 + 1 + 1 + 1 + 1)

#### SignatureMode Enum

Defines the signature requirement for attestations:

| Variant | Value | Description | Signature Count |
|---------|-------|-------------|-----------------|
| `DualSignature` | 0 | Requires two off-chain signatures (agent + counterparty) | 2 |
| `SingleSigner` | 1 | Requires one off-chain signature | 1 |
| `CredentialAuthority` | 2 | Uses SAS credential's authorized_signers | 0 |

#### PaymentRequirement Enum

Orthogonal to signature mode — defines whether payment proof is required:

| Variant | Value | Description |
|---------|-------|-------------|
| `None` | 0 | No payment proof needed |
| `Required` | 1 | Payment proof required |
| `Optional` | 2 | Accepts with OR without payment proof |

**Example configurations:**

| Schema | SignatureMode | PaymentRequirement | Effect |
|--------|---------------|-------------------|--------|
| Feedback | DualSignature | Optional | Agent-subsidized OR payment-verified |
| Validation | DualSignature | None | Always requires both parties |
| ReputationScore | SingleSigner | None | Provider-only signature |
| Certification | CredentialAuthority | None | SAS native auth |

#### StorageType Enum

| Variant | Value | Description | Use Case |
|---------|-------|-------------|----------|
| `Compressed` | 0 | Light Protocol compressed accounts | High-volume (Feedback, Validation) |
| `Regular` | 1 | Direct SAS attestations | Low-volume, on-chain readable (future) |

### Compressed Attestation Structure

For `StorageType::Compressed`, attestations are stored as Light Protocol compressed accounts:

```rust
#[derive(Clone, Debug, Default, LightDiscriminator, LightHasher)]
pub struct CompressedAttestation {
    // Queryable fields (for Photon filtering via memcmp)
    // Note: discriminator is stored separately, so offsets start at 0
    #[hash]
    pub sas_schema: Pubkey,        // Schema reference — memcmp offset 0
    #[hash]
    pub agent_mint: Pubkey,        // Who attestation is about — memcmp offset 32

    // Attestation data
    pub data_type: u8,             // 0=Feedback, 1=Validation, 2+=Future
    pub data: Vec<u8>,             // Opaque schema-conformant data
    pub signatures: Vec<[u8; 64]>, // Embedded for self-contained verification
    pub timestamp: i64,
}
```

**Design notes:**
- `Clone`, `Debug`, `Default` are required by `LightAccount` wrapper
- `LightDiscriminator` derives 8-byte type discriminator (stored separately by Photon, not in data bytes)
- `LightHasher` with `#[hash]` attributes defines poseidon hash structure for merkle tree
- Photon `memcmp` offsets: `sas_schema` at 0, `agent_mint` at 32 (discriminator excluded from data)
- `data` remains **opaque** — program never parses it
- `signatures` embedded for verification without trusting indexer
- `data_type` enables type-specific parsing by SDK/indexer

### Signature Verification Model

The program performs **minimal on-chain verification** of attestation data to ensure security while keeping the data model extensible.

```rust
create_attestation(
    data: Vec<u8>,                    // Schema-conformant bytes
    signatures: Vec<SignerEntry>,     // [{pubkey, sig}, ...]
    payment_proof: Option<PaymentProof>,
)
```

#### On-Chain Verification (Program Enforces)

1. **Signature count** per SignatureMode:
   ```rust
   match schema_config.signature_mode {
       SignatureMode::DualSignature => require!(signatures.len() == 2),
       SignatureMode::SingleSigner => require!(signatures.len() == 1),
       SignatureMode::CredentialAuthority => require!(signatures.is_empty()),
   }
   ```

2. **Payment requirement** per PaymentRequirement:
   ```rust
   match schema_config.payment_requirement {
       PaymentRequirement::Required => require!(payment_proof.is_some()),
       PaymentRequirement::None => require!(payment_proof.is_none()),
       PaymentRequirement::Optional => { /* either is fine */ },
   }
   ```

3. **Signature validity** with domain separator:
   ```rust
   // Domain-separated hash prevents cross-schema signature reuse
   let hash = keccak256(sas_schema, data_type, data);
   for signer_entry in signatures {
       verify_ed25519(signer_entry.pubkey, signer_entry.sig, hash)?;
   }
   ```

4. **Signature-data binding** (minimal parsing of first 64 bytes):
   ```rust
   // All schemas start with: task_id (32) + agent (32) + counterparty (32)
   // We verify signature pubkeys match agent/counterparty in data
   let agent_pubkey = Pubkey::try_from(&data[32..64])?;
   let counterparty_pubkey = Pubkey::try_from(&data[64..96])?;

   if signatures.len() == 2 {
       require!(signatures[0].pubkey == agent_pubkey, SignatureMismatch);
       require!(signatures[1].pubkey == counterparty_pubkey, SignatureMismatch);
   } else if signatures.len() == 1 {
       require!(signatures[0].pubkey == counterparty_pubkey, SignatureMismatch);
   }
   ```

5. **Self-attestation prevention** (like ERC-8004):
   ```rust
   // Prevent agent from giving feedback to themselves
   require!(agent_pubkey != counterparty_pubkey, SelfAttestationNotAllowed);
   ```

#### Off-Chain Verification (Indexer/Escrow)

- **Full semantic parsing** of attestation data
- **Payment proof validation** — verifies tx_signature exists and succeeded
- **Extended field validation** — scores within range, timestamps valid, etc.

This hybrid model provides **on-chain security guarantees** while keeping the program extensible for new data types.

### Instructions

#### register_schema_config

Register a schema with its authorization and storage configuration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | Pubkey | SAS schema to configure |
| `signature_mode` | SignatureMode | Signature requirement |
| `payment_requirement` | PaymentRequirement | Payment proof requirement |
| `storage_type` | StorageType | Compressed or Regular |

**Preconditions**:
- Schema must be a valid SAS schema
- Caller must be program authority (governance)

**Behavior**:
- Creates SchemaConfig PDA
- Emits `SchemaConfigRegistered` event

#### create_attestation (Compressed)

Create a compressed attestation with signature verification.

| Parameter | Type | Description |
|-----------|------|-------------|
| `proof` | ValidityProof | ZK proof from Photon |
| `address_tree_info` | PackedAddressTreeInfo | Address tree metadata |
| `output_state_tree_index` | u8 | Target state tree |
| `sas_schema` | Pubkey | Schema for this attestation |
| `data_type` | u8 | Type discriminator |
| `data` | Vec<u8> | Schema-conformant attestation data |
| `signatures` | Vec<SignerEntry> | Per signature_mode |
| `payment_proof` | Option<PaymentProof> | Per payment_requirement |
| `agent_mint` | Pubkey | Who attestation is about |

**SignerEntry struct**: `{ pubkey: Pubkey, sig: [u8; 64] }`

**PaymentProof struct**: `{ tx_signature: [u8; 64], amount: u64, token_mint: Pubkey }`

**Preconditions**:
- SchemaConfig must exist with `storage_type = Compressed`
- Signatures must be valid per signature_mode
- Payment proof must match payment_requirement

**Behavior**:
1. Look up SchemaConfig for `sas_schema`
2. Verify signature count per `signature_mode`
3. Verify payment proof per `payment_requirement`
4. Verify signatures on domain-separated hash: `keccak256(sas_schema, data_type, data)`
5. Parse first 96 bytes of data: `task_id (32) + agent (32) + counterparty (32)`
6. Verify signature pubkeys match agent/counterparty (signature-data binding)
7. Verify agent != counterparty (self-attestation prevention)
8. Derive address using **deterministic nonce** (prevents duplicate attestations):
   ```rust
   // Deterministic nonce from task_id (first 32 bytes of data)
   let task_id = &data[0..32];
   let nonce = keccak256(task_id, sas_schema, agent_mint);

   let (address, address_seed) = derive_address(
       &[b"attestation", sas_schema.as_ref(), agent_mint.as_ref(), &nonce],
       &address_tree_info.get_tree_pubkey(&light_cpi_accounts)?,
       &crate::ID,
   );
   ```
9. Create compressed account via Light CPI (using `LightAccount::new_init()`)
10. Emit `AttestationCreated` event

**Note on deterministic nonce**: Using `keccak256(task_id, schema, agent)` as nonce means the same task_id for the same agent/schema will always derive the same address. This provides **on-chain duplicate prevention** — attempting to create a second attestation for the same task will fail with address collision. To update an attestation, first close the existing one.

#### create_attestation (Regular) — FUTURE

For `StorageType::Regular`, will CPI to SAS. Specified but not implemented in MVP.

| Parameter | Type | Description |
|-----------|------|-------------|
| `sas_schema` | Pubkey | Schema for this attestation |
| `data` | Vec<u8> | Schema-conformant attestation data |
| `signatures` | Vec<SignerEntry> | Per signature_mode |
| `token_account` | Pubkey | SAS token_account field (agent_mint) |
| `nonce` | [u8; 32] | SAS nonce (deterministic) |
| `expiry` | Option<i64> | SAS expiry |

**MVP Status**: Specified, not implemented. Will be added for ReputationScore and Certification.

#### close_attestation

Close an attestation (allows reinitialization at same address).

| Parameter | Type | Description |
|-----------|------|-------------|
| `proof` | ValidityProof | ZK proof from Photon |
| `account_meta` | CompressedAccountMeta | Existing attestation metadata |
| `current_data` | Vec<u8> | Current attestation data (for hash verification) |
| `signatures` | Vec<SignerEntry> | Authorization signatures |

**Behavior**:
1. Verify signatures (same requirements as create)
2. Close compressed account via Light CPI using `LightAccount::new_close()`
3. Emit `AttestationClosed` event

**Close vs Burn**: SATI uses **close** (not burn) for attestations:
- Close produces a zero-valued hash, marking the account as closed
- A closed attestation **can be reinitialized** at the same address via `new_init()`
- This enables corrections — close invalid attestation, recreate with correct data
- Use case: dispute resolution, governance corrections

For permanent deletion (rare), an admin `burn_attestation` instruction could be added later using `LightAccount::new_burn()`.

### Events

Events emitted via spl-noop CPI for reliability (never truncated):

#### SchemaConfigRegistered

| Field | Type |
|-------|------|
| `schema` | Pubkey |
| `signature_mode` | SignatureMode |
| `payment_requirement` | PaymentRequirement |
| `storage_type` | StorageType |

#### AttestationCreated

| Field | Type |
|-------|------|
| `sas_schema` | Pubkey |
| `agent_mint` | Pubkey |
| `data_type` | u8 |
| `storage_type` | StorageType |
| `address` | Pubkey |
| `timestamp` | i64 |

#### AttestationClosed

| Field | Type |
|-------|------|
| `sas_schema` | Pubkey |
| `agent_mint` | Pubkey |
| `address` | Pubkey |

### Error Codes

| Code | Message |
|------|---------|
| `SchemaConfigNotFound` | Schema config not registered |
| `InvalidSignatureCount` | Wrong number of signatures for auth mode |
| `InvalidSignature` | Ed25519 signature verification failed |
| `InvalidPaymentProof` | Payment proof verification failed |
| `StorageTypeNotSupported` | Storage type not yet implemented |
| `InvalidStorageType` | Schema storage type mismatch |
| `InvalidDataType` | Unexpected data type for operation |

---

## Identity: Token-2022 NFT

### Why Token-2022?

| Aspect | SAS Attestation | Token-2022 NFT |
|--------|-----------------|----------------|
| Wallet display | Not shown | Phantom, Solflare, Backpack |
| Transfer | Close + recreate | Standard token transfer |
| Auto-incrementing ID | Manual | TokenGroupMember.member_number |
| Collections | None | TokenGroup |
| Browsability | Custom tooling | Explorers show NFTs |

### Extensions Used

| Extension | Purpose |
|-----------|---------|
| MetadataPointer | Points to metadata location |
| TokenMetadata | Stores name, symbol, uri, additionalMetadata |
| GroupMemberPointer | Points to group membership |
| TokenGroupMember | Membership in SATI Registry |
| NonTransferable | Optional: for soulbound agents |

### Agent NFT Configuration

| Property | Value | Reason |
|----------|-------|--------|
| `decimals` | 0 | NFT (indivisible) |
| `supply` | 1 | Unique identity |
| `mint_authority` | None | Renounced atomically after minting |
| `freeze_authority` | None | No one can freeze agent NFTs |

### TokenMetadata Structure

| Field | Type | Description |
|-------|------|-------------|
| `updateAuthority` | Option<Pubkey> | Agent owner (can update metadata) |
| `mint` | Pubkey | Agent NFT mint = agentId |
| `name` | String | Agent name |
| `symbol` | String | "SATI" or agent type |
| `uri` | String | Agent registration file URL |
| `additionalMetadata` | Vec<(String, String)> | Key-value pairs |

**Common additionalMetadata keys:**
- `agentWallet` — CAIP-10 format wallet address
- `did` — DID document reference
- `a2a` — A2A agent card URL
- `mcp` — MCP endpoint URL

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

### Operations

Metadata updates and transfers use **direct Token-2022 calls** (not wrapped by registry):
- **Update metadata**: `updateTokenMetadataField` from spl-token-metadata
- **Transfer agent**: Standard Token-2022 transfer instruction

Smart accounts (Squads) can own and manage agent NFTs natively via ATAs with `allowOwnerOffCurve = true`.

---

## Schema Definitions: SAS

### Role in Hybrid Architecture

SAS provides **schema definitions** for type validation and forward compatibility. Storage is determined by SchemaConfig:
- **Compressed** (Light Protocol): High-volume attestations (Feedback, Validation)
- **Regular** (SAS): Low-volume, on-chain readable attestations (ReputationScore, Certification — future)

**Why SAS schemas matter:**
- **Type safety** — Schema layouts define and validate data structure
- **Forward compatibility** — Migration path to compressed SAS when it ships mainnet
- **Ecosystem standards** — SAS schemas recognized across Solana ecosystem
- **Versioning** — Schema versions enable non-breaking upgrades

### SAS Program

Solana Attestation Service (SAS) by Solana Foundation:

| Network | Program ID |
|---------|------------|
| Mainnet/Devnet | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` |

### SATI Credential

SATI operates a single SAS credential controlled by SATI governance. All core schemas (Feedback, Validation, ReputationScore, Certification) live under this credential.

### Core Schemas

| Schema | Storage Type | Auth Mode | MVP Status |
|--------|--------------|-----------|------------|
| **Feedback** | Compressed | DualOrPayment | ✅ Implement |
| **Validation** | Compressed | DualSignature | ✅ Implement |
| **ReputationScore** | Regular | SingleSigner | 📋 Spec only |
| **Certification** | Regular | CredentialAuthority | 📋 Spec only |

**Data types** (stored in CompressedAttestation.data):

| data_type | Name | SignatureMode | PaymentRequirement |
|-----------|------|---------------|-------------------|
| 0 | Feedback | DualSignature | Optional |
| 1 | Validation | DualSignature | None |

The program verifies signature count per `signature_mode` and payment proof per `payment_requirement`.

### Queryable Fields

For compressed attestations, the following fields are indexed by Photon:

| Field | Purpose | Queryable |
|-------|---------|-----------|
| `sas_schema` | Schema reference (type definition) | ✅ Yes |
| `agent_mint` | Who attestation is about | ✅ Yes |
| `data_type` | Type discriminator | Via data parsing |

For future regular attestations (ReputationScore, Certification), SAS native fields will be used:

| SAS Field | Usage |
|-----------|-------|
| `token_account` | `agent_mint` (who attestation is about) |
| `signer` | Attestation Program PDA (CPI signing) |
| `expiry` | Attestation expiration |
| `nonce` | Deterministic per schema |

### SATI Core Schema Addresses

**Devnet:**

| Schema | Address | Status |
|--------|---------|--------|
| Credential | `7HCCiuYUHptR1SXXHBRqkKUPb5G3hPvnKfy5v8n2cFmY` | ✅ Current |
| Feedback | TBD | 🔄 Deploy needed |
| Validation | TBD | 🔄 Deploy needed |
| ReputationScore | TBD | 📋 Future |
| Certification | TBD | 📋 Future |

**Mainnet:**

| Schema | Address | Status |
|--------|---------|--------|
| Credential | `DQHW6fAhPfGAENuwJVYfzEvUN12DakZgaaGtPPRfGei1` | ✅ Current |
| Feedback | TBD | 🔄 Deploy needed |
| Validation | TBD | 🔄 Deploy needed |
| ReputationScore | TBD | 📋 Future |
| Certification | TBD | 📋 Future |

### SAS Layout Types

| Type ID | Type | Size |
|---------|------|------|
| 0 | U8 | 1 byte |
| 1 | U16 | 2 bytes |
| 4 | U64 | 8 bytes |
| 7 | I64 | 8 bytes |
| 13 | VecU8 | 4 + N bytes |

### Address/Nonce Strategy

**Compressed attestations** (Feedback, Validation) use Light Protocol address derivation:
```rust
let (address, address_seed) = derive_address(
    &[b"attestation", sas_schema.as_ref(), agent_mint.as_ref(), &nonce],
    &address_tree_pubkey,
    &program_id,
);
```
Where `nonce` is a random 32-byte value provided by the SDK to ensure uniqueness.

**Regular SAS attestations** (future) use deterministic nonces:

| Schema | Strategy | Nonce | Result |
|--------|----------|-------|--------|
| ReputationScore | Deterministic | `keccak256(provider, agent_mint)` | One per provider+agent |
| Certification | Deterministic | `keccak256(agent_mint, cert_type, certifier, version)` | Versioned per certifier |

### Serialization Format

All attestation data uses **Borsh serialization** (Binary Object Representation Serializer for Hashing), following Light Protocol and Anchor conventions.

**Key characteristics:**
- Fixed-size fields serialized directly (no length prefixes)
- Variable-size fields (Vec, String) use 4-byte little-endian length prefix
- Structs serialized in field order (no field names)
- Enums use 1-byte variant index followed by variant data

**Example: Feedback struct (207 bytes)**
```
Offset   Size   Field
0        32     task_id: [u8; 32]
32       32     agent: Pubkey
64       32     client: Pubkey
96       8      timestamp: i64 (little-endian)
104      32     content_hash: [u8; 32]
136      32     response_hash: [u8; 32]
168      36     content_ref: [u8; 36]
204      1      score: u8
205      1      tag1: u8
206      1      tag2: u8
```

**Why Borsh:**
- Light Protocol SDK uses Borsh natively
- Deterministic serialization (same data = same bytes)
- Efficient parsing (no dynamic allocation for fixed fields)
- Anchor compatibility

### Schema Definitions

The following schemas define the structure of `CompressedAttestation.data` for each data type. The program parses the first 96 bytes for signature-data binding; SDKs and indexers parse the full content.

#### Feedback Schema

Stored in `CompressedAttestation.data` with `data_type = 0`.

| Field | Type | Bytes | Description |
|-------|------|-------|-------------|
| `task_id` | [u8; 32] | 32 | Unique task/interaction identifier |
| `agent` | Pubkey | 32 | Agent pubkey (must match `agent_mint`) |
| `client` | Pubkey | 32 | Client pubkey (counterparty) |
| `timestamp` | i64 | 8 | When attestation was created |
| `content_hash` | [u8; 32] | 32 | Hash of service being attested |
| `response_hash` | [u8; 32] | 32 | Agent's response (zeros if none) |
| `content_ref` | [u8; 36] | 36 | Off-chain content reference |
| `score` | u8 | 1 | 0-100 rating |
| `tag1` | u8 | 1 | Primary category |
| `tag2` | u8 | 1 | Secondary category |

**Total data size**: 207 bytes

**Optional fields** (appended when using PaymentVerified):

| Field | Type | Bytes | Description |
|-------|------|-------|-------------|
| `payment_tx_sig` | [u8; 64] | 64 | Payment transaction signature |
| `payment_amount` | u64 | 8 | Payment amount |
| `payment_mint` | Pubkey | 32 | Payment token mint |

**Total with payment**: 311 bytes

**Signature binding** (verified off-chain by indexer/escrow):
- **DualSignature**: `signatures[0]` on `hash(task_id, client, content_hash)` (agent), `signatures[1]` on `hash(task_id, agent, score, timestamp)` (client)
- **PaymentVerified**: `signatures[0]` on `hash(task_id, agent, score, timestamp)` (client), payment proof verified separately
- **DualOrPayment**: Accepts either mode

---

#### Validation Schema

Stored in `CompressedAttestation.data` with `data_type = 1`.

| Field | Type | Bytes | Description |
|-------|------|-------|-------------|
| `task_id` | [u8; 32] | 32 | Unique task/interaction identifier |
| `agent` | Pubkey | 32 | Agent pubkey (must match `agent_mint`) |
| `validator` | Pubkey | 32 | Validator pubkey (counterparty) |
| `timestamp` | i64 | 8 | When validation was created |
| `content_hash` | [u8; 32] | 32 | Hash of work being validated |
| `response_hash` | [u8; 32] | 32 | Validator's response hash |
| `content_ref` | [u8; 36] | 36 | Off-chain content reference |
| `validation_type` | u8 | 1 | 0=tee, 1=zkml, 2=reexecution, 3=consensus |
| `status` | u8 | 1 | 0=fail, 100=pass |

**Total data size**: 206 bytes

**Signature binding** (verified off-chain by indexer/escrow):
- `signatures[0]` on `hash(task_id, validator, content_hash)` (agent)
- `signatures[1]` on `hash(task_id, agent, status)` (validator)

---

#### ReputationScore Schema (Future — Regular Storage)

Provider-computed reputation score. Uses `StorageType::Regular` (direct SAS attestation) for on-chain queryability.

**SAS Data Layout**:

| Bytes | Field | Type | Description |
|-------|-------|------|-------------|
| 0-31 | `provider` | Pubkey | Reputation provider (signer) |
| 32-63 | `agent` | Pubkey | Agent being scored |
| 64 | `score` | u8 | 0-100 reputation score |
| 65 | `confidence` | u8 | 0-100 confidence level |
| 66 | `methodology_id` | u8 | Provider's scoring methodology |
| 67-74 | `last_updated` | i64 | Timestamp |

**Total data size**: 75 bytes

**SAS Attestation config**:
- `token_account` = agent_mint
- `nonce` = `keccak256(provider, agent_mint)` (deterministic: one per provider+agent)
- `signer` = Attestation Program PDA (CPI signing)

**MVP Status**: Specified, not implemented.

---

#### Certification Schema (Future — Regular Storage)

Third-party certification. Uses `StorageType::Regular` with CredentialAuthority mode (traditional SAS auth).

**SAS Data Layout**:

| Field | Type | Description |
|-------|------|-------------|
| `cert_type` | U8 | 0=security_audit, 1=compliance, etc. |
| `version` | U8 | Version for re-certification |
| `content_ref` | VecU8 | 36 bytes: [type][data] |

**Total data size**: 42 bytes

**SAS Attestation config**:
- `token_account` = agent_mint
- `nonce` = `keccak256(agent_mint, cert_type, certifier, version)`

**MVP Status**: Specified, not implemented.

### Verification Models

SATI supports flexible verification via `SignatureMode` and `PaymentRequirement` in SchemaConfig.

#### DualSignature Mode

The breakthrough that makes on-chain feedback economically viable.

**The insight:** Service interaction naturally produces two signatures:
1. Agent signs attestation (proves they acknowledge the interaction)
2. Client signs attestation (proves they experienced it)

Anyone with both signatures can submit to chain. The agent (who benefits) pays. Client action is free — just sign, like clicking "submit" on a Web2 review.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Dual-Signature Flow                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Agent provides service to Client                                │
│  2. Both parties sign the complete attestation data:                │
│     hash = keccak256(sas_schema, data_type, data)                  │
│     agent_sig = sign(hash)                                          │
│     client_sig = sign(hash)                                         │
│  3. Agent (or anyone with both sigs) submits to chain:             │
│     create_attestation(data, [agent_sig, client_sig])              │
│  4. On-chain verification:                                          │
│     - Verify signature count matches SignatureMode                  │
│     - Verify signatures valid on domain-separated hash              │
│     - Verify signer pubkeys match agent/client in data              │
│     - Verify agent != client (self-attestation prevention)          │
│     - Create compressed attestation via Light CPI                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Cost breakdown:**
| Phase | Cost | Who |
|-------|------|-----|
| Agent signs | FREE | Off-chain |
| Client signs | FREE | Off-chain |
| Submit to chain | ~$0.002 (Light) | Whoever submits (typically agent) |

**Self-attestation prevention:** Enforced **on-chain** via two checks:
1. **Signature-data binding**: Program parses first 96 bytes, verifies `signatures[0].pubkey == agent` and `signatures[1].pubkey == client`
2. **Distinct parties**: Program verifies `agent != client`

This follows ERC-8004's approach — security is enforced on-chain, not just by indexers.

#### PaymentRequirement::Optional (Feedback)

For Feedback attestations, `PaymentRequirement::Optional` enables censorship-resistant submission:

- **Without payment proof**: Standard DualSignature — agent signs, pays to build reputation
- **With payment proof**: Client can submit even if agent refuses to sign

```
┌─────────────────────────────────────────────────────────────────────┐
│              Payment-Verified Flow (Optional Path)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Client pays Agent via x402 or direct transfer                   │
│  2. Payment creates on-chain record (tx signature)                  │
│  3. Both parties sign the complete attestation data:                │
│     hash = keccak256(sas_schema, data_type, data)                  │
│     agent_sig = sign(hash) — or agent refuses                       │
│     client_sig = sign(hash)                                         │
│  4. Client submits with payment proof:                              │
│     create_attestation(data, [agent_sig, client_sig], payment_proof)│
│  5. Verification:                                                   │
│     - On-chain: Signature count, validity, binding, self-check     │
│     - Off-chain: Indexer validates payment exists and is unique     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Payment deduplication**: The `payment_tx_sig` in the attestation enables indexers to detect and reject duplicate submissions for the same payment.

**Why this works:**
- Client gives feedback for free (no wallet transaction, just signature)
- Agent pays because reputation = more business
- Permissionless submission (anyone with required proofs can submit)
- Payment-verified path ensures censorship resistance (agent can't block feedback)

### Escrow Integration

Compressed attestations enable automatic escrow release via ZK proofs. Escrow contracts can verify attestations using Light Protocol's proof system:

```rust
// Escrow contract verifies validation before releasing funds
fn release_escrow(
    attestation_proof: CompressedProof,  // From Photon
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
const { proof, attestation } = await sati.getAttestationProof(agentMint, dataType, taskId);

// Verify and use for escrow release
const valid = await sati.verifyAttestation(proof, attestation);
```

### Content Reference Encoding

The `content_ref` field in Feedback/Validation schemas is for **optional extended content** (e.g., written review text, detailed validation reports) that's too large for compressed accounts. Core feedback data (score, tags, signatures) is always stored in the CompressedAttestation.

36-byte encoding for off-chain content references:

| Byte | Content |
|------|---------|
| 0 | Storage type code |
| 1-35 | Content data |

**Storage Types** (multicodec-compatible):

| Code | Storage | Data |
|------|---------|------|
| `0xe3` | IPFS | CIDv1 bytes |
| `0xce` | Arweave | Transaction ID |
| `0x00` | Raw | SHA-256 hash (no extended content) |

### Authority Separation

| Authority | Controls | Renounceable? |
|-----------|----------|---------------|
| Registry authority | `update_registry_authority()` | Yes |
| Attestation Program authority | Schema config registration | Yes |
| SAS credential authority | Schema creation | No (needed for versioning) |
| Schema signers | Per signature_mode configuration | N/A |

---

## Compressed Storage: Light Protocol

### Why Light Protocol?

SATI considered several approaches for scalable attestation storage:

| Approach | Cost per Attestation | Indexing | On-Chain Verification |
|----------|---------------------|----------|----------------------|
| Regular accounts | ~0.002 SOL | RPC (free) | Direct read |
| Custom merkle batching | ~0.00001 SOL | **Build indexer** | Custom verification |
| **Light Protocol** | ~0.00001 SOL | **Photon (free)** | ZK proof verification |

**Light Protocol wins because:**

1. **No custom indexer** — Photon reconstructs compressed accounts from on-chain logs. No infrastructure to build or maintain.

2. **ZK proofs for escrow** — Escrow contracts can verify attestations exist on-chain using validity proofs (~100K CU).

3. **Proven infrastructure** — Powers compressed NFTs (Bubblegum), battle-tested on mainnet.

4. **Future improvements** — V2 batched state trees (devnet) reduce CU by ~70%. SATI benefits automatically.

5. **SDK compatibility** — Light SDK integrates cleanly with Anchor programs via CPI.

### Overview

Light Protocol provides ZK Compression for Solana — storing data as leaves in on-chain merkle trees rather than full accounts. This enables ~200x cost reduction for attestations.

| Aspect | Regular Account | Compressed Account |
|--------|-----------------|-------------------|
| **Storage cost** | ~0.002 SOL rent | ~0.00001 SOL (tree append) |
| **On-chain access** | Direct read | Requires proof + indexer |
| **Data integrity** | Account data | ZK proof of merkle inclusion |
| **Scalability** | Linear cost | Fixed tree cost |

### How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                   ZK Compression Architecture                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. SATI Attestation Program creates attestation                    │
│     → Calls Light System Program CPI                                │
│                                                                     │
│  2. Light System Program:                                           │
│     → Hashes account data into leaf                                 │
│     → Appends leaf to state tree (concurrent merkle tree)           │
│     → Emits Noop log with account data (for Photon indexing)        │
│                                                                     │
│  3. On-chain state:                                                 │
│     → Only merkle root stored (32 bytes per tree)                   │
│     → Tree supports millions of leaves at fixed cost                │
│                                                                     │
│  4. Querying:                                                       │
│     → Photon reconstructs full accounts from Noop logs              │
│     → Provides validity proofs for on-chain verification            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Light Protocol Programs

| Program | Address | Purpose |
|---------|---------|---------|
| Light System | `SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7` | Compressed account operations |
| Account Compression | `compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq` | State tree management |
| Noop | `noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV` | Event logging for indexer |

### SATI Integration

The SATI Attestation Program integrates with Light Protocol via CPI:

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

pub fn create_compressed_attestation<'info>(
    ctx: Context<'_, '_, '_, 'info, CreateAttestation<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    params: CreateParams,
    schema_config: &SchemaConfig,
) -> Result<()> {
    // 1. Verify signature count per signature_mode
    verify_signature_count(&params.signatures, schema_config.signature_mode)?;

    // 2. Verify payment requirement
    verify_payment_requirement(&params.payment_proof, schema_config.payment_requirement)?;

    // 3. Verify signatures on domain-separated hash
    let hash = keccak256(&[
        params.sas_schema.as_ref(),
        &[params.data_type],
        &params.data,
    ].concat());
    verify_ed25519_signatures(&params.signatures, &hash)?;

    // 4. Signature-data binding: parse first 96 bytes
    let agent_pubkey = Pubkey::try_from(&params.data[32..64])?;
    let counterparty_pubkey = Pubkey::try_from(&params.data[64..96])?;
    verify_signature_binding(&params.signatures, agent_pubkey, counterparty_pubkey)?;

    // 5. Self-attestation prevention
    require!(agent_pubkey != counterparty_pubkey, SatiError::SelfAttestationNotAllowed);

    // 6. Set up CPI accounts
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.signer.as_ref(),
        ctx.remaining_accounts,
        crate::LIGHT_CPI_SIGNER,
    );

    // 7. Derive deterministic address using task_id
    let task_id = &params.data[0..32];
    let nonce = keccak256(&[task_id, params.sas_schema.as_ref(), params.agent_mint.as_ref()].concat());
    let (address, address_seed) = derive_address(
        &[b"attestation", params.sas_schema.as_ref(), params.agent_mint.as_ref(), &nonce],
        &address_tree_info.get_tree_pubkey(&light_cpi_accounts)?,
        &crate::ID,
    );

    // 8. Initialize compressed account via LightAccount wrapper
    let mut attestation = LightAccount::<CompressedAttestation>::new_init(
        &crate::ID,
        Some(address),
        output_state_tree_index,
    );

    attestation.sas_schema = params.sas_schema;
    attestation.agent_mint = params.agent_mint;
    attestation.data_type = params.data_type;
    attestation.data = params.data;
    attestation.signatures = params.signatures.iter().map(|s| s.sig).collect();
    attestation.timestamp = Clock::get()?.unix_timestamp;

    // 9. CPI to Light System Program
    let new_address_params = address_tree_info.into_new_address_params_packed(address_seed);

    LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
        .with_light_account(attestation)?
        .with_new_addresses(&[new_address_params])
        .invoke(light_cpi_accounts)?;

    Ok(())
}
```

**Key patterns:**
- `CpiAccounts::new()` parses accounts for the Light System Program CPI
- `derive_address()` returns both address and seed needed for CPI
- `LightAccount::new_init()` wraps struct for creation (also: `new_mut()` for updates, `new_close()` for closing)
- `LightSystemProgramCpi` builder chains `.with_light_account()` and `.with_new_addresses()`

### Address Derivation

Compressed accounts have deterministic addresses derived from seeds:

```rust
let (address, address_seed) = derive_address(
    &[b"attestation", sas_schema.as_ref(), agent_mint.as_ref(), &nonce],
    &address_tree_pubkey,  // from address_tree_info.get_tree_pubkey()
    &program_id,
);
```

**Parameters:**
- Custom seeds: `b"attestation"`, schema, agent, nonce
- `address_tree_pubkey`: The address tree where this address will be registered
- `program_id`: SATI Attestation Program ID

**Returns:**
- `address`: The derived compressed account address
- `address_seed`: Needed for the Light System Program CPI

This enables:
- **Collision prevention**: Same seeds = same address = prevents duplicates
- **Efficient querying**: Filter by schema or agent via Photon
- **Deterministic lookup**: SDK can compute expected address

### State Trees

Light Protocol uses concurrent merkle trees for state. SATI will use a shared public tree:

| Option | Pros | Cons |
|--------|------|------|
| **Shared public tree** | Zero setup, immediate use | Higher contention |
| **SATI-owned tree** | Isolated namespace | Setup cost, tree management |

**MVP approach**: Use shared public tree. Migrate to dedicated tree if contention becomes an issue.

### Cost Analysis

| Operation | Regular SAS | Light Protocol | Savings |
|-----------|-------------|----------------|---------|
| Create attestation | ~$0.40 | ~$0.002 | 200x |
| Update attestation | ~$0.40 | ~$0.002 | 200x |
| Close attestation | Rent return | Nullify | — |
| Query attestation | Free (RPC) | Free (Photon) | — |

---

## Indexing: Photon

### Overview

Photon is Helius's indexer for Light Protocol compressed accounts. It reconstructs full account state from on-chain Noop logs and provides ZK proofs for verification.

**Key capabilities:**
- **Free indexing** — No custom indexer infrastructure needed
- **RPC-compatible API** — Drop-in replacement for standard account queries
- **Proof generation** — Provides validity proofs for on-chain verification

### Photon RPC Methods

| Method | Description |
|--------|-------------|
| `getCompressedAccount` | Fetch single compressed account by address or hash |
| `getCompressedAccountsByOwner` | List accounts owned by a program (with filters) |
| `getMultipleCompressedAccounts` | Batch fetch multiple accounts |
| `getCompressedAccountProof` | Get merkle proof for account verification |
| `getValidityProof` | Get ZK proof for transactions (create/update) |
| `getCompressionSignaturesForAddress` | Transaction history for an address |
| `getIndexerHealth` | Check indexer status |

### Response Structure

Photon returns compressed accounts with discriminator separated from data:

```typescript
interface CompressedAccount {
  address?: string;              // Derived address (if account has one)
  hash: string;                  // Account hash (changes on every update)
  data?: {
    discriminator: number;       // 8-byte type ID (separate, NOT in data bytes)
    data: string;                // Base64-encoded account data
    dataHash: string;
  };
  owner: string;                 // Program ID
  lamports: number;
  leafIndex: number;
  tree: string;
  slotCreated: number;
}
```

**Important**: The `discriminator` is returned as a separate field. The `data` bytes start AFTER the discriminator, so memcmp offsets are relative to account struct start (offset 0 = first field after discriminator).

### SATI Queries via Photon

```typescript
import { createHelius } from "helius-sdk";

const helius = createHelius({ apiKey });

// Query feedbacks for an agent with cursor pagination
const feedbacks = await helius.zk.getCompressedAccountsByOwner({
    owner: SATI_ATTESTATION_PROGRAM.toBase58(),
    filters: [
        { memcmp: { offset: 0, bytes: feedbackSchemaAddress.toBase58() } },  // sas_schema
        { memcmp: { offset: 32, bytes: agentMint.toBase58() } },             // agent_mint
    ],
    limit: 50,
    cursor: null,  // For pagination
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

**Note on byte offsets**: Since discriminator is returned separately, our memcmp offsets should be:
- `sas_schema`: offset 0 (first field in struct)
- `agent_mint`: offset 32 (after 32-byte sas_schema)

### Indexing Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Photon Indexing Flow                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  On-chain                                                           │
│  ─────────                                                          │
│  1. SATI Attestation Program → CPI → Light System Program           │
│  2. Light System → CPI → Noop Program (log account data)            │
│  3. Account data + merkle path logged in transaction                │
│                                                                     │
│  Photon Indexer                                                     │
│  ─────────────                                                      │
│  4. Subscribes to Noop program logs                                 │
│  5. Reconstructs full account state in database                     │
│  6. Tracks merkle tree state for proof generation                   │
│                                                                     │
│  Client                                                             │
│  ──────                                                             │
│  7. Query Photon RPC for accounts                                   │
│  8. Request proofs for on-chain verification                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### SDK Integration

The SATI SDK wraps Photon for attestation queries:

```typescript
// High-level SDK interface
const sati = new SatiClient({ photonRpc: "https://mainnet.helius-rpc.com" });

// Query feedbacks for agent
const feedbacks = await sati.listFeedbacks(agentMint, { limit: 50 });

// Get specific attestation with proof
const { attestation, proof } = await sati.getAttestationWithProof(address);

// Verify attestation exists on-chain (client-side)
const valid = await sati.verifyAttestation(attestation, proof);
```

### Helius Photon Endpoints

| Network | Endpoint |
|---------|----------|
| Mainnet | `https://mainnet.helius-rpc.com/?api-key=<KEY>` |
| Devnet | `https://devnet.helius-rpc.com/?api-key=<KEY>` |

**Note**: Photon is available via Helius RPC endpoints. Free tier includes Photon access.

---

## Extensibility

The opaque `CompressedAttestation.data` model is designed for future extensibility. New data types can be added via new `data_type` values without program changes — only SDK and indexer need updates.

---

## Cross-Chain Interoperability

SATI agents can operate across chains using standard identity formats.

### Registration File Format

Agents use ERC-8004 compatible JSON registration files stored at their `TokenMetadata.uri`:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "description": "Agent description",
  "image": "https://example.com/agent-image.png",
  "endpoints": [
    { "name": "A2A", "endpoint": "https://agent.example/agent-card.json" },
    { "name": "agentWallet", "endpoint": "solana:5eykt4...:7S3P4..." }
  ],
  "registrations": [
    { "agentId": "sati:devnet:ABC123mint", "agentRegistry": "solana:devnet:satiFVb9..." }
  ]
}
```

**Required fields**: `type`, `name`, `description`, `image`

### SATI Canonical Identifier

SATI uses a custom format for agent identification:

```
sati:<network>:<mint_address>

// Examples:
sati:mainnet:ABC123mintPubkey
sati:devnet:XYZ789mintPubkey
```

The registry program address is stored separately in `agentRegistry` using CAIP-2 format. This format is used in registration files, cross-chain resolution, and event indexing.

### Standards Support

SATI supports [CAIP](https://github.com/ChainAgnostic/CAIPs) (Chain Agnostic Improvement Proposals) and DIDs for cross-chain interoperability. See [Appendix A](#appendix-a-caip-and-did-reference) for detailed format specifications

---

## SDK Interface

The TypeScript SDK (`@cascade-fyi/sati-sdk`) provides:
- **Agent identity** operations (Token-2022)
- **Attestation** methods (compressed attestation creation)
- **Query methods** (via Photon)
- **Verification methods** (signature and proof verification)

### Registry Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `registerAgent(params)` | Create Token-2022 NFT with metadata + group membership | `{ mint, memberNumber }` |

### Identity Methods (Direct Token-2022)

| Method | Description | Returns |
|--------|-------------|---------|
| `loadAgent(mint)` | Load agent identity by mint | `AgentIdentity \| null` |
| `updateAgentMetadata(mint, updates)` | Update name, uri, or additionalMetadata | `void` |
| `transferAgent(mint, newOwner)` | Transfer agent to new owner | `void` |
| `getAgentOwner(mint)` | Get current owner | `PublicKey` |
| `listAgents(params?)` | List agents with pagination | `AgentIdentity[]` |

### Attestation Methods

Generic method and type-specific convenience helpers:

| Method | Description | Returns |
|--------|-------------|---------|
| `createAttestation(params)` | Create compressed attestation | `{ address, signature }` |
| `createFeedback(params)` | Create feedback attestation (convenience) | `{ address, signature }` |
| `createFeedbackBatch(params[])` | Batch create feedbacks (up to 5/tx) | `{ addresses, signature }` |
| `createValidation(params)` | Create validation attestation (convenience) | `{ address, signature }` |
| `updateReputationScore(params)` | Provider updates their score for agent (future) | `{ attestation }` |
| `createCertification(params)` | Create certification (future) | `{ attestation }` |

**createFeedback params:**

```typescript
await sati.createFeedback({
  agentMint,
  client: clientPubkey,
  score: 85,
  tag1: TagCategory.Quality,
  tag2: TagCategory.Speed,
  contentHash: serviceHash,
  taskId: randomBytes(32),
  signatures: [
    { pubkey: agentPubkey, sig: agentSig },
    { pubkey: clientPubkey, sig: clientSig },
  ],  // DualSignature mode
  // OR for PaymentVerified mode:
  // signatures: [{ pubkey: clientPubkey, sig: clientSig }],
  // paymentProof: { txSig, amount, mint },
});
```

**createFeedbackBatch** (SDK-level optimization):

Batches multiple feedbacks into a single transaction. Validity proof cost (~100K CU) is amortized across all feedbacks, reducing per-feedback cost by ~70%.

```typescript
// Batch up to 5 feedbacks per transaction
// ~170K CU total vs 5 × 120K = 600K CU for individual calls
const { addresses, signature } = await sati.createFeedbackBatch([
  {
    agentMint: agent1,
    client: client1,
    score: 85,
    signatures: [agentSig1, clientSig1],
    // ... other fields
  },
  {
    agentMint: agent1,  // Can be same or different agents
    client: client2,
    score: 92,
    signatures: [agentSig2, clientSig2],
    // ... other fields
  },
  // ... up to 5 feedbacks
]);

console.log(`Created ${addresses.length} feedbacks in one tx: ${signature}`);
```

**When to use batching:**
- Agent processing multiple client feedbacks
- Bulk import of historical feedbacks
- High-volume agents optimizing costs

**MVP note:** Batching is an SDK optimization using Light Protocol's multi-recipient compress pattern. The on-chain program processes single attestations — batching combines multiple program instructions per transaction.

### Query Methods (via Photon)

| Method | Description | Returns |
|--------|-------------|---------|
| `getAttestation(address)` | Get compressed attestation by address | `CompressedAttestation \| null` |
| `getAttestationWithProof(address)` | Get attestation with ZK proof for on-chain verification | `{ attestation, proof }` |
| `listFeedbacks(agentMint, params?)` | List feedbacks for agent | `Feedback[]` |
| `listValidations(agentMint, params?)` | List validations for agent | `Validation[]` |
| `getAgentStats(agentMint)` | Get aggregated stats for agent | `AgentStats` |
| `getReputationScore(agent, provider)` | Get provider's score for agent (future) | `ReputationScore \| null` |

### Verification Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `verifyAttestation(attestation, proof)` | Verify compressed attestation proof | `boolean` |
| `verifySignatures(data, signatures)` | Verify signatures on data hash | `boolean` |
| `parseAttestation(attestation)` | Parse attestation data into typed structure | `Feedback \| Validation` |

**Note**: `closeAttestation()` is supported but attestations are generally immutable for reputation integrity.

### Event Parsing Methods

The SDK provides utilities to parse events from Noop logs:

| Method | Description | Returns |
|--------|-------------|---------|
| `parseTransaction(tx)` | Parse SATI events from transaction | `SatiEvent[]` |
| `parseWebhookPayload(payload)` | Parse events from Helius webhook payload | `SatiEvent[]` |

**Usage:**

```typescript
import { SatiClient } from "@cascade-fyi/sati-sdk";

const sati = new SatiClient({
  connection,
  photonRpc: "https://mainnet.helius-rpc.com/?api-key=<KEY>",
});

// Create feedback attestation
const { address } = await sati.createFeedback({
  agentMint,
  client: clientPubkey,
  score: 85,
  // ... other params
});

// Query feedbacks for an agent
const feedbacks = await sati.listFeedbacks(agentMint, { limit: 50 });

// Get attestation with proof for escrow
const { attestation, proof } = await sati.getAttestationWithProof(address);

// Verify proof client-side
const valid = await sati.verifyAttestation(attestation, proof);

// Parse typed leaf from attestation
const feedback = sati.parseAttestation(attestation);
console.log(feedback.score, feedback.client);
```

---

## Security Considerations

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
| Domain separation | Signatures on `keccak256(sas_schema, data_type, data)` — prevents cross-schema reuse |
| Signature-data binding | On-chain verification that signer pubkeys match agent/client in data |
| Self-attestation prevention | On-chain check: `agent != client` (like ERC-8004) |
| Replay protection | Deterministic nonce from `keccak256(task_id, schema, agent)` — same task = same address |

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

### Trust Model

SATI uses a **hybrid verification model** — critical security properties are enforced on-chain, while extended validation happens off-chain.

#### On-Chain Guarantees (Trustless)

| Property | Enforcement |
|----------|-------------|
| Signature validity | Ed25519 verification on domain-separated hash |
| Signature-data binding | Signer pubkeys must match agent/client in data |
| Self-attestation prevention | `agent != client` check |
| Duplicate prevention | Deterministic address derivation from task_id |

These are **cryptographically enforced** — invalid attestations are rejected by the program.

#### Off-Chain Validation (Indexer)

| Property | Enforcement |
|----------|-------------|
| Payment proof validity | Indexer verifies tx_signature exists on-chain |
| Payment deduplication | Indexer tracks used payment_tx_sig |
| Score range validation | Indexer verifies 0 ≤ score ≤ 100 |
| Timestamp reasonableness | Indexer verifies timestamp is recent |

#### Component Trust

| Component | Trust Assumption |
|-----------|-----------------|
| SATI Programs | Correctly verify signatures, binding, and self-attestation |
| Light Protocol | State tree integrity maintained |
| Photon Indexer | Accurately indexes compressed accounts |
| Application Indexer | Validates payment proofs and semantic content |

**Design rationale:** On-chain enforcement for security-critical properties (can't create fake attestations). Off-chain validation for properties that need external data (payment verification) or are non-critical (score ranges).

---

## Deployment

### Canonical Addresses

| Network | Program ID | Registry Config | Group Mint | Status |
|---------|------------|-----------------|------------|--------|
| Devnet | `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` | `5tMXnDjqVsvQoem8tZ74nAMU1KYntUSTNEnMDoGFjnij` | `4W3mJSqV6xkQXz1W1BW6ue3RBcMrY54tKnkpZ63ePMJ3` | **Deployed** |
| Mainnet | `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` | `5tMXnDjqVsvQoem8tZ74nAMU1KYntUSTNEnMDoGFjnij` | `A1jEZyAasuU7D8NrcaQn7PD9To8eG2i9gxyFjy6Mii9q` | **Deployed** |

*Both networks are verified via solana-verify on-chain.*

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

### Costs

All costs consolidated into a single reference table.

| Category | Operation | Cost (SOL) | CU | Notes |
|----------|-----------|------------|-----|-------|
| **Infrastructure (one-time)** | | | | |
| | Initialize registry | ~0.005 | 10,918 | One-time global setup |
| | Setup SAS credential | ~0.003 | — | One-time |
| | Setup SAS schemas (4 core) | ~0.012 | — | One-time |
| | Register schema config | ~0.0003 | — | One-time per schema |
| **Agent Registration** | | | | |
| | register_agent (minimal) | ~0.003 | 58,342 | Mint + metadata + group |
| | register_agent (3 fields) | ~0.0035 | 82,877 | +additional metadata |
| | register_agent (10 fields) | ~0.005 | 168,097 | Maximum metadata |
| | register_agent (soulbound) | ~0.003 | 79,255 | NonTransferable extension |
| | Update metadata | tx fee | — | Direct Token-2022 call |
| | Transfer agent | tx fee | — | Direct Token-2022 call |
| **Compressed Attestations (MVP)** | | | | |
| | Create feedback (single) | ~0.00001 | ~120,000 | Proof verify + tree append |
| | Create feedback (batched 5/tx) | ~0.000003 | ~35,000/ea | Amortized proof cost |
| | Create validation | ~0.00001 | ~120,000 | Proof verify + tree append |
| | Close attestation | tx fee | ~100,000 | Nullify in state tree |
| **Regular Attestations (Future)** | | | | |
| | Create ReputationScore | ~0.002 | ~30,000 | SAS attestation (75 bytes) |
| | Update ReputationScore | tx fee | ~30,000 | Close+create (rent neutral) |
| | Create Certification | ~0.002 | ~30,000 | SAS attestation (42 bytes) |
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
- V2 batched state trees (devnet) reduce CU by ~70% — will adopt when mainnet ready

---

## Governance

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

### Schema Governance

SATI Core credential is controlled by SATI multisig, with path to immutability.

**Schema changes** require new schema versions (e.g., Feedback_v2), preserving existing attestations. Schemas are versioned, not upgraded in place.

---

## What's NOT Included (Yet)

| Feature | Status | Notes |
|---------|--------|-------|
| Regular SAS attestations | Future | ReputationScore, Certification via StorageType::Regular |
| Public reviews (no agent signature) | Deferred | Spam risk without interaction proof |
| Third-party credential system | Deferred | Platform model; add when demand exists |
| Agent→Agent delegation | Future | New data type when needed |
| Mandates / AP2 lifecycle | Future | New data type when needed |
| SDK batching (`createFeedbackBatch`) | MVP | SDK-level optimization, ~70% cost reduction |

**Regular SAS attestations:**

MVP focuses on compressed storage for Feedback and Validation. ReputationScore and Certification will use regular SAS attestations (StorageType::Regular) for direct on-chain queryability. The Attestation Program supports both paths — regular attestations will be added post-MVP.

**Third-party credential system:**

The spec is designed to support external projects registering their own SAS credentials with SATI for permissionless attestation creation and unified indexing. This "SATI as platform" model adds complexity (extra instructions, account types, indexer logic) without immediate value. Will be added when third parties express demand.

**Public reviews:**

Public reviews (client-only signature) would allow feedback without proving interaction. Deferred due to spam/sybil risk. May revisit with reputation-weighted filtering.

**Future data types:**

The opaque `CompressedAttestation.data` model supports adding Delegation, Mandate, etc. via new `data_type` values without program changes. Only SDK and indexer need updates.

---

## Summary

SATI solves the economics of on-chain agent reputation:

- **Free feedback for clients** — Dual-signature enables agent-subsidized submission
- **Censorship-resistant** — PaymentVerified mode ensures clients can always submit feedback
- **Infinite scale at fixed cost** — ZK Compression stores attestations at ~$0.002 each
- **No monopoly** — Multiple reputation providers compete with different algorithms
- **Escrow integration** — ZK proofs enable automatic escrow release

**Architecture highlights:**

| Concept | Description |
|---------|-------------|
| **Opaque data + signatures** | Program verifies signatures on `keccak256(data)`, never parses content |
| **Storage abstraction** | SchemaConfig determines compressed (Light) or regular (SAS) storage |
| **Semantic verification** | Indexers and escrows parse attestations, verify pubkeys match signatures |

**Core schemas:**

| Schema | Storage Type | Auth Mode | MVP Status |
|--------|--------------|-----------|------------|
| Feedback | Compressed | DualOrPayment | ✅ Implement |
| Validation | Compressed | DualSignature | ✅ Implement |
| ReputationScore | Regular | SingleSigner | 📋 Future |
| Certification | Regular | CredentialAuthority | 📋 Future |

| Component | Technology | Status |
|-----------|------------|--------|
| Registry | SATI Registry Program (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`) | Deployed |
| Attestation | SATI Attestation Program | To deploy |
| Identity | Token-2022 NFT + TokenMetadata + TokenGroup | Available |
| Compressed Storage | Light Protocol | Available |
| Indexing | Photon (Helius) | Available |
| Core SAS Schemas | Feedback, Validation, ReputationScore, Certification | To deploy |
| Smart accounts | Native Token-2022 support | Available |

---

## References

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Token-2022 Program](https://github.com/solana-program/token-2022)
- [Token Metadata Interface](https://github.com/solana-program/token-metadata)
- [Token Group Interface](https://github.com/solana-program/token-group)
- [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service)
- [Light Protocol](https://github.com/Lightprotocol/light-protocol) — ZK Compression for Solana
- [Light Protocol Docs](https://www.zkcompression.com/) — Compressed accounts documentation
- [Light SDK (Rust)](https://docs.rs/light-sdk/) — Anchor integration for compressed accounts
- [Photon RPC](https://docs.helius.dev/compression-and-das-api/photon-api) — Helius indexer for compressed accounts
- [Squads Smart Account](https://github.com/Squads-Protocol/smart-account-program)
- [Anchor Framework](https://www.anchor-lang.com/docs)

---

## Appendix A: CAIP and DID Reference

Detailed format specifications for cross-chain interoperability standards used by SATI.

### CAIP-2: Blockchain ID

Chain identifiers follow format: `namespace:reference`

| Chain | CAIP-2 Identifier |
|-------|-------------------|
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Ethereum Mainnet | `eip155:1` |
| Base | `eip155:8453` |

### CAIP-10: Account ID

Account identifiers follow format: `chain_id:account_address`

```
// Solana account on mainnet:
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv

// Ethereum account:
eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7
```

### DID Support

Agents can advertise DIDs via `additionalMetadata`:

```typescript
["did", "did:web:agent.example.com"]           // Web-based DID
["did", "did:pkh:solana:5eykt4...:7S3P4..."]   // PKH (blockchain account)
["did", "did:key:z6Mkf..."]                    // Key-based DID
```

### Endpoint Capability Arrays (ERC-8004 Best Practice)

Registration files can include capability arrays for protocol endpoints:

**MCP Endpoints:**
```json
{
  "name": "MCP",
  "endpoint": "https://api.example.com/mcp",
  "version": "2025-06-18",
  "mcpTools": ["data_analysis", "chart_generation"],
  "mcpPrompts": ["summarize", "explain"],
  "mcpResources": ["database", "files"]
}
```

**A2A Endpoints:**
```json
{
  "name": "A2A",
  "endpoint": "https://api.example.com/a2a",
  "version": "0.30",
  "a2aSkills": ["task_planning", "code_review"]
}
```

**OASF Endpoints** (Open Agentic Schema Framework):

OASF provides standardized skill and domain taxonomies. Reference: [github.com/agntcy/oasf](https://github.com/agntcy/oasf)

```json
{
  "name": "OASF",
  "endpoint": "https://github.com/agntcy/oasf/",
  "version": "v0.8.0",
  "skills": ["natural_language_processing/summarization", "analytical_skills/coding_skills"],
  "domains": ["technology/software_engineering", "finance_and_business"]
}
```

These capability arrays are optional but recommended for agent discoverability.

### Full Registration File Example

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "description": "Agent description",
  "image": "https://example.com/agent.png",
  "endpoints": [
    { "name": "A2A", "endpoint": "https://agent.example/agent-card.json", "version": "0.3.0" },
    { "name": "MCP", "endpoint": "https://mcp.agent.example/", "version": "2025-06-18" },
    { "name": "agentWallet", "endpoint": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv" }
  ],
  "registrations": [
    { "agentId": "sati:devnet:ABC123mint", "agentRegistry": "solana:devnet:satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF" },
    { "agentId": 22, "agentRegistry": "eip155:1:0x..." }
  ],
  "supportedTrusts": ["reputation", "validation"],
  "active": true,
  "x402support": true
}
```

**Optional fields:**
- `active` — Agent operational status (boolean)
- `x402support` — Accepts x402 payments (boolean)
- `supportedTrusts` — Trust mechanisms: `"reputation"`, `"validation"`, `"crypto-economic"`, `"tee-attestation"`

