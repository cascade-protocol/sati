# @cascade-fyi/sati-sdk

TypeScript SDK for SATI - Solana Agent Trust Infrastructure.

## Installation

```bash
pnpm add @cascade-fyi/sati-sdk
```

**Peer dependencies:**
```bash
pnpm add @solana/kit @solana-program/token-2022 @coral-xyz/anchor
```

## Quick Start

```typescript
import { Sati, Outcome } from "@cascade-fyi/sati-sdk";

// Initialize client
const sati = new Sati({
  network: "devnet",
  photonRpcUrl: "https://devnet.helius-rpc.com?api-key=YOUR_KEY", // For compressed attestations
});

// Register an agent
const { mint, memberNumber, signature } = await sati.registerAgent({
  payer,
  name: "MyAgent",
  uri: "https://example.com/agent.json",
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

### IPFS Upload + Registration

Upload a registration file to IPFS and register in one flow:

```typescript
import { createPinataUploader } from "@cascade-fyi/sati-sdk";

const uploader = createPinataUploader(process.env.PINATA_JWT!);

// Build + upload registration file, then register
const uri = await sati.uploadRegistrationFile(
  {
    name: "MyAgent",
    description: "AI assistant",
    image: "https://example.com/avatar.png",
    endpoints: [
      { name: "MCP", endpoint: "https://myagent.com/mcp", version: "2025-06-18", mcpTools: ["search"] },
      { name: "A2A", endpoint: "https://myagent.com/.well-known/agent.json", version: "0.3.0" },
    ],
    supportedTrust: ["reputation"],
  },
  uploader,
);

const result = await sati.registerAgent({ payer, name: "MyAgent", uri });
```

### Custom Storage Providers

Implement the `MetadataUploader` interface for any storage backend:

```typescript
import type { MetadataUploader } from "@cascade-fyi/sati-sdk";

const arweaveUploader: MetadataUploader = {
  async upload(data: unknown): Promise<string> {
    // Upload to Arweave and return ar:// URI
    return `ar://${txId}`;
  },
};
```

---

## Creating Attestations

### Signature Flow (Blind Feedback Model)

SATI uses a dual-signature model where the agent signs blind (before knowing outcome):

```typescript
import {
  computeInteractionHash,
  computeFeedbackHash,
  Outcome,
} from "@cascade-fyi/sati-sdk";

// 1. Agent signs BEFORE knowing outcome (blind commitment)
const interactionHash = computeInteractionHash(
  sasSchema,
  taskRef,          // 32-byte task identifier
  dataHash,         // Hash of request data
);
const agentSig = await signMessage(agentKeypair, interactionHash);

// 2. After task completion, counterparty signs human-readable SIWS message
// (built automatically by the SDK)
```

### Create Feedback Attestation

```typescript
const result = await sati.createFeedback({
  payer,
  sasSchema,
  taskRef: new Uint8Array(32),    // CAIP-220 tx hash or arbitrary ID
  agentMint,                      // Agent's NFT mint address
  counterparty: clientAddress,
  dataHash: requestHash,
  outcome: Outcome.Positive,      // Negative, Neutral, Positive
  content: JSON.stringify({ ... }), // Optional extended data
  agentSignature: {
    pubkey: agentAddress,
    signature: agentSig,
  },
  counterpartySignature: {
    pubkey: clientAddress,
    signature: counterpartySig,
  },
});

console.log(result.address);      // Compressed account address
console.log(result.signature);    // Transaction signature
```

### Create Validation Attestation

Validation attestations are for third-party validators assessing agent work:

```typescript
import { computeValidationHash, ValidationType } from "@cascade-fyi/sati-sdk";

// 1. Agent signs blind (same as Feedback)
const interactionHash = computeInteractionHash(
  validationSchema,
  taskRef,
  workHash,             // Hash of work being validated
);
const agentSig = await signMessage(agentKeypair, interactionHash);

// 2. Validator signs human-readable SIWS message (built by SDK)

