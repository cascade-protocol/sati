# SATI Specification v1.0

## Solana Agent Trust Infrastructure

**Version**: 1.0 | **License**: Apache 2.0

---

## Abstract

SATI is open trust infrastructure for AI agents on Solana solving the economics of on-chain feedback:

- **Agent-subsidized feedback** — Agent signs with response (blind to outcome), client feedback is free
- **x402 native** — Canonical feedback extension; payment tx becomes task reference (CAIP-220)
- **200x cost reduction** — ZK Compression stores attestations at ~$0.002 each
- **Schema agnostic** — Program verifies signatures on 131-byte universal base layout; new schemas without upgrades
- **No reputation monopoly** — Multiple providers compete with different scoring algorithms
- **Hot/cold wallet separation** — Delegates can sign attestations without full ownership permissions
- **On-chain agent enumeration** — AgentIndex PDAs enable listing all agents without external indexing

**Built on**: Token-2022 (identity), SAS (schemas), Light Protocol (storage), Photon (indexing), x402 (payments)

---

## Core Concepts

### Blind Feedback Model

The breakthrough enabling free on-chain feedback. Agent and counterparty sign different data at different times:

| Party | Signs | When | Proves |
|-------|-------|------|--------|
| Agent | `interaction_hash = keccak256(schema \|\| task_ref \|\| data_hash)` | With response | "I served this task" |
| Counterparty | Human-readable SIWS message (see Off-Chain Signing) | After service | "I gave this feedback" |

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
| Agent registration | ~0.003 SOL | Mint + metadata + group + AgentIndex |
| Feedback (single) | ~$0.002 | ~0.00001 SOL via Light |
| Feedback (batched 5/tx) | ~$0.0006 | Amortized proof cost |
| Validation | ~$0.002 | Same as feedback |
| ReputationScore | ~0.002 SOL | Regular SAS attestation |
| Delegation grant | ~0.002 SOL | Regular SAS attestation (reclaimable) |
| Delegation revoke | ~0.000005 SOL | Tx fee only; ~0.002 SOL rent returned |
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
│             (satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe)            │
├─────────────────────────────────────────────────────────────────────┤
│  Registry:                                                           │
│    initialize()                    → Create registry + TokenGroup    │
│    register_agent()                → Token-2022 NFT + group + index  │
│    update_registry_authority()     → Transfer/renounce control       │
│  Attestation:                                                        │
│    register_schema_config()        → Register schema + auth + storage│
│    create_compressed_attestation() → Verify sigs → Light Protocol    │
│    create_regular_attestation()    → Verify sigs → SAS storage       │
│    close_compressed_attestation()  → Close compressed attestation    │
│    close_regular_attestation()     → Close regular attestation       │
└─────────────────────────────────────────────────────────────────────┘
          │                                         │
          │ (CPI: compressed)                       │ (CPI: regular)
          ▼                                         ▼
