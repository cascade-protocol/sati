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
- **Infinite scale at fixed cost** — Merkle root batching stores millions of feedbacks in 112 bytes
- **No reputation monopoly** — Multiple providers compete with different scoring algorithms
- **Composable authorization** — Schema-defined auth modes for any trust use case

Built on:
- **SATI Registry Program** — Canonical agent registration + permissionless attestation proxy
- **Token-2022** — Agent identity as NFTs with native metadata
- **Solana Attestation Service (SAS)** — Attestation storage with coming ZK compression

Third parties can register credentials to gain permissionless attestation creation, unified indexing, and SDK support without building infrastructure.

This architecture is **compression-ready** — when SAS ships ZK-compressed attestations, costs drop ~100x with no changes to SATI.

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

### The Math

| Approach | Cost per Feedback | 10K Feedbacks | Who Pays |
|----------|-------------------|---------------|----------|
| Client pays (naive) | ~$0.40 | Dead system | Nobody shows up |
| Agent subsidizes | ~$0.40 | $4,000 | Agent (cost of business) |
| With ZK compression | ~$0.004 | $40 | Agent (negligible) |

At scale with compression, feedback becomes nearly free infrastructure.

---

## Table of Contents

1. [Motivation](#motivation)
2. [Architecture](#architecture)
3. [Registry Program](#registry-program)
4. [Identity: Token-2022 NFT](#identity-token-2022-nft)
5. [Reputation & Validation: SAS](#reputation--validation-sas)
6. [Extensibility: Building on SATI](#extensibility-building-on-sati)
7. [SDK Interface](#sdk-interface)
8. [Security Considerations](#security-considerations)
9. [Deployment](#deployment)
10. [Governance](#governance)
11. [Cross-Chain Interoperability](#cross-chain-interoperability)
12. [What's NOT Included (Yet)](#whats-not-included-yet)
13. [Scalability: ZK Compression](#scalability-zk-compression)
14. [Summary](#summary)
15. [References](#references)

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
- **ZK compression** — Automatic cost reduction when SAS ships compression

**Core schemas** (FeedbackRoot, ValidationRoot, ReputationScore, Certification) implement the economics-first trust model: dual-signature for agent-subsidized feedback, merkle root batching for infinite scale, and multi-provider reputation to prevent monopolies. Third parties can register their own credentials for custom trust applications.

### Why v2?

SATI v1 proposed custom programs with built-in ZK compression. Analysis revealed a better path:

1. **Delegate compression to SAS**: SAS is adding ZK-compressed attestations ([PR #101](https://github.com/solana-foundation/solana-attestation-service/pull/101)). SATI benefits automatically.
2. **Minimal custom code**: Token-2022 + SAS already provide needed primitives
3. **Ship now, scale later**: Launch with PDAs today, gain 100x cost reduction when SAS compression ships
4. **Avoid audit burden**: Custom compression code = more attack surface

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
│  register_credential()       → Register external SAS credential     │
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
│  • Identity storage      │    │                  │                  │
│  • TokenMetadata         │    │    ┌─────────────┼─────────────┐    │
│  • TokenGroup            │    │    ▼             ▼             ▼    │
│  • Direct updates/xfers  │    │ ┌───────┐   ┌───────┐   ┌───────┐  │
└──────────────────────────┘    │ │ SATI  │   │Proj A │   │Proj B │  │
                                │ │ Cred  │   │ Cred  │   │ Cred  │  │
                                │ │(Core) │   │(Their)│   │(Their)│  │
                                │ └───────┘   └───────┘   └───────┘  │
                                └─────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **SATI Registry** | Canonical entry point, agent registration, credential registration, CPI proxy for attestations |
| **Token-2022** | Identity storage, metadata, transfers (direct calls) |
| **SAS** | Attestation storage for all registered credentials |
| **SATI Indexer** | Indexes all registered credentials, provides unified queries |

---

## Registry Program

### Overview

The SATI Registry is a minimal program that:
- Provides a **canonical program address** (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`)
- Holds TokenGroup `update_authority` as a PDA
- Enables **permissionless, atomic agent registration**
- Enables **credential registration** for third-party trust applications
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

#### CredentialRegistration

PDA seeds: `["credential", credential_pubkey]`

| Field | Type | Description |
|-------|------|-------------|
| `credential` | Pubkey | SAS credential address |
| `owner` | Pubkey | Who registered (for deregistration) |
| `registered_at` | i64 | Registration timestamp |
| `active` | bool | Active status |
| `bump` | u8 | PDA bump seed |

**Size**: 82 bytes (8 discriminator + 32 + 32 + 8 + 1 + 1)

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

| Variant | Value | Description | Signer Positions |
|---------|-------|-------------|------------------|
| `DualSignature` | 0 | Requires two off-chain signatures, anyone can submit | data[0..32], data[32..64] |
| `SingleSigner` | 1 | Requires one off-chain signature from signer in data | data[0..32] |
| `CredentialAuthority` | 2 | Uses SAS credential's authorized_signers (traditional) | N/A |

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

#### register_credential

Register an external SAS credential with SATI infrastructure.

| Parameter | Type | Description |
|-----------|------|-------------|
| `credential` | Pubkey | SAS credential to register |

**Preconditions**:
- Credential must exist in SAS
- Caller must be credential authority
- Registry PDA must already be in credential's `authorized_signers`

**Behavior**:
- Creates CredentialRegistration PDA
- Verifies Registry PDA is in credential's authorized_signers
- Emits `CredentialRegistered` event

#### deregister_credential

Remove credential from SATI infrastructure.

| Parameter | Type | Description |
|-----------|------|-------------|
| `credential` | Pubkey | SAS credential to deregister |

**Preconditions**:
- Caller must be registration owner

**Behavior**:
- Sets `active = false` on CredentialRegistration
- Emits `CredentialDeregistered` event

#### create_attestation

Create attestation with authorization proof.

| Parameter | Type | Description |
|-----------|------|-------------|
| `credential` | Pubkey | Target SAS credential |
| `schema` | Pubkey | Target SAS schema |
| `data` | Vec<u8> | Attestation data (schema-specific) |
| `nonce` | [u8; 32] | Attestation nonce |
| `signatures` | Vec<Signature> | Authorization signatures per schema's auth_mode |
| `token_account` | Option<Pubkey> | SAS token_account field (typically agent_mint) |
| `expiry` | Option<i64> | SAS expiry field |

**Signature struct**: `{ pubkey: Pubkey, sig: [u8; 64] }`

**Preconditions**:
- Credential must be registered and active
- Schema must belong to credential
- SchemaConfig must exist for schema
- Signatures must be valid per auth_mode:
  - `DualSignature`: 2 signatures, sig[0].pubkey == data[0..32], sig[1].pubkey == data[32..64]
  - `SingleSigner`: 1 signature, sig[0].pubkey == data[0..32]
  - `CredentialAuthority`: 0 signatures (uses traditional SAS auth)

**Behavior**:
- Verifies ed25519 signatures against pubkeys in data (if applicable)
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

### Credential Architecture

SATI uses a multi-credential model where both core schemas and third-party schemas coexist:

| Credential Type | Owner | Purpose |
|-----------------|-------|---------|
| **SATI Core** | SATI governance | Agent reputation with economics-first design |
| **Third-party** | External projects | Custom trust applications |

All registered credentials share:
- Permissionless attestation creation via SATI Registry CPI
- Unified indexing by SATI indexer
- SDK support for attestation operations

### Core Schemas

SATI provides four core schemas for agent trust:

| Schema | What It Stores | Auth Model | Why It Matters |
|--------|---------------|------------|----------------|
| **FeedbackRoot** | Merkle root of client feedbacks | Dual-signature | Free for clients, scales infinitely |
| **ValidationRoot** | Merkle root of validations | Dual-signature | Enables automatic escrow release |
| **ReputationScore** | Provider's computed score | Single-signer | No monopoly — providers compete |
| **Certification** | Third-party attestations | Credential authority | Immutable proof of audit/compliance |

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

#### FeedbackRoot

Merkle root of all client feedbacks for an agent. Uses dual-signature: agent signs service receipt, client signs rating.

**Data Layout** (signers at fixed positions for verification):

| Bytes | Field | Type | Description |
|-------|-------|------|-------------|
| 0-31 | `agent` | Pubkey | Agent who received service (signer A) |
| 32-63 | `client` | Pubkey | Client who gave feedback (signer B) |
| 64-95 | `merkle_root` | [u8; 32] | Root of feedback merkle tree |
| 96-103 | `count` | u64 | Total feedbacks in tree |
| 104-111 | `last_updated` | i64 | Timestamp of last update |

**Total data size**: 112 bytes

**Attestation config**:
- `token_account` = agent_mint
- `nonce` = agent_mint (deterministic: one FeedbackRoot per agent)

**Off-chain Feedback Leaf** (stored in merkle tree):
```
FeedbackLeaf {
    task_id: [u8; 32],        // Unique task identifier
    agent: Pubkey,            // Agent pubkey
    client: Pubkey,           // Client pubkey
    score: u8,                // 0-100 rating
    tag1: u8,                 // Primary category
    tag2: u8,                 // Secondary category
    timestamp: i64,           // When feedback given
    service_hash: [u8; 32],   // Hash of service details
    agent_sig: [u8; 64],      // Agent signs: hash(task_id, client, service_hash)
    client_sig: [u8; 64],     // Client signs: hash(task_id, agent, score, timestamp)
    content_ref: [u8; 36],    // Off-chain content reference
}
```

#### ValidationRoot

Merkle root of all validations for an agent. Uses dual-signature: agent signs work, validator signs verification.

**Data Layout**:

| Bytes | Field | Type | Description |
|-------|-------|------|-------------|
| 0-31 | `agent` | Pubkey | Agent whose work was validated (signer A) |
| 32-63 | `validator` | Pubkey | Validator who verified (signer B) |
| 64-95 | `merkle_root` | [u8; 32] | Root of validation merkle tree |
| 96-103 | `count` | u64 | Total validations in tree |
| 104-111 | `last_updated` | i64 | Timestamp of last update |

**Total data size**: 112 bytes

**Attestation config**:
- `token_account` = agent_mint
- `nonce` = agent_mint (deterministic: one ValidationRoot per agent)

**Off-chain Validation Leaf**:
```
ValidationLeaf {
    task_id: [u8; 32],        // Unique task identifier
    agent: Pubkey,            // Agent pubkey
    validator: Pubkey,        // Validator pubkey
    validation_type: u8,      // 0=tee, 1=zkml, 2=reexecution, 3=consensus
    status: u8,               // 0=fail, 100=pass
    timestamp: i64,           // When validated
    work_hash: [u8; 32],      // Hash of work being validated
    agent_sig: [u8; 64],      // Agent signs: hash(task_id, validator, work_hash)
    validator_sig: [u8; 64],  // Validator signs: hash(task_id, agent, status)
    response_hash: [u8; 32],  // Hash of detailed response
}
```

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

### Dual-Signature Model

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
│     agent_sig = sign(hash(task_id, client, service_hash))          │
│  3. Client signs feedback (FREE — just a signature):                │
│     client_sig = sign(hash(task_id, agent, score, timestamp))      │
│  4. Agent (or facilitator) submits to chain and pays:              │
│     update_attestation(FeedbackRoot, new_data, [sigs], merkle_proof)│
│  5. On-chain verification:                                          │
│     - Verify agent_sig against data[0..32]                         │
│     - Verify client_sig against data[32..64]                       │
│     - Verify merkle proof                                           │
│     - Update FeedbackRoot attestation                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this works:**
- Client gives feedback for free (no wallet transaction, just signature)
- Agent pays because reputation = more business
- Permissionless submission (anyone with both sigs can submit)
- Embedded proof of service (agent signature proves interaction occurred)

### Merkle Root Batching

Instead of individual attestations per feedback, SATI stores merkle roots:

| Approach | 1,000 Feedbacks | 1,000,000 Feedbacks |
|----------|-----------------|---------------------|
| Individual attestations | ~1.5 SOL | ~1,500 SOL |
| Merkle root (1 per agent) | ~0.002 SOL | ~0.002 SOL |

**Merkle Tree Properties:**
- Append-only (feedback history immutable)
- Verifiable via merkle proofs
- Off-chain storage (IPFS, Arweave) with on-chain root

### Events for Indexing

Since individual feedbacks aren't on-chain, SATI emits events for indexer consumption:

```
FeedbackAdded {
    agent: Pubkey,
    client: Pubkey,
    task_id: [u8; 32],
    score: u8,
    tag1: u8,
    tag2: u8,
    timestamp: i64,
    content_ref: [u8; 36],
}

ValidationAdded {
    agent: Pubkey,
    validator: Pubkey,
    task_id: [u8; 32],
    validation_type: u8,
    status: u8,
    timestamp: i64,
}
```

### Escrow Integration

ValidationRoot enables automatic escrow release via merkle proofs:

```rust
// Escrow contract verifies validation before releasing funds
fn release_escrow(
    validation_root: &ValidationRoot,
    merkle_proof: Vec<[u8; 32]>,
    validation_leaf: ValidationLeaf,
) -> Result<()> {
    // Verify leaf is in ValidationRoot
    verify_merkle_proof(validation_root.merkle_root, &merkle_proof, &validation_leaf)?;

    // Check validation passed
    require!(validation_leaf.status >= PASS_THRESHOLD, ValidationFailed);

    // Release escrow
    transfer_funds(escrow, recipient)?;

    Ok(())
}
```

### Content Reference Encoding

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
| `0x00` | Raw | SHA-256 hash |

### Schema Data Sizes

| Schema | Data Size | Total (173 base + data) | Auth Mode |
|--------|-----------|-------------------------|-----------|
| FeedbackRoot | 112 bytes | 285 bytes | DualSignature |
| ValidationRoot | 112 bytes | 285 bytes | DualSignature |
| ReputationScore | 75 bytes | 248 bytes | SingleSigner |
| Certification | 42 bytes | 215 bytes | CredentialAuthority |

### Authority Separation

| Authority | Controls | Renounceable? |
|-----------|----------|---------------|
| Registry authority | `update_registry_authority()` | Yes |
| SAS credential authority | Schema creation | No (needed for versioning) |
| Schema signers | Per auth_mode configuration | N/A |

---

## Extensibility: Building on SATI

### SATI as Infrastructure

SATI provides trust attestation infrastructure that third parties can build on:

| Benefit | Description |
|---------|-------------|
| **Permissionless attestations** | Anyone can create attestations without pre-authorization |
| **Unified indexing** | All registered credentials indexed by SATI indexer |
| **SDK support** | Use SATI SDK for attestation operations |
| **ZK compression** | Automatic ~100x cost reduction when SAS ships compression |

### Registering Your Credential

To use SATI infrastructure with your own credential:

**Step 1: Create SAS Credential**
```
Create your credential via SAS create_credential instruction
```

**Step 2: Add Registry PDA to Authorized Signers**
```
Add SATI Registry PDA to your credential's authorized_signers
PDA seeds: ["registry"] with program satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF
```

**Step 3: Register with SATI**
```
Call sati.registerCredential(yourCredential)
```

**Step 4: Create Schemas**
```
Create schemas under your credential via SAS (direct call, you control this)
```

**Step 5: Use SATI for Attestations**
```
Call sati.createAttestation({ credential, schema, data, ... })
```

### Architecture

```
Your Credential (owned by you)
    │
    ├── Your Schema 1
    ├── Your Schema 2
    └── authorized_signers: [your_authority, SATI_REGISTRY_PDA]
                                                    │
                                                    ▼
                                  ┌───────────────────────────┐
                                  │ SATI Registry (CPI Proxy) │
                                  │  • Validates registration  │
                                  │  • Signs attestations      │
                                  │  • Emits events            │
                                  └───────────────────────────┘
```

### Core vs Third-Party

| Aspect | SATI Core Schemas | Third-Party Schemas |
|--------|-------------------|---------------------|
| Governance | SATI multisig | Your control |
| Schema definition | Economics-first trust model | Your design |
| Indexer support | Full semantic understanding | Generic attestation indexing |
| SDK helpers | Dedicated methods (`submitFeedback()`) | Generic `createAttestation()` |
| Auth modes | Pre-configured (DualSig, SingleSigner) | Configure via `register_schema_config()` |

### Why Register with SATI?

Without SATI registration, you would need to:
- Manage your own `authorized_signers` list (add every user who can create attestations)
- Build your own permissionless creation mechanism
- Build your own indexer
- Build your own SDK

With SATI registration:
- Registry PDA signs on behalf of any caller (permissionless)
- Unified indexing across all registered credentials
- SDK works out of the box
- Automatic ZK compression when available

---

## Cross-Chain Interoperability

SATI agents can operate across chains using standard identity formats.

### Registration File Format

Agents use a standard JSON registration file for cross-chain discovery:

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

This format is shared with Ethereum agent registries, enabling cross-chain agent discovery.

### CAIP and DID Support

SATI uses [Chain Agnostic Improvement Proposals](https://github.com/ChainAgnostic/CAIPs) for cross-chain interoperability:

#### CAIP-2: Blockchain ID

Chain identifiers follow CAIP-2 format: `namespace:reference`

| Chain | CAIP-2 Identifier |
|-------|-------------------|
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Ethereum Mainnet | `eip155:1` |
| Base | `eip155:8453` |

#### CAIP-10: Account ID

Account identifiers follow CAIP-10 format: `chain_id:account_address`

```
// Solana account on mainnet:
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv

// Ethereum account:
eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7
```

#### DID Support

Agents can advertise DIDs via `additionalMetadata`:

```typescript
// Supported DID methods:
["did", "did:web:agent.example.com"]           // Web-based DID
["did", "did:pkh:solana:5eykt4...:7S3P4..."]   // PKH (blockchain account)
["did", "did:key:z6Mkf..."]                    // Key-based DID
```

#### SATI Canonical Identifier

SATI uses a custom format for agent identification following CAIP-2 patterns:

```
sati:<network>:<mint_address>

// Examples:
sati:mainnet:ABC123mintPubkey
sati:devnet:XYZ789mintPubkey
```

The registry program address is stored separately in the `agentRegistry` field using CAIP-2 format:

```json
{
  "agentId": "sati:devnet:ABC123mintPubkey",
  "agentRegistry": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF"
}
```

This separation allows:
- Compact agent identifiers (no redundant registry in every reference)
- Clear CAIP-2 compliance for registry addresses
- Flexibility for multi-registry scenarios

This format is used in:
- `registrations[]` array in registration files
- Cross-chain agent resolution
- Event indexing

---

## SDK Interface

The TypeScript SDK (`@cascade-fyi/sati-sdk`) provides:
- **Agent identity** operations (Token-2022)
- **Core reputation** methods (FeedbackAuth, Feedback, etc.) for SATI schemas
- **Infrastructure** methods for third-party credentials

### Registry Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `registerAgent(params)` | Create Token-2022 NFT with metadata + group membership | `{ mint, memberNumber }` |

### Infrastructure Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `registerCredential(credential)` | Register external SAS credential with SATI | `{ registration }` |
| `deregisterCredential(credential)` | Deregister credential | `void` |
| `listRegisteredCredentials()` | List all registered credentials | `CredentialRegistration[]` |
| `createAttestation(params)` | Create attestation for any registered credential | `{ attestation }` |

### Identity Methods (Direct Token-2022)

| Method | Description | Returns |
|--------|-------------|---------|
| `loadAgent(mint)` | Load agent identity by mint | `AgentIdentity \| null` |
| `updateAgentMetadata(mint, updates)` | Update name, uri, or additionalMetadata | `void` |
| `transferAgent(mint, newOwner)` | Transfer agent to new owner | `void` |
| `getAgentOwner(mint)` | Get current owner | `PublicKey` |
| `listAgents(params?)` | List agents with pagination | `AgentIdentity[]` |

### Trust Methods (SAS)

| Method | Description | Returns |
|--------|-------------|---------|
| `submitFeedback(params)` | Submit dual-signed feedback to FeedbackRoot | `{ attestation, leafIndex }` |
| `submitValidation(params)` | Submit dual-signed validation to ValidationRoot | `{ attestation, leafIndex }` |
| `updateReputationScore(params)` | Provider updates their score for agent | `{ attestation }` |
| `createCertification(params)` | Create certification (security-audit, kyc, etc.) | `{ attestation }` |

### Query Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getFeedbackRoot(agent)` | Get FeedbackRoot for agent | `FeedbackRoot \| null` |
| `getValidationRoot(agent)` | Get ValidationRoot for agent | `ValidationRoot \| null` |
| `getReputationScore(agent, provider)` | Get provider's score for agent | `ReputationScore \| null` |
| `getCertification(attestation)` | Get certification data | `Certification \| null` |

### Verification Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `verifyFeedback(root, proof, leaf)` | Verify feedback in merkle tree | `boolean` |
| `verifyValidation(root, proof, leaf)` | Verify validation in merkle tree | `boolean` |

**Note**: `revokeFeedback()` intentionally not supported — feedback is immutable for reputation integrity.

### Third-Party Usage

Third parties can use SATI infrastructure with their own credentials:

```typescript
// Register your credential with SATI
await sati.registerCredential(myCredential);

// Create attestation under your schema
await sati.createAttestation({
  credential: myCredential,
  schema: mySchema,
  data: mySchemaData,
  nonce: randomBytes(32),
  tokenAccount: optionalPubkey,
  expiry: optionalTimestamp,
});

// Query attestations via indexer
const attestations = await sati.indexer.query({
  credential: myCredential,
  schema: mySchema,
});
```

Core SATI methods (`giveFeedback()`, `createCertification()`, etc.) internally use `createAttestation()` with the SATI Core credential.

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

#### Schema Optimizations Preserved

All schema efficiency improvements operate at the SAS attestation level and are unaffected by CPI routing:

| Optimization | Layer | Affected by CPI? |
|--------------|-------|------------------|
| `token_account` for agent_mint | SAS storage | No |
| `expiry` for authorization | SAS storage | No |
| `signer` for client identity | SAS storage | No |
| Reduced schema data sizes | SAS storage | No |

#### CPI Overhead

The CPI proxy pattern adds compute overhead for permissionless attestation creation:

| Call Path | CUs | Notes |
|-----------|-----|-------|
| Direct SAS `create_attestation` | ~15,000-20,000 | Not available (requires authorized_signers) |
| Via Registry CPI proxy | ~25,000-35,000 | Permissionless |
| **Overhead** | ~10,000-15,000 | ~0.7-1% of budget |

This overhead is the cost of permissionless infrastructure — negligible relative to rent costs and well within budget.

#### Compute Units (Benchmarked)

| Operation | CUs | % of 1.4M Budget |
|-----------|-----|------------------|
| initialize | 10,918 | 0.8% |
| register_agent (minimal) | 58,342 | 4.2% |
| register_agent (3 metadata fields) | 82,877 | 5.9% |
| register_agent (max 10 fields) | 168,097 | 12.0% |
| register_agent (soulbound) | 79,255 | 5.7% |
| update_registry_authority | 3,516 | 0.3% |
| register_credential | ~10,000 | 0.7% |
| create_attestation (via CPI) | ~30,000 | 2.1% |

*See [benchmarks/](./benchmarks/) for detailed measurements and methodology.*

#### Rent Costs (Estimated)

**One-time costs:**

| Operation | Cost | Notes |
|-----------|------|-------|
| Initialize registry | ~0.005 SOL | One-time |
| Setup SAS credential | ~0.003 SOL | One-time per credential |
| Setup SAS schemas (4 core) | ~0.012 SOL | One-time |
| Register credential | ~0.001 SOL | One-time per third-party |
| Register schema config | ~0.0003 SOL | One-time per schema |

**Per-operation costs:**

| Operation | Cost | Notes |
|-----------|------|-------|
| Register agent (minimal) | ~0.003 SOL | Mint + metadata + group member |
| Register agent (3 fields) | ~0.0035 SOL | +additional metadata |
| Register agent (10 fields) | ~0.005 SOL | Maximum metadata |
| Update metadata | ~0.00001 SOL | Transaction fee only |
| Transfer agent | ~0.00001 SOL | Transaction fee only |
| Create FeedbackRoot | ~0.002 SOL | One-time per agent (285 bytes) |
| Create ValidationRoot | ~0.002 SOL | One-time per agent (285 bytes) |
| Submit feedback | ~0.00001 SOL | Merkle root update (tx fee only) |
| Submit validation | ~0.00001 SOL | Merkle root update (tx fee only) |
| Create ReputationScore | ~0.0017 SOL | One-time per provider+agent (248 bytes) |
| Update ReputationScore | ~0.00001 SOL | Close+create (rent neutral, tx fee) |
| Certification | ~0.0015 SOL | SAS attestation (215 bytes) |

#### Cost Summary

| Aspect | Impact |
|--------|--------|
| Schema data sizes | **Unchanged** (optimizations preserved) |
| Rent costs | **Unchanged** (based on account size) |
| Compute costs | **+10-15K CU** per attestation (~1% budget) |
| New one-time costs | **~0.001 SOL** per registered credential |

When SAS ships ZK compression, cost reductions apply equally to CPI-proxied calls. The CPI overhead becomes even more negligible relative to the ~100x rent savings.

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

### Credential Governance

| Credential | Authority | Upgradeable? |
|------------|-----------|--------------|
| SATI Core | SATI multisig → immutable | Schemas versioned, not upgraded |
| Third-party | Their control | Their decision |

**Core schema changes** require new schema versions (e.g., Feedback_v2), preserving existing attestations.

**Third-party credentials** are fully controlled by their owners. SATI only provides infrastructure, not governance over third-party schemas.

---

## What's NOT Included (Yet)

| Feature | Status |
|---------|--------|
| ZK Compression | Automatic when SAS ships [PR #101](https://github.com/solana-foundation/solana-attestation-service/pull/101) — no SATI changes needed |
| Mandates / AP2 lifecycle | Can add via SAS schemas when demand emerges |
| User→Agent delegation | Can add via SAS schemas if needed |
| On-chain aggregation | Indexer is standard Solana pattern; compression enables richer on-chain analysis |
| Wrapped metadata/transfer | Direct Token-2022 calls are simpler |

The SAS-based architecture means new capabilities can be added as schemas without breaking changes or program upgrades.

---

## Scalability: ZK Compression

### Why Compression Matters

Systems constrained by storage costs store only aggregates (averages, counts). With compressed attestations, SATI can store **complete feedback histories** on-chain, enabling:

| Capability | Without Compression | With Compression |
|------------|---------------------|------------------|
| Feedback storage | Aggregates only (gas prohibitive) | Complete history |
| Spam detection | Off-chain heuristics | On-chain pattern analysis |
| Reviewer reputation | Trust all equally | Weight by reviewer quality |
| Time-decay scoring | Not practical | Recent feedback weighted higher |
| Scale | ~10K feedbacks practical | 1M+ feedbacks practical |

### SAS Compressed Attestations

SAS [PR #101](https://github.com/solana-foundation/solana-attestation-service/pull/101) adds three instructions via Light Protocol integration:

| Instruction | Purpose |
|-------------|---------|
| `CreateCompressedAttestation` | Create attestation as compressed account (~100x cheaper) |
| `CloseCompressedAttestation` | Close compressed attestation |
| `CompressAttestations` | Batch-migrate existing PDAs to compressed (reclaims rent) |

**Cost comparison:**

| Operation | PDA Attestation | Compressed Attestation |
|-----------|-----------------|------------------------|
| Feedback | ~0.0015 SOL | ~0.000015 SOL |
| 1,000 feedbacks | ~1.5 SOL | ~0.015 SOL |
| 100,000 feedbacks | ~150 SOL | ~1.5 SOL |
| 1,000,000 feedbacks | ~1,500 SOL | ~15 SOL |

### SATI Integration Path

**No SATI code changes required.** When SAS ships compressed attestations:

1. **SDK update only** — Use `CreateCompressedAttestation` instead of `CreateAttestation` where applicable
2. **Migration optional** — Existing PDA attestations continue working; can batch-compress to reclaim rent
3. **Already optimized** — Merkle root batching means individual feedbacks are already off-chain

**Recommended pattern post-compression:**

| Schema | Storage | Reason |
|--------|---------|--------|
| FeedbackRoot | PDA | Single per agent, needs on-chain merkle root |
| ValidationRoot | PDA | Single per agent, needs on-chain merkle root |
| ReputationScore | PDA or Compressed | Depends on query patterns |
| Certification | PDA | Low volume, needs direct queries |

Note: With merkle root batching, individual feedbacks are already off-chain. ZK compression primarily benefits ReputationScore if high provider count per agent.

### Timeline

- **PR Status**: Open, marked "NOT AUDITED"
- **Dependencies**: Light Protocol infrastructure (Photon indexer, merkle trees)
- **SATI Action**: Monitor PR, update SDK when merged

---

## Summary

SATI solves the economics of on-chain agent reputation:

- **Free feedback for clients** — Dual-signature enables agent-subsidized submission
- **Infinite scale** — Merkle root batching: millions of feedbacks at fixed cost (112 bytes per agent)
- **No monopoly** — Multiple reputation providers compete with different algorithms
- **Composable trust** — Schema-defined authorization for any use case
- **Escrow integration** — Merkle proofs enable automatic escrow release

**Core schemas:**

| Schema | Purpose | Key Feature |
|--------|---------|-------------|
| FeedbackRoot | Client feedback | Free for clients, scales infinitely |
| ValidationRoot | Objective verification | Enables escrow release |
| ReputationScore | Aggregated scores | Provider-owned, no monopoly |
| Certification | Third-party attestations | Immutable proof |

**Third-party credentials** can register to gain permissionless attestation creation, unified indexing, and SDK support.

| Component | Technology | Status |
|-----------|------------|--------|
| Registry | SATI Registry Program (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`) | Deployed |
| Identity | Token-2022 NFT + TokenMetadata + TokenGroup | Available |
| Core Schemas | FeedbackRoot, ValidationRoot, ReputationScore, Certification | To deploy |
| Authorization | SchemaConfig with AuthMode | To implement |
| Third-party Support | Credential registration + CPI proxy | To implement |
| Indexer | Multi-credential indexing + merkle proofs | To implement |
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