// 3. Create attestation
const result = await sati.createValidation({
  payer,
  sasSchema: validationSchema,
  taskRef,
  agentMint,
  counterparty: validatorAddress,
  dataHash: workHash,
  validationType: ValidationType.Automated,  // Manual, Automated, Hybrid
  response: 95,
  content: JSON.stringify({
    method: "automated_code_review",
    issues_found: 0,
  }),
  agentSignature: {
    pubkey: agentAddress,
    signature: agentSig,
  },
  validatorSignature: {
    pubkey: validatorAddress,
    signature: validatorSig,
  },
});
```

### Create ReputationScoreV3 (Regular Attestation)

ReputationScoreV3 uses VecU8 for variable-length content and CounterpartySigned mode (provider only).

```typescript
import {
  computeInteractionHash,
  computeReputationNonce,
  zeroDataHash,
  createJsonContent,
  ContentType,
} from "@cascade-fyi/sati-sdk";

// Compute deterministic nonce and taskRef
const nonce = computeReputationNonce(providerAddress, agentMint);
const taskRef = nonce; // same as nonce per spec
const dataHash = zeroDataHash();

// Provider signs the interaction hash
const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);
const providerSig = await signMessage(providerKeypair, interactionHash);

const result = await sati.createReputationScore({
  payer,
  provider: providerAddress,
  providerSignature: providerSig,
  sasSchema,
  satiCredential,
  agentMint,
  taskRef,
  dataHash,
  outcome: Outcome.Positive,
  contentType: ContentType.JSON,
  content: createJsonContent({
    score: 85,
    methodology: "weighted_feedback",
    feedbackCount: 127,
    validationCount: 5,
  }),
});
```

### Update ReputationScoreV3

High-level convenience method that closes the existing score and creates a new one:

```typescript
const result = await sati.updateReputationScore({
  payer,
  provider: providerKeypair,  // Must be KeyPairSigner (signs close + create)
  sasSchema,
  satiCredential,
  agentMint,
  outcome: Outcome.Positive,
  contentType: ContentType.JSON,
  content: createJsonContent({
    score: 90,
    methodology: "weighted_feedback",
    feedbackCount: 150,
    validationCount: 8,
  }),
});
```

---

## Closing Attestations

Attestations can be closed if the schema config has `closeable: true`.

### Close Compressed Attestation (Feedback/Validation)

```typescript
// First, query the attestation you want to close
const attestations = await rpc.getCompressedAccountsByOwner({
  owner: SATI_PROGRAM_ADDRESS,
  filters: [
    { memcmp: { offset: 8, bytes: feedbackSchema } },
    { memcmp: { offset: 40, bytes: agentMint } },
  ],
});

const toClose = attestations.value.items[0];

// Close it
const result = await sati.closeAttestation({
  payer,
  sasSchema: feedbackSchema,
  agentMint,
  // Current attestation state (for proof verification)
  dataType: DataType.Feedback,
  currentData: toClose.data,
  numSignatures: 2,
  signature1: toClose.data.slice(/* sig1 offset */),
  signature2: toClose.data.slice(/* sig2 offset */),
  address: toClose.address,
});

console.log(result.signature);    // Transaction signature
```

### Close Regular Attestation (ReputationScoreV3)

```typescript
// ReputationScoreV3 uses SAS storage, close via PDA
const result = await sati.closeReputationScore({
  payer,
  sasSchema: reputationSchema,
  satiCredential,
  agentMint,
  provider: providerAddress,      // Provider who created it
});
```

**Note:** Only the original provider can close a ReputationScoreV3. Compressed attestations can be closed by anyone with the proof, but the rent goes back to the original payer.

---

## Querying Attestations with Photon

SATI uses Light Protocol's compressed accounts. Query via Helius Photon:

```typescript
import { createPhotonRpc } from "@cascade-fyi/compression-kit";
import { SATI_PROGRAM_ADDRESS, FEEDBACK_OFFSETS } from "@cascade-fyi/sati-sdk";

const rpc = createPhotonRpc("https://devnet.helius-rpc.com?api-key=YOUR_KEY");