┌───────────────────────────┐         ┌────────────────────────────────┐
│   Light Protocol          │         │   Solana Attestation Service   │
│   (Compressed Storage)    │         │   (Regular Storage)            │
├───────────────────────────┤         ├────────────────────────────────┤
│ • Feedback attestations   │         │ • ReputationScore attestations │
│ • Validation attestations │         │ • Delegation attestations      │
│ • ~$0.002 per attestation │         │ • ~$0.40 per attestation       │
│ • Photon indexing (free)  │         │ • On-chain queryable (RPC)     │
└───────────────────────────┘         └────────────────────────────────┘
```

| Component | Responsibility |
|-----------|----------------|
| **SATI Program** | Agent registration, signature verification, storage routing, delegation |
| **Token-2022** | Identity storage, metadata, transfers |
| **SAS** | Schema definitions + regular attestation storage |
| **Light Protocol** | Compressed attestation storage |
| **Photon** | Free indexing for compressed accounts |

---

## SATI Program

**Program ID**: `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe`

### Registry

#### RegistryConfig (PDA: `["registry"]`)

| Field | Type | Description |
|-------|------|-------------|
| `group_mint` | Pubkey | SATI TokenGroup mint |
| `authority` | Pubkey | Registry authority (default = immutable) |
| `total_agents` | u64 | Agent counter |
| `bump` | u8 | PDA bump |

#### AgentIndex (PDA: `["agent_index", member_number]`)

| Field | Type | Description |
|-------|------|-------------|
| `mint` | Pubkey | Agent mint address |
| `bump` | u8 | PDA bump |

**Size**: 8 (discriminator) + 32 (mint) + 1 (bump) = 41 bytes (~0.0003 SOL)

> **Why AgentIndex?** Token-2022 TokenGroupMember stores `member_number` but provides no query mechanism. `getProgramAccounts` with memcmp fails because extension offsets vary by extension order. AgentIndex provides a forward index: derive PDA from `member_number`, fetch `mint`.

> **Invariant**: AgentIndex PDAs are never deleted. Enumeration relies on sequential member_numbers with no gaps. Concurrent registrations are safe due to PDA collision protection (second tx fails if same member_number).

#### Instructions

| Instruction | Parameters | Behavior |
|-------------|------------|----------|
| `initialize` | — | Create registry + TokenGroup (one-time) |
| `register_agent` | name, symbol*, uri, additional_metadata?, non_transferable | Create Token-2022 NFT, add to group, create AgentIndex PDA, renounce mint |
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

`InvalidGroupMint` · `InvalidAuthority` · `ImmutableAuthority` · `NameTooLong` · `SymbolTooLong` · `UriTooLong` · `TooManyMetadataEntries` · `MetadataKeyTooLong` · `MetadataValueTooLong` · `Overflow` · `MintAuthorityNotRenounced`

**EVM linking errors:**
- `InvalidSecp256k1Signature` — invalid secp256k1 signature format
- `Secp256k1RecoveryFailed` — secp256k1 public key recovery failed
- `EvmAddressMismatch` — recovered address doesn't match provided `evm_address`
- `InvalidEvmAddressRecovery` — failed to extract EVM address from recovered key

### Attestation

#### SchemaConfig (PDA: `["schema_config", schema]`)

| Field | Type | Description |
|-------|------|-------------|
| `sas_schema` | Pubkey | SAS schema address |
| `signature_mode` | SignatureMode | DualSignature / CounterpartySigned / AgentOwnerSigned |
| `storage_type` | StorageType | Compressed / Regular |
| `delegation_schema` | `Option<Pubkey>` | Schema for delegation verification (None = owner only) |
| `closeable` | bool | Whether attestations can be closed |
| `name` | String | Schema name for signing messages (max 32 chars) |
| `bump` | u8 | PDA bump seed |

**`delegation_schema` semantics**:
- `Some(schema)`: Owner OR valid delegate can sign (delegation checked against specified schema)
- `None`: Only owner can sign (used for DelegateV1 itself to prevent recursive delegation)

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
| `data` | Vec&lt;u8&gt; | 64+ | Schema-conformant bytes (universal base layout) |
| `num_signatures` | u8 | varies | Number of signatures (1 or 2) |
| `signature1` | [u8; 64] | varies | First Ed25519 signature |
| `signature2` | [u8; 64] | varies | Second Ed25519 signature (zeros if single-sig) |

#### Universal Base Data Layout (first 131 bytes)

All schemas MUST use this universal layout:

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 1 | `layout_version` | Layout version (currently `1`) |
| 1 | 32 | `task_ref` | CAIP-220 tx hash or task identifier |
| 33 | 32 | `token_account` | Agent mint address |
| 65 | 32 | `counterparty` | Attester pubkey (Ed25519) |
| 97 | 1 | `outcome` | Universal: 0=Negative, 1=Neutral, 2=Positive |
| 98 | 32 | `data_hash` | Agent's blind commitment (zeros for AgentOwnerSigned/CounterpartySigned) |
| 130 | 1 | `content_type` | Format: 0=None, 1=JSON, 2=UTF-8, 3=IPFS, 4=Arweave, 5=Encrypted |
| 131 | var | `content` | Variable length, up to 512 bytes |

**On-chain validation:**
- `layout_version` == 1 (reject unknown versions for forward compatibility)
- `outcome` ∈ {0, 1, 2} (0=Negative, 1=Neutral, 2=Positive)
- `content_type` ≤ 15 (0-5 defined, 6-15 reserved for future)
- Data length ≥ 131 bytes

> **Layout versioning**: The `layout_version` byte enables future layout changes without requiring new schemas. Indexers and SDKs check byte 0 first to determine parsing strategy. Version 0 is reserved (never used). Future versions (2+) may add fields, reorder for alignment, or change semantics.

**`data_hash` semantics:** For DualSignature schemas, this is the agent's cryptographic commitment (`keccak256(request || response)`). For AgentOwnerSigned schemas, this field stores schema-specific data (e.g., delegator pubkey for DelegateV1) or zeros if unused. For CounterpartySigned schemas, this field should be zero-filled.

Program parses offsets 0-130 for signature binding and base validation. Content structure parsed by SDK/indexers.

> **Note on `token_account` naming**: This field stores the **agent's mint address** (the stable identity), not an Associated Token Account (ATA). The name `token_account` is inherited from the SAS specification for wire format efficiency (avoids adding 32 bytes per attestation).
>
> **SDK convention**: Use `agentMint` in SDK types and public APIs for clarity. The SDK handles the mapping to `token_account` in wire format internally. On-chain programs and wire format retain `token_account` for SAS compatibility.

**Note on timestamps**: Attestation creation time is tracked via Photon's `slotCreated` field. For interaction time (when the original event occurred), clients can look up the transaction referenced in `task_ref`.

#### Signature Verification (On-Chain)

Signatures are **extracted** from Ed25519 precompile instructions in the transaction, matched by **message content** (not index). This is resilient to transactions containing unrelated Ed25519 instructions from other protocols.

Verification differs by `SignatureMode`:

**DualSignature** (Feedback, Validation):
1. Extract 2 signatures from Ed25519 instructions by matching expected messages
2. **Agent authorization**: `verify_agent_authorization()` for signer of interaction_hash message
3. **Counterparty binding**: Verify SIWS message signer matches pubkey from `data[65..97]`
4. **Self-attestation**: `token_account != counterparty`

**AgentOwnerSigned** (DelegateV1):
1. Extract 1 signature matching interaction_hash message
2. **Agent authorization**: `verify_agent_authorization()` for extracted signer
3. No counterparty binding (signer IS the agent owner/delegate)

**CounterpartySigned** (FeedbackPublic, ReputationScore):
1. Extract 1 signature matching interaction_hash message
2. **No agent authorization** — anyone can submit about any agent
3. **Counterparty binding**: Verify extracted signer matches pubkey from `data[65..97]`
4. **Self-attestation**: `token_account != counterparty`

> **Note**: `token_account` is the agent's MINT ADDRESS. For DualSignature/AgentOwnerSigned, the agent OWNER (or delegate) signs the interaction_hash. For DualSignature, counterparty signs the SIWS message. For CounterpartySigned, only the counterparty signs the interaction_hash.

#### verify_agent_authorization()

Verification steps for agent authorization:

1. **Owner fast path** (~100 CU): If signer equals agent ATA owner, authorize immediately
2. **Delegation required**: If `delegation_schema` is `None`, reject with `OwnerOnly`
3. **Attestation required**: Delegation attestation must be provided
4. **PDA verification**: Derive expected PDA using `keccak256(schema || signer || agent_mint)` as nonce with SATI credential; reject if attestation key doesn't match (prevents schema confusion)
5. **Delegate binding**: Verify `counterparty` field equals signer
6. **Agent binding**: Verify `token_account` field equals agent mint
7. **Owner binding**: Verify `data_hash` field equals current ATA owner (invalidates delegation after NFT transfer)
8. **Expiration check**: Verify `expiry == 0` OR `expiry > current_timestamp`

> **Note**: PDA verification ensures the attestation belongs to the expected DelegateV1 schema, preventing attestation confusion attacks. The `data_hash` check invalidates delegation when the agent NFT is transferred. The `sati_credential` used in PDA derivation is the SATI SAS credential account (derived from authority + "SATI" name).

#### Off-Chain Message Signing Format (Wallet UX)

Counterparty signs a human-readable SIWS-inspired message for Phantom/Solflare:

```
SATI {schema_name}

