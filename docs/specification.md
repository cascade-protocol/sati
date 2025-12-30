# SATI Specification v2.1

## Solana Agent Trust Infrastructure

**Status**: Implementation Ready | **Version**: 2.1.0 | **Updated**: 2025-12-23 | **License**: Apache 2.0

---

## Abstract

SATI is open trust infrastructure for AI agents on Solana solving the economics of on-chain feedback:

- **Agent-subsidized feedback** — Agent signs with response (blind to outcome), client feedback is free
- **x402 native** — Canonical feedback extension; payment tx becomes task reference (CAIP-220)
- **200x cost reduction** — ZK Compression stores attestations at ~$0.002 each
- **Schema agnostic** — Program verifies signatures on 96-byte base layout; new schemas without upgrades
- **No reputation monopoly** — Multiple providers compete with different scoring algorithms

**Built on**: Token-2022 (identity), SAS (schemas), Light Protocol (storage), Photon (indexing), x402 (payments)

---

## Core Concepts

### Blind Feedback Model

The breakthrough enabling free on-chain feedback. Agent and counterparty sign different data at different times:

| Party | Signs | When | Proves |
|-------|-------|------|--------|
| Agent | `hash(schema, task_ref, token_account, data_hash)` | With response | "I served this task" |
| Counterparty | `hash(schema, task_ref, token_account, outcome)` | After service | "I gave this feedback" |

**Flow**: Client pays (x402) → Agent responds + signs (blind) → Client signs feedback → Agent/facilitator submits

**Key insight**: Agent signs BEFORE knowing feedback sentiment — cannot selectively participate.

**Enforcement note**: The protocol does not enforce that agents sign with every response. Enforcement can be handled at the application layer:
- **Facilitators** can require agent signatures before settling payments
- **Clients** can refuse to pay agents that don't participate in reputation
- **Marketplaces** can filter for agents with reputation participation

This is not a protocol concern — SATI provides the infrastructure, enforcement is delegated to ecosystem participants.

### Incentive Alignment

| Feedback | Who Pays | Why |
|----------|----------|-----|
| Positive | Agent | Benefits from reputation boost |
| Negative | Client | Motivated to warn others |
| None | No one | Client chose not to sign |

**Participation is opt-in**: No agent signature = not participating = no verified feedback possible.

### x402 Integration

SATI is the canonical feedback extension for x402. Payment tx hash becomes `task_ref` (CAIP-220 format).

**Facilitators** are natural feedback managers: already in payment flow, trusted by both parties, can batch submissions.

### Costs

| Operation | Cost | Notes |
|-----------|------|-------|
| Agent registration | ~0.003 SOL | Mint + metadata + group |
| Feedback (single) | ~$0.002 | ~0.00001 SOL via Light |
| Feedback (batched 5/tx) | ~$0.0006 | Amortized proof cost |
| Validation | ~$0.002 | Same as feedback |
| ReputationScore | ~0.002 SOL | Regular SAS attestation |
| Photon indexing | Free | Compressed attestations only |

---

## Architecture

```
┌───────────────────────────┐
│      Token-2022           │
│  • Identity storage       │
│  • TokenMetadata          │
│  • TokenGroup             │
└───────────────────────────┘
          ▲
          │ (CPI: mint NFT)
┌─────────────────────────────────────────────────────────────────────┐
│                         SATI Program                                 │
│             (satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz)            │
├─────────────────────────────────────────────────────────────────────┤
│  Registry:                                                           │
│    initialize()                → Create registry + TokenGroup        │
│    register_agent()            → Token-2022 NFT + group membership   │
│    update_registry_authority() → Transfer/renounce control           │
│  Attestation:                                                        │
│    register_schema_config()    → Register schema + auth mode + storage│
│    create_attestation()        → Verify sigs → route to storage      │
│    close_attestation()         → Close/nullify attestation           │
└─────────────────────────────────────────────────────────────────────┘
          │                                         │
          │ (CPI: compressed)                       │ (CPI: regular)
          ▼                                         ▼
┌───────────────────────────┐         ┌────────────────────────────────┐
│   Light Protocol          │         │   Solana Attestation Service   │
│   (Compressed Storage)    │         │   (Regular Storage)            │
├───────────────────────────┤         ├────────────────────────────────┤
│ • Feedback attestations   │         │ • ReputationScore attestations │
│ • Validation attestations │         │ • ~$0.40 per attestation       │
│ • ~$0.002 per attestation │         │ • On-chain queryable (RPC)     │
│ • Photon indexing (free)  │         │                                │
└───────────────────────────┘         └────────────────────────────────┘
```

