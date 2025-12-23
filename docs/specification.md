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
| Agent | `hash(schema, task_ref, token_account, content_hash)` | With response | "I served this task" |
| Counterparty | `hash(schema, task_ref, token_account, outcome, timestamp)` | After service | "I gave this feedback" |

**Flow**: Client pays (x402) → Agent responds + signs (blind) → Client signs feedback → Agent/facilitator submits

**Key insight**: Agent signs BEFORE knowing feedback sentiment — cannot selectively participate.

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
│ • Feedback attestations   │         │ • ReputationScore attestations │
│ • Validation attestations │         │ • ~$0.40 per attestation       │
│ • ~$0.002 per attestation │         │ • On-chain queryable (RPC)     │
│ • Photon indexing (free)  │         │                                │
└───────────────────────────┘         └────────────────────────────────┘
          │
          ▼
┌───────────────────────────┐
│      Token-2022           │
│  • Identity storage       │
│  • TokenMetadata          │
│  • TokenGroup             │
└───────────────────────────┘
```

| Component | Responsibility |
|-----------|----------------|
| **SATI Registry** | Canonical agent registration |
| **SATI Attestation** | Signature verification + storage routing |
| **Token-2022** | Identity storage, metadata, transfers |
| **SAS** | Schema definitions + regular attestation storage |
| **Light Protocol** | Compressed attestation storage |
| **Photon** | Free indexing for compressed accounts |

---

## Registry Program

**Program ID**: `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`

### RegistryConfig (PDA: `["registry"]`)

| Field | Type | Description |
|-------|------|-------------|
| `group_mint` | Pubkey | SATI TokenGroup mint |
| `authority` | Pubkey | Registry authority (default = immutable) |
| `total_agents` | u64 | Agent counter |
| `bump` | u8 | PDA bump |

### Instructions

| Instruction | Parameters | Behavior |
|-------------|------------|----------|
| `initialize` | — | Create registry + TokenGroup (one-time) |
| `register_agent` | name, symbol, uri, additional_metadata?, non_transferable | Create Token-2022 NFT, add to group, renounce mint |
| `update_registry_authority` | new_authority? | Transfer or renounce (None = immutable) |

### Events

| Event | Fields |
|-------|--------|
| `AgentRegistered` | mint, owner, member_number, name, uri, non_transferable |
| `RegistryAuthorityUpdated` | old_authority, new_authority |

### Errors

`InvalidAuthority` · `ImmutableAuthority` · `NameTooLong` · `SymbolTooLong` · `UriTooLong` · `TooManyMetadataEntries` · `Overflow`

---

## Attestation Program

### SchemaConfig (PDA: `["schema_config", schema]`)

| Field | Type | Description |
|-------|------|-------------|
| `sas_schema` | Pubkey | SAS schema address |
| `signature_mode` | SignatureMode | DualSignature / SingleSigner |
| `storage_type` | StorageType | Compressed / Regular |

### CompressedAttestation

| Field | Type | Offset | Description |
|-------|------|--------|-------------|
| `sas_schema` | Pubkey | 0 | Schema (memcmp filter) |
| `token_account` | Pubkey | 32 | Agent being attested (memcmp filter) |
| `data_type` | u8 | 64 | Schema data type |
| `data` | Vec&lt;u8&gt; | 65+ | Schema-conformant bytes |
| `signatures` | Vec&lt;[u8;64]&gt; | varies | Ed25519 signatures |
| `timestamp` | i64 | varies | Creation timestamp |

### Base Data Layout (first 96 bytes)

All schemas MUST start with:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 32 | `task_ref` |
| 32 | 32 | `token_account` |
| 64 | 32 | `counterparty` |

Program parses this for signature binding; full schema parsed by indexers.

### Signature Verification (On-Chain)

1. **Count**: Match `SignatureMode` (2 for DualSignature)
2. **Binding**: `signatures[0].pubkey == token_account`, `signatures[1].pubkey == counterparty`
3. **Self-attestation**: `token_account != counterparty`
4. **Validity**: Each signature on its domain-separated hash

### Instructions

| Instruction | Parameters | Behavior |
|-------------|------------|----------|
| `register_schema_config` | schema, signature_mode, storage_type | Register schema config (authority only) |
| `create_attestation` | data, signatures, storage-specific params | Verify sigs → route to storage by `storage_type` |
| `close_attestation` | storage-specific params | Close attestation (agent only) |

**Storage-specific parameters:**

| Storage Type | Create Params | Close Params |
|--------------|---------------|--------------|
| Compressed | proof, address_tree_info, output_state_tree_index | proof, account_meta, current_data |
| Regular | nonce, expiry | attestation_pda |

**Routing**: Program checks `SchemaConfig.storage_type` and CPIs to Light Protocol (compressed) or SAS (regular). SATI Attestation Program PDA is the sole authorized signer for both storage backends.

### Events

| Event | Fields |
|-------|--------|
| `SchemaConfigRegistered` | schema, signature_mode, storage_type |
| `AttestationCreated` | sas_schema, token_account, data_type, storage_type, address, timestamp |
| `AttestationClosed` | sas_schema, token_account, address |

### Errors

`SchemaConfigNotFound` · `InvalidSignatureCount` · `InvalidSignature` · `StorageTypeNotSupported` · `AttestationDataTooSmall` · `AttestationDataTooLarge` · `SignatureMismatch` · `SelfAttestationNotAllowed` · `UnauthorizedClose` · `LightCpiInvocationFailed`

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
| `symbol` | "SATI" or type |
| `uri` | Registration file URL |
| `additionalMetadata` | agentWallet, did, a2a, mcp |

### Operations

- **Update metadata**: Direct `spl-token-metadata` calls
- **Transfer**: Standard Token-2022 transfer
- **Smart accounts**: Squads can own via ATAs

---

## Schemas

### Core Schemas

| Schema | Storage | SignatureMode | Status |
|--------|---------|---------------|--------|
| Feedback | Compressed | DualSignature | ✅ MVP |
| Validation | Compressed | DualSignature | ✅ MVP |
| ReputationScore | Regular | SingleSigner | ✅ MVP |

**SignatureMode determines payload signature requirements:**

| Mode | Signatures | Use Case |
|------|------------|----------|
| DualSignature | 2 | Feedback, Validation (blind feedback model) |
| SingleSigner | 1 | ReputationScore (provider signs) |

### Feedback Schema (data_type = 0, 207 bytes)

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | task_ref | [u8;32] | CAIP-220 tx hash or arbitrary ID |
| 32 | token_account | Pubkey | Agent |
| 64 | counterparty | Pubkey | Client |
| 96 | timestamp | i64 | Feedback time |
| 104 | content_hash | [u8;32] | Request hash |
| 136 | response_hash | [u8;32] | Response hash |
| 168 | content_ref | [u8;36] | Off-chain reference |
| 204 | outcome | u8 | 0=Negative, 1=Neutral, 2=Positive |
| 205 | tag1 | u8 | Primary category |
| 206 | tag2 | u8 | Secondary category |

### Validation Schema (data_type = 1, 206 bytes)

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | task_ref | [u8;32] | Task reference |
| 32 | token_account | Pubkey | Agent |
| 64 | counterparty | Pubkey | Validator |
| 96 | timestamp | i64 | Validation time |
| 104 | content_hash | [u8;32] | Work hash |
| 136 | response_hash | [u8;32] | Validator response |
| 168 | content_ref | [u8;36] | Off-chain reference |
| 204 | validation_type | u8 | tee/zkml/reexecution/consensus |
| 205 | status | u8 | 0=fail, 100=pass |

### ReputationScore Schema (data_type = 2, 133 bytes)

Provider-computed scores using `StorageType::Regular` for direct on-chain queryability.

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| 0 | task_ref | [u8;32] | Deterministic: `keccak256(provider, token_account)` |
| 32 | token_account | Pubkey | Agent being scored |
| 64 | counterparty | Pubkey | Provider (reputation scorer) |
| 96 | score | u8 | 0-100 normalized score |
| 97 | content_ref | [u8;36] | Off-chain methodology/details |

**Semantics**: One ReputationScore per (provider, agent) pair. Providers update by closing old attestation and creating new one with same deterministic nonce. Timestamp and expiry use SAS attestation metadata.

### Address Derivation

**Compressed Attestations (Light Protocol):**

```rust
let nonce = keccak256(&[task_ref, sas_schema, token_account].concat());
let (address, seed) = derive_address(
    &[b"attestation", sas_schema, token_account, &nonce],
    &address_tree_pubkey, &program_id
);
```

**Regular Attestations (SAS):**

```rust
// Nonce is deterministic: one ReputationScore per (provider, agent) pair
let nonce = keccak256(&[provider, token_account]);