Agent: {base58(token_account)}
Task: {base58(task_ref)}
Outcome: {Negative|Neutral|Positive}
Details: {content as UTF-8, or "[Encrypted]"}

Sign to create this attestation.
```

**Fields:**
| Field | Source | Description |
|-------|--------|-------------|
| `schema_name` | SchemaConfig.name | Schema identifier (e.g., "feedback") |
| `Agent` | data[33..65] | Agent mint address as base58 |
| `Task` | data[1..33] | Task reference as base58 |
| `Outcome` | data[97] | Mapped: 0→Negative, 1→Neutral, 2→Positive |
| `Details` | data[131..] | Content as UTF-8, or "[Encrypted]" if content_type=5 |

**Example (Feedback):**
```
SATI feedback

Agent: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
Task: 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
Outcome: Positive
Details: {"score":85,"tags":["helpful","fast"],"m":"Great service!"}

Sign to create this attestation.
```

**Signature types:**
- **Agent**: Signs `interaction_hash = keccak256(DOMAIN_INTERACTION || schema || task_ref || data_hash)` — 32-byte hash
- **Counterparty**: Signs the full human-readable message above (~300 bytes) — bypasses Phantom's 32-byte restriction

> **Note**: The human-readable format enables wallet display while the full message (~300 bytes) bypasses Phantom's restriction on signing 32-byte messages (which look like transaction hashes).

#### Instructions

| Instruction | Parameters | Behavior |
|-------------|------------|----------|
| `register_schema_config` | schema, signature_mode, storage_type, delegation_schema, closeable, name | Register schema config (authority only) |
| `create_compressed_attestation` | data, proof, address_tree_info, output_state_tree_index | Verify sigs → Light Protocol |
| `create_regular_attestation` | data, expiry | Verify sigs → SAS storage |
| `close_compressed_attestation` | proof, account_meta, current_data | Close compressed attestation |
| `close_regular_attestation` | attestation_pda | Close regular attestation |

> **Note on signature handling**: Signatures are NOT included in instruction parameters. The program extracts pubkeys and signatures directly from Ed25519 precompile instructions that MUST precede the SATI instruction in the same transaction. This optimization saves ~192 bytes for DualSignature transactions (2× pubkey + 2× signature), enabling larger attestation content.

> **Note**: Instructions are named explicitly for their storage type to avoid ambiguity. `delegation_schema` in `register_schema_config` controls whether delegates can sign attestations for that schema.

**Routing**: Program checks `SchemaConfig.storage_type` and CPIs to Light Protocol (compressed) or SAS (regular). SATI Program PDA is the sole authorized signer for both storage backends.

#### Events

| Event | Fields |
|-------|--------|
| `SchemaConfigRegistered` | schema, signature_mode, storage_type, delegation_schema, closeable, name |
| `AttestationCreated` | sas_schema, token_account, counterparty, storage_type, address |
| `AttestationClosed` | sas_schema, token_account, address |

#### Errors

`SchemaConfigNotFound` · `InvalidSignatureCount` · `InvalidSignature` · `StorageTypeNotSupported` · `StorageTypeMismatch` · `AttestationDataTooSmall` · `AttestationDataTooLarge` · `ContentTooLarge` · `SignatureMismatch` · `SelfAttestationNotAllowed` · `AgentAtaMintMismatch` · `AgentAtaEmpty` · `AgentAtaRequired` · `UnauthorizedClose` · `AttestationNotCloseable` · `InvalidOutcome` · `InvalidContentType` · `UnsupportedLayoutVersion` · `LightCpiInvocationFailed`

**Ed25519 signature verification:**
- `InvalidEd25519Instruction` — invalid Ed25519 instruction format
- `MissingSignatures` — required Ed25519 signatures not found in transaction
- `MessageMismatch` — signature was for different data than expected
- `InvalidInstructionsSysvar` — invalid instructions sysvar
- `DuplicateSigners` — duplicate signers not allowed for dual signature mode
- `Ed25519InstructionNotFound` — no Ed25519 instruction in transaction
- `AgentSignatureNotFound` — agent's Ed25519 signature not found
- `CounterpartySignatureNotFound` — counterparty's Ed25519 signature not found

**Universal base layout validation:**
- `InvalidOutcome` — outcome not in {0, 1, 2}
- `InvalidContentType` — content_type > 15 (0-5 defined, 6-15 reserved)
- `UnsupportedLayoutVersion` — layout version not supported

**Delegation validation:**
- `OwnerOnly` — schema requires owner signature but delegate attempted
- `DelegationAttestationRequired` — delegate signed but no delegation attestation provided
- `InvalidDelegationPDA` — delegation attestation PDA doesn't match expected derivation
- `DelegateMismatch` — delegation attestation delegate doesn't match signer
- `AgentMintMismatch` — delegation attestation agent doesn't match target agent
- `DelegationOwnerMismatch` — delegation was created by different owner (NFT was transferred)
- `DelegationExpired` — delegation attestation has expired

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

**Common additionalMetadata keys:**
- `agentWallet` — Agent's payment wallet (CAIP-10 format)
- `did` — Decentralized identifier
- `a2a` — Agent-to-Agent endpoint URL
- `mcp` — MCP server endpoint URL

### Operations

- **Update metadata**: Direct `spl-token-metadata` calls
- **Transfer**: Standard Token-2022 transfer
- **Smart accounts**: Squads can own via ATAs

---

## Schemas

### Core Schemas

| Schema | Storage | SignatureMode | Closeable | delegation_schema | Status |
|--------|---------|---------------|-----------|-------------------|--------|
| FeedbackV1 | Compressed | DualSignature | No | DelegateV1 | ✅ MVP |
| FeedbackPublicV1 | Compressed | CounterpartySigned | No | None | ✅ MVP |
| ValidationV1 | Compressed | DualSignature | No | DelegateV1 | ✅ MVP |
| ReputationScoreV1 | Regular | CounterpartySigned | Yes | None | ✅ MVP |
| DelegateV1 | Regular | AgentOwnerSigned | Yes | None | ✅ MVP |

**SignatureMode determines payload signature requirements:**

| Mode | Signatures | Use Case |
|------|------------|----------|
| DualSignature | 2 | Feedback, Validation (blind feedback model) |
| CounterpartySigned | 1 | FeedbackPublic, ReputationScore (counterparty/provider signs) |
| AgentOwnerSigned | 1 | DelegateV1 (agent owner or delegate signs) |

> **Note**: `SingleSigner` was split into `CounterpartySigned` and `AgentOwnerSigned` to distinguish who must sign. This enables delegation for AgentOwnerSigned schemas while preventing it for CounterpartySigned schemas.

### FeedbackV1 Schema

Uses universal base layout (131 bytes) + JSON content for extensibility.

| Field | Offset | Description |
|-------|--------|-------------|
| layout_version | 0 | `1` (current layout version) |
| task_ref | 1-32 | CAIP-220 tx hash or task identifier |
| token_account | 33-64 | Agent mint address |
| counterparty | 65-96 | Client pubkey |
| outcome | 97 | 0=Negative, 1=Neutral, 2=Positive |
| data_hash | 98-129 | Agent's blind commitment (`keccak256(request \|\| response)`) |
| content_type | 130 | 1=JSON (recommended), 0=None, 2=UTF-8, 5=Encrypted |
| content | 131+ | JSON with optional fields (see below) |

**JSON Content Fields** (all optional):

```json
{
  "score": 85,                         // ERC-8004 score (0-100)
  "tags": ["helpful", "fast"],         // Category tags
  "m": "Great service!"                // Message/comment
}
```

**Size**: 131 bytes minimum (empty content), typical 180-250 bytes with JSON content.

**Fixed offset benefit**: `outcome` at offset 97 enables Photon memcmp filtering by feedback sentiment.

**ERC-8004 compatibility**: Include `score` in JSON content for ERC-8004 interoperability. The `outcome` field provides categorical filtering (Negative/Neutral/Positive) while `score` provides granular 0-100 values.

### FeedbackPublicV1 Schema

Public feedback that anyone can submit about an agent without agent participation. Uses CounterpartySigned mode (counterparty signature only, no agent signature required).

| Field | Offset | Description |
|-------|--------|-------------|
| layout_version | 0 | `1` (current layout version) |
| task_ref | 1-32 | CAIP-220 tx hash or task identifier |
| token_account | 33-64 | Agent mint address |
| counterparty | 65-96 | Feedback author pubkey |
| outcome | 97 | 0=Negative, 1=Neutral, 2=Positive |
| data_hash | 98-129 | Zero-filled (CounterpartySigned mode, no blind commitment) |
| content_type | 130 | 1=JSON (recommended), 0=None, 2=UTF-8, 5=Encrypted |
| content | 131+ | JSON with optional fields (same as FeedbackV1) |

**Key difference from FeedbackV1**: No agent signature required. Anyone can submit feedback about any agent. The agent does not participate in the blind feedback model.

**Use cases**:
- Public reviews where agent participation is not required
- Third-party assessments or ratings
- Community-sourced feedback

**Trade-off**: Without agent signature, there's no cryptographic proof the agent actually served the referenced task. Trust depends on the `task_ref` being verifiable through other means (e.g., on-chain payment transaction).

### ValidationV1 Schema

Uses universal base layout (131 bytes) + JSON content for validation details.

| Field | Offset | Description |
|-------|--------|-------------|
| layout_version | 0 | `1` (current layout version) |
| task_ref | 1-32 | Task reference |
| token_account | 33-64 | Agent mint address |
| counterparty | 65-96 | Validator pubkey |
| outcome | 97 | 0=Fail, 1=Inconclusive, 2=Pass |
| data_hash | 98-129 | Agent's work commitment |
| content_type | 130 | 1=JSON (recommended), 0=None, 5=Encrypted |
| content | 131+ | JSON with validation details (see below) |

**JSON Content Fields** (all optional):

```json
{
  "type": "tee",                       // Validation type: tee/zkml/reexecution/consensus
  "confidence": 95,                    // 0-100 confidence score
  "report": "..."                      // Validation report/details
}
```

**Size**: 131 bytes minimum (empty content), typical 150-200 bytes with JSON content.

**Fixed offset benefit**: `outcome` at offset 97 enables Photon memcmp filtering by validation result.

**Validation types**: `tee` (TEE attestation), `zkml` (ZK-ML proof), `reexecution` (deterministic replay), `consensus` (multi-validator agreement).

### ReputationScoreV1 Schema

Provider-computed scores using `StorageType::Regular` for direct on-chain queryability. Uses CounterpartySigned mode (provider signature only).

| Field | Offset | Description |
|-------|--------|-------------|
| layout_version | 0 | `1` (current layout version) |
| task_ref | 1-32 | Deterministic: `keccak256(counterparty \|\| token_account)` |
| token_account | 33-64 | Agent mint address being scored |
| counterparty | 65-96 | Provider (reputation scorer) |
| outcome | 97 | Provider's categorical assessment (0=Poor, 1=Average, 2=Good) |
| data_hash | 98-129 | Zero-filled (CounterpartySigned mode, no blind commitment) |
| content_type | 130 | 1=JSON (recommended) |
| content | 131+ | JSON with score details (see below) |

**JSON Content Fields** (all optional):

```json
{
  "score": 85,                         // 0-100 normalized score
  "methodology": "weighted_average",   // Scoring algorithm identifier
  "feedbackCount": 42,                 // Number of feedbacks analyzed
  "validationCount": 5                 // Number of validations analyzed
}
```

**Size**: 131 bytes minimum (empty content), typical 150-250 bytes with JSON content.

**Semantics**: One ReputationScore per (provider, agent) pair. Providers update by closing old attestation and creating new one with same deterministic nonce. On-chain creation time is tracked via SAS attestation metadata.

### DelegateV1 Schema

Authorization attestation allowing a delegate to sign on behalf of an agent owner. Uses `StorageType::Regular` for on-chain queryability and `SignatureMode::AgentOwnerSigned` with `delegation_schema: None` (owner only, no recursive delegation).

| Field | Offset | Description |
|-------|--------|-------------|
| layout_version | 0 | `1` (current layout version) |
| task_ref | 1-32 | Reserved (zeros) |
| token_account | 33-64 | Agent mint address |
| counterparty | 65-96 | Delegate pubkey (who receives authorization) |
| outcome | 97 | Reserved (0) |
| data_hash | 98-129 | Delegator pubkey (owner at delegation time) |
| content_type | 130 | 0=None |
| content | 131+ | Empty |

**SAS Schema Definition:**

```typescript
export const DELEGATE_SAS_SCHEMA: SASSchemaDefinition = {
  name: "DelegateV1",
  description: "Delegation authorization for hot wallet signing",
  // Layout types: u8=0, pubkey=7, blob=9
  layout: [0, 7, 7, 7, 0, 7, 0, 9],
  fieldNames: ["layout_version", "task_ref", "token_account", "counterparty", "outcome", "data_hash", "content_type", "content"],
};
```

**Address Derivation (deterministic nonce)**:

```rust
// One delegation per (schema, delegate, agent) tuple
// Using schema pubkey as domain separator enables future delegation versions
let nonce = keccak256(delegate_schema.as_ref(), delegate, agent_mint);
```

**Expiration**: Uses SAS attestation `expiry` field. `0` = no expiration.

**Revocation**: Owner calls `close_regular_attestation` to revoke.

**Size**: 131 bytes (no content).

> **Why SAS for delegation?** Reuses existing infrastructure: built-in expiration, existing close mechanism, existing query patterns. Tradeoff: ~5-10k CU for delegate verification vs ~300 CU for custom PDA, but only applies when delegate signs (owner signing is ~100 CU fast path). Squads doesn't solve this — it requires human approval per action, incompatible with automated attestation signing.

### Delegation Authorization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  DELEGATION LIFECYCLE                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. GRANT (Owner only):                                         │
│     Owner calls create_regular_attestation(DelegateV1, ...)     │
│       • delegation_schema: None → owner-only check              │
│       • Creates SAS attestation with deterministic nonce        │
│       • data_hash = delegator (current owner)                   │
│                                                                  │
│  2. USE:                                                         │
│     Delegate calls create_*_attestation(Feedback/etc, ...)      │
│       • delegation_schema: Some(DelegateV1) → check delegation  │
│       • verify_agent_authorization():                           │
│         - If signer == owner → OK (fast path, ~100 CU)         │
│         - Else lookup DelegateV1 attestation                   │
│         - Verify: counterparty == signer (delegate)            │
│         - Verify: token_account == agent mint                  │
│         - Verify: data_hash == current owner (transfer safety) │
│         - Verify: not expired                                   │
│         - If valid → OK (slow path, ~5-10k CU)                 │
│                                                                  │
│  3. REVOKE (Owner only):                                        │
│     Owner calls close_regular_attestation(DelegateV1 PDA)       │
│       • delegation_schema: None → owner-only check              │
│       • Closes attestation, rent reclaimed                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

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

**Delegation Attestations (SAS):**

```rust
// Use schema pubkey as domain separator - enables future delegation versions
let nonce = keccak256(delegate_schema.as_ref(), delegate, agent_mint);

