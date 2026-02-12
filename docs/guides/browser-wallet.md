---
title: Browser Wallet Flow
description: Collect feedback signed by browser wallets in client-side apps
---

# Browser Wallet Flow

This guide covers collecting feedback in browser-based apps where the user's wallet (Phantom, Solflare, Backpack) signs the feedback. This is a two-step flow: the frontend prepares the feedback, the user signs it, and a server-side signer submits it on-chain.

[[toc]]

## Prerequisites

- A browser wallet adapter (e.g., `@solana/wallet-adapter`)
- A server-side signer with SOL for transaction fees
- See [Getting Started](/getting-started) for SDK installation

## How It Works

1. **Frontend** calls `prepareFeedback()` - builds a SIWS message for the user to sign
2. **User's wallet** signs the message (no SOL needed from the user)
3. **Server** calls `submitPreparedFeedback()` with the user's signature - pays for the transaction

This separation means your users never need SOL - your server covers transaction costs.

## Frontend: Prepare and Sign

```typescript
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";

// Initialize with TransactionSender (browser wallet adapter)
const sdk = new SatiSDK({
  network: "mainnet",
  transactionSender: walletAdapter,
});

// Step 1: Prepare the feedback (builds the SIWS message)
const prepared = await sdk.prepareFeedback(
  agentId,
  85,        // value (0-100)
  "quality", // tag1
  "speed",   // tag2
);

// Step 2: User signs with their wallet
const walletSignature = await wallet.signMessage(prepared.messageBytes);

// Step 3: Send to your server
await fetch("/api/submit-feedback", {
  method: "POST",
  body: JSON.stringify({
    prepared,
    signature: Array.from(walletSignature),
  }),
});
```

## Server: Submit On-Chain

```typescript
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";

// Server SDK with a KeyPairSigner (pays for transactions)
const sdk = new SatiSDK({
  network: "mainnet",
  signer: serverSigner,
});

// Submit the wallet-signed feedback
const handle = await sdk.submitPreparedFeedback(
  prepared,
  new Uint8Array(signatureFromClient),
);

const { result: feedback } = await handle.waitMined();
console.log(handle.hash); // transaction signature
```

## With Typed Outcomes

For workflows that need structured outcomes:

```typescript
import { Outcome } from "@cascade-fyi/sati-agent0-sdk";

const prepared = await sdk.prepareFeedback(
  agentId,
  85,
  "quality",
  "speed",
  {
    endpoint: "https://api.example.com",
    text: "Excellent response",
    outcome: Outcome.Positive,
    taskRef: interactionHashBytes, // deterministic 32-byte reference
  },
);
```

## Error Handling

```typescript
import {
  SatiError,
  AgentNotFoundError,
  ReadOnlyError,
  SignerRequiredError,
} from "@cascade-fyi/sati-agent0-sdk";

try {
  await sdk.submitPreparedFeedback(prepared, walletSignature);
} catch (err) {
  if (err instanceof AgentNotFoundError) {
    // Agent was deregistered between prepare and submit
  } else if (err instanceof SignerRequiredError) {
    // Server SDK missing KeyPairSigner
  }
}
```

## Next Steps

- **[Agent Marketplace](/guides/agent-marketplace)** - full server-side integration
- **[API Reference: prepareFeedback](/reference/sati-agent0-sdk#preparefeedback)** - method signature and options
- **[API Reference: submitPreparedFeedback](/reference/sati-agent0-sdk#submitpreparedfeedback)** - server-side submission