// Query all feedbacks for an agent
const feedbacks = await rpc.getCompressedAccountsByOwner({
  owner: SATI_PROGRAM_ADDRESS,
  filters: [
    // sas_schema at offset 8 (after 8-byte Light discriminator)
    { memcmp: { offset: 8, bytes: feedbackSchemaAddress } },
    // agent_mint at offset 40
    { memcmp: { offset: 40, bytes: agentMint } },
  ],
  limit: 50,
});

// Parse results
for (const item of feedbacks.value.items) {
  const data = item.data;
  const outcome = data[FEEDBACK_OFFSETS.outcome]; // 0=Negative, 1=Neutral, 2=Positive
  console.log(`Outcome: ${outcome}`);
}
```

### Memcmp Filter Offsets

The SDK exports offset constants for filtering:

```typescript
import {
  COMPRESSED_OFFSETS,   // Base offsets (sas_schema, agent_mint)
  FEEDBACK_OFFSETS,     // Feedback-specific (outcome at 129 + 8)
  VALIDATION_OFFSETS,   // Validation-specific (response at 130 + 8)
} from "@cascade-fyi/sati-sdk";
```

| Field | Offset | Notes |
|-------|--------|-------|
| `sas_schema` | 8 | Filter by attestation type |
| `agent_mint` | 40 | Filter by agent |
| `outcome` (Feedback) | 137 | 0=Negative, 1=Neutral, 2=Positive |
| `response` (Validation) | 138 | Score 0-100 |

### Pagination

```typescript
let cursor = null;

do {
  const page = await rpc.getCompressedAccountsByOwner({
    owner: SATI_PROGRAM_ADDRESS,
    filters: [...],
    cursor,
    limit: 50,
  });

  // Process page.value.items...
  cursor = page.value.cursor;
} while (cursor);
```

---

## Encrypted Content

SATI supports end-to-end encrypted feedback content using X25519-XChaCha20-Poly1305. Only the intended recipient can decrypt the content.

### Encrypting Content

```typescript
import {
  encryptContent,
  deriveEncryptionKeypair,
  serializeEncryptedPayload,
  ContentType,
} from "@cascade-fyi/sati-sdk";

// Derive encryption keypair from agent's Ed25519 key
// (In practice, get the agent's public key from their Solana address)
const { publicKey: agentEncPubkey } = deriveEncryptionKeypair(agentEd25519Seed);

// Encrypt feedback content for the agent
const plaintext = new TextEncoder().encode("Great service, fast response!");
const encrypted = encryptContent(plaintext, agentEncPubkey);

// Serialize for on-chain storage
const encryptedBytes = serializeEncryptedPayload(encrypted);

// Create feedback with encrypted content
const result = await sati.createFeedback({
  payer,
  sasSchema,
  taskRef,
  agentMint,
  counterparty: clientAddress,
  dataHash: requestHash,
  outcome: Outcome.Positive,
  contentType: ContentType.Encrypted, // Mark as encrypted
  content: encryptedBytes,            // Serialized encrypted payload
  // ... signatures
});
```

### Decrypting Content

```typescript
import {
  decryptContent,
  deserializeEncryptedPayload,
  deriveEncryptionKeypair,
  ContentType,
} from "@cascade-fyi/sati-sdk";

// Agent derives their decryption keypair
const { privateKey } = deriveEncryptionKeypair(agentEd25519Seed);

// Check if content is encrypted
if (feedback.contentType === ContentType.Encrypted) {
  // Deserialize and decrypt
  const payload = deserializeEncryptedPayload(feedback.content);
  const plaintext = decryptContent(payload, privateKey);
  const text = new TextDecoder().decode(plaintext);
  console.log("Decrypted feedback:", text);
}
```

### Key Derivation from Solana Wallets

```typescript
import { deriveEncryptionKeypair, deriveEncryptionPublicKey } from "@cascade-fyi/sati-sdk";

// From wallet secret key (Keypair.secretKey is 64 bytes)
const { publicKey, privateKey } = deriveEncryptionKeypair(wallet.secretKey);