// SAS PDA derivation
let (delegation_pda, _) = Pubkey::find_program_address(
    &[b"attestation", sati_credential, delegate_schema, &nonce.to_bytes()],
    &SAS_PROGRAM_ID
);
```

**Deterministic nonce** ensures one delegation per (schema, delegate, agent) tuple. Using schema pubkey as domain separator allows multiple delegation schema versions to coexist.

### Content Types

The `content_type` field determines how to interpret the variable-length `content` field:

| Code | Type | Content | Use Case |
|------|------|---------|----------|
| 0 | None | Empty | Just use outcome (no extended content) |
| 1 | JSON | Inline JSON object | Structured feedback with metadata |
| 2 | UTF-8 | Plain text | Simple text feedback |
| 3 | IPFS | CIDv1 (~36 bytes) | Large content stored off-chain |
| 4 | Arweave | Transaction ID (32 bytes) | Permanent off-chain storage |
| 5 | Encrypted | X25519-XChaCha20-Poly1305 payload | End-to-end encrypted content |
| 6-15 | Reserved | — | Future content types |

**On-chain validation**: `content_type ≤ 15`. Values 6-15 are reserved for future use without program upgrades.

**Size limit**: `MAX_CONTENT_SIZE = 512 bytes`. Enforced on-chain. For larger content, use IPFS/Arweave.

**Examples:**

```json
// content_type=1 (JSON), ~60 bytes
{"score":85,"tags":["helpful"],"m":"Fast and accurate"}