| Component | Responsibility |
|-----------|----------------|
| **SATI Program** | Agent registration, signature verification, storage routing |
| **Token-2022** | Identity storage, metadata, transfers |
| **SAS** | Schema definitions + regular attestation storage |
| **Light Protocol** | Compressed attestation storage |
| **Photon** | Free indexing for compressed accounts |

---

## SATI Program

**Program ID**: `satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz`

### Registry

#### RegistryConfig (PDA: `["registry"]`)

| Field | Type | Description |
|-------|------|-------------|
| `group_mint` | Pubkey | SATI TokenGroup mint |
| `authority` | Pubkey | Registry authority (default = immutable) |
| `total_agents` | u64 | Agent counter |
| `bump` | u8 | PDA bump |

#### Instructions

| Instruction | Parameters | Behavior |
|-------------|------------|----------|
| `initialize` | — | Create registry + TokenGroup (one-time) |
| `register_agent` | name, symbol*, uri, additional_metadata?, non_transferable | Create Token-2022 NFT, add to group, renounce mint |
| `update_registry_authority` | new_authority? | Transfer or renounce (None = immutable) |
| `link_evm_address` | evm_address, chain_id, signature, recovery_id | Verify secp256k1 signature, emit event |

> \* **Note on `symbol`**: This field is vestigial from Token-2022's fungible token origin. For NFTs it has no semantic meaning. The SDK hardcodes this to an empty string `""`. The on-chain program still accepts and validates the field (max 10 bytes) for backwards compatibility.

#### Events

| Event | Fields |
|-------|--------|
| `AgentRegistered` | mint, owner, member_number, name, uri, non_transferable |
| `RegistryAuthorityUpdated` | old_authority, new_authority |
| `EvmAddressLinked` | agent_mint, evm_address, chain_id, linked_at |

#### Errors

`InvalidAuthority` · `ImmutableAuthority` · `NameTooLong` · `SymbolTooLong` · `UriTooLong` · `TooManyMetadataEntries` · `Overflow`

### Attestation

#### SchemaConfig (PDA: `["schema_config", schema]`)

| Field | Type | Description |
|-------|------|-------------|
| `sas_schema` | Pubkey | SAS schema address |
| `signature_mode` | SignatureMode | DualSignature / SingleSigner |
| `storage_type` | StorageType | Compressed / Regular |
| `closeable` | bool | Whether attestations can be closed |
| `bump` | u8 | PDA bump seed |

#### CompressedAttestation

Compressed accounts require Light Protocol derives for hashing and discrimination:

```rust
#[derive(Clone, Debug, Default, LightDiscriminator, LightHasher)]
pub struct CompressedAttestation { /* fields below */ }
```

| Field | Type | Offset | Description |
|-------|------|--------|-------------|
| `sas_schema` | Pubkey | 0 | Schema (memcmp filter) |
| `token_account` | Pubkey | 32 | Agent mint address (memcmp filter) |
| `data_type` | u8 | 64 | Schema data type |
| `data` | Vec&lt;u8&gt; | 65+ | Schema-conformant bytes |
| `signatures` | Vec&lt;[u8;64]&gt; | varies | Ed25519 signatures |

#### Base Data Layout (first 96 bytes)

All schemas MUST start with:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 32 | `task_ref` |
| 32 | 32 | `token_account` |
| 64 | 32 | `counterparty` |

Program parses this for signature binding; full schema parsed by indexers.

> **Note on `token_account` naming**: This field stores the **agent's mint address** (the stable identity), not an Associated Token Account (ATA). The name `token_account` is inherited from the SAS specification for storage efficiency. Throughout SATI documentation and code, `token_account` = agent mint address.

**Note on timestamps**: Attestation creation time is tracked via Photon's `slotCreated` field. For interaction time (when the original event occurred), clients can look up the transaction referenced in `task_ref`.

#### Signature Verification (On-Chain)

1. **Count**: Match `SignatureMode` (2 for DualSignature)
2. **Agent authorization** (via ATA):
   - `agent_ata.mint == token_account` (ATA holds correct NFT)
   - `agent_ata.amount >= 1` (NFT present)
   - `signatures[0].pubkey == agent_ata.owner` (signer owns NFT)
3. **Counterparty binding**: `signatures[1].pubkey == counterparty`
4. **Self-attestation**: `token_account != counterparty`
5. **Validity**: Each signature on its domain-separated hash

> **Note**: `token_account` is the agent's MINT ADDRESS (identity). The agent OWNER signs (verified via ATA ownership).

#### Instructions