// From just a public key (when you only have the recipient's address)
// Note: Requires the Ed25519 public key bytes, not the base58 string
const recipientX25519Pubkey = deriveEncryptionPublicKey(ed25519PublicKeyBytes);
```

### Size Constraints

| Field | Size |
|-------|------|
| Minimum overhead | 73 bytes (version + pubkey + nonce + auth tag) |
| Maximum plaintext | 439 bytes (512 - 73) |
| Version byte | 1 byte |
| Ephemeral pubkey | 32 bytes |
| Nonce | 24 bytes |
| Auth tag | 16 bytes |

### Security Properties

- **Forward secrecy**: Each encryption uses a fresh ephemeral keypair
- **Authenticated encryption**: XChaCha20-Poly1305 provides confidentiality and integrity
- **Wallet compatibility**: Ed25519 → X25519 derivation works with Solana keypairs

---

## Escrow Integration

SATI attestations can trigger automatic escrow release.

### Approach 1: Off-Chain Verification

Backend monitors attestations and releases escrow when conditions are met:

```typescript
async function checkAndReleaseEscrow(taskRef: Uint8Array, agent: Address) {
  const attestations = await rpc.getCompressedAccountsByOwner({
    owner: SATI_PROGRAM_ADDRESS,
    filters: [
      { memcmp: { offset: 8, bytes: validationSchema } },
      { memcmp: { offset: 40, bytes: agent } },
    ],
  });

  // Find matching task
  const match = attestations.value.items.find((item) => {
    return Buffer.compare(item.data.slice(0, 32), taskRef) === 0;
  });

  if (!match) return null;

  // Check validation score (response at offset 130 in data)
  const PASS_THRESHOLD = 80;
  const response = match.data[130];

  if (response >= PASS_THRESHOLD) {
    return await releaseEscrowFunds(taskRef, agent);
  }
  return null;
}
```

**Pros:** Simple, no on-chain changes needed
**Cons:** Requires trusted backend

### Approach 2: On-Chain ZK Verification

Fully trustless — escrow program verifies attestations via Light Protocol CPI:

```rust
// Escrow program verifies compressed attestation exists
pub fn release_escrow<'info>(
    ctx: Context<'_, '_, '_, 'info, ReleaseEscrow<'info>>,
    proof: ValidityProof,
    account_meta: CompressedAccountMeta,
    attestation_data: Vec<u8>,
    expected_task_ref: [u8; 32],
    expected_agent: Pubkey,
) -> Result<()> {
    // Light CPI verifies attestation exists in merkle tree
    // Fails if attestation doesn't exist or data was tampered
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(account)?
        .invoke(light_cpi_accounts)?;

    // Parse attestation data
    let task_ref: [u8; 32] = attestation_data[0..32].try_into()?;
    let response = attestation_data[130];

    require!(task_ref == expected_task_ref, EscrowError::TaskMismatch);
    require!(response >= PASS_THRESHOLD, EscrowError::ValidationFailed);

    // Release funds...
    Ok(())
}
```

**Client-side:**

```typescript
// Get proof for attestation
const proof = await rpc.getValidityProof({
  hashes: [attestation.hash],
});

// Call escrow program with proof
await escrowProgram.methods
  .releaseEscrow(proof.compressedProof, attestation.accountMeta, ...)
  .remainingAccounts(proof.remainingAccounts)
  .rpc();
```

**Pros:** Fully trustless, no backend needed
**Cons:** Requires custom escrow program with Light integration

---

## Error Handling

### Program Errors

SATI program errors are typed and can be caught:

```typescript
import {
  SatiError,
  isSatiError,
  getSatiErrorMessage,
} from "@cascade-fyi/sati-sdk";

