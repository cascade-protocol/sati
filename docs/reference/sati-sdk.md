---
title: "@cascade-fyi/sati-sdk"
description: API reference for the SATI SDK
---

# @cascade-fyi/sati-sdk

Full-featured SDK for SATI on Solana. Agent registration, feedback, search, reputation queries, and low-level attestation access.

[[toc]]

## Installation

```bash
pnpm add @cascade-fyi/sati-sdk
```

**Peer dependencies:**
```bash
pnpm add @solana/kit @solana-program/token-2022
```

## Sati Client

```typescript
import { Sati } from "@cascade-fyi/sati-sdk";

const sati = new Sati({
  network: "devnet",
  rpcUrl: "https://devnet.helius-rpc.com?api-key=YOUR_KEY",  // optional override
});
```

### SATIClientOptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `network` | `"mainnet" \| "devnet" \| "localnet"` | Yes | SATI network |
| `rpcUrl` | `string` | No | Custom RPC URL (overrides network default) |
| `wsUrl` | `string` | No | Custom WebSocket URL for subscriptions |
| `photonRpcUrl` | `string` | No | Photon RPC URL for Light Protocol queries (defaults to hosted proxy) |
| `onWarning` | `(warning: SatiWarning) => void` | No | Non-fatal warning callback (parse errors, RPC failures) |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `network` | `"mainnet" \| "devnet" \| "localnet"` | Configured network |
| `rpc` | `SolanaRpc` | Solana RPC client |
| `deployedConfig` | `SATISASConfig \| null` | SAS schema config for this network |
| `feedbackPublicSchema` | `Address \| undefined` | FeedbackPublic schema address |
| `feedbackSchema` | `Address \| undefined` | Feedback schema address |
| `validationSchema` | `Address \| undefined` | Validation schema address |
| `lookupTable` | `Address \| undefined` | Address Lookup Table address |

---

## SatiAgentBuilder

Fluent builder for agent registration and management. Created via `sati.createAgentBuilder()`.

### Create a Builder

```typescript
const builder = sati.createAgentBuilder(
  "My AI Assistant",
  "An intelligent assistant for data analysis.",
  "https://example.com/agent-image.png",
);
```

### Fluent Configuration

All setters return `this` for chaining:

```typescript
builder
  .setMCP("https://mcp.example.com", "2025-06-18", {
    tools: ["search", "summarize"],
    prompts: ["code-review"],
    resources: ["project-context"],
  })
  .setA2A("https://a2a.example.com/.well-known/agent-card.json", "1.0", {
    skills: ["data-analysis"],
  })
  .setWallet("WalletAddress123")
  .setActive(true)
  .setX402Support(true)
  .setSupportedTrust(["reputation"])
  .setExternalUrl("https://myagent.com");
```

| Method | Parameters | Description |
|--------|-----------|-------------|
| `setMCP(url, version?, meta?)` | `meta: { tools?, prompts?, resources? }` | Set MCP endpoint with optional capabilities |
| `setA2A(url, version?, meta?)` | `meta: { skills? }` | Set A2A endpoint with optional skills |
| `setWallet(address)` | `string` | Set payment wallet endpoint |
| `setEndpoint(endpoint)` | `Endpoint` | Set a generic endpoint |
| `removeEndpoint(name)` | `string` | Remove an endpoint by name |
| `setActive(active)` | `boolean` | Set active status |
| `setX402Support(x402)` | `boolean` | Set x402 payment support |
| `setSupportedTrust(trusts)` | `TrustMechanism[]` | Set trust mechanisms |
| `setExternalUrl(url)` | `string` | Set external URL |
| `updateInfo(opts)` | `{ name?, description?, image? }` | Update basic info |

::: tip No Auto-Fetch
Unlike `sati-agent0-sdk`'s `SatiAgent.setMCP()`, the builder does **not** auto-fetch MCP capabilities. Pass tools/prompts/resources explicitly via the `meta` parameter.
:::

### Register

```typescript
import { createSatiUploader, createPinataUploader } from "@cascade-fyi/sati-sdk";

// Hosted uploader (zero config)
const result = await builder.register({
  payer: signer,
  uploader: createSatiUploader(),
});

// Or with Pinata
const result = await builder.register({
  payer: signer,
  uploader: createPinataUploader(process.env.PINATA_JWT!),
  nonTransferable: true,  // soulbound (default)
});

console.log(result.mint);         // Agent mint address
console.log(result.memberNumber); // Registry member number
console.log(result.signature);    // Transaction signature
```