| Instruction | Parameters | Behavior |
|-------------|------------|----------|
| `register_schema_config` | schema, signature_mode, storage_type, closeable | Register schema config (authority only) |
| `create_attestation` | data, signatures, storage-specific params | Verify sigs → route to storage by `storage_type` |
| `close_attestation` | storage-specific params | Close if `closeable=true`; ReputationScore: provider only |

**Storage-specific parameters:**

| Storage Type | Create Params | Close Params |
|--------------|---------------|--------------|
| Compressed | proof, address_tree_info, output_state_tree_index | proof, account_meta, current_data |
| Regular | nonce, expiry | attestation_pda |

**Routing**: Program checks `SchemaConfig.storage_type` and CPIs to Light Protocol (compressed) or SAS (regular). SATI Program PDA is the sole authorized signer for both storage backends.

#### Events

| Event | Fields |
|-------|--------|
| `SchemaConfigRegistered` | schema, signature_mode, storage_type |
| `AttestationCreated` | sas_schema, token_account, data_type, storage_type, address, timestamp |
| `AttestationClosed` | sas_schema, token_account, address |

#### Errors

`SchemaConfigNotFound` · `InvalidSignatureCount` · `InvalidSignature` · `StorageTypeNotSupported` · `AttestationDataTooSmall` · `AttestationDataTooLarge` · `ContentTooLarge` · `SignatureMismatch` · `SelfAttestationNotAllowed` · `UnauthorizedClose` · `AttestationNotCloseable` · `InvalidOutcome` · `InvalidContentType` · `InvalidDataType` · `InvalidScore` · `InvalidResponse` · `TagTooLong` · `InvalidDataLayout` · `LightCpiInvocationFailed`

---

## Identity: Token-2022 NFT

### Extensions

| Extension | Purpose |
|-----------|---------|
| MetadataPointer | Points to metadata location |
| TokenMetadata | name, symbol, uri, additionalMetadata |
| GroupMemberPointer | Points to group membership |
| TokenGroupMember | SATI Registry membership |
| NonTransferable | Optional: soulbound agents |

> ⚠️ **Soulbound Warning**: The `NonTransferable` extension is **permanent and irreversible**. Once set at mint creation, the agent NFT can NEVER be transferred to another wallet. Use only when you are certain the agent should be permanently bound to the initial owner. Consider using a smart account (Squads) if you may need to change control in the future.

### Configuration

| Property | Value |
|----------|-------|
| decimals | 0 (NFT) |
| supply | 1 (unique) |
| mint_authority | None (renounced) |
| freeze_authority | None |

### TokenMetadata

| Field | Description |
|-------|-------------|
| `updateAuthority` | Agent owner |
| `mint` | Agent ID |
| `name` | Agent name |
| `symbol` | Empty string (legacy field, not used) |
| `uri` | Registration file URL |
| `additionalMetadata` | agentWallet, did, a2a, mcp |

### Operations

- **Update metadata**: Direct `spl-token-metadata` calls
- **Transfer**: Standard Token-2022 transfer
- **Smart accounts**: Squads can own via ATAs

---

## Schemas

### Core Schemas

| Schema | Storage | SignatureMode | Closeable | Status |
|--------|---------|---------------|-----------|--------|
| Feedback | Compressed | DualSignature | No | ✅ MVP |
| Validation | Compressed | DualSignature | No | ✅ MVP |
| ReputationScore | Regular | SingleSigner | Yes (provider only) | ✅ MVP |

**SignatureMode determines payload signature requirements:**

| Mode | Signatures | Use Case |
|------|------------|----------|
| DualSignature | 2 | Feedback, Validation (blind feedback model) |
| SingleSigner | 1 | ReputationScore (provider signs) |

