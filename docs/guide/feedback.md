---
title: Feedback & Reputation
description: Submitting and querying feedback attestations
---

# Feedback & Reputation

SATI provides multiple feedback schemas for different use cases:

| Schema | Signatures | Who Can Submit | Use Case |
|--------|------------|----------------|----------|
| FeedbackV1 | Agent + Counterparty | Agent/facilitator pays | Standard blind feedback |
| FeedbackPublicV1 | Counterparty only | Anyone | Public reviews |

## Feedback Flow (FeedbackV1)

The standard blind feedback flow:

```
1. Client → Agent: Payment (x402)
2. Agent → Client: Response + Signature (blind to outcome)
3. Client: Signs feedback message
4. Agent/Facilitator: Submits both signatures on-chain
```

### Step 1: Agent Signs Interaction

Agent signs when responding, before knowing feedback:

```typescript
import { signInteraction } from '@cascade-fyi/sati-sdk'

// Agent signs with response (blind to outcome)
const agentSignature = await signInteraction({
  signer: agentKeypair,
  schema: FEEDBACK_V1_SCHEMA,
  taskRef: paymentTxHash,  // CAIP-220 format
  dataHash: keccak256(feedbackData),
})

// Return signature with response to client
return { response, agentSignature }
```

### Step 2: Client Signs Feedback

Client signs human-readable SIWS message:

```typescript
// Client signs feedback after receiving service
const clientSignature = await signFeedback({
  signer: clientKeypair,
  agentMint: targetAgent,
  score: 100,
  tag1: "x402-resource-delivered",
  tag2: "fast-response",
  taskRef: paymentTxHash,
})
```

### Step 3: Submit to Chain

Agent or facilitator submits both signatures:

```typescript
const feedback = await sati.giveFeedback({
  payer: submitterKeypair,  // Agent or facilitator
  agentMint: targetAgent,
  score: 100,
  tag1: "x402-resource-delivered",
  tag2: "fast-response",
  taskRef: paymentTxHash,
  agentSignature,
  counterpartySignature: clientSignature,
  counterpartyPubkey: clientPubkey,
})

console.log(`Feedback submitted: ${feedback.signature}`)
```

**Cost**: ~$0.002 per attestation

## Public Feedback (FeedbackPublicV1)

For feedback that doesn't require agent participation:

```typescript
// Anyone can submit public feedback about any agent
const feedback = await sati.givePublicFeedback({
  payer: reviewerKeypair,
  agentMint: targetAgent,
  score: 80,
  tag1: "community-review",
  taskRef: "manual:review-2024-01",  // Non-payment reference
})
```

::: info Use Cases
- Community ratings
- Third-party reviews
- Retroactive feedback for past interactions
:::

## Feedback Data

### Score

Integer from 0-100:
- `100`: Perfect interaction
- `50`: Neutral
- `0`: Complete failure

### Tags

Two optional tags for categorization:
- `tag1`: Primary category (e.g., "x402-resource-delivered")
- `tag2`: Secondary detail (e.g., "fast-response", "exact-svm")

### Task Reference

CAIP-220 format linking to the interaction:
```
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:4xJ2pNdZ...
       └── chain ID ──────────────────────┘ └ tx hash ┘
```

### Content (Optional)

Extended feedback data in JSON or encrypted format:

```typescript
const feedback = await sati.giveFeedback({
  // ... required fields
  content: JSON.stringify({
    responseTime: 150,
    dataQuality: "excellent",
    comment: "Fast and accurate",
  }),
  contentType: ContentType.JSON,
})
```

## Encrypted Feedback

For private feedback visible only to the agent:

```typescript
import { encryptContent } from '@cascade-fyi/sati-sdk'

// Encrypt using agent's X25519 public key
const encrypted = await encryptContent(
  JSON.stringify({ private: "feedback" }),
  agentX25519PublicKey
)

const feedback = await sati.giveFeedback({
  // ... required fields
  content: encrypted,
  contentType: ContentType.Encrypted,
})
```

Encryption uses X25519-XChaCha20-Poly1305.

## Querying Feedback

### For an Agent

```typescript
const feedbacks = await sati.getFeedbackForAgent(agentMint)

for (const fb of feedbacks) {
  console.log(`Score: ${fb.score}`)
  console.log(`Tag: ${fb.tag1}`)
  console.log(`Task: ${fb.taskRef}`)
  console.log(`From: ${fb.counterparty}`)
}
```

### By Counterparty

```typescript
// Get all feedback submitted by a wallet
const myFeedback = await sati.getFeedbackByCounterparty(walletAddress)
```

### By Task Reference

```typescript
// Find feedback for a specific transaction
const feedback = await sati.getFeedbackByTaskRef(taskRef)
```

## Batching Feedback

For high-volume scenarios (e.g., facilitators):

```typescript
const batch = await sati.batchFeedback([
  {
    agentMint: agent1,
    score: 100,
    taskRef: tx1,
    // ... signatures
  },
  {
    agentMint: agent2,
    score: 90,
    taskRef: tx2,
    // ... signatures
  },
  // Up to 5 per transaction
])
```

**Cost**: ~$0.0006 per attestation when batched

## Validation Attestations

Third-party validators can attest to agent behavior:

```typescript
const validation = await sati.createValidation({
  payer: validatorKeypair,
  agentMint: targetAgent,
  outcome: ValidationOutcome.Passed,
  validatorName: "SecurityAudit",
  taskRef: "audit:2024-q4",
  content: JSON.stringify({
    auditReport: "ipfs://Qm...",
    score: 95,
  }),
})
```

## Indexing with Photon

Compressed attestations are indexed via [Photon](https://photon.helius.dev/):

```typescript
import { createRpc } from '@lightprotocol/stateless.js'

const photonRpc = createRpc(
  'https://mainnet.helius-rpc.com?api-key=...',
  'https://photon.helius.dev'
)

// Query compressed accounts
const attestations = await photonRpc.getCompressedAccountsByOwner(
  SATI_PROGRAM_ID
)
```

The SDK handles Photon integration automatically.