// SAS PDA derivation
let (attestation_pda, _) = Pubkey::find_program_address(
    &[b"attestation", sati_credential, sas_schema, &nonce.to_bytes()],
    &SAS_PROGRAM_ID
);
```

**Deterministic nonce** ensures one ReputationScore per (provider, agent) pair — updates replace previous.

### Content Reference (36 bytes)

| Byte 0 | Storage | Data (bytes 1-35) |
|--------|---------|-------------------|
| 0xe3 | IPFS | CIDv1 |
| 0xce | Arweave | Transaction ID |
| 0x00 | Raw | SHA-256 hash |

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

**Filters**: `sas_schema` (offset 8), `token_account` (offset 40)

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
enum TagCategory { Quality = 0, Speed = 1, Reliability = 2, Communication = 3, Value = 4 }
```

### Methods

| Category | Method | Returns |
|----------|--------|---------|
| **Registry** | `registerAgent(params)` | `{ mint, memberNumber }` |
| **Identity** | `loadAgent(mint)` | `AgentIdentity` |
| | `updateAgentMetadata(mint, updates)` | void |
| | `transferAgent(mint, newOwner)` | void |
| **Compressed** | `createFeedback(params)` | `{ address, signature }` |
| | `createFeedbackBatch(params[])` | `{ addresses, signature }` |
| | `createValidation(params)` | `{ address, signature }` |
| **Regular** | `createReputationScore(params)` | `{ address, signature }` |
| | `updateReputationScore(params)` | `{ address, signature }` |
| **Query (Compressed)** | `listFeedbacks(tokenAccount, params?)` | `Feedback[]` |
| | `listValidations(tokenAccount, params?)` | `Validation[]` |
| | `getAttestationWithProof(address)` | `{ attestation, proof }` |
| **Query (Regular)** | `getReputationScore(provider, tokenAccount)` | `ReputationScore \| null` |
| | `listReputationScores(tokenAccount)` | `ReputationScore[]` |
| **Verify** | `verifyAttestation(attestation, proof)` | boolean |
| | `verifySignatures(attestation)` | boolean |

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
| Signature-data binding | Pubkeys match token_account/counterparty |
| Self-attestation prevention | token_account ≠ counterparty |
| Duplicate prevention | Deterministic address from task_ref |