### Feedback Schema (data_type = 0, variable length)

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | task_ref | [u8;32] | CAIP-220 tx hash or arbitrary ID |
| 32 | token_account | Pubkey | Agent mint address |
| 64 | counterparty | Pubkey | Client |
| 96 | data_hash | [u8;32] | Request hash (agent's blind commitment) |
| 128 | content_type | u8 | Content format (see Content Types) |
| 129 | outcome | u8 | 0=Negative, 1=Neutral, 2=Positive |
| 130 | tag1 | String | Primary category (1-byte len + UTF-8, max 32 chars) |
| var | tag2 | String | Secondary category (1-byte len + UTF-8, max 32 chars) |
| var | content | Vec\<u8\> | Variable: 4-byte len + data |

**Size**: 132 bytes minimum (empty tags, empty content), typical 160-220 bytes with tags and inline feedback

**Fixed offset benefit**: `outcome` at offset 129 enables Photon memcmp filtering by feedback sentiment. Tags are variable-length strings for ERC-8004 compatibility (e.g., `"quality"`, `"latency"`, `"accuracy"`).

**ERC-8004 score mapping**: ERC-8004 uses `score` (0-100) while SATI uses categorical `outcome`. For interoperability, map as: Negative(0)→0, Neutral(1)→50, Positive(2)→100.

### Validation Schema (data_type = 1, variable length)

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | task_ref | [u8;32] | Task reference |
| 32 | token_account | Pubkey | Agent mint address |
| 64 | counterparty | Pubkey | Validator |
| 96 | data_hash | [u8;32] | Work hash (agent's commitment) |
| 128 | content_type | u8 | Content format (see Content Types) |
| 129 | validation_type | u8 | tee/zkml/reexecution/consensus |
| 130 | response | u8 | 0-100 validation confidence score |
| 131 | content | Vec\<u8\> | Variable: 4-byte len + data |

**Size**: 135 bytes minimum (empty content), typical 150-200 bytes with inline report

**Fixed offset benefit**: `response` at offset 130 enables Photon memcmp filtering by validation score.

**ERC-8004 alignment**: Field name `response` matches ERC-8004 Validation schema. Score 0-100 allows validators to express confidence levels (e.g., 95 = high confidence pass, 10 = low confidence fail).

### ReputationScore Schema (data_type = 2, variable length)

Provider-computed scores using `StorageType::Regular` for direct on-chain queryability.

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | task_ref | [u8;32] | Deterministic: `keccak256(counterparty, token_account)` |
| 32 | token_account | Pubkey | Agent mint address being scored |
| 64 | counterparty | Pubkey | Provider (reputation scorer) |
| 96 | score | u8 | 0-100 normalized score |
| 97 | content_type | u8 | Content format (see Content Types) |
| 98 | content | Vec\<u8\> | Variable: methodology/details |

**Size**: 102 bytes minimum (empty content), typical 150-300 bytes with methodology details

**Semantics**: One ReputationScore per (provider, agent) pair. Providers update by closing old attestation and creating new one with same deterministic nonce. On-chain creation time is tracked via SAS attestation metadata.

### Address Derivation

**Compressed Attestations (Light Protocol):**

```rust
let nonce = keccak256(&[task_ref, sas_schema, token_account, counterparty].concat());
let (address, seed) = derive_address(
    &[b"attestation", sas_schema, token_account, &nonce],
    &address_tree_pubkey, &program_id
);
```

**Note**: Including `counterparty` in the nonce ensures unique addresses per (task, agent, counterparty) tuple, preventing address collisions when different counterparties attest to the same agent for the same task.

**Regular Attestations (SAS):**

```rust
// Nonce is deterministic: one ReputationScore per (provider, agent) pair
// Note: For ReputationScore, counterparty = provider (the reputation scorer)
let nonce = keccak256(&[counterparty, token_account]);  // counterparty = provider

// SAS PDA derivation
let (attestation_pda, _) = Pubkey::find_program_address(
    &[b"attestation", sati_credential, sas_schema, &nonce.to_bytes()],
    &SAS_PROGRAM_ID
);
```

**Deterministic nonce** ensures one ReputationScore per (provider, agent) pair — updates replace previous.

### Content Types

The `content_type` field determines how to interpret the variable-length `content` field:

| Code | Type | Content | Use Case |
|------|------|---------|----------|
| 0 | None | Empty | Just use outcome/tags (no extended content) |
| 1 | JSON | Inline JSON object | Structured feedback with metadata |
| 2 | UTF-8 | Plain text | Simple text feedback |
| 3 | IPFS | CIDv1 (~36 bytes) | Large content stored off-chain |
| 4 | Arweave | Transaction ID (32 bytes) | Permanent off-chain storage |

**Size limit**: `MAX_CONTENT_SIZE = 512 bytes`. Enforced on-chain. For larger content, use IPFS/Arweave.

**Examples:**

```json
// content_type=1 (JSON), ~60 bytes
{"text":"Fast and accurate","latency_ms":180,"tokens":1200}

// content_type=2 (UTF-8), ~30 bytes
"Excellent service, would recommend"

// content_type=0 (None)
// Empty content, just use outcome + tags
```

**Design rationale**: Simple feedback doesn't need IPFS. Inline JSON/UTF-8 is directly readable by indexers without external fetches.

---

## Storage & Indexing

### Light Protocol (ZK Compression)

Stores Feedback and Validation attestations as merkle tree leaves (~200x cheaper than accounts).

| Aspect | Value |
|--------|-------|
| Cost per attestation | ~0.00001 SOL |
| On-chain storage | 32-byte merkle root |
| Verification | ZK proof (~100K CU) |
| Programs | Light System, Account Compression, Noop |

**SATI uses**: CPI to Light System for create/close, Photon for queries.

### Photon Indexing (Compressed)

Reconstructs compressed accounts from Noop logs. Free via Helius RPC.

| Method | Purpose |
|--------|---------|
| `getCompressedAccountsByOwner` | Query by owner + filters |
| `getValidityProof` | Get ZK proof for on-chain verification |
| `getCompressedAccountProof` | Merkle proof for escrow |

**Filters**: `sas_schema` (offset 8), `token_account` (offset 40), `outcome` (offset 129 for Feedback), `response` (offset 130 for Validation)

### SAS (Regular Storage)

Stores ReputationScore as standard Solana accounts for direct on-chain queryability.

| Aspect | Value |
|--------|-------|
| Cost per attestation | ~0.002 SOL (rent) |
| On-chain storage | Full account data |
| Verification | Direct account read |
| Program | SAS (`22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`) |

**SATI uses**: CPI to SAS for create/close, standard RPC for queries.

### RPC Queries (Regular)

Regular attestations use standard Solana RPC methods:

| Method | Purpose |
|--------|---------|
| `getAccountInfo` | Fetch single attestation by PDA |
| `getProgramAccounts` | Query by filters (schema, token_account) |

**Filters**: `credential` (offset 33), `schema` (offset 65), custom data filters

**Tradeoff**: Regular attestations cost ~200x more but are directly queryable on-chain by other programs (useful for escrow, governance, etc.).

---

## SDK Interface

Package: `@cascade-fyi/sati-sdk`

### Types

```typescript
enum Outcome { Negative = 0, Neutral = 1, Positive = 2 }

// Tags are free-form strings (max 32 chars each)
// Common examples: "quality", "speed", "reliability", "communication", "value", "accuracy"
type Tag = string;
```

### Methods

| Category | Method | Returns |
|----------|--------|---------|
| **Registry** | `registerAgent(params)` | `{ mint, memberNumber, signature }` |
| **Identity** | `loadAgent(mint)` | `AgentIdentity` |
| | `listAgentsByOwner(owner)` | `AgentIdentity[]` |
| | `updateAgentMetadata(params)` | `{ signature }` |
| | `transferAgent(params)` | `{ signature }` |
| **Compressed** | `createFeedback(params)` | `{ address, signature }` |
| | `createFeedbackBatch(params[])` | `{ addresses, signature }` |
| | `createValidation(params)` | `{ address, signature }` |
| | `closeCompressedAttestation(params)` | `{ signature }` |
| **Regular** | `createReputationScore(params)` | `{ address, signature }` |
| | `updateReputationScore(params)` | `{ address, signature }` |
| | `closeRegularAttestation(params)` | `{ signature }` |
| **Query (Compressed)** | `listFeedbacks(filter)` | `ParsedAttestation[]` |
| | `listValidations(filter)` | `ParsedAttestation[]` |
| | `getAttestationWithProof(address)` | `{ attestation, proof }` |
| **Query (Regular)** | `getReputationScore(provider, tokenAccount)` | `ReputationScore \| null` |
| | `listReputationScores(tokenAccount)` | `ReputationScore[]` |
| **Verify** | `verifyProof(proof, expectedRoot?)` | boolean |
| | `verifySignatures(attestation)` | `SignatureVerificationResult` |
| **Setup** | `setupSASSchemas(params)` | `SASDeploymentResult` |
| | `registerSchemaConfig(params)` | `{ signature }` |
| | `getSchemaConfig(sasSchema)` | `SchemaConfig \| null` |
| **Hashing** | `computeInteractionHash(...)` | `Uint8Array` |
| | `computeFeedbackHash(...)` | `Uint8Array` |
| | `computeValidationHash(...)` | `Uint8Array` |
| | `computeReputationHash(...)` | `Uint8Array` |

### createFeedback Example

```typescript
await sati.createFeedback({
  tokenAccount,
  counterparty: clientPubkey,
  outcome: Outcome.Positive,
  taskRef: paymentTxHash,  // CAIP-220 format
  signatures: [agentSig, clientSig],
});
```

---

## Security

### On-Chain Guarantees

| Property | Enforcement |
|----------|-------------|
| Signature validity | Ed25519 verification |
| Blind feedback | Agent signs before outcome known |
| Agent authorization | ATA ownership (signer owns agent NFT) |
| Counterparty binding | `signatures[1].pubkey == counterparty` |
| Self-attestation prevention | `token_account ≠ counterparty` |
| Duplicate prevention | Deterministic address from task_ref |
| Outcome range | Verified ∈ {0,1,2} before storage |
| Content type range | Verified ∈ {0,1,2,3,4} before storage |
| Closeable enforcement | Schema config controls whether close is allowed |

### Off-Chain Validation (SDK/Indexer)

| Property | Enforcement |
|----------|-------------|
| task_ref format | SDK validates CAIP-220 |
| Timestamp filtering | Client-side filtering via Photon `slotCreated` |

### Trust Model

| Component | Trust Assumption |
|-----------|-----------------|
| SATI Programs | Correctly verify signatures |
| Light Protocol | State tree integrity |
| Photon | Accurate indexing |
| SDK | Validates formats, constructs hashes |

### Known Limitations

- **Sybil resistance**: Prevents self-attestation but not multiple wallets. Reputation providers implement sybil-resistant scoring.
- **No pending state**: The protocol has no concept of "pending" validation or feedback. Attestations only exist once both signatures are collected and submitted. There is no on-chain way to check if a validation is in progress but not yet complete.
- **Timestamp trust**: The `timestamp` field is set by the submitter and not verified against on-chain time. It should be trusted for ordering purposes only, not as cryptographic proof of time.

---

## Deployment

### Addresses

| Network | SATI Program | Registry Config | Group Mint |
|---------|--------------|-----------------|------------|
| Devnet | `satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz` | TBD | TBD |
| Mainnet | `satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz` | TBD | TBD |

### Governance

**Authority lifecycle**: Launch (multisig) → Stable (multisig) → Immutable (renounced)

- Registry authority controls `update_registry_authority()` only
- Upgrade authority controls program deployment
- Both independently renounceable

**Schema governance**: Versioned, not upgraded. New schema = new version (e.g., Feedback_v2).

---

## ERC-8004 Compatibility

SATI implements the [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) specification on Solana with enhancements for cost efficiency and security.

### Compatibility Matrix

| ERC-8004 Feature | SATI | Notes |
|------------------|------|-------|
| **Identity** | | |
| Agent registration | ✅ | Registry program → Token-2022 NFT |
| `tokenId` (auto-incrementing) | ✅ | TokenGroupMember.member_number |
| `ownerOf(tokenId)` | ✅ | Token account holder |
| `transferFrom()` | ✅ | Direct Token-2022 transfer |
| `setApprovalForAll()` | ✅ | Token delegate |
| `tokenURI` / registration file | ✅ | TokenMetadata.uri |
| On-chain metadata | ✅ | TokenMetadata.additionalMetadata |
| **Reputation** | | |
| `feedbackAuth` | ⚡ | Replaced by dual-signature model (more secure) |
| `giveFeedback()` | ✅ | Compressed attestation via Light Protocol |
| `revokeFeedback()` | ✅ | close_attestation() |
| `appendResponse()` | ✅ | FeedbackResponse schema (deferred) |
| `getSummary()` | ✅ | Photon indexer queries |
| `readFeedback()` | ✅ | Fetch compressed attestation |
| **Validation** | | |
| `validationRequest()` | ✅ | Validation schema |
| `validationResponse()` | ✅ | Validation schema with response score |
| **Cross-Chain** | | |
| Wallet display | ✅ | Phantom, Solflare, Backpack |
| DID support | ✅ | additionalMetadata["did"] |
| CAIP-2/CAIP-10 | ✅ | Chain-agnostic identifiers |

### Authorization Model Comparison

ERC-8004 uses `feedbackAuth` (agent pre-authorizes client). SATI uses **dual-signature blind feedback**:

| Aspect | ERC-8004 feedbackAuth | SATI Dual-Signature |
|--------|----------------------|---------------------|
| Authorization | Agent signs permission upfront | Agent signs with response (blind) |
| Selective blocking | Agent can refuse to authorize bad clients | Agent cannot refuse — signs before knowing outcome |
| Sybil resistance | None (authorized client can submit anything) | Both parties must sign same task_ref |
| Gas cost | Client pays | Agent pays (bundled into service) |

> **Note**: ERC-8004 PR #11 removes `feedbackAuth` entirely, moving to open feedback. SATI's dual-signature model provides stronger guarantees than either approach.

### CAIP and DID Support

SATI uses [Chain Agnostic Improvement Proposals](https://github.com/ChainAgnostic/CAIPs) for cross-chain interoperability:

**CAIP-2 (Blockchain ID)**: `namespace:reference`

| Chain | CAIP-2 Identifier |
|-------|-------------------|
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Ethereum Mainnet | `eip155:1` |
| Base | `eip155:8453` |

**CAIP-10 (Account ID)**: `chain_id:account_address`

```
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv
eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7
```

**DID Support** (via additionalMetadata):

```typescript
["did", "did:web:agent.example.com"]           // Web-based DID
["did", "did:pkh:solana:5eykt4...:7S3P4..."]   // PKH (blockchain account)
["did", "did:key:z6Mkf..."]                    // Key-based DID
```

See [CAIP Standards](https://github.com/ChainAgnostic/CAIPs) for full format specifications.

---

## Cross-Chain

### Registration File Schema

The registration file is an off-chain JSON document referenced by the on-chain `uri` field. SATI's schema merges ERC-8004 requirements with Metaplex/Phantom standards, ensuring agents display correctly in Solana wallets while maintaining cross-chain compatibility.

#### Field Reference

| Field | Source | Required | Description |
|-------|--------|----------|-------------|
| `type` | ERC-8004 | Yes | Schema identifier |
| `name` | Both | Yes | Agent name |
| `description` | Both | Yes | Agent description |
| `image` | Both | Yes | Primary image URL |
| `properties.files` | Metaplex | Yes* | Image with MIME type for wallet display |
| `properties.category` | Metaplex | No | Asset category |
| `external_url` | Metaplex | No | Project website |
| `endpoints` | ERC-8004 | No | Service endpoints (A2A, MCP, etc.) |
| `registrations` | ERC-8004 | No | Cross-chain registration entries |
| `supportedTrust` | ERC-8004 | No | Supported trust mechanisms |
| `active` | SATI | No | Operational status |
| `x402support` | SATI | No | x402 payment support |

*Required for Phantom wallet image rendering

#### Example

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "description": "AI assistant with x402 payment support",
  "image": "https://example.com/agent.png",

  "properties": {
    "files": [{ "uri": "https://example.com/agent.png", "type": "image/png" }],
    "category": "image"
  },
  "external_url": "https://myagent.example.com",

  "endpoints": [
    { "name": "A2A", "endpoint": "https://agent.example/agent-card.json", "version": "0.3.0" },
    { "name": "MCP", "endpoint": "https://mcp.agent.example/", "version": "2025-06-18" },
    { "name": "agentWallet", "endpoint": "solana:5eykt4...:7S3P4..." }
  ],
  "registrations": [
    { "agentId": "sati:mainnet:ABC123mint", "agentRegistry": "solana:5eykt4...:satiR3q7..." },
    { "agentId": 22, "agentRegistry": "eip155:1:0x..." }
  ],
  "supportedTrust": ["reputation"],
  "active": true,
  "x402support": true
}
```

#### Image Requirements

For proper display in Phantom, Solflare, and Solscan:

1. **Use `properties.files`** with explicit MIME type — this is what wallets read for image rendering
2. **Match URIs** — `properties.files[0].uri` should equal `image` field
3. **Supported formats**: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`
4. **Recommended specs**: 512×512 to 1024×1024 pixels, under 1MB

**Why both `image` and `properties.files`?**
- `image` — ERC-8004 standard field, used by cross-chain consumers
- `properties.files` — Metaplex standard, used by Solana wallets for rendering

Including both ensures compatibility with both ecosystems.

#### Consumer Compatibility

| Consumer | Reads | Ignores |
|----------|-------|---------|
| Phantom/Solflare | name, description, image, properties.files, external_url | type, endpoints, registrations, supportedTrust, active, x402support |
| Solscan | name, description, image, properties.files | Same as wallets |
| ERC-8004 clients | type, name, description, image, endpoints, registrations, supportedTrust | properties, external_url, active, x402support |
| SATI SDK | All fields | — |

Custom fields from either standard are preserved but ignored by consumers that don't understand them.

#### Cross-Chain Identity via `registrations[]`

The `registrations` array lists all on-chain registrations for the same logical agent, enabling cross-chain identity linking.

**Note**: This array can be null or empty when first creating the registration file. The typical workflow is:
1. Create registration file with `registrations: []`
2. Register agent on-chain (returns mint address)
3. Update registration file with actual registration entry
4. (Optional) Register on additional chains and update file

This is necessary because the mint address isn't known until after registration completes.

Cross-chain identity enables:
- **Same agent identity** across Solana, Ethereum, Base, etc.
- **Verifiable cross-chain resolution** — verify registration file hash matches on-chain uri
- **No on-chain bridging required** — off-chain linking via content-addressed storage

### SATI Identifier Format

```
sati:<network>:<mint_address>
```

| Format | Example |
|--------|---------|
| SATI (Solana) | `sati:mainnet:ABC123mintPubkey` |
| ERC-8004 (EVM) | `22` (tokenId on specific registry) |
| Registry address | `solana:5eykt4...:satiR3q7...` (CAIP-10) |

See [CAIP Standards](https://github.com/ChainAgnostic/CAIPs) and [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) for full format specifications.

---

## EVM Address Linking

Enables SATI agents to cryptographically prove ownership of EVM addresses via secp256k1 signature verification. This creates verifiable cross-chain identity links.

### Instruction: `link_evm_address`

| Field | Type | Description |
|-------|------|-------------|
| `evm_address` | [u8; 20] | Ethereum address (20 bytes) |
| `chain_id` | String | CAIP-2 chain identifier (e.g., "eip155:1", "eip155:8453") |
| `signature` | [u8; 64] | secp256k1 signature (r \|\| s) |
| `recovery_id` | u8 | Recovery ID (0 or 1) |

### Message Format

The EVM wallet signs a domain-separated hash:

```
Domain: SATI:evm_link:v1
Hash: keccak256(domain || agent_mint || evm_address || chain_id)
```

### Verification Flow

1. Client computes message hash with agent mint, EVM address, and chain ID
2. EVM wallet signs the hash (produces 64-byte signature + recovery ID)
3. Call `link_evm_address` instruction with signature
4. Program recovers public key via Solana's `secp256k1_recover` syscall
5. Derive Ethereum address from recovered public key (keccak256, last 20 bytes)
6. Verify recovered address matches provided `evm_address`
7. Emit `EvmAddressLinked` event as proof

### Storage

**On-chain**: Event only (no account storage)
**Off-chain**: Agent updates `registrations[]` in registration file per ERC-8004 convention

### Use Cases

- **ERC-8004 linking**: Prove an ERC-8004 agent (Ethereum) controls a SATI agent (Solana)
- **Cross-chain identity**: Verifiable proof of EVM address ownership for any agent
- **Multi-chain presence**: Same agent identity across Solana + EVM chains

### Constraints

- Agent owner must sign the transaction (holds agent NFT)
- One EVM address can link to multiple SATI agents (consistent with ERC-8004)
- No on-chain deduplication — multiple link events for same address are allowed

---

## Design Rationale

### Why Agent-Subsidized Feedback?

Web2 reviews work because they're **free** (Google, Yelp, Amazon = $0). On-chain costs kill participation.

**Solution**: The party who benefits pays. Agents benefit from reputation → agents pay (~$0.002 bundled into service).

### Why Token-2022 for Identity?

| Aspect | SAS Attestation | Token-2022 NFT |
|--------|-----------------|----------------|
| Wallet display | Not shown | Phantom, Solflare |
| Transfer | Close + recreate | Standard transfer |
| Auto ID | Manual | TokenGroupMember.member_number |
| Collections | None | TokenGroup |

### Why Light Protocol?

| Approach | Cost | Indexing |
|----------|------|----------|
| Regular accounts | ~0.002 SOL | RPC (free) |
| Custom merkle | ~0.00001 SOL | Build indexer |
| **Light Protocol** | ~0.00001 SOL | **Photon (free)** |

No custom indexer needed. ZK proofs enable escrow verification.

### Why Blind Feedback?

If agent signs AFTER seeing outcome, they can refuse negative feedback. By signing with response (blind to outcome), agents commit to reputation participation before knowing the sentiment.

---

## Future Features

| Feature | Status | Notes |
|---------|--------|-------|
| Certification schema | Deferred | Third-party certs when demand exists |
| Third-party credentials | Deferred | Platform model when demand exists |
| Agent→Agent delegation | Future | New data type for agent hierarchies |
| Escrow integration | Future | ZK proofs for automatic release |
| Batch reputation updates | Future | Provider updates multiple agents atomically |

### Certification System (Deferred)

Third-party certifications (security audits, compliance, capability verification) are deferred until demand exists. For MVP, certifications can be modeled as ReputationScores where:
- Provider = certified auditor/authority
- Score = 100 (certified) or 0 (not certified)
- content_ref = link to certificate details

When added, Certification may use a new `CredentialAuthority` SignatureMode with whitelisted certifiers, or remain open like ReputationScore with trust delegated to consumers.

### Third-Party Credential System (Deferred)

The spec supports external projects registering their own SAS credentials with SATI for permissionless attestation creation and unified indexing. This "SATI as platform" model adds complexity without immediate value — will be added when third parties express demand.

---

## References

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Token-2022 Program](https://github.com/solana-program/token-2022)
- [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service)
- [Light Protocol](https://github.com/Lightprotocol/light-protocol)
- [Light Protocol Docs](https://www.zkcompression.com/)
- [Photon RPC](https://docs.helius.dev/compression-and-das-api/photon-api)
- [x402 Protocol](https://github.com/coinbase/x402)