**Cost:** ~0.003 SOL

### Register with Pre-existing URI

```typescript
const result = await builder.registerWithUri({
  payer: signer,
  uri: "ipfs://Qm...",
});
```

### Update

After modifying the builder with fluent setters:

```typescript
const updated = await builder.update({
  payer: signer,
  owner: ownerKeypair,  // must be the current NFT owner
  uploader: createSatiUploader(),
});
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `params` | `RegistrationFileParams` | Current registration parameters |
| `identity` | `AgentIdentity \| undefined` | On-chain identity (available after register/load) |

---

## Feedback Methods

### giveFeedback

Give feedback to an agent. Uses FeedbackPublicV1 schema. Handles SIWS message construction and signing automatically.

```typescript
const result = await sati.giveFeedback({
  payer: signer,             // pays fees + is the reviewer
  agentMint: address("..."), // agent to review
  value: 85,                 // ERC-8004 signed fixed-point value
  valueDecimals: 0,          // decimal places (0-18)
  tag1: "quality",           // first tag dimension
  tag2: "speed",             // second tag dimension (optional)
  message: "Fast and accurate",
  endpoint: "https://api.example.com",
  outcome: Outcome.Positive, // optional (defaults to Neutral)
  taskRef: taskHashBytes,    // optional 32-byte reference
});

console.log(result.signature);          // transaction signature
console.log(result.attestationAddress); // compressed account address
```

**Cost:** ~$0.002

#### GiveFeedbackParams

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payer` | `KeyPairSigner` | Yes | Pays fees and is the reviewer |
| `agentMint` | `Address` | Yes | Agent mint address |
| `value` | `number` | No | ERC-8004 signed fixed-point value |
| `valueDecimals` | `number` | No | Decimal places for value (0-18, default 0) |
| `tag1` | `string` | No | First tag dimension |
| `tag2` | `string` | No | Second tag dimension |
| `message` | `string` | No | Human-readable feedback |
| `endpoint` | `string` | No | Endpoint being reviewed |
| `outcome` | `Outcome` | No | Defaults to Neutral |
| `taskRef` | `Uint8Array` | No | 32-byte task reference (random if omitted) |

### prepareFeedback

Prepare feedback for browser wallet signing (step 1 of 2). Returns SIWS message bytes for the counterparty to sign externally.

```typescript
const prepared = await sati.prepareFeedback({
  agentMint: address("..."),
  counterparty: walletAddress,
  value: 90,
  tag1: "quality",
});

// Send prepared.messageBytes to the wallet for signing
```

### submitPreparedFeedback

Submit wallet-signed feedback (step 2 of 2).

```typescript
const result = await sati.submitPreparedFeedback({
  payer: serverSigner,
  prepared,
  counterpartySignature: walletSignature,
});
```

### searchFeedback

Search feedback attestations with client-side filtering.

```typescript
const feedbacks = await sati.searchFeedback({
  agentMint: address("..."),
  counterparty: address("..."), // filter by reviewer
  tag1: "quality",
  minValue: 70,
  maxValue: 100,
  includeTxHash: true,
});

for (const fb of feedbacks) {
  console.log(`value=${fb.value} from ${fb.counterparty}`);
  console.log(`tag1=${fb.tag1}, tag2=${fb.tag2}, Message: ${fb.message}`);
}
```

#### FeedbackSearchOptions

| Field | Type | Description |
|-------|------|-------------|
| `agentMint` | `Address` | Filter by agent |
| `counterparty` | `Address` | Filter by reviewer |
| `tag1` | `string` | Filter by first tag dimension |
| `tag2` | `string` | Filter by second tag dimension |
| `minValue` | `number` | Minimum value (inclusive) |
| `maxValue` | `number` | Maximum value (inclusive) |
| `includeTxHash` | `boolean` | Populate `txSignature` per result (extra RPC call each) |

#### ParsedFeedback

| Field | Type | Description |
|-------|------|-------------|
| `compressedAddress` | `Address` | Compressed account address |
| `agentMint` | `Address` | Agent mint address |
| `counterparty` | `Address` | Reviewer address |
| `outcome` | `Outcome` | Feedback outcome |
| `value` | `number \| undefined` | ERC-8004 signed fixed-point value |
| `valueDecimals` | `number \| undefined` | Decimal places (0-18) |
| `tag1` | `string \| undefined` | First tag dimension |
| `tag2` | `string \| undefined` | Second tag dimension |
| `message` | `string \| undefined` | Feedback message |
| `endpoint` | `string \| undefined` | Endpoint reviewed |
| `createdAt` | `number` | Approximate Unix timestamp |
| `txSignature` | `string \| undefined` | Transaction signature (if requested) |