try {
  await sati.createFeedback({ ... });
} catch (error) {
  if (isSatiError(error)) {
    switch (error.code) {
      case SatiError.InvalidSignatureCount:
        console.error("Wrong number of signatures for this schema");
        break;
      case SatiError.SignatureMismatch:
        console.error("Signature doesn't match expected pubkey");
        break;
      case SatiError.SelfAttestationNotAllowed:
        console.error("Agent and counterparty cannot be the same");
        break;
      case SatiError.AttestationNotCloseable:
        console.error("This schema doesn't allow closing attestations");
        break;
      default:
        console.error(getSatiErrorMessage(error.code));
    }
  }
  throw error;
}
```

### Common Error Codes

| Error | Cause | Solution |
|-------|-------|----------|
| `InvalidSignatureCount` | Wrong number of sigs for SignatureMode | DualSignature needs 2, SingleSigner needs 1 |
| `SignatureMismatch` | Sig pubkey doesn't match expected | Verify agent signs interaction hash, counterparty signs feedback hash |
| `SelfAttestationNotAllowed` | `agentMint == counterparty` | Use different addresses for agent and counterparty |
| `InvalidAuthority` | Signer is not registry authority | Only authority can register schemas |
| `ImmutableAuthority` | Registry authority was renounced | Cannot modify immutable registry |
| `AttestationNotCloseable` | Schema has `closeable: false` | Use a different schema or don't close |
| `SchemaConfigNotFound` | Schema not registered with SATI | Register schema via `registerSchemaConfig` first |

### Transaction Errors

```typescript
import { SendTransactionError } from "@solana/kit";

try {
  await sati.registerAgent({ ... });
} catch (error) {
  if (error instanceof SendTransactionError) {
    // Transaction failed (insufficient funds, network issues, etc.)
    console.error("Transaction failed:", error.message);

    // Check logs for more details
    const logs = error.logs;
    if (logs?.some(log => log.includes("insufficient"))) {
      console.error("Insufficient SOL for rent");
    }
  }
}
```

### Light Protocol Errors

```typescript
try {
  await sati.createFeedback({ ... });
} catch (error) {
  // Light Protocol proof errors
  if (error.message?.includes("InvalidProof")) {
    console.error("ZK proof verification failed - retry with fresh proof");
  }
  if (error.message?.includes("StateTreeFull")) {
    console.error("State tree full - SDK should auto-select different tree");
  }
}
```

### Validation Before Submission

Catch errors early by validating inputs:

```typescript
import { MAX_TAG_LENGTH, MAX_CONTENT_SIZE } from "@cascade-fyi/sati-sdk";

function validateFeedbackParams(params: CreateFeedbackParams) {
  if (params.tag1 && params.tag1.length > MAX_TAG_LENGTH) {
    throw new Error(`tag1 exceeds ${MAX_TAG_LENGTH} chars`);
  }
  if (params.content && params.content.length > MAX_CONTENT_SIZE) {
    throw new Error(`content exceeds ${MAX_CONTENT_SIZE} bytes`);
  }
  if (params.agentMint === params.counterparty) {
    throw new Error("Self-attestation not allowed");
  }
}
```

---

## API Reference

### Hash Functions

```typescript
import {
  computeInteractionHash,   // Agent signs (blind to outcome)
  computeAttestationNonce,  // Deterministic nonce for compressed attestation address
  computeReputationNonce,   // Deterministic nonce for ReputationScoreV3 (one per provider+agent)
  computeDataHash,          // Hash request + response content
  computeDataHashFromStrings, // Convenience wrapper for string content
  zeroDataHash,             // Zero-filled hash for CounterpartySigned schemas
} from "@cascade-fyi/sati-sdk";
```

### Serialization

```typescript
import {
  serializeFeedback,
  serializeValidation,
  serializeReputationScore,
  deserializeFeedback,
  deserializeValidation,
  deserializeReputationScore,
} from "@cascade-fyi/sati-sdk";
```

### Constants

```typescript
import {
  SATI_PROGRAM_ADDRESS,   // Program ID
  MAX_CONTENT_SIZE,       // 512 bytes
  MAX_TAG_LENGTH,         // 32 chars
} from "@cascade-fyi/sati-sdk";
```

---

## License

Apache-2.0