### Off-Chain Validation (SDK/Indexer)

| Property | Enforcement |
|----------|-------------|
| task_ref format | SDK validates CAIP-220 |
| Outcome range | Indexer verifies ∈ {0,1,2} |
| Timestamp | Indexer checks reasonableness |

### Trust Model

| Component | Trust Assumption |
|-----------|-----------------|
| SATI Programs | Correctly verify signatures |
| Light Protocol | State tree integrity |
| Photon | Accurate indexing |
| SDK | Validates formats, constructs hashes |

### Known Limitations

- **Sybil resistance**: Prevents self-attestation but not multiple wallets. Reputation providers implement sybil-resistant scoring.

---

## Deployment

### Addresses

| Network | Registry | Registry Config | Group Mint |
|---------|----------|-----------------|------------|
| Devnet | TBD | TBD | TBD |
| Mainnet | TBD | TBD | TBD |

### Governance

**Authority lifecycle**: Launch (multisig) → Stable (multisig) → Immutable (renounced)

- Registry authority controls `update_registry_authority()` only
- Upgrade authority controls program deployment
- Both independently renounceable

**Schema governance**: Versioned, not upgraded. New schema = new version (e.g., Feedback_v2).

---

## Cross-Chain

### Registration File (ERC-8004 compatible)

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "endpoints": [
    { "name": "A2A", "endpoint": "https://agent.example/agent-card.json" },
    { "name": "agentWallet", "endpoint": "solana:5eykt4...:7S3P4..." }
  ],
  "registrations": [
    { "agentId": "sati:devnet:ABC123mint", "agentRegistry": "solana:devnet:satiFVb9..." }
  ]
}
```

### SATI Identifier Format

```
sati:<network>:<mint_address>
```

Supports CAIP and DIDs. See [Appendix A: CAIP & DID Reference](./appendix-a-caip-did.md).

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

## Appendices

- [Appendix A: CAIP & DID Reference](./appendix-a-caip-did.md) — Cross-chain identifier formats
- [Appendix B: Implementation Details](./appendix-b-implementation.md) — Full implementation guidance

---

## References

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Token-2022 Program](https://github.com/solana-program/token-2022)
- [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service)
- [Light Protocol](https://github.com/Lightprotocol/light-protocol)
- [Light Protocol Docs](https://www.zkcompression.com/)
- [Photon RPC](https://docs.helius.dev/compression-and-das-api/photon-api)
- [x402 Protocol](https://github.com/coinbase/x402)
