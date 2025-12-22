# SATI Specification v2.0

## Solana Agent Trust Infrastructure

**Status**: Implementation Ready
**Version**: 2.0.0
**Created**: 2025-12-11
**License**: Apache 2.0

---

## Abstract

SATI is open trust infrastructure for AI agents on Solana. It solves the fundamental economics of on-chain feedback:

- **Agent-subsidized feedback** — Dual-signature makes feedback free for clients
- **Censorship-resistant** — Payment-verified mode ensures clients can always submit feedback
- **Infinite scale at fixed cost** — Merkle root batching stores millions of feedbacks in 80 bytes
- **No reputation monopoly** — Multiple providers compete with different scoring algorithms
- **Extensible by design** — Unified base types (AttestationRoot, AttestationLeaf) enable new trust primitives without program changes

Built on:
- **SATI Registry Program** — Canonical agent registration + permissionless attestation proxy
- **Token-2022** — Agent identity as NFTs with native metadata
- **Solana Attestation Service (SAS)** — Attestation storage with unified schema model

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
| Client pays (naive) | ~$0.002 | Dead system | Nobody shows up |
| Agent subsidizes (merkle batch) | ~$0.00002 | $0.20 | Agent (negligible) |

With merkle root batching, 10K feedbacks cost the same as 1 — just one on-chain attestation storing the root.

---

## Table of Contents