### getReputationSummary

Aggregate feedback stats for an agent.

```typescript
const summary = await sati.getReputationSummary(agentMint);
console.log(`${summary.count} reviews, avg value ${summary.averageValue}`);

// Filter by tags
const quality = await sati.getReputationSummary(agentMint, "quality");
const qualityLatency = await sati.getReputationSummary(agentMint, "quality", "latency");
```

Returns `{ count: number; averageValue: number }`.

### revokeFeedback

Revoke (close) a feedback attestation. The payer must be the original reviewer.

```typescript
const result = await sati.revokeFeedback({
  payer: signer,
  attestationAddress: feedback.compressedAddress,
});
```

---

## Agent Search Methods

### searchAgents

Search registered agents with filters.

```typescript
// All agents
const all = await sati.searchAgents();

// Filtered
const results = await sati.searchAgents({
  name: "weather",
  active: true,
  endpointTypes: ["MCP"],
  limit: 25,
  offset: 50n,
  includeFeedbackStats: true,
});

for (const agent of results) {
  console.log(`${agent.identity.name} (${agent.identity.mint})`);
  if (agent.registrationFile) {
    console.log(`  MCP: ${agent.registrationFile.services?.find(e => e.name === "MCP")?.endpoint}`);
  }
  if (agent.feedbackStats) {
    console.log(`  Avg value: ${agent.feedbackStats.averageValue} (${agent.feedbackStats.count} reviews)`);
  }
}
```

#### AgentSearchOptions

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Substring match on agent name |
| `owner` | `Address` | Filter by owner address |
| `active` | `boolean` | Filter by active status |
| `endpointTypes` | `string[]` | Filter by endpoint types (e.g., `["MCP", "A2A"]`) |
| `limit` | `number` | Max results |
| `offset` | `bigint` | Offset for pagination (member number) |
| `includeFeedbackStats` | `boolean` | Compute feedback stats per agent (slower) |

#### AgentSearchResult

| Field | Type | Description |
|-------|------|-------------|
| `identity` | `AgentIdentity` | On-chain identity (mint, owner, name, uri, memberNumber) |
| `registrationFile` | `RegistrationFile \| null` | Fetched metadata (null if fetch failed) |
| `feedbackStats` | `ReputationSummary \| undefined` | Only if `includeFeedbackStats` was true |

### searchValidations

Query validation attestations for an agent.

```typescript
const validations = await sati.searchValidations(agentMint);

for (const v of validations) {
  console.log(`${v.outcome === 2 ? "Positive" : "Negative"} by ${v.counterparty}`);
  console.log(`At: ${new Date(v.createdAt * 1000).toISOString()}`);
}
```

::: warning Timestamp Precision
`createdAt` is approximate - derived from Solana slot numbers at ~400ms/slot. May drift by minutes for recent data.
:::

---

## Agent Registration (Low-Level)

For full control over registration without using `SatiAgentBuilder`.

```typescript
const result = await sati.registerAgent({
  payer,                          // KeyPairSigner (pays fees + becomes owner)
  name: "MyAgent",                // Max 32 chars
  uri: "ipfs://Qm...",            // Agent metadata JSON
  owner: ownerAddress,            // Optional: mint NFT to a different address
  additionalMetadata: [           // Optional key-value pairs
    { key: "version", value: "1.0" },
  ],
  nonTransferable: true,          // Default: true (soulbound)
});

console.log(result.mint);         // Agent's token address (identity)
console.log(result.memberNumber); // Registry member number
```

### IPFS Upload + Registration

```typescript
import { createPinataUploader } from "@cascade-fyi/sati-sdk";

const uploader = createPinataUploader(process.env.PINATA_JWT!);

const uri = await sati.uploadRegistrationFile(
  {
    name: "MyAgent",
    description: "AI assistant",
    image: "https://example.com/avatar.png",
    services: [
      { name: "MCP", endpoint: "https://myagent.com/mcp", version: "2025-06-18", mcpTools: ["search"] },
    ],
    supportedTrust: ["reputation"],
  },
  uploader,
);

const result = await sati.registerAgent({ payer, name: "MyAgent", uri });
```

### Custom Storage Providers

```typescript
import type { MetadataUploader } from "@cascade-fyi/sati-sdk";

const arweaveUploader: MetadataUploader = {
  async upload(data: unknown): Promise<string> {
    return `ar://${txId}`;
  },
};
```

---

## Querying (Low-Level)

### List Agents

```typescript
const agents = await sati.listAllAgents();
for (const agent of agents) {
  console.log(`Agent ${agent.memberNumber}: ${agent.mint}`);
}