// content_type=2 (UTF-8), ~30 bytes
"Excellent service, would recommend"

// content_type=0 (None)
// Empty content, just use outcome
```

**Design rationale**: Simple feedback doesn't need IPFS. Inline JSON/UTF-8 is directly readable by indexers without external fetches.

### Encrypted Content (ContentType = 5)

End-to-end encrypted content using X25519-XChaCha20-Poly1305. Only the intended recipient can decrypt.

**Wire Format:**

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 1 | Version | Protocol version (0x01) |
| 1 | 32 | Ephemeral Public Key | X25519 public key for ECDH |
| 33 | 24 | Nonce | XChaCha20 nonce |
| 57 | variable | Ciphertext | Encrypted content + 16-byte Poly1305 tag |

**Size Constraints:**
- Minimum overhead: 73 bytes (1 + 32 + 24 + 16)
- Maximum plaintext: 439 bytes (512 - 73)
- Total must fit within `MAX_CONTENT_SIZE = 512 bytes`

**Key Derivation:**

1. **Recipient Key**: Convert Ed25519 Solana keypair to X25519 using the standard birational map:
   ```
   x25519_private = Ed25519_to_X25519_private(ed25519_seed)  // RFC 8032 compatible
   x25519_public = Ed25519_to_X25519_public(ed25519_public)   // Montgomery form conversion
   ```
   Note: This uses the standard curve conversion, not HKDF. Solana wallets can derive encryption keys deterministically.

2. **Shared Secret**: Ephemeral ECDH key exchange:
   ```
   shared_secret = X25519(ephemeral_private, recipient_public)
   ```

3. **Encryption Key**: Derive from shared secret via HKDF:
   ```
   encryption_key = HKDF-SHA256(shared_secret, salt=ephemeral_public, info="sati-v1", len=32)
   ```

**Encryption Process:**
1. Generate ephemeral X25519 keypair
2. Compute shared secret via ECDH
3. Derive encryption key via HKDF
4. Generate random 24-byte nonce
5. Encrypt plaintext with XChaCha20-Poly1305
6. Serialize: `version || ephemeral_public || nonce || ciphertext`
7. Zero ephemeral private key

**Decryption Process:**
1. Deserialize payload components
2. Derive recipient's X25519 private key from Ed25519
3. Compute shared secret via ECDH
4. Derive encryption key via HKDF
5. Decrypt and verify with XChaCha20-Poly1305

**Semantics:**
- Only the recipient (agent) can decrypt content
- Base fields (outcome, counterparty, task_ref) remain unencrypted and queryable
- Content field contains the serialized encrypted payload
- Forward secrecy: ephemeral keypair per encryption

**Example:**

```typescript
import { encryptContent, deriveEncryptionKeypair } from '@cascade-fyi/sati-sdk';

