---
title: Getting Started
description: Go from zero to a registered agent with feedback in 5 minutes
---

# Getting Started

This guide walks you through installing the SDK, registering an agent on devnet, giving feedback, and querying reputation.

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
pnpm add @cascade-fyi/sati-agent0-sdk
```

```bash [npm]
npm install @cascade-fyi/sati-agent0-sdk
```

:::

**Peer dependencies:**
```bash
pnpm add @cascade-fyi/sati-sdk @solana/kit @solana-program/token-2022 agent0-sdk
```

## Which SDK?

| Package | Use When |
|---------|----------|
| **[@cascade-fyi/sati-agent0-sdk](https://www.npmjs.com/package/@cascade-fyi/sati-agent0-sdk)** | Building apps that interact with agents - registration, feedback, search, reputation. **Start here.** |
| **[@cascade-fyi/sati-sdk](https://www.npmjs.com/package/@cascade-fyi/sati-sdk)** | Low-level access - raw attestations, custom schemas, compression, encryption. For advanced integrations. |

## Quick Start

The full loop: initialize, register an agent, give feedback, query reputation.

```typescript
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner, createSolanaRpc } from "@solana/kit";

// 1. Create a funded devnet wallet
const signer = await generateKeyPairSigner();
const rpc = createSolanaRpc("https://api.devnet.solana.com");
await rpc.requestAirdrop(signer.address, 1_000_000_000n).send(); // 1 SOL

// 2. Initialize the SDK
const sdk = new SatiSDK({
  network: "devnet",
  signer,
});

// 3. Register an agent (metadata is uploaded to IPFS automatically)
const agent = sdk.createAgent("MyAgent", "An AI trading assistant");
agent.setActive(true);

const regHandle = await agent.registerIPFS();
console.log(agent.agentId);   // solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:MintAddr...
console.log(regHandle.hash);  // transaction signature

// 4. Give feedback (0-100 score with optional tags)
const fbHandle = await sdk.giveFeedback(agent.agentId!, 85, "quality", "speed");
const { result: feedback } = await fbHandle.waitMined();

// 5. Query reputation
const summary = await sdk.getReputationSummary(agent.agentId!);
console.log(`${summary.count} reviews, avg ${summary.averageValue}`);
```

::: tip Bring Your Own IPFS
`registerIPFS()` uses a hosted uploader by default - no API keys needed. To use your own [Pinata](https://pinata.cloud) account instead, pass `pinataJwt`:
```typescript
const sdk = new SatiSDK({
  network: "devnet",
  signer,
  pinataJwt: process.env.PINATA_JWT, // optional - uses hosted uploader if omitted
});
```
You can also use `registerHTTP(url)` if you host metadata at your own URL.
:::

## SDK Modes

```typescript
// Read-only (no signer) - search agents, read feedback
const readOnly = new SatiSDK({ network: "devnet" });

// Server-side (KeyPairSigner) - full write access
const server = new SatiSDK({ network: "devnet", signer });

// Browser wallet (TransactionSender) - wallet-signed writes
const browser = new SatiSDK({ network: "devnet", transactionSender: walletAdapter });
```

## Next Steps

- **[How It Works](/how-it-works)** - understand blind feedback, compression, and the architecture
- **[Agent Marketplace Guide](/guides/agent-marketplace)** - add reputation to your platform
- **[Register an MCP Agent](/guides/mcp-agent)** - register your MCP server on-chain
- **[Query Reputation](/guides/query-reputation)** - read-only integration for displaying agent scores
- **[API Reference](/reference/)** - full SDK documentation
