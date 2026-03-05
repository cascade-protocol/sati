---
title: x402 Payment Feedback
description: Link feedback directly to x402 payment transactions
---

# x402 Payment Feedback

SATI is designed as the feedback extension for [x402](https://x402.org) payments. The payment transaction signature becomes the `taskRef`, creating a cryptographic link between payment and feedback.

## How It Works

1. Client pays for a service via x402 (HTTP 402 flow)
2. Facilitator settles the payment on Solana, producing a transaction signature
3. After service delivery, the facilitator (or client) submits SATI feedback with the payment signature as `taskRef`
4. Feedback is permanently linked to the payment transaction on-chain

## taskRef Derivation

SATI's `taskRef` is 32 bytes. Solana transaction signatures are 64 bytes. To link them, hash the signature:

```typescript
import { keccak_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";

// x402 settlement gives you a base58 transaction signature
const txSignature = settlementResponse.transaction; // e.g. "5Kj..."

// Hash to 32 bytes for SATI taskRef
const sigBytes = bs58.decode(txSignature);
const taskRef = keccak_256(sigBytes);
```

This is deterministic - the same payment signature always produces the same `taskRef`. Anyone with the payment tx can verify the link.

## Facilitator Integration

The facilitator is the natural feedback manager - already in the payment flow, trusted by both parties. Use x402's `onAfterSettle` lifecycle hook:

```typescript
import { x402ResourceServer } from "@x402/core";
import { Sati, Outcome, address } from "@cascade-fyi/sati-sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

const sati = new Sati({ network: "mainnet" });
const facilitatorPayer = await createKeyPairSignerFromBytes(keypairBytes);

const server = new x402ResourceServer(facilitatorClient);

server.onAfterSettle(async (context) => {
  const txSignature = context.result.transaction;
  const sigBytes = bs58.decode(txSignature);
  const taskRef = keccak_256(sigBytes);

  // The facilitator's payTo address is the agent's payment wallet.
  // Map it to the agent's SATI mint address (your registry lookup).
  const agentMint = await lookupAgentMint(context.requirements.payTo);

  if (agentMint) {
    await sati.giveFeedback({
      payer: facilitatorPayer,
      agentMint: address(agentMint),
      taskRef,
      outcome: Outcome.Positive,
      value: 100,
      tag1: "x402",
      endpoint: context.paymentPayload.resource?.url,
    });
  }
});
```

## Client-Side Feedback (After Service Delivery)

If the client rates the service after receiving it, pass the payment tx as `taskRef`:

```typescript
import { Sati, Outcome, address } from "@cascade-fyi/sati-sdk";
import { keccak_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";

const sati = new Sati({ network: "mainnet" });

// paymentTxSignature from the x402 settlement response
const taskRef = keccak_256(bs58.decode(paymentTxSignature));

await sati.giveFeedback({
  payer: clientKeypair,
  agentMint: address("AgentMint..."),
  taskRef,
  outcome: Outcome.Positive,
  value: 85,
  tag1: "starred",
  message: "Fast response, accurate results",
});
```

## Browser Wallet Flow (Marketplace)

For marketplaces where the user rates via browser wallet after an x402 purchase:

```typescript
// Server: prepare feedback with the payment's taskRef
const taskRef = keccak_256(bs58.decode(paymentTxSignature));

const prepared = await sati.prepareFeedback({
  counterparty: address(userWalletAddress),
  agentMint: address("AgentMint..."),
  taskRef,
  outcome: Outcome.Positive,
  value: 85,
  tag1: "starred",
});

// Send messageBytes to frontend for signing (see Wallet Adapter section in SKILL.md)
```

## Verifying Payment-Feedback Links

Given a feedback attestation, verify it links to a specific payment:

```typescript
const result = await sati.listFeedbacks({
  agentMint: address("AgentMint...") as Address,
});

const expectedTaskRef = keccak_256(bs58.decode(paymentTxSignature));

for (const fb of result.items) {
  // fb.data.taskRef is the 32-byte hash stored on-chain
  const ref = fb.data.taskRef;
  const matches = ref.length === expectedTaskRef.length &&
    ref.every((b, i) => b === expectedTaskRef[i]);
}
```

## REST API

Submit feedback with a payment link via the REST API (no wallet needed):

```bash
curl -X POST https://sati.cascade.fyi/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "agentMint": "AgentMint...",
    "value": 85,
    "tag1": "x402",
    "outcome": 2,
    "message": "Paid via x402, service delivered correctly"
  }'
```

Note: The REST API generates a random `taskRef` - it does not accept a custom one. For deterministic payment linking, use the SDK.

## Cost Structure

| Operation | Cost |
|-----------|------|
| Feedback attestation | ~0.00001 SOL (ZK compressed) |
| x402 payment (separate) | Varies by facilitator |

Feedback costs are negligible compared to the x402 payment itself. Facilitators can batch feedback submissions to reduce per-transaction overhead.
