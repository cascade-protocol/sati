---
title: Getting Started
description: Get up and running with SATI in 5 minutes
---

# Getting Started

SATI provides on-chain reputation for AI agents on Solana. This guide covers installation, agent registration, and submitting your first feedback.

## Prerequisites

- Node.js 18+
- Solana wallet with SOL for transactions
- pnpm/npm/yarn

## Installation

::: code-group

```bash [pnpm]
pnpm add @cascade-fyi/sati-sdk
```

```bash [npm]
npm install @cascade-fyi/sati-sdk
```

```bash [yarn]
yarn add @cascade-fyi/sati-sdk
```

:::

## Quick Start

### 1. Initialize Client

```typescript
import { Sati } from '@cascade-fyi/sati-sdk'

const sati = new Sati({
  network: 'mainnet',
  rpcUrl: 'https://mainnet.helius-rpc.com?api-key=YOUR_KEY',
})
```

### 2. Register an Agent

Agent registration creates a Token-2022 NFT with metadata and group membership.

```typescript
const { mint, signature } = await sati.registerAgent({
  payer: walletKeypair,
  name: "MyTradingAgent",
  uri: "https://example.com/agent.json",  // ERC-8004 registration file
  additionalMetadata: [
    ["version", "1.0.0"],
    ["agentWallet", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4Hxy..."],
  ],
})

console.log(`Agent registered: ${mint}`)
```

**Cost**: ~0.003 SOL (mint + metadata + group + AgentIndex)

### 3. Submit Feedback

```typescript
// Both parties sign - agent blind to outcome
const feedback = await sati.giveFeedback({
  agentMint: targetAgentMint,
  counterparty: clientKeypair,
  score: 100,  // 0-100
  tag1: "x402-resource-delivered",
  tag2: "fast-response",
  taskRef: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:4xJ2...",  // Payment tx (CAIP-220)
})
```

**Cost**: ~$0.002 per attestation via ZK compression

### 4. Query Reputation

```typescript
import { loadDeployedConfig } from '@cascade-fyi/sati-sdk'

// Load schema addresses for the network
const config = loadDeployedConfig('mainnet')
const feedbackSchema = config!.schemas.feedback

// Query feedbacks for an agent
const result = await sati.listFeedbacks({
  sasSchema: feedbackSchema,
  agentMint
})

for (const fb of result.items) {
  console.log(`Outcome: ${fb.data.outcome}`)
  console.log(`Counterparty: ${fb.data.counterparty}`)
}

// Handle pagination if more results exist
if (result.cursor) {
  const nextPage = await sati.listFeedbacks({
    sasSchema: feedbackSchema,
    agentMint,
    cursor: result.cursor
  })
}
```

Compressed attestations are indexed via [Photon](https://photon.helius.dev/) (free). The SDK handles Photon integration automatically.

## Costs

| Operation | Cost | Notes |
|-----------|------|-------|
| Agent registration | ~0.003 SOL | Mint + metadata + group + AgentIndex |
| Feedback (single) | ~$0.002 | ~0.00001 SOL via Light Protocol |
| Feedback (batched 5/tx) | ~$0.0006 | Amortized proof cost |
| Validation | ~$0.002 | Same as feedback |
| ReputationScore | ~0.002 SOL | Regular SAS attestation |
| Delegation grant | ~0.002 SOL | Regular SAS attestation (reclaimable) |

## Next Steps

- [Core Concepts](/guide/concepts) - Understand blind feedback and incentive alignment
- [Agent Registration](/guide/agent-registration) - Full registration options
- [Feedback & Reputation](/guide/feedback) - Submitting and querying feedback
- [Delegation](/guide/delegation) - Hot/cold wallet separation
- [Specification](/specification) - Complete technical reference

## Deployed Addresses

| Network | Program ID |
|---------|------------|
| Mainnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |
| Devnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |

| Asset | Address |
|-------|---------|
| TokenGroup Mint | `satiG7i9iyFxjq23sdyeLB4ibAHf6GXCARuosGeqane` |
