# SATI Specification v2.0

## Solana Agent Trust Infrastructure

**Status**: Implementation Ready
**Version**: 2.0.0
**Created**: 2025-12-11
**License**: Apache 2.0

---

## Abstract

SATI is trust infrastructure for million-agent economies on Solana. It provides ERC-8004 compatible agent identity, reputation, and validation through:

- **SATI Registry Program** - Minimal Anchor program for canonical address and atomic registration
- **Token-2022** for agent identity (NFTs with native metadata and collection membership)
- **Solana Attestation Service (SAS)** for reputation and validation attestations

This architecture is **compression-ready** — when SAS ships ZK-compressed attestations, reputation costs drop ~100x with no changes to SATI. This enables storing complete feedback histories on-chain rather than just averages, unlocking spam detection, reviewer reputation weighting, and time-decay scoring at scale.

---

## Table of Contents

1. [Motivation](#motivation)
2. [Architecture](#architecture)
3. [Registry Program](#registry-program)
4. [Identity: Token-2022 NFT](#identity-token-2022-nft)
5. [Reputation & Validation: SAS](#reputation--validation-sas)
6. [ERC-8004 Compatibility](#erc-8004-compatibility)
7. [SDK Interface](#sdk-interface)
8. [Security Considerations](#security-considerations)
9. [Deployment](#deployment)
10. [Governance](#governance)
11. [What's NOT Included (Yet)](#whats-not-included-yet)
12. [Scalability: ZK Compression](#scalability-zk-compression)
13. [Summary](#summary)
14. [References](#references)

---

## Motivation

### Why v2?

SATI v1 proposed custom programs with built-in ZK compression. Analysis revealed a better path:

1. **Delegate compression to SAS**: SAS is adding ZK-compressed attestations ([PR #101](https://github.com/solana-foundation/solana-attestation-service/pull/101)). SATI benefits automatically.
2. **Minimal custom code**: Token-2022 + SAS already provide needed primitives
3. **Ship now, scale later**: Launch with PDAs today, gain 100x cost reduction when SAS compression ships
4. **Avoid audit burden**: Custom compression code = more attack surface

### Why a Registry Program?

ERC-8004 requires a canonical registry address per chain for discoverability. On Solana:

- Token-2022 TokenGroup requires `update_authority` to sign for membership
- Without a program, someone must manually co-sign every registration (centralized)
- A minimal program holds the authority as a PDA and provides atomic registration

The registry program is a **thin wrapper** (~500 lines) around Token-2022, not a replacement.

### Why Token-2022 for Identity?

ERC-8004 uses ERC-721 NFTs because they provide:
- **Browsability** - OpenSea, wallets show all NFTs
- **Transferability** - Standard `transferFrom()`
- **Metadata** - `tokenURI` points to registration file

On Solana, **Token-2022 achieves the same benefits**:
- **Wallet support** - Phantom, Solflare, Backpack display Token-2022 NFTs
- **Standard transfers** - Native token transfer instruction
- **TokenMetadata extension** - `name`, `symbol`, `uri`, `additionalMetadata`
- **TokenGroup extension** - Collections with auto-incrementing member IDs

### Design Principles

1. **Minimal custom code** - Thin registry wrapper + Token-2022 + SAS
2. **ERC-8004 compatible** - Same data model and registration file format
3. **Canonical address** - `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` vanity program ID for discoverability
4. **Wallet support out of the box** - Users see agents in their wallets
5. **Enterprise ready** - Works with Squads smart accounts
6. **Immutable governance** - Start with multisig, renounce to immutable after stable

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SATI Registry Program                        │
│           (satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF)          │
├─────────────────────────────────────────────────────────────────┤
│  initialize()              → Create registry + TokenGroup       │
│  register_agent()          → Token-2022 NFT + group membership  │
│  update_registry_authority() → Transfer/renounce control        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────┐  ┌──────────────────────────────────┐
│      Token-2022          │  │  Solana Attestation Service      │
│  • Identity storage      │  │  • FeedbackAuth schema           │
│  • TokenMetadata         │  │  • Feedback schema               │
│  • TokenGroup            │  │  • FeedbackResponse schema       │
│  • Direct updates/xfers  │  │  • ValidationRequest schema      │
│                          │  │  • ValidationResponse schema     │
│                          │  │  • Certification schema          │
└──────────────────────────┘  └──────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **SATI Registry** | Canonical entry point, atomic registration, group authority |
| **Token-2022** | Identity storage, metadata, transfers (direct calls) |
| **SAS** | Reputation attestations, validation attestations |

---

## Registry Program

### Overview

The SATI Registry is a minimal program that:
- Provides a **canonical program address** (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`)
- Holds TokenGroup `update_authority` as a PDA
- Enables **permissionless, atomic registration**
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
| `uri` | String | ERC-8004 registration file |
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

### SATI Schema Addresses

> **Note:** Schema addresses below need to be redeployed to use optimized layouts. Credential address remains unchanged.

**Devnet:**

| Schema | Address | Status |
|--------|---------|--------|
| Credential | `7HCCiuYUHptR1SXXHBRqkKUPb5G3hPvnKfy5v8n2cFmY` | ✅ Current |
| FeedbackAuth | TBD | 🔄 Redeploy needed |
| Feedback | TBD | 🔄 Redeploy needed |
| FeedbackResponse | TBD | 🔄 Redeploy needed |
| ValidationRequest | TBD | 🔄 Redeploy needed |
| ValidationResponse | TBD | 🔄 Redeploy needed |
| Certification | TBD | 🔄 Redeploy needed |

**Mainnet:**

| Schema | Address | Status |
|--------|---------|--------|
| Credential | `DQHW6fAhPfGAENuwJVYfzEvUN12DakZgaaGtPPRfGei1` | ✅ Current |
| FeedbackAuth | TBD | 🔄 Redeploy needed |
| Feedback | TBD | 🔄 Redeploy needed |
| FeedbackResponse | TBD | 🔄 Redeploy needed |
| ValidationRequest | TBD | 🔄 Redeploy needed |
| ValidationResponse | TBD | 🔄 Redeploy needed |
| Certification | TBD | 🔄 Redeploy needed |

### SAS Layout Types

| Type ID | Type | Size |
|---------|------|------|
| 0 | U8 | 1 byte |
| 1 | U16 | 2 bytes |
| 13 | VecU8 | 4 + N bytes |

### Attestation Nonce Computation

SAS attestation PDAs: `["attestation", credential, schema, nonce]`

| Schema | Nonce Formula |
|--------|---------------|
| FeedbackAuth | `keccak256("feedbackAuth:" + agentMint + ":" + clientPubkey)` |
| Feedback | `keccak256("feedback:" + agentMint + ":" + tag1 + ":" + tag2 + ":" + clientPubkey + ":" + nonce)` |
| FeedbackResponse | `keccak256("response:" + feedbackId + ":" + responderPubkey + ":" + index)` |
| ValidationRequest | `keccak256("validationReq:" + agentMint + ":" + validatorPubkey + ":" + userNonce)` |
| ValidationResponse | `keccak256("validationResp:" + requestId + ":" + tag + ":" + responseIndex)` |
| Certification | `keccak256("cert:" + agentMint + ":" + certType + ":" + certifierPubkey)` |

### Schema Definitions

#### FeedbackAuth

Authorization for client to submit feedback (replaces ERC-8004 off-chain signature).

| Field | Type | Description |
|-------|------|-------------|
| `index_limit` | U16 | Maximum feedback count allowed |

**Attestation config**: issuer = agent owner, subject = client pubkey, expiry = SAS expirationTime

#### Feedback

Client feedback for agent (ERC-8004 compatible).

| Field | Type | Description |
|-------|------|-------------|
| `score` | U8 | 0-100 score |
| `content_ref` | VecU8 | 36 bytes: [type][data] |

**Attestation config**: issuer = client (feedback giver), nonce includes 8 random bytes for uniqueness

#### FeedbackResponse

Response to feedback (ERC-8004 appendResponse).

| Field | Type | Description |
|-------|------|-------------|
| `content_ref` | VecU8 | 36 bytes: [type][data] |

**Attestation config**: issuer = responder (agent owner, auditor, etc.)

#### ValidationRequest

Agent requests work validation.

| Field | Type | Description |
|-------|------|-------------|
| `method_id` | U8 | 0=tee, 1=zkml, 2=restake, 3=manual |
| `content_ref` | VecU8 | 36 bytes: [type][data] |

**Attestation config**: issuer = agent owner, subject = validator pubkey

#### ValidationResponse

Validator responds to request.

| Field | Type | Description |
|-------|------|-------------|
| `response` | U8 | 0-100 (0=fail, 100=pass) |
| `content_ref` | VecU8 | 36 bytes: [type][data] |

**Attestation config**: issuer = validator

#### Certification

Immutable certification for agent.

| Field | Type | Description |
|-------|------|-------------|
| `content_ref` | VecU8 | 36 bytes: [type][data] |

**Attestation config**: issuer = certifier (e.g., auditor)

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

### Off-Chain Feedback File

| Field | Required | Description |
|-------|----------|-------------|
| `agentId` | Yes | SATI canonical identifier |
| `agentRegistry` | Yes | CAIP-2 registry address |
| `clientAddress` | Yes | CAIP-10 feedback giver |
| `createdAt` | Yes | ISO 8601 timestamp |
| `score` | Yes | 0-100 (must match on-chain) |
| `tag1`, `tag2` | Yes | Must match on-chain PDA seeds |
| `skill` | No | Skill being evaluated |
| `context` | No | Interaction description |
| `paymentProof` | No | x402 payment details |
| `details` | No | Extended information |

### Authority Separation

| Authority | Controls | Renounceable? |
|-----------|----------|---------------|
| Registry authority | `update_registry_authority()` | Yes |
| SAS credential authority | Schema creation | No (needed for versioning) |

---

## ERC-8004 Compatibility

### Registration File Format

SATI v2 uses the **exact same registration file format** as ERC-8004:

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

### Compatibility Matrix

| ERC-8004 Feature | SATI v2 | Notes |
|------------------|---------|-------|
| Agent registration | ✅ | Registry program → Token-2022 NFT |
| `tokenId` (auto-incrementing) | ✅ | TokenGroupMember.member_number |
| `ownerOf(tokenId)` | ✅ | Token account holder |
| `transferFrom()` | ✅ | Direct Token-2022 transfer |
| `setApprovalForAll()` | ✅ | Token delegate |
| `tokenURI` / registration file | ✅ | TokenMetadata.uri |
| On-chain metadata | ✅ | TokenMetadata.additionalMetadata |
| `feedbackAuth` | ✅ | SAS attestation (better than off-chain sig) |
| `giveFeedback()` | ✅ | SAS Feedback attestation |
| `revokeFeedback()` | ❌ | Intentionally unsupported (immutable reputation) |
| `appendResponse()` | ✅ | SAS FeedbackResponse attestation |
| `getSummary()` | ✅ | Indexer (standard Solana pattern) |
| `readFeedback()` | ✅ | Fetch attestation |
| `validationRequest()` | ✅ | SAS ValidationRequest attestation |
| `validationResponse()` | ✅ | SAS ValidationResponse attestation |
| Wallet display | ✅ | Phantom, Solflare, Backpack |
| Cross-chain DID | ✅ | additionalMetadata["did"] |
| CAIP-2/CAIP-10 | ✅ | Chain-agnostic identifiers |

**Summary**: 100% functionally compatible. ERC-8004 deliberately prevents feedback revocation for reputation integrity — SATI follows the same design.

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

The TypeScript SDK (`@cascade-fyi/sati-sdk`) provides a unified interface for all SATI operations.

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

### Reputation Methods (SAS)

| Method | Description | Returns |
|--------|-------------|---------|
| `authorizeFeedback(params)` | Authorize client to submit feedback | `{ attestation }` |
| `revokeAuthorization(attestation)` | Revoke feedback authorization | `void` |
| `giveFeedback(params)` | Submit feedback (0-100 score, tags, contentRef) | `{ attestation }` |
| `appendResponse(params)` | Respond to feedback | `{ attestation }` |
| `readFeedback(attestation)` | Read feedback data | `Feedback \| null` |

**Note**: `revokeFeedback()` intentionally not supported — feedback is immutable for reputation integrity.

### Validation Methods (SAS)

| Method | Description | Returns |
|--------|-------------|---------|
| `requestValidation(params)` | Request validation (methodId: tee/zkml/restake/manual) | `{ attestation }` |
| `respondToValidation(params)` | Respond to validation request (0-100) | `{ attestation }` |
| `getValidationStatus(attestation)` | Get validation status | `ValidationStatus \| null` |

### Certification Methods (SAS)

| Method | Description | Returns |
|--------|-------------|---------|
| `createCertification(params)` | Create certification (security-audit, kyc, etc.) | `{ attestation }` |
| `getCertification(attestation)` | Get certification data | `Certification \| null` |

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
| FeedbackAuth | On-chain attestation (stronger than ERC-8004's off-chain signatures) |
| Expiry | Built into SAS primitive |
| Schema validation | SAS validates data against schema |

### Governance Security

| Aspect | Approach |
|--------|----------|
| Multisig authority | Registry and SAS credential use Squads smart accounts |
| Immutability option | Can renounce authority after stable |
| Separation of concerns | Registry vs SAS credential managed independently |

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
- ERC-8004 standard uses IPFS
- Free to pin via Pinata, web3.storage, etc.

### Costs

#### Compute Units (Benchmarked)

| Operation | CUs | % of 1.4M Budget |
|-----------|-----|------------------|
| initialize | 10,918 | 0.8% |
| register_agent (minimal) | 58,342 | 4.2% |
| register_agent (3 metadata fields) | 82,877 | 5.9% |
| register_agent (max 10 fields) | 168,097 | 12.0% |
| register_agent (soulbound) | 79,255 | 5.7% |
| update_registry_authority | 3,516 | 0.3% |

*See [benchmarks/](./benchmarks/) for detailed measurements and methodology.*

#### Rent Costs (Estimated)

| Operation | Cost | Notes |
|-----------|------|-------|
| Initialize registry | ~0.005 SOL | One-time |
| Setup SAS schemas (6) | ~0.018 SOL | One-time |
| Register agent (minimal) | ~0.003 SOL | Mint + metadata + group member |
| Register agent (3 fields) | ~0.0035 SOL | +additional metadata |
| Register agent (10 fields) | ~0.005 SOL | Maximum metadata |
| Update metadata | ~0.00001 SOL | Transaction fee only |
| Transfer agent | ~0.00001 SOL | Transaction fee only |
| Authorize feedback | ~0.002 SOL | SAS attestation |
| Give feedback | ~0.002 SOL | SAS attestation |

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
| Feedback | ~0.002 SOL | ~0.00002 SOL |
| 1,000 feedbacks | ~2 SOL | ~0.02 SOL |
| 100,000 feedbacks | ~200 SOL | ~2 SOL |
| 1,000,000 feedbacks | ~2,000 SOL | ~20 SOL |

### SATI Integration Path

**No SATI code changes required.** When SAS ships compressed attestations:

1. **SDK update only** — Use `CreateCompressedAttestation` instead of `CreateAttestation` for high-volume operations
2. **Migration optional** — Existing PDA attestations continue working; can batch-compress to reclaim rent
3. **Hybrid approach** — Use PDAs for authorization (FeedbackAuth), compressed for high-volume (Feedback, ValidationResponse)

**Recommended pattern post-compression:**

| Schema | Storage | Reason |
|--------|---------|--------|
| FeedbackAuth | PDA | Needs on-chain queryability for authorization checks |
| Feedback | Compressed | High volume, ~100x savings |
| FeedbackResponse | Compressed | High volume |
| ValidationRequest | PDA | Needs state tracking |
| ValidationResponse | Compressed | High volume |
| Certification | PDA | Low volume, needs direct queries |

### Timeline

- **PR Status**: Open, marked "NOT AUDITED"
- **Dependencies**: Light Protocol infrastructure (Photon indexer, merkle trees)
- **SATI Action**: Monitor PR, update SDK when merged

---

## Summary

SATI v2 achieves 100% ERC-8004 functional compatibility with:

- **SATI Registry Program** - Canonical address, atomic registration (~500 lines)
- **Token-2022** for identity (wallet support, transfers, collections)
- **SAS** for reputation and validation attestations
- **TypeScript SDK**
- **Indexer for aggregation queries**

| Component | Technology | Status |
|-----------|------------|--------|
| Registry | SATI Registry Program (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`) | To implement |
| Identity | Token-2022 NFT + TokenMetadata + TokenGroup | Available |
| Reputation | SAS attestations | Available |
| Validation | SAS attestations | Available |
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