// By member number
const agent = await sati.getAgentByMemberNumber(1n);

// By mint
const agent = await sati.loadAgent(mintAddress);
```

### List Feedbacks

```typescript
import { loadDeployedConfig } from "@cascade-fyi/sati-sdk";

const config = loadDeployedConfig("mainnet");
const feedbackSchema = config!.schemas.feedback;

const result = await sati.listFeedbacks({
  sasSchema: feedbackSchema,
  agentMint,
});

for (const fb of result.items) {
  console.log(`Outcome: ${fb.data.outcome}`);
  console.log(`Counterparty: ${fb.data.counterparty}`);
}

// Pagination
if (result.cursor) {
  const nextPage = await sati.listFeedbacks({
    sasSchema: feedbackSchema,
    agentMint,
    cursor: result.cursor,
  });
}
```

---

## Creating Attestations (Low-Level)

### Feedback (Compressed)

```typescript
const result = await sati.createFeedback({
  payer,
  sasSchema,
  taskRef: new Uint8Array(32),
  agentMint,
  counterparty: clientAddress,
  dataHash: requestHash,
  outcome: Outcome.Positive,
  contentType: ContentType.JSON,
  content: new TextEncoder().encode(JSON.stringify({ value: 85, valueDecimals: 0, tag1: "quality" })),
  agentSignature: { pubkey: agentAddress, signature: agentSig },
  counterpartySignature: { pubkey: clientAddress, signature: counterpartySig },
  counterpartyMessage: siwsMessageBytes,
});
```

**Cost:** ~$0.002

### Validation (Compressed)

```typescript
const result = await sati.createValidation({
  payer,
  sasSchema: validationSchema,
  taskRef,
  agentMint,
  counterparty: validatorAddress,
  dataHash: workHash,
  outcome: Outcome.Positive,
  contentType: ContentType.JSON,
  content: new TextEncoder().encode(JSON.stringify({ method: "automated_code_review" })),
  agentSignature: { pubkey: agentAddress, signature: agentSig },
  validatorSignature: { pubkey: validatorAddress, signature: validatorSig },
  counterpartyMessage: siwsMessageBytes,
});
```

### ReputationScoreV3 (Regular SAS)

```typescript
import { computeReputationNonce, zeroDataHash, ContentType } from "@cascade-fyi/sati-sdk";

const nonce = computeReputationNonce(providerAddress, agentMint);

const result = await sati.createReputationScore({
  payer,
  provider: providerAddress,
  providerSignature: providerSig,
  sasSchema,
  satiCredential,
  agentMint,
  taskRef: nonce,
  dataHash: zeroDataHash(),
  outcome: Outcome.Positive,
  contentType: ContentType.JSON,
  content: createJsonContent({ score: 85, feedbackCount: 127 }),
});
```

### Update ReputationScoreV3

Closes the existing score and creates a new one in a single call:

```typescript
const result = await sati.updateReputationScore({
  payer,
  provider: providerKeypair,
  sasSchema,
  satiCredential,
  agentMint,
  outcome: Outcome.Positive,
  contentType: ContentType.JSON,
  content: createJsonContent({ score: 90, feedbackCount: 150 }),
});
```

---

## Closing Attestations

### Compressed (Feedback/Validation)

```typescript
const result = await sati.closeCompressedAttestation({
  payer,
  counterparty: payer,           // must be the original feedback giver
  sasSchema: feedbackSchema,
  attestationAddress,             // compressed account address (base58)
  lookupTableAddress,             // optional ALT for tx size
});
```

### Regular (ReputationScoreV3)

```typescript
const result = await sati.closeRegularAttestation({
  payer,
  provider: providerKeypair,      // KeyPairSigner (must sign the close)
  sasSchema: reputationSchema,
  satiCredential,
  agentMint,
  attestation: attestationPda,    // SAS attestation PDA address
});
```

---

## Encrypted Content

End-to-end encrypted feedback using X25519-XChaCha20-Poly1305.

```typescript
import { encryptContent, deriveEncryptionKeypair, ContentType } from "@cascade-fyi/sati-sdk";

// Encrypt for agent
const { publicKey: agentEncPubkey } = deriveEncryptionKeypair(agentEd25519Seed);
const encrypted = encryptContent(plaintext, agentEncPubkey);