1. [Motivation](#motivation)
2. [Architecture](#architecture)
3. [Registry Program](#registry-program)
4. [Identity: Token-2022 NFT](#identity-token-2022-nft)
5. [Reputation & Validation: SAS](#reputation--validation-sas)
6. [Extensibility](#extensibility)
7. [SDK Interface](#sdk-interface)
8. [Security Considerations](#security-considerations)
9. [Deployment](#deployment)
10. [Governance](#governance)
11. [Cross-Chain Interoperability](#cross-chain-interoperability)
12. [What's NOT Included (Yet)](#whats-not-included-yet)
13. [Summary](#summary)
14. [References](#references)
15. [Appendix A: CAIP and DID Reference](#appendix-a-caip-and-did-reference)
16. [Appendix B: Merkle Tree Implementation](#appendix-b-merkle-tree-implementation)

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

**Core schemas** (FeedbackRoot, ValidationRoot, ReputationScore, Certification) implement the economics-first trust model: dual-signature for agent-subsidized feedback, merkle root batching for infinite scale, and multi-provider reputation to prevent monopolies. Third parties can register their own credentials for custom trust applications.

### Why v2?

SATI v1 proposed custom programs. Analysis revealed a better path:

1. **Minimal custom code**: Token-2022 + SAS already provide needed primitives
2. **Merkle root batching**: Store millions of feedbacks in one attestation — scalability solved at design level
3. **Avoid audit burden**: Less custom code = smaller attack surface

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
2. **Minimal custom code** — Thin registry wrapper + Token-2022 + SAS
3. **Canonical address** — `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` for discoverability
4. **Wallet support out of the box** — Users see agents in Phantom, Solflare, Backpack
5. **Enterprise ready** — Works with Squads smart accounts
6. **Immutable governance** — Start with multisig, renounce to immutable after stable
7. **Composable authorization** — Each schema defines its auth mode (dual-signature, single-signer, credential authority)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SATI Registry Program                          │
│             (satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF)            │
├─────────────────────────────────────────────────────────────────────┤
│  initialize()                → Create registry + TokenGroup         │
│  register_agent()            → Token-2022 NFT + group membership    │
│  register_schema_config()    → Register schema with auth mode       │
│  create_attestation()        → CPI to SAS (auth-verified)           │
│  update_attestation()        → Close+create with auth proof         │
│  close_attestation()         → CPI to SAS close (auth-verified)     │
│  update_registry_authority() → Transfer/renounce control            │
└─────────────────────────────────────────────────────────────────────┘
          │                               │
          ▼                               ▼
┌──────────────────────────┐    ┌─────────────────────────────────────┐
│      Token-2022          │    │     Solana Attestation Service      │
│  • Identity storage      │    │                                     │
│  • TokenMetadata         │    │  ┌─────────────────────────────┐    │
│  • TokenGroup            │    │  │       SATI Credential       │    │
│  • Direct updates/xfers  │    │  │  FeedbackRoot, ValidationRoot│   │
└──────────────────────────┘    │  │  ReputationScore, Certification│  │
                                │  └─────────────────────────────┘    │
                                └─────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **SATI Registry** | Canonical entry point, agent registration, CPI proxy for attestations |
| **Token-2022** | Identity storage, metadata, transfers (direct calls) |
| **SAS** | Attestation storage for SATI schemas |
| **SATI Indexer** | Indexes SATI attestations, provides queries |

---

## Registry Program

### Overview

The SATI Registry is a minimal program that:
- Provides a **canonical program address** (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`)
- Holds TokenGroup `update_authority` as a PDA
- Enables **permissionless, atomic agent registration**
- Provides **CPI proxy** for permissionless attestation creation
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

#### SchemaConfig

PDA seeds: `["schema_config", sas_schema_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| `sas_schema` | Pubkey | SAS schema address |
| `auth_mode` | AuthMode | Authorization mode for this schema |
| `is_merkle_based` | bool | Whether data contains merkle root |
| `bump` | u8 | PDA bump seed |

**Size**: 43 bytes (8 discriminator + 32 + 1 + 1 + 1)

#### AuthMode Enum

| Variant | Value | Description | Signature Count |
|---------|-------|-------------|-----------------|
| `DualSignature` | 0 | Requires two off-chain signatures, anyone can submit | 2 |
| `SingleSigner` | 1 | Requires one off-chain signature, anyone can submit | 1 |
| `PaymentVerified` | 2 | Requires one signature + payment proof, anyone can submit | 1 + payment |
| `CredentialAuthority` | 3 | Uses SAS credential's authorized_signers (traditional) | 0 |

**Signature Verification Model (Option B):**

The program treats leaf data as **opaque bytes** and never parses it. Signatures are passed separately from data:

```rust
create_attestation(
    data: Vec<u8>,                    // Opaque leaf bytes
    signatures: Vec<SignerEntry>,     // [{pubkey, sig}, ...]
    payment_proof: Option<PaymentProof>,  // For PaymentVerified mode
)
```

The program verifies:
1. Correct number of signatures per AuthMode
2. Each signature is valid on `keccak256(data)`
3. Payment proof is valid (if PaymentVerified)

**What the program does NOT verify:**
- Whether signature pubkeys match fields inside `data`
- Semantic meaning of who signed (agent vs client)

**Where semantic verification happens:**
- **Indexer**: Parses leaf, verifies pubkeys in data match signature pubkeys
- **Escrow**: Parses leaf at consumption time, verifies before releasing funds
- **SDK**: Constructs valid leaves with correct pubkey positions

This decoupling enables adding new leaf types (Delegation, Mandate, etc.) without program changes.

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

#### create_attestation

Create attestation with authorization proof.

| Parameter | Type | Description |
|-----------|------|-------------|
| `credential` | Pubkey | Target SAS credential |
| `schema` | Pubkey | Target SAS schema |
| `data` | Vec<u8> | Attestation data (opaque, schema-specific) |
| `nonce` | [u8; 32] | Attestation nonce |
| `signatures` | Vec<SignerEntry> | Authorization signatures per schema's auth_mode |
| `payment_proof` | Option<PaymentProof> | Payment proof for PaymentVerified mode |
| `token_account` | Option<Pubkey> | SAS token_account field (typically agent_mint) |
| `expiry` | Option<i64> | SAS expiry field |

**SignerEntry struct**: `{ pubkey: Pubkey, sig: [u8; 64] }`

**PaymentProof struct**: `{ tx_signature: [u8; 64], amount: u64, token_mint: Pubkey }`

**Preconditions**:
- Schema must belong to SATI credential
- SchemaConfig must exist for schema
- Signatures must be valid per auth_mode:
  - `DualSignature`: 2 signatures, both valid on `keccak256(data)`
  - `SingleSigner`: 1 signature, valid on `keccak256(data)`
  - `PaymentVerified`: 1 signature valid on `keccak256(data)` + valid payment_proof
  - `CredentialAuthority`: 0 signatures (uses traditional SAS auth)

**Behavior**:
- Verifies ed25519 signatures against `keccak256(data)` (program does not parse data)
- CPIs to SAS `create_attestation` with Registry PDA as authorized signer
- Emits `AttestationCreated` event

#### register_schema_config

Register a schema with its authorization configuration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | Pubkey | SAS schema to configure |
| `auth_mode` | AuthMode | DualSignature, SingleSigner, or CredentialAuthority |
| `is_merkle_based` | bool | Whether schema data contains merkle root |

**Preconditions**:
- Schema must belong to a registered credential
- Caller must be credential authority

**Behavior**:
- Creates SchemaConfig PDA
- Emits `SchemaConfigRegistered` event

#### update_attestation

Update an existing attestation with authorization proof.

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_data` | Vec<u8> | Updated attestation data |
| `signatures` | Vec<Signature> | 1-2 signatures based on schema's auth_mode |
| `merkle_proof` | Option<Vec<[u8; 32]>> | Merkle proof for merkle-based schemas |

**Preconditions**:
- SchemaConfig must exist for attestation's schema
- Signatures must be valid per auth_mode (same rules as create_attestation)
- If merkle-based: merkle proof must verify append operation

**Behavior**:
- Verifies ed25519 signatures against pubkeys in new_data
- Verifies merkle proof if applicable
- CPIs to SAS `close_attestation` then `create_attestation` (atomic)
- Emits `AttestationUpdated` event with old and new data hashes

#### close_attestation

Close an attestation with authorization proof.

| Parameter | Type | Description |
|-----------|------|-------------|
| `signatures` | Vec<Signature> | Authorization signatures per auth_mode |

**Preconditions**:
- Same signature requirements as create_attestation

**Behavior**:
- Verifies signatures
- CPIs to SAS `close_attestation`
- Returns rent to payer
- Emits `AttestationClosed` event

### Events

All events use Anchor's `emit_cpi!` macro for reliable indexing. Account structs requiring event emission include the `#[event_cpi]` attribute, which automatically adds `event_authority` and `program` accounts.

**Why `emit_cpi!` instead of `emit!`:**

| Approach | Mechanism | Truncation Risk | CU Cost |
|----------|-----------|-----------------|---------|
| `emit!` | `sol_log_data` syscall | Yes (10KB log limit) | ~1K |
| `emit_cpi!` | Self-CPI to `innerInstructions` | No | ~5K |

Feedback and validation data is critical for reputation integrity — truncation is unacceptable. The 5K CU overhead (~0.4% of budget) is a worthwhile tradeoff for guaranteed delivery.

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

#### CredentialRegistered

| Field | Type |
|-------|------|
| `credential` | Pubkey |
| `owner` | Pubkey |

#### CredentialDeregistered

| Field | Type |
|-------|------|
| `credential` | Pubkey |

#### AttestationCreated

| Field | Type |
|-------|------|
| `credential` | Pubkey |
| `schema` | Pubkey |
| `attestation` | Pubkey |
| `signer` | Pubkey |

#### SchemaConfigRegistered

| Field | Type |
|-------|------|
| `schema` | Pubkey |
| `auth_mode` | AuthMode |
| `is_merkle_based` | bool |

#### AttestationUpdated

| Field | Type |
|-------|------|
| `attestation` | Pubkey |
| `schema` | Pubkey |
| `old_data_hash` | [u8; 32] |
| `new_data_hash` | [u8; 32] |

#### AttestationClosed

| Field | Type |
|-------|------|
| `attestation` | Pubkey |
| `schema` | Pubkey |

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
| `CredentialNotRegistered` | Credential not registered with SATI |
| `CredentialInactive` | Credential is deactivated |
| `RegistryNotAuthorized` | Registry PDA not in credential's authorized_signers |
| `InvalidCredentialOwner` | Caller is not credential owner |
| `SchemaCredentialMismatch` | Schema does not belong to credential |
| `SchemaConfigNotFound` | Schema config not registered |
| `InvalidSignatureCount` | Wrong number of signatures for auth mode |
| `SignerMismatch` | Signature pubkey doesn't match expected position in data |
| `InvalidSignature` | Ed25519 signature verification failed |
| `InvalidMerkleProof` | Merkle proof verification failed |
| `MerkleProofRequired` | Merkle-based schema requires proof |

### Agent Removal

No `remove_agent` instruction exists. To "remove" an agent:
1. Owner burns the NFT (closes token account)
2. TokenGroupMember remains (historical record preserved)
3. SAS attestations remain (feedback/validation history preserved)

### Fees

**No registration fees.** Only Solana rent (~0.003 SOL per agent) which goes to the user's account.

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

## Reputation & Validation: SAS

### SAS Program

Solana Attestation Service (SAS) by Solana Foundation:

| Network | Program ID |
|---------|------------|
| Mainnet/Devnet | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` |

### SATI Credential

SATI operates a single SAS credential controlled by SATI governance. All core schemas (FeedbackRoot, ValidationRoot, ReputationScore, Certification) live under this credential.

### Core Schemas

SATI provides a unified schema system built on base types:

**Base Types** (shared structure):

| Base Type | Purpose |
|-----------|---------|
| **AttestationRoot** | Base structure for all merkle-based roots |
| **AttestationLeaf** | Base structure for all merkle tree leaves |

**Merkle-based schemas** (derived from AttestationRoot):

| Schema | Derives From | Auth Mode | Why It Matters |
|--------|--------------|-----------|----------------|
| **FeedbackRoot** | AttestationRoot | DualSignature or PaymentVerified | Free for clients, scales infinitely |
| **ValidationRoot** | AttestationRoot | DualSignature | Enables automatic escrow release |

**Direct schemas** (non-merkle, individual attestations):

| Schema | What It Stores | Auth Mode | Why It Matters |
|--------|---------------|-----------|----------------|
| **ReputationScore** | Provider's computed score | SingleSigner | No monopoly — providers compete |
| **Certification** | Third-party attestations | CredentialAuthority | Immutable proof of audit/compliance |

**Leaf types** (derived from AttestationLeaf):

| leaf_type | Name | Auth Mode | Used By |
|-----------|------|-----------|---------|
| 0 | FeedbackLeaf | DualSignature or PaymentVerified | FeedbackRoot |
| 1 | ValidationLeaf | DualSignature | ValidationRoot |

For merkle-based schemas: the root update is signed by the agent, but each leaf contains signatures verified at submission time. The program verifies signature count per auth_mode without parsing leaf content.

### SAS Native Field Usage

SATI leverages SAS native attestation fields:

| SAS Field | Usage | Stored In |
|-----------|-------|-----------|
| `token_account` | `agent_mint` (who attestation is about) | All schemas |
| `signer` | Registry PDA (CPI signing) | All schemas |
| `expiry` | Attestation expiration | Where applicable |
| `nonce` | Deterministic or random per schema | Per schema |

**Why `token_account` for `agent_mint`?**

1. **Directly queryable** — Indexers can filter by `attestation.token_account` without parsing schema data
2. **No architectural change** — Just populate the field during attestation creation
3. **Significant savings** — 32 bytes saved per attestation

### SATI Core Schema Addresses

**Devnet:**

| Schema | Address | Status |
|--------|---------|--------|
| Credential | `7HCCiuYUHptR1SXXHBRqkKUPb5G3hPvnKfy5v8n2cFmY` | ✅ Current |
| FeedbackRoot | TBD | 🔄 Deploy needed |
| ValidationRoot | TBD | 🔄 Deploy needed |
| ReputationScore | TBD | 🔄 Deploy needed |
| Certification | TBD | 🔄 Deploy needed |

**Mainnet:**

| Schema | Address | Status |
|--------|---------|--------|
| Credential | `DQHW6fAhPfGAENuwJVYfzEvUN12DakZgaaGtPPRfGei1` | ✅ Current |
| FeedbackRoot | TBD | 🔄 Deploy needed |
| ValidationRoot | TBD | 🔄 Deploy needed |
| ReputationScore | TBD | 🔄 Deploy needed |
| Certification | TBD | 🔄 Deploy needed |

### SAS Layout Types

| Type ID | Type | Size |
|---------|------|------|
| 0 | U8 | 1 byte |
| 1 | U16 | 2 bytes |
| 4 | U64 | 8 bytes |
| 7 | I64 | 8 bytes |
| 13 | VecU8 | 4 + N bytes |

### Attestation Nonce Strategy

SAS attestation PDAs: `["attestation", credential, schema, nonce]`

| Schema | Strategy | Nonce | Result |
|--------|----------|-------|--------|
| FeedbackRoot | Deterministic | `agent_mint` | One per agent |
| ValidationRoot | Deterministic | `agent_mint` | One per agent |
| ReputationScore | Deterministic | `keccak256(provider, agent_mint)` | One per provider+agent |
| Certification | Deterministic | `keccak256(agent_mint, cert_type, certifier, version)` | Versioned per certifier |

### Schema Definitions

#### Base Types

##### AttestationRoot (Base)

Base structure for all merkle-based root schemas. FeedbackRoot, ValidationRoot, and future *Root schemas derive from this.

**Data Layout**:

| Bytes | Field | Type | Description |
|-------|-------|------|-------------|
| 0-31 | `agent` | Pubkey | Agent who owns this attestation root |
| 32-63 | `merkle_root` | [u8; 32] | Root of merkle tree |
| 64-71 | `count` | u64 | Total leaves in tree |
| 72-79 | `last_updated` | i64 | Timestamp of last update |

**Total data size**: 80 bytes

##### AttestationLeaf (Base)

Base structure for all merkle tree leaves. FeedbackLeaf, ValidationLeaf, and future *Leaf types derive from this.

**Common Fields** (all leaf types):

| Field | Type | Description |
|-------|------|-------------|
| `leaf_type` | u8 | Discriminator: 0=Feedback, 1=Validation, 2+=Future |
| `task_id` | [u8; 32] | Unique task/interaction identifier |
| `agent` | Pubkey | Agent pubkey |
| `counterparty` | Pubkey | Client, validator, delegatee, etc. |
| `timestamp` | i64 | When attestation was created |
| `content_hash` | [u8; 32] | Hash of work/service being attested |
| `response_hash` | [u8; 32] | Agent's response (zeros if none yet) |
| `content_ref` | [u8; 36] | Off-chain content reference |
| `type_data` | Vec<u8> | Type-specific fields (parsed by SDK based on leaf_type) |

**Signatures**: Passed separately to instruction per AuthMode (not embedded in leaf).

---

#### FeedbackRoot

Derives from **AttestationRoot**. Merkle root of all client feedbacks for an agent.

**Data Layout**: Same as AttestationRoot (80 bytes)

**Attestation config**:
- `token_account` = agent_mint
- `nonce` = agent_mint (deterministic: one FeedbackRoot per agent)

**Auth modes supported**: DualSignature, PaymentVerified, or both combined

**Creation**: Agent creates FeedbackRoot explicitly before receiving first feedback. This keeps registration cost minimal — agents only pay for reputation infrastructure when they need it.

##### FeedbackLeaf

Derives from **AttestationLeaf** with `leaf_type = 0`.

**Common fields** (from AttestationLeaf):
- `leaf_type` = 0
- `task_id`, `agent`, `counterparty` (= client), `timestamp`
- `content_hash` (= service_hash), `response_hash`, `content_ref`

**Type-specific fields** (in `type_data`):

| Field | Type | Description |
|-------|------|-------------|
| `score` | u8 | 0-100 rating |
| `tag1` | u8 | Primary category |
| `tag2` | u8 | Secondary category |

**Payment verification fields** (optional, for PaymentVerified mode):

| Field | Type | Description |
|-------|------|-------------|
| `payment_tx_sig` | Option<[u8; 64]> | Payment transaction signature (for deduplication) |
| `payment_amount` | Option<u64> | Payment amount |
| `payment_mint` | Option<Pubkey> | Payment token mint |

**Why payment info appears in both leaf and instruction:**
- **PaymentProof in instruction** → emitted in event → indexer verifies immediately
- **Payment fields in leaf** → hashed into merkle tree → escrow can verify via proof without trusting indexer

**Signatures required** (passed separately):
- **DualSignature**: agent signs `hash(task_id, client, content_hash)`, client signs `hash(task_id, agent, score, timestamp)`
- **PaymentVerified**: client signs `hash(task_id, agent, score, timestamp)` + payment_proof
- **Both**: All of the above

---

#### ValidationRoot

Derives from **AttestationRoot**. Merkle root of all validations for an agent.

**Data Layout**: Same as AttestationRoot (80 bytes)

**Attestation config**:
- `token_account` = agent_mint
- `nonce` = agent_mint (deterministic: one ValidationRoot per agent)

**Auth mode**: DualSignature

**Creation**: Agent creates ValidationRoot explicitly when they need validation tracking.

##### ValidationLeaf

Derives from **AttestationLeaf** with `leaf_type = 1`.

**Common fields** (from AttestationLeaf):
- `leaf_type` = 1
- `task_id`, `agent`, `counterparty` (= validator), `timestamp`
- `content_hash` (= work_hash), `response_hash`, `content_ref`

**Type-specific fields** (in `type_data`):

| Field | Type | Description |
|-------|------|-------------|
| `validation_type` | u8 | 0=tee, 1=zkml, 2=reexecution, 3=consensus |
| `status` | u8 | 0=fail, 100=pass |

**Signatures required** (passed separately):
- Agent signs: `hash(task_id, validator, content_hash)`
- Validator signs: `hash(task_id, agent, status)`

#### ReputationScore

Provider-computed reputation score for an agent. Single-signer: only the provider can update their score.

**Data Layout**:

| Bytes | Field | Type | Description |
|-------|-------|------|-------------|
| 0-31 | `provider` | Pubkey | Reputation provider (signer) |
| 32-63 | `agent` | Pubkey | Agent being scored |
| 64 | `score` | u8 | 0-100 reputation score |
| 65 | `confidence` | u8 | 0-100 confidence level |
| 66 | `methodology_id` | u8 | Provider's scoring methodology |
| 67-74 | `last_updated` | i64 | Timestamp |

**Total data size**: 75 bytes

**Attestation config**:
- `token_account` = agent_mint
- `nonce` = `keccak256(provider, agent_mint)` (deterministic: one per provider+agent)

#### Certification

Third-party certification (uses CredentialAuthority mode - traditional SAS auth).

| Field | Type | Description |
|-------|------|-------------|
| `cert_type` | U8 | 0=security_audit, 1=compliance, etc. |
| `version` | U8 | Version for re-certification |
| `content_ref` | VecU8 | 36 bytes: [type][data] |

**Total data size**: 42 bytes

**Attestation config**:
- `token_account` = agent_mint
- `nonce` = `keccak256(agent_mint, cert_type, certifier, version)`

### Verification Models

SATI supports two verification modes, usable separately or together.

#### DualSignature Mode

The breakthrough that makes on-chain feedback economically viable.

**The insight:** Service interaction naturally produces two signatures:
1. Agent signs service receipt (proves they did work)
2. Client signs feedback (proves they experienced it)

Anyone with both signatures can submit to chain. The agent (who benefits) pays. Client action is free — just sign, like clicking "submit" on a Web2 review.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Dual-Signature Flow                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Agent provides service to Client                                │
│  2. Agent signs service receipt:                                    │
│     agent_sig = sign(hash(task_id, client, content_hash))          │
│  3. Client signs feedback (FREE — just a signature):                │
│     client_sig = sign(hash(task_id, agent, score, timestamp))      │
│  4. Agent (or anyone with both sigs) submits to chain:             │
│     submit_leaf(leaf_data, [agent_sig, client_sig], merkle_proof)  │
│  5. On-chain verification:                                          │
│     - Verify both signatures valid on keccak256(leaf_data)         │
│     - Verify leaf hash + proof produces valid new root             │
│     - Update FeedbackRoot attestation                               │
│     - Emit LeafAdded event                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Cost breakdown:**
| Phase | Cost | Who |
|-------|------|-----|
| Agent signs | FREE | Off-chain |
| Client signs | FREE | Off-chain |
| Submit to chain | ~$0.00002 tx fee | Whoever submits (typically agent) |

#### PaymentVerified Mode

Alternative verification when agent signature is unavailable (agent unresponsive, or client preference).

**The insight:** On-chain payment receipt proves interaction occurred — no agent signature needed.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   Payment-Verified Flow                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Client pays Agent via x402 or direct transfer                   │
│  2. Payment creates on-chain record (tx signature)                  │
│  3. Client signs feedback:                                          │
│     client_sig = sign(hash(task_id, agent, score, timestamp))      │
│  4. Client (or anyone) submits to chain:                           │
│     submit_leaf(leaf_data, [client_sig], payment_proof)            │
│  5. On-chain/off-chain verification:                                │
│     - Verify client signature valid on keccak256(leaf_data)        │
│     - Payment proof stored in leaf for indexer verification        │
│     - Indexer validates payment_tx_sig is unique (deduplication)   │
│     - Indexer validates payment actually occurred                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Payment deduplication**: The `payment_tx_sig` in the leaf enables indexers to detect and ignore duplicate submissions for the same payment. No on-chain PDA needed — deduplication is handled at the indexing layer, preserving merkle batching economics.

#### Combined Mode

Both DualSignature AND PaymentVerified can be used together:

- Agent signature proves agent acknowledges the interaction
- Client signature proves client's feedback
- Payment proof provides immutable on-chain evidence of transaction

**Why this works:**
- Client gives feedback for free (no wallet transaction, just signature)
- Agent pays because reputation = more business
- Permissionless submission (anyone with required proofs can submit)
- Payment-verified path ensures censorship resistance (agent can't block feedback)

### Merkle Root Batching

Instead of individual attestations per feedback, SATI stores merkle roots:

| Approach | 1,000 Feedbacks | 1,000,000 Feedbacks |
|----------|-----------------|---------------------|
| Individual attestations | ~1.5 SOL | ~1,500 SOL |
| Merkle root (1 per agent) | ~0.002 SOL | ~0.002 SOL |

**Merkle Tree Properties:**
- Append-only (feedback history immutable)
- Verifiable via merkle proofs
- Data stored in events (blockchain is the storage)
- Indexers reconstruct full tree from event history

**Tree Depth Recommendation:**

| Depth | Max Leaves | Proof Size | On-chain Cost |
|-------|------------|------------|---------------|
| 16 | 65K | 512 bytes | 32 bytes (root only) |
| 24 | 16M | 768 bytes | 32 bytes (root only) |
| 32 | 4B | 1KB | 32 bytes (root only) |

**Recommended: Depth 32** (4 billion leaves per agent). Since only the root is stored on-chain (32 bytes), there's no cost difference between depths. Proof size (1KB for depth 32) is negligible.

**Batched Submission:**

Multiple feedbacks can be submitted in a single transaction:

```
N feedbacks → N FeedbackAdded events → 1 root update
```

| Constraint | Value |
|------------|-------|
| CU budget | ~1.4M |
| emit_cpi! per event | ~5K CU |
| Ed25519 verify (2 sigs/feedback) | ~2.8K CU |
| **Max feedbacks per tx** | ~150-180 (conservative) |

In practice, batch based on time/volume rather than maximizing per transaction.

**Note:** Batched submission (multiple feedbacks per transaction) is deferred for this version of the specification and will be considered in future updates.

### Merkle Tree Algorithm

SATI uses the Solana ecosystem standard for merkle trees:

- **Hash function:** Keccak-256 (`solana_program::keccak`)
- **Tree structure:** Binary, append-only, leaves indexed left-to-right
- **Compatibility:** Matches [SPL Account Compression](https://github.com/solana-labs/solana-program-library/tree/master/account-compression) and [Metaplex Bubblegum](https://github.com/metaplex-foundation/mpl-bubblegum)

See [Appendix B](#appendix-b-merkle-tree-implementation) for implementation code.

### Events for Indexing

Since individual leaves aren't stored on-chain (only the merkle root), SATI emits events via `emit_cpi!` for indexer consumption. These events are stored in transaction `meta.innerInstructions`, not program logs — ensuring they're never truncated.

#### LeafAdded (Generic)

All leaf types emit the same base event structure:

```
LeafAdded {
    // Common fields
    leaf_type: u8,            // 0=Feedback, 1=Validation, 2+=Future
    agent: Pubkey,
    counterparty: Pubkey,     // Client, validator, etc.
    task_id: [u8; 32],
    timestamp: i64,
    content_hash: [u8; 32],
    response_hash: [u8; 32],
    content_ref: [u8; 36],

    // Type-specific data (opaque, parsed by SDK based on leaf_type)
    type_data: Vec<u8>,

    // Signatures (for self-contained verification)
    signatures: Vec<SignerEntry>,  // [{pubkey, sig}, ...]

    // Payment proof (optional, for PaymentVerified mode)
    payment_proof: Option<PaymentProof>,
}
```

**Type-specific parsing by SDK:**

| leaf_type | type_data contains |
|-----------|-------------------|
| 0 (Feedback) | score, tag1, tag2 |
| 1 (Validation) | validation_type, status |

Events include signatures for self-contained verification — anyone can verify leaf authenticity directly from the event without trusting the indexer.

#### Convenience Type Aliases

For SDK ergonomics, the SDK provides typed wrappers:

```typescript
// SDK provides typed access
const event = parser.parseLeafAdded(rawEvent);

if (event.leafType === LeafType.Feedback) {
    const feedback: FeedbackLeaf = event.asFeedback();
    console.log(feedback.score, feedback.client);
}

if (event.leafType === LeafType.Validation) {
    const validation: ValidationLeaf = event.asValidation();
    console.log(validation.status, validation.validator);
}
```

### Indexing Architecture

SATI events are stored in transaction `innerInstructions`, requiring specific parsing.

**Recommended indexing approaches:**

| Method | Use Case | Provider |
|--------|----------|----------|
| Raw Webhooks | Real-time event streaming | Helius |
| `getTransactionsForAddress` | Historical backfill with filters | Helius (exclusive) |
| Yellowstone gRPC | High-throughput streaming | Helius/Triton |
| Custom RPC polling | Self-hosted infrastructure | Any |

**Event data location:**

```
transaction.meta.innerInstructions[].instructions[]
  → programIdIndex matches SATI program
  → data starts with EVENT_IX_TAG_LE (0x1d9acb512ea545e4)
  → remaining bytes are Borsh-encoded event
```

Since Anchor Issue #2609 remains open (no built-in CPI event subscription), the SATI SDK provides parsing utilities (see [SDK Interface](#sdk-interface)).

### Data Reconstruction

**The blockchain is the storage.** Individual leaf data is not stored separately on IPFS/Arweave — it's emitted in events and reconstructed by indexers.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Data Flow                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Leaf submitted → emit_cpi!(LeafAdded { ... })                   │
│                              ↓                                      │
│  2. Stored permanently in transaction.meta.innerInstructions        │
│                              ↓                                      │
│  3. Indexer parses events from blockchain history                   │
│                              ↓                                      │
│  4. Indexer reconstructs full merkle tree in database               │
│                              ↓                                      │
│  5. Indexer serves queries and merkle proofs                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why no separate storage?**
- Events in `innerInstructions` are permanent and immutable
- No data availability risk (blockchain is the source of truth)
- No pinning costs or availability dependencies
- Same pattern used by [Metaplex Bubblegum](https://github.com/metaplex-foundation/mpl-bubblegum) for cNFTs

**Indexer responsibilities:**
- Parse `LeafAdded` events from transaction history
- Maintain full merkle tree state per agent per leaf_type
- Verify event signatures match pubkeys in leaf data
- Verify payment proofs for PaymentVerified leaves (deduplication)
- Serve queries and merkle proofs

### Merkle Proof Serving

To verify a specific leaf exists in an agent's attestation root, clients need merkle proofs. The indexer generates and serves these proofs.

**Proof request flow:**

```
Client                          Indexer                         On-chain
   │                               │                               │
   │  "Prove leaf X in agent Y"    │                               │
   │──────────────────────────────▶│                               │
   │                               │                               │
   │                               │  (has full tree from events)  │
   │                               │                               │
   │  { proof: [...], leaf: {...} }│                               │
   │◀──────────────────────────────│                               │
   │                               │                               │
   │  Fetch AttestationRoot.merkle_root                            │
   │──────────────────────────────────────────────────────────────▶│
   │                               │                               │
   │  Verify: hash(leaf + proof) == root                           │
   │                               │                               │
```

**SDK interface:**

```typescript
// Get proof from indexer (works for any leaf type)
const { proof, leaf } = await sati.indexer.getLeafProof(agentMint, leafType, taskId);

// Verify against on-chain root
const root = await sati.getAttestationRoot(agentMint, leafType);
const valid = sati.verifyLeaf(root, proof, leaf);

// Convenience methods for specific leaf types
const { proof, leaf } = await sati.indexer.getFeedbackProof(agentMint, taskId);
const { proof, leaf } = await sati.indexer.getValidationProof(agentMint, taskId);
```

**On-chain verification (for escrow):**

Escrow contracts can verify proofs directly without trusting the indexer:

```rust
// Escrow receives proof + leaf, verifies against on-chain root
let root = get_attestation_root(agent_mint, leaf_type)?;
verify_merkle_proof(root.merkle_root, &proof, &leaf)?;

// Escrow parses leaf to verify semantic content
let feedback: FeedbackLeaf = parse_leaf(&leaf)?;
require!(feedback.counterparty == expected_client, InvalidClient);
```

This is analogous to Helius DAS API's `getAssetProof` for compressed NFTs.

### Escrow Integration

AttestationRoot (via ValidationRoot) enables automatic escrow release via merkle proofs:

```rust
// Escrow contract verifies validation before releasing funds
fn release_escrow(
    attestation_root: &AttestationRoot,  // ValidationRoot
    merkle_proof: Vec<[u8; 32]>,
    leaf_bytes: Vec<u8>,
) -> Result<()> {
    // Verify leaf is in merkle tree
    let leaf_hash = keccak256(&leaf_bytes);
    verify_merkle_proof(attestation_root.merkle_root, &merkle_proof, leaf_hash)?;

    // Parse and verify leaf content (escrow knows ValidationLeaf structure)
    let validation: ValidationLeaf = parse_leaf(&leaf_bytes)?;
    require!(validation.leaf_type == 1, InvalidLeafType);  // Must be validation
    require!(validation.status >= PASS_THRESHOLD, ValidationFailed);

    // Release escrow
    transfer_funds(escrow, recipient)?;

    Ok(())
}
```

### Content Reference Encoding

The `content_ref` field in FeedbackLeaf/ValidationLeaf is for **optional extended content** (e.g., written review text, detailed validation reports) that's too large for events. Core feedback data (score, tags, signatures) is always in events.

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

**Note:** Core feedback data lives in events (see [Data Reconstruction](#data-reconstruction)). `content_ref` is only for optional extended content that exceeds event size limits.

### Schema Data Sizes

| Schema | Data Size | Total (173 base + data) | Auth Mode |
|--------|-----------|-------------------------|-----------|
| FeedbackRoot | 80 bytes | 253 bytes | SingleSigner |
| ValidationRoot | 80 bytes | 253 bytes | SingleSigner |
| ReputationScore | 75 bytes | 248 bytes | SingleSigner |
| Certification | 42 bytes | 215 bytes | CredentialAuthority |

Note: FeedbackRoot and ValidationRoot use SingleSigner (agent only) at the root level. Dual-signature verification happens in leaves, validated via merkle proofs.

### Authority Separation

| Authority | Controls | Renounceable? |
|-----------|----------|---------------|
| Registry authority | `update_registry_authority()` | Yes |
| SAS credential authority | Schema creation | No (needed for versioning) |
| Schema signers | Per auth_mode configuration | N/A |

---

## Extensibility

The unified AttestationRoot/AttestationLeaf base types are designed for future extensibility. New leaf types and third-party credential registration are deferred — see [What's NOT Included (Yet)](#whats-not-included-yet).

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
  "endpoints": [
    { "name": "A2A", "endpoint": "https://agent.example/agent-card.json" },
    { "name": "agentWallet", "endpoint": "solana:5eykt4...:7S3P4..." }
  ],
  "registrations": [
    { "agentId": "sati:devnet:ABC123mint", "agentRegistry": "solana:devnet:satiFVb9..." }
  ]
}
```

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
- **Attestation** methods (type-specific helpers)
- **Query and verification** methods

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

### Leaf Submission Methods

Generic method and type-specific convenience helpers:

| Method | Description | Returns |
|--------|-------------|---------|
| `submitLeaf(params)` | Submit any leaf type to AttestationRoot | `{ attestation, leafIndex }` |
| `submitFeedback(params)` | Submit feedback (convenience wrapper) | `{ attestation, leafIndex }` |
| `submitValidation(params)` | Submit validation (convenience wrapper) | `{ attestation, leafIndex }` |
| `updateReputationScore(params)` | Provider updates their score for agent | `{ attestation }` |
| `createCertification(params)` | Create certification | `{ attestation }` |

**submitFeedback params:**

```typescript
await sati.submitFeedback({
  agentMint,
  client: clientPubkey,
  score: 85,
  tag1: TagCategory.Quality,
  tag2: TagCategory.Speed,
  contentHash: serviceHash,
  signatures: [agentSig, clientSig],  // DualSignature mode
  // OR
  signatures: [clientSig],            // PaymentVerified mode
  paymentProof: { txSig, amount, mint },
});
```

### Query Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getAttestationRoot(agent, leafType)` | Get AttestationRoot for agent and leaf type | `AttestationRoot \| null` |
| `getFeedbackRoot(agent)` | Get FeedbackRoot (convenience) | `AttestationRoot \| null` |
| `getValidationRoot(agent)` | Get ValidationRoot (convenience) | `AttestationRoot \| null` |
| `getReputationScore(agent, provider)` | Get provider's score for agent | `ReputationScore \| null` |
| `getCertification(attestation)` | Get certification data | `Certification \| null` |

### Indexer Query Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `indexer.getLeafProof(agent, leafType, taskId)` | Get merkle proof for any leaf | `{ proof, leaf }` |
| `indexer.getFeedbackProof(agent, taskId)` | Get merkle proof for feedback | `{ proof, leaf }` |
| `indexer.getValidationProof(agent, taskId)` | Get merkle proof for validation | `{ proof, leaf }` |
| `indexer.listLeaves(agent, leafType, params?)` | List leaves with pagination | `AttestationLeaf[]` |
| `indexer.listFeedbacks(agent, params?)` | List feedbacks (typed) | `FeedbackLeaf[]` |
| `indexer.listValidations(agent, params?)` | List validations (typed) | `ValidationLeaf[]` |
| `indexer.getAgentStats(agent)` | Get aggregated stats | `AgentStats` |

### Verification Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `verifyLeaf(root, proof, leaf)` | Verify any leaf in merkle tree | `boolean` |
| `verifyFeedback(root, proof, leaf)` | Verify feedback (convenience) | `boolean` |
| `verifyValidation(root, proof, leaf)` | Verify validation (convenience) | `boolean` |
| `verifySignatures(leaf, signatures)` | Verify signatures match leaf pubkeys | `boolean` |

**Note**: `revokeLeaf()` intentionally not supported — attestations are immutable for reputation integrity.

### Event Parsing Methods

Since SATI uses `emit_cpi!` for events, the SDK provides utilities to parse events from transactions:

| Method | Description | Returns |
|--------|-------------|---------|
| `parseTransaction(tx)` | Parse SATI events from `VersionedTransactionResponse` | `SatiEvent[]` |
| `parseWebhookPayload(payload)` | Parse events from Helius raw webhook payload | `SatiEvent[]` |

**Usage:**

```typescript
import { SatiEventParser, LeafType } from "@cascade-fyi/sati-sdk";

const parser = new SatiEventParser(SATI_PROGRAM_ID);

// From transaction signature
const tx = await connection.getTransaction(sig, {
  maxSupportedTransactionVersion: 0
});
const events = parser.parseTransaction(tx);

// Generic parsing with type dispatch
for (const event of events) {
  if (event.name === "LeafAdded") {
    const leaf = event.data;
    if (leaf.leafType === LeafType.Feedback) {
      const feedback = parser.asFeedback(leaf);
      console.log(feedback.score, feedback.counterparty);
    }
  }
}

// From Helius raw webhook
app.post('/webhook', (req) => {
  const events = parser.parseWebhookPayload(req.body);
  // Process events...
});
```

The parser filters `innerInstructions` for the SATI program, checks for the `EVENT_IX_TAG_LE` discriminator, and deserializes using the IDL's BorshCoder.

### Concurrency Handling

When multiple feedback submissions target the same agent's FeedbackRoot simultaneously, the second transaction may fail due to stale merkle root. The SDK handles this with optimistic concurrency:

**Why conflicts are rare:**
- Each agent has their own FeedbackRoot (no cross-agent conflicts)
- Typically one entity submits (agent or their batching service)
- Even with multiple submitters, ~400ms block time limits collision window

**Retry pattern:**

```typescript
// SDK internally handles retries
const result = await sati.submitFeedback({
  agentMint,
  feedback,
  maxRetries: 3,  // Default: 3
});

// Manual retry if needed
async function submitWithRetry(feedback: Feedback, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Fetch fresh merkle root
      const currentRoot = await sati.getFeedbackRoot(agentMint);

      // Build new tree with feedback appended
      const { newRoot, proof } = buildUpdatedTree(currentRoot, feedback);

      // Submit transaction
      return await sati.submitFeedback({ agentMint, feedback, expectedRoot: currentRoot });
    } catch (e) {
      if (e.code === 'STALE_MERKLE_ROOT' && attempt < maxRetries - 1) {
        // Root changed, retry with fresh state
        continue;
      }
      throw e;
    }
  }
}
```

**Error codes:**

| Code | Meaning | Action |
|------|---------|--------|
| `STALE_MERKLE_ROOT` | Root changed between fetch and submit | Retry with fresh root |
| `INVALID_MERKLE_PROOF` | Proof doesn't verify against root | Bug in tree construction |

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

### SAS Security

| Aspect | Guarantee |
|--------|-----------|
| Dual-signature | Ed25519 verification on-chain via Solana's native program |
| Expiry | Built into SAS primitive |
| Schema validation | SAS validates data against schema |
| Merkle proofs | Cryptographic verification of feedback/validation inclusion |

### Signature Security

| Aspect | Guarantee |
|--------|-----------|
| Ed25519 verification | ~1400 CU per signature via Solana's ed25519_program |
| Replay protection | Task IDs + merkle tree append-only property |
| Signer binding | Signatures verified against fixed positions in attestation data |

### Governance Security

| Aspect | Approach |
|--------|----------|
| Multisig authority | Registry and SAS credential use Squads smart accounts |
| Immutability option | Can renounce authority after stable |
| Separation of concerns | Registry vs SAS credential managed independently |

### Multi-Credential Security

| Aspect | Guarantee |
|--------|-----------|
| Credential isolation | Each credential has separate `authorized_signers` |
| Registration verification | Registry verifies it's in credential's `authorized_signers` before accepting |
| Owner control | Only registration owner can deregister their credential |
| Schema validation | SAS validates attestation data against schema |

**Trust model:**
- Third parties trust SATI Registry to only sign valid attestation requests
- SATI trusts registered credentials to manage their own schemas correctly
- Users trust the indexer to accurately represent attestation data

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

| Category | Operation | Rent (SOL) | CU | Notes |
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
| **Reputation (per agent)** | | | | |
| | Create FeedbackRoot | ~0.0018 | ~30,000 | One-time per agent (253 bytes) |
| | Create ValidationRoot | ~0.0018 | ~30,000 | One-time per agent (253 bytes) |
| | Submit feedback | tx fee | ~40,000 | Merkle root update + event |
| | Submit validation | tx fee | ~40,000 | Merkle root update + event |
| **Scores & Certs** | | | | |
| | Create ReputationScore | ~0.0017 | ~30,000 | One-time per provider+agent (248 bytes) |
| | Update ReputationScore | tx fee | ~30,000 | Close+create (rent neutral) |
| | Create Certification | ~0.0015 | ~30,000 | SAS attestation (215 bytes) |
| **Per-operation overhead** | | | | |
| | emit_cpi! (per event) | — | ~5,000 | Reliable event delivery |
| | Ed25519 verify (per sig) | — | ~1,400 | Signature verification |
| | CPI to SAS | — | ~10-15K | Permissionless proxy overhead |

**Key insights:**
- Registration costs are rent deposits (recoverable when burned)
- Feedback submission is essentially free (tx fee only ~0.00001 SOL)
- CPI overhead (~10-15K CU) is negligible (~1% of 1.4M budget)
- FeedbackRoot/ValidationRoot are one-time per agent, not per feedback

*See [benchmarks/](./benchmarks/) for detailed measurements and methodology.*

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
| Public reviews (no agent signature) | Deferred | Spam risk without interaction proof |
| Third-party credential system | Deferred | Platform model; add when demand exists |
| Agent→Agent delegation | Future | New leaf type when needed |
| Mandates / AP2 lifecycle | Future | New leaf type when needed |
| On-chain aggregation | By design | Merkle roots on-chain; leaves indexed off-chain |

**Third-party credential system:**

The spec is designed to support external projects registering their own SAS credentials with SATI for permissionless attestation creation and unified indexing. This "SATI as platform" model adds complexity (extra instructions, account types, indexer logic) without immediate value. Will be added when third parties express demand.

**Public reviews:**

Public reviews (client-only signature) would allow feedback without proving interaction. Deferred due to spam/sybil risk. May revisit with reputation-weighted filtering in v2.

**Future leaf types:**

The unified AttestationRoot/AttestationLeaf design supports adding DelegationLeaf, MandateLeaf, etc. via new `leaf_type` values without program changes. Will be specified when use cases emerge.

---

## Summary

SATI solves the economics of on-chain agent reputation:

- **Free feedback for clients** — Dual-signature enables agent-subsidized submission
- **Censorship-resistant** — PaymentVerified mode ensures clients can always submit feedback
- **Infinite scale** — Merkle root batching: millions of feedbacks at fixed cost (80 bytes per agent)
- **No monopoly** — Multiple reputation providers compete with different algorithms
- **Escrow integration** — Merkle proofs enable automatic escrow release

**Architecture highlights:**

| Concept | Description |
|---------|-------------|
| **Opaque data + signatures** | Program verifies signatures on `keccak256(data)`, never parses content |
| **Unified base types** | AttestationRoot/AttestationLeaf shared by all merkle-based schemas |
| **Semantic verification** | Indexers and escrows parse leaves, verify pubkeys match signatures |

**Core schemas:**

| Schema | Derives From | Auth Mode | Key Feature |
|--------|--------------|-----------|-------------|
| FeedbackRoot | AttestationRoot | DualSig/PaymentVerified | Free for clients, censorship-resistant |
| ValidationRoot | AttestationRoot | DualSignature | Enables escrow release |
| ReputationScore | — | SingleSigner | Provider-owned, no monopoly |
| Certification | — | CredentialAuthority | Immutable proof |

| Component | Technology | Status |
|-----------|------------|--------|
| Registry | SATI Registry Program (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`) | Deployed |
| Identity | Token-2022 NFT + TokenMetadata + TokenGroup | Available |
| Core Schemas | FeedbackRoot, ValidationRoot, ReputationScore, Certification | To deploy |
| Authorization | SchemaConfig with AuthMode | To implement |
| Indexer | Merkle proofs + payment deduplication | To implement |
| Smart accounts | Native Token-2022 support | Available |

---

## References

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Token-2022 Program](https://github.com/solana-program/token-2022)
- [Token Metadata Interface](https://github.com/solana-program/token-metadata)
- [Token Group Interface](https://github.com/solana-program/token-group)
- [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service)
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
  "supportedTrust": ["reputation", "validation"]
}
```

---

## Appendix B: Merkle Tree Implementation

Reference implementation for SATI merkle trees.

### Leaf Hashing

```rust
use solana_program::keccak;

fn hash_leaf(leaf: &AttestationLeaf) -> [u8; 32] {
    // Borsh serialize, then Keccak-256 hash
    keccak::hashv(&[&leaf.try_to_vec().unwrap()]).to_bytes()
}
```

### Parent Hashing

```rust
fn hash_parent(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    keccak::hashv(&[left, right]).to_bytes()
}
```

### Proof Verification

```rust
fn verify_proof(
    leaf: [u8; 32],
    proof: &[[u8; 32]],
    index: u32,
    root: [u8; 32]
) -> bool {
    let mut current = leaf;
    for (depth, sibling) in proof.iter().enumerate() {
        let is_left = (index >> depth) & 1 == 0;
        current = if is_left {
            hash_parent(&current, sibling)
        } else {
            hash_parent(sibling, &current)
        };
    }
    current == root
}
```

### Tree Structure

- Binary merkle tree (each node has 0 or 2 children)
- Leaves indexed left-to-right starting at 0
- Append-only (new leaves get next available index)
- Left child: `2 * parent_index`
- Right child: `2 * parent_index + 1`