// Derive agent's encryption public key
const { publicKey } = deriveEncryptionKeypair(agentEd25519Seed);

// Encrypt feedback content
const plaintext = JSON.stringify({ score: 85, m: "Private feedback" });
const encrypted = encryptContent(
  new TextEncoder().encode(plaintext),
  publicKey
);

// Use in FeedbackData
const feedback = {
  contentType: ContentType.Encrypted,  // 5
  content: serializeEncryptedPayload(encrypted),
  // ... other fields remain unencrypted
};
```

**Privacy Guarantees:**
- Content confidentiality: Only recipient can read
- Forward secrecy: Compromise of long-term key doesn't expose past messages
- Integrity: Poly1305 tag prevents tampering

**Limitations:**
- Metadata visible: counterparty, outcome, timestamps remain public
- Ciphertext length reveals approximate plaintext length
- No key rotation mechanism (uses wallet-derived keys)

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

**Filters**: `sas_schema` (offset 0), `token_account` (offset 32), `outcome` (offset 68 + 97 = 165, within data field)

### SAS (Regular Storage)

Stores ReputationScore and Delegation as standard Solana accounts for direct on-chain queryability.

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

**Tradeoff**: Regular attestations cost ~200x more but are directly queryable on-chain by other programs (useful for escrow, governance, delegation verification).

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
| | `listAllAgents()` | `AgentIdentity[]` |
| | `getAgentByMemberNumber(n)` | `AgentIdentity \| null` |
| | `updateAgentMetadata(params)` | `{ signature }` |
| | `transferAgent(params)` | `{ signature }` |
| **Delegation** | `createDelegation(params)` | `{ address, signature }` |
| | `revokeDelegation(params)` | `{ signature }` |
| | `getDelegation(delegate, tokenAccount)` | `Delegation \| null` |
| | `listDelegations(tokenAccount)` | `Delegation[]` |
| | `listDelegationsByDelegate(delegate)` | `Delegation[]` |
| | `verifyDelegation(delegate, tokenAccount)` | `boolean` |
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
| **Signing** | `computeDataHash(request, response)` | `Uint8Array` |
| | `computeDataHashFromStrings(request, response)` | `Uint8Array` |
| | `computeInteractionHash(schema, taskRef, dataHash)` | `Uint8Array` |
| | `buildCounterpartyMessage(schemaName, data)` | `string` |
| | `zeroDataHash()` | `Uint8Array` (32 zeros for OwnerSigned) |
| **Validation** | `validateBaseLayout(data)` | `void` (throws on invalid) |
| | `validateFeedbackContent(content)` | `void` (throws on invalid) |
| | `validateReputationScoreContent(content)` | `void` (throws on invalid) |
| **Identity** | `linkEvmAddress(params)` | `{ signature }` |

### createFeedback Example

```typescript
// SDK builds Ed25519 instructions from provided signatures automatically
await sati.createFeedback({
  tokenAccount,
  counterparty: clientPubkey,
  outcome: Outcome.Positive,
  taskRef: paymentTxHash,  // CAIP-220 format
  agentSignature: agentSig,      // Signs interaction_hash
  counterpartySignature: clientSig,  // Signs SIWS message
});
// Note: SDK constructs Ed25519 precompile instruction(s) that precede
// the SATI instruction. The program extracts signatures from Ed25519 ix.
```

### createDelegation Example

```typescript
// Owner grants delegation to hot wallet
await sati.createDelegation({
  tokenAccount: agentMint,
  delegate: hotWalletPubkey,
  expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,  // 30 days
  ownerSignature: ownerSig,  // Owner signs to authorize delegation
  // delegator (data_hash) is set automatically to current owner
});

