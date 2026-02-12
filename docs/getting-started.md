---
title: Getting Started
description: Go from zero to a registered agent with feedback in 5 minutes
---

# Getting Started

SATI is the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) agent identity standard on Solana. This guide walks you through installing the SDK, registering an agent on devnet, giving feedback, and querying reputation.

[[toc]]

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** and a package manager (pnpm recommended)
- **A Solana wallet with devnet SOL** - you'll need ~0.01 SOL for transactions

::: tip Getting Devnet SOL
Generate a keypair and airdrop SOL using `@solana/kit`:
```typescript
import { generateKeyPairSigner, createSolanaRpc, address } from "@solana/kit";

const signer = await generateKeyPairSigner();
const rpc = createSolanaRpc("https://api.devnet.solana.com");
await rpc.requestAirdrop(signer.address, 1_000_000_000n).send(); // 1 SOL
```
Or use the [Solana Faucet](https://faucet.solana.com) with your wallet address.
:::

## Install

::: code-group

```bash [pnpm]
pnpm add @cascade-fyi/sati-sdk
```

```bash [npm]
npm install @cascade-fyi/sati-sdk
```

:::

**Peer dependencies:**
```bash
pnpm add @solana/kit @solana-program/token-2022
```

## Which SDK?

| Package | Use When |
|---------|----------|
| **[@cascade-fyi/sati-sdk](https://www.npmjs.com/package/@cascade-fyi/sati-sdk)** | Solana-native development - agent registration, feedback, search, reputation, and low-level access. **Start here.** |
| **[@cascade-fyi/sati-agent0-sdk](https://www.npmjs.com/package/@cascade-fyi/sati-agent0-sdk)** | Your codebase already uses [agent0-sdk](https://www.npmjs.com/package/agent0-sdk) types (`AgentId`, `Feedback`, `AgentSummary`). Thin wrapper over sati-sdk. |

## Quick Start

The full loop: initialize, register an agent, give feedback, query reputation.

::: code-group

```typescript [sati-sdk]
import { Sati, createSatiUploader } from "@cascade-fyi/sati-sdk";
import { generateKeyPairSigner, createSolanaRpc } from "@solana/kit";

// 1. Create a funded devnet wallet
const signer = await generateKeyPairSigner();
const rpc = createSolanaRpc("https://api.devnet.solana.com");
await rpc.requestAirdrop(signer.address, 1_000_000_000n).send(); // 1 SOL

// 2. Initialize the client
const sati = new Sati({ network: "devnet" });

// 3. Register an agent (metadata uploaded to IPFS automatically)
const builder = sati
  .createAgentBuilder("MyAgent", "An AI trading assistant", "https://example.com/avatar.png")
  .setMCP("https://mcp.example.com", "2025-06-18")
  .setActive(true);

const reg = await builder.register({
  payer: signer,
  uploader: createSatiUploader(), // hosted IPFS - no API keys needed
});
console.log(reg.mint);         // agent mint address
console.log(reg.signature);    // transaction signature

// 4. Give feedback (ERC-8004 value/tag fields)
const fb = await sati.giveFeedback({
  payer: signer,
  agentMint: reg.mint,
  value: 85,
  tag1: "quality",
  tag2: "speed",
});

// 5. Query reputation
const summary = await sati.getReputationSummary(reg.mint);
console.log(`${summary.count} reviews, avg ${summary.averageValue}`);
```

```typescript [sati-agent0-sdk]
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner, createSolanaRpc } from "@solana/kit";

// 1. Create a funded devnet wallet
const signer = await generateKeyPairSigner();
const rpc = createSolanaRpc("https://api.devnet.solana.com");
await rpc.requestAirdrop(signer.address, 1_000_000_000n).send(); // 1 SOL

// 2. Initialize the SDK
const sdk = new SatiAgent0({
  network: "devnet",
  signer,
});

// 3. Register an agent (metadata is uploaded to IPFS automatically)
const agent = sdk.createAgent("MyAgent", "An AI trading assistant");
agent.setActive(true);

const regHandle = await agent.registerIPFS();
console.log(agent.agentId);   // solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:MintAddr...
console.log(regHandle.hash);  // transaction signature

// 4. Give feedback (ERC-8004 value/tag fields)
const fbHandle = await sdk.giveFeedback(agent.agentId!, 85, "quality", "speed");
const { result: feedback } = await fbHandle.waitMined();

// 5. Query reputation
const summary = await sdk.getReputationSummary(agent.agentId!);
console.log(`${summary.count} reviews, avg ${summary.averageValue}`);
```

:::

::: tip Bring Your Own IPFS
`createSatiUploader()` uses a hosted service - no API keys needed. To use your own [Pinata](https://pinata.cloud) account instead:
```typescript
import { createPinataUploader } from "@cascade-fyi/sati-sdk";
const uploader = createPinataUploader(process.env.PINATA_JWT!);
```
:::

## SDK Modes

```typescript
import { Sati } from "@cascade-fyi/sati-sdk";

// Read-only - search agents, read feedback (no signer needed)
const sati = new Sati({ network: "devnet" });

// With convenience writes - pass a payer to each write method
const result = await sati.giveFeedback({ payer: signer, agentMint, value: 85 });
```

## Next Steps

- **[How It Works](/how-it-works)** - understand blind feedback, compression, and the architecture
- **[Agent Marketplace Guide](/guides/agent-marketplace)** - add reputation to your platform
- **[Register an MCP Agent](/guides/mcp-agent)** - register your MCP server on-chain
- **[Query Reputation](/guides/query-reputation)** - read-only integration for displaying agent scores
- **[API Reference](/reference/)** - full SDK documentation