// Use in attestation
await sati.createFeedback({
  // ...
  contentType: ContentType.Encrypted,
  content: serializeEncryptedPayload(encrypted),
});

// Agent decrypts
const { privateKey } = deriveEncryptionKeypair(agentEd25519Seed);
const payload = deserializeEncryptedPayload(feedback.content);
const decrypted = decryptContent(payload, privateKey);
```

**Size limit:** 439 bytes plaintext (512 - 73 bytes overhead).

---

## Photon Querying

Direct compressed account queries via Helius Photon:

```typescript
import { createPhotonRpc } from "@cascade-fyi/compression-kit";
import { SATI_PROGRAM_ADDRESS } from "@cascade-fyi/sati-sdk";

const rpc = createPhotonRpc("https://devnet.helius-rpc.com?api-key=YOUR_KEY");

const feedbacks = await rpc.getCompressedAccountsByOwner(
  SATI_PROGRAM_ADDRESS,
  {
    filters: [
      { offset: 0, bytes: feedbackSchemaAddress },   // sas_schema at offset 0
      { offset: 32, bytes: agentMint },               // agent_mint at offset 32
    ],
    limit: 50,
  },
);
```

### Memcmp Offsets

Compressed account data layout: `sas_schema(32) | agent_mint(32) | data_len(4) | data_bytes(...)`.

| Field | Offset | Notes |
|-------|--------|-------|
| `sas_schema` | 0 | Filter by attestation type |
| `agent_mint` | 32 | Filter by agent |
| `outcome` | 165 | 0=Negative, 1=Neutral, 2=Positive (at data_start + 97) |

---

## Signature Flow

SATI uses a dual-signature model (blind feedback):

```typescript
import { computeInteractionHash } from "@cascade-fyi/sati-sdk";

// 1. Agent signs BEFORE knowing outcome
const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);
const agentSig = await signMessage(agentKeypair, interactionHash);

// 2. Counterparty signs human-readable SIWS message after task completion
// (built automatically by the SDK)
```

---

## Hash Functions

```typescript
import {
  computeInteractionHash,        // Agent blind signature input
  computeAttestationNonce,       // Deterministic compressed account address
  computeReputationNonce,        // One per provider+agent pair
  computeDataHash,               // Hash request + response content
  computeDataHashFromStrings,    // String convenience wrapper
  zeroDataHash,                  // Zero hash for CounterpartySigned schemas
} from "@cascade-fyi/sati-sdk";
```

## Constants

```typescript
import {
  SATI_PROGRAM_ADDRESS,                // Program ID (all networks)
  MAX_CONTENT_SIZE,                     // 512 bytes
  MAX_DUAL_SIGNATURE_CONTENT_SIZE,      // 70 bytes (DualSignature mode)
  MAX_COUNTERPARTY_SIGNED_CONTENT_SIZE, // 100 bytes (CounterpartySigned mode)
  MAX_AGENT_OWNER_SIGNED_CONTENT_SIZE,  // 240 bytes (AgentOwnerSigned mode)
} from "@cascade-fyi/sati-sdk";
```

## Error Handling

The SDK throws typed errors for common failure cases:

```typescript
import { SatiError, DuplicateAttestationError, AgentNotFoundError } from "@cascade-fyi/sati-sdk";

try {
  await sati.createFeedback({ ... });
} catch (error) {
  if (error instanceof DuplicateAttestationError) {
    console.error("Attestation already exists");
  } else if (error instanceof AgentNotFoundError) {
    console.error(`Agent not found: ${error.agentMint}`);
  } else if (error instanceof SatiError) {
    console.error(`SATI error [${error.code}]: ${error.message}`);
  }
}
```

| Error Class | Code | Cause |
|-------------|------|-------|
| `DuplicateAttestationError` | `DUPLICATE_ATTESTATION` | Same (schema, agent, taskRef, dataHash) submitted twice |
| `AgentNotFoundError` | `AGENT_NOT_FOUND` | Agent mint is not a registered SATI agent |
| `SchemaNotFoundError` | `SCHEMA_NOT_FOUND` | Schema not registered or not initialized |

The program also returns on-chain errors (via Anchor). Common ones:

| Program Error | Cause |
|---------------|-------|
| `InvalidSignatureCount` | Wrong number of sigs for SignatureMode |
| `SignatureMismatch` | Sig pubkey doesn't match expected |
| `SelfAttestationNotAllowed` | agentMint == counterparty |
| `AttestationNotCloseable` | Schema has closeable: false |
| `SchemaConfigNotFound` | Schema not registered with SATI |