// Hot wallet can now sign feedback on behalf of agent
await sati.createFeedback({
  tokenAccount: agentMint,
  counterparty: clientPubkey,
  outcome: Outcome.Positive,
  taskRef: paymentTxHash,
  agentSignature: hotWalletSig,      // Delegate signs instead of owner
  counterpartySignature: clientSig,  // Client signs SIWS
  // SDK automatically detects signer != owner, fetches delegation attestation
});
```

> **SDK Auto-Lookup**: When signer differs from agent owner, SDK automatically derives the delegation PDA, fetches it, validates expiration, and includes it in the transaction. Caller does not need to explicitly provide delegation attestation.

---

## Security

### On-Chain Guarantees

| Property | Enforcement |
|----------|-------------|
| Layout version | Verified == 1 (reject unknown versions) |
| Signature validity | Ed25519 verification (precompile) |
| Blind feedback | Agent signs before outcome known |
| Agent authorization | ATA ownership OR valid delegation |
| Counterparty binding | Verify signature using pubkey from `data[65..97]` |
| Self-attestation prevention | `token_account ≠ counterparty` |
| Duplicate prevention | Deterministic address from task_ref |
| Outcome range | Verified ∈ {0, 1, 2} before storage |
| Content type range | Verified ≤ 15 before storage (0-5 defined, 6-15 reserved) |
| Closeable enforcement | Schema config controls whether close is allowed |

### Close Authorization

Close authorization follows the principle: **the signing party controls closure**.

| Schema | Closeable | Who Can Close | Rationale |
|--------|-----------|---------------|-----------|
| FeedbackV1 | No | — | Permanent record |
| FeedbackPublicV1 | No | — | Permanent record |
| ValidationV1 | No | — | Permanent record |
| ReputationScoreV1 | Yes | Provider (counterparty) only | Provider created it; agent cannot delete unfavorable scores |
| DelegateV1 | Yes | Agent owner only | Owner controls their own delegations |

> **Note**: For single-signature modes, only the signing party can close. For DualSignature schemas (if closeable in future), either party could close since both consented to creation. Delegates cannot close attestations—only the original signing party (agent owner for DelegateV1, provider for ReputationScoreV1).

### Delegation Permissions

**What delegates CAN do:**
- Sign `create_compressed_attestation` for schemas with `delegation_schema: Some(DelegateV1)`
- Sign `create_regular_attestation` for schemas with `delegation_schema: Some(DelegateV1)`

**What delegates CANNOT do:**
- Create sub-delegations (DelegateV1 has `delegation_schema: None`)
- Close attestations (`close_*_attestation` requires owner)
- Revoke their own delegation (requires owner)
- Transfer the agent NFT (Token-2022 requires owner signature)
- Update agent metadata (Token-2022 requires updateAuthority)

> **Note**: Delegation scope is all-or-nothing for attestation signing. A delegate authorized for one schema can sign for ALL schemas that allow delegation. Granular per-schema delegation is not supported in v1.0.

### Delegation Security

| Property | Enforcement |
|----------|-------------|
| Owner-only delegation grant | `delegation_schema: None` for DelegateV1 → signer must be owner |
| No recursive delegation | DelegateV1 has `delegation_schema: None` → delegates cannot create sub-delegates |
| Transfer invalidation | `delegator` field checked against current owner → delegation invalid after NFT transfer |
| Expiration enforcement | SAS attestation `expiry` checked in `verify_agent_authorization()` |
| Deterministic nonce | One delegation per (schema, delegate, agent) tuple → no duplicate delegations |

**Attack Mitigations:**

| Attack | Mitigation |
|--------|------------|
| Delegate persists after NFT sale | `delegator == current_owner` check invalidates old delegations |
| Expired delegation use | Explicit expiry check in verification |
| Schema/PDA confusion | Verify attestation PDA matches expected derivation before deserializing |
| Account confusion | Deserialize and verify ALL fields (delegate, agent_mint, delegator) |
| Recursive delegation | DelegateV1's `delegation_schema: None` prevents delegates from delegating |

### Off-Chain Validation (SDK/Indexer)

| Property | Enforcement |
|----------|-------------|
| task_ref format | SDK validates CAIP-220 |
| JSON content structure | SDK validates schema-specific fields |
| Score range (0-100) | SDK validates for Feedback/ReputationScore |
| Confidence range (0-100) | SDK validates for Validation |
| Tag length (max 32 chars) | SDK validates in JSON content |
| Timestamp filtering | Client-side filtering via Photon `slotCreated` |

**Rationale**: Schema-specific validation is performed by SDK, not on-chain. This allows new schemas to be registered without program upgrades. The program validates only universal base layout fields.

### Trust Model

| Component | Trust Assumption |
|-----------|-----------------|
| SATI Programs | Correctly verify signatures and delegation |
| Light Protocol | State tree integrity |
| Photon | Accurate indexing |
| SDK | Validates formats, constructs hashes |

### Known Limitations

- **Sybil resistance**: Prevents self-attestation but not multiple wallets. Reputation providers implement sybil-resistant scoring.
- **No pending state**: The protocol has no concept of "pending" validation or feedback. Attestations only exist once both signatures are collected and submitted. There is no on-chain way to check if a validation is in progress but not yet complete.
- **Timestamp trust**: The `timestamp` field is set by the submitter and not verified against on-chain time. It should be trusted for ordering purposes only, not as cryptographic proof of time.
- **Delegation race condition**: Between revocation and transaction landing, a delegate could complete one more operation. This is inherent to blockchain finality.
- **Stale delegations after transfer**: When an agent NFT transfers, old delegations become invalid but their PDAs remain. New owner must call `close_regular_attestation` to reclaim rent before creating new delegations for the same delegate.

---

## Deployment

### Addresses

| Component | Address |
|-----------|---------|
| SATI Program | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |
| SAS Program | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` |
| TokenGroup Mint | `satiG7i9iyFxjq23sdyeLB4ibAHf6GXCARuosGeqane` |
| SAS Credential | Derived at deployment from authority + "SATI" |
| Lookup Table | Derived at deployment from authority + slot |

