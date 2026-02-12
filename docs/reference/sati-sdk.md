---
title: "@cascade-fyi/sati-sdk"
description: API reference for the low-level SATI SDK
---

# @cascade-fyi/sati-sdk

Low-level SDK for direct access to SATI's Solana program - raw attestations, custom schemas, compression, and encryption.

[[toc]]

## Installation

```bash
pnpm add @cascade-fyi/sati-sdk
```

**Peer dependencies:**
```bash
pnpm add @solana/kit @solana-program/token-2022 @coral-xyz/anchor
```

## Sati Client

```typescript
import { Sati, Outcome } from "@cascade-fyi/sati-sdk";

const sati = new Sati({
  network: "devnet",
  rpcUrl: "https://devnet.helius-rpc.com?api-key=YOUR_KEY",  // optional override
});
```

---

## Agent Registration

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

**Cost:** ~0.003 SOL

### IPFS Upload + Registration

```typescript
import { createPinataUploader } from "@cascade-fyi/sati-sdk";

const uploader = createPinataUploader(process.env.PINATA_JWT!);

const uri = await sati.uploadRegistrationFile(
  {
    name: "MyAgent",
    description: "AI assistant",
    image: "https://example.com/avatar.png",
    endpoints: [
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

## Querying

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

## Creating Attestations

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
  content: new TextEncoder().encode(JSON.stringify({ score: 85 })),
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
  MAX_DUAL_SIGNATURE_CONTENT_SIZE,      // ~70 bytes (DualSignature mode)
  MAX_SINGLE_SIGNATURE_CONTENT_SIZE,    // ~240 bytes (SingleSigner mode)
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