**SAS Schemas**:
- FeedbackV1
- FeedbackPublicV1
- ValidationV1
- ReputationScoreV1
- DelegateV1

**Note**: Registry Config PDA derived from `["registry"]`. SAS Credential, Schema PDAs, SchemaConfig PDAs, and Lookup Table addresses are deterministic but generated at deployment time. See `packages/sdk/src/deployed/{network}.json` for deployed addresses.

### Governance

**Authority lifecycle**: Launch (multisig) → Stable (multisig) → Immutable (renounced)

- Registry authority controls `update_registry_authority()` only
- Upgrade authority controls program deployment
- Both independently renounceable

**Schema governance**: Versioned, not upgraded. New schema = new version (e.g., FeedbackV2).

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
| `revokeFeedback()` | ✅ | close_compressed_attestation() |
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
    { "agentId": "sati:mainnet:ABC123mint", "agentRegistry": "solana:5eykt4...:satiRkx..." },
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
4. (Optional) Call `link_evm_address` to prove EVM address ownership
5. (Optional) Register on additional chains and update file

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
| Registry address | `solana:5eykt4...:satiRkx...` (CAIP-10) |

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

**On-chain (Event):** `EvmAddressLinked` event emitted for indexing.

**Off-chain:** Agent updates `registrations[]` in registration file per ERC-8004 convention.

### Use Cases

- **ERC-8004 linking**: Prove an ERC-8004 agent (Ethereum) controls a SATI agent (Solana)
- **Cross-chain identity**: Verifiable proof of EVM address ownership for any agent
- **Multi-chain presence**: Same agent identity across Solana + EVM chains

### Constraints

- Agent owner must sign the transaction (holds agent NFT)
- One EVM address can link to multiple SATI agents (consistent with ERC-8004)
- Multiple chain IDs can be linked per agent (e.g., both Ethereum and Base)

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

### Why Delegation?

Hot/cold wallet separation: agent must sign every response (blind feedback), but hot wallet shouldn't control NFT transfers/metadata. Delegation allows hot wallet to sign attestations while cold wallet retains ownership. See DelegateV1 schema for implementation details.

---

## Future Features

| Feature | Status | Notes |
|---------|--------|-------|
| EVM attestation signing | Deferred | secp256k1 signatures for agents and counterparties |
| Certification schema | Deferred | Third-party certs when demand exists |
| Third-party credentials | Deferred | Platform model when demand exists |
| Agent→Agent delegation | Future | New data type for agent hierarchies |
| Escrow integration | Future | ZK proofs for automatic release |
| Batch reputation updates | Future | Provider updates multiple agents atomically |

### EVM Attestation Signing (Deferred)

Enable ERC-8004 agents and clients to sign attestations with their existing EVM wallets (secp256k1), eliminating the need for separate Solana wallets. Vision:

- **Agents**: Sign `interaction_hash` with linked EVM address (via EIP-712 typed data)
- **Counterparties**: Sign feedback with same wallet used for payment on Base/Ethereum
- **Program changes**: Add `SignatureData` enum supporting Ed25519 and Secp256k1 variants, store linked addresses in TokenMetadata, verify secp256k1 via `secp256k1_recover` syscall

Will be implemented when ERC-8004 agents express demand for cross-chain signing.

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
