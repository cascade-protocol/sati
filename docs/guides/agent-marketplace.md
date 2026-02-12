---
title: Agent Marketplace
description: Add identity, reputation, and discovery to your agent marketplace
---

# Agent Marketplace

This guide walks you through integrating SATI into an agent marketplace. By the end, your platform will register agents with on-chain identity, collect feedback after interactions, and display reputation scores.

[[toc]]

## What You'll Build

- Agents register on-chain when they join your marketplace
- After each interaction, feedback is recorded as a compressed attestation
- Marketplace pages show reputation scores pulled from on-chain data
- Users can search and filter agents by capabilities, feedback stats, and more

## Prerequisites

- A server-side Node.js environment (the signer holds SOL and pays for transactions)
- A funded Solana wallet (~0.01 SOL per agent registration, ~$0.002 per feedback)
- See [Getting Started](/getting-started) for installation

## Initialize the SDK

```typescript
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

const signer = await createKeyPairSignerFromBytes(
  base58.decode(process.env.SATI_PRIVATE_KEY!),
);

const sdk = new SatiSDK({
  network: "mainnet",
  signer,
});
```

## Register Agents

When an agent joins your marketplace, register it on-chain:

```typescript
const agent = sdk.createAgent(
  "WeatherBot",
  "Real-time weather data for any location",
  "https://yourcdn.com/weatherbot-avatar.png",
);

// Configure endpoints and capabilities
await agent.setMCP("https://weatherbot.example.com/mcp");
agent.setWallet("AgentWalletAddress123");
agent.setActive(true);
agent.setX402Support(true);
agent.addSkill("weather-forecast");
agent.addDomain("data-services");

// Register on IPFS and on-chain
const handle = await agent.registerIPFS();
console.log(agent.agentId); // solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:MintAddr...
```

### Update an Existing Agent

```typescript
const agent = await sdk.loadAgent(agentId);
agent.updateInfo("WeatherBot v2", "Updated weather data with forecasts");
await agent.setMCP("https://weatherbot-v2.example.com/mcp");

const handle = await agent.updateIPFS();
```

## Collect Feedback

After an interaction completes, record feedback:

```typescript
const handle = await sdk.giveFeedback(
  agentId,
  85,                              // value (0-100)
  "quality",                       // tag1 (optional)
  "speed",                         // tag2 (optional)
  "https://api.example.com",       // endpoint (optional)
  { text: "Fast and accurate" },   // feedbackFile (optional)
);

const { result: feedback } = await handle.waitMined();
console.log(handle.hash); // transaction signature
```

### Typed Outcomes

For structured workflows (escrow, quality gates), use typed outcomes:

```typescript
import { Outcome } from "@cascade-fyi/sati-agent0-sdk";

const handle = await sdk.giveFeedback(agentId, 85, "governance", "defi", undefined, {
  text: "Proposal executed correctly",
  outcome: Outcome.Positive,
  taskRef: proposalHashBytes, // deterministic 32-byte reference
});
```

## Display Reputation

### Summary Stats

```typescript
const summary = await sdk.getReputationSummary(agentId);
console.log(`${summary.count} reviews, avg ${summary.averageValue}`);

// Filter by tags
const qualitySummary = await sdk.getReputationSummary(agentId, "quality");
```

### Feedback History

```typescript
const feedbacks = await sdk.searchFeedback(
  { agentId, tags: ["quality"] },
  { includeTxHash: true },
);

for (const fb of feedbacks) {
  console.log(`${fb.value}/100 from ${fb.reviewer}`);
}
```

### Revoke Feedback

If a reviewer wants to retract their feedback:

```typescript
const [feedback] = await sdk.searchFeedback({
  agentId,
  reviewers: [myAddress],
});
const handle = await sdk.revokeFeedback(feedback);
```

## Search and Discovery

```typescript
// By name
const results = await sdk.searchAgents({ name: "weather" });

// By capabilities
const mcpAgents = await sdk.searchAgents({
  hasMCP: true,
  mcpTools: ["web-search"],
});

// With reputation stats (slower - extra RPC calls per agent)
const ranked = await sdk.searchAgents(
  { active: true },
  { includeFeedbackStats: true, sort: ["averageValue:desc"] },
);

// Paginated
const page = await sdk.searchAgents({}, { limit: 25, offset: 50n });
```

## Architecture Tips

- **Cache reputation data.** Don't query Solana RPC on every page load. Cache `getReputationSummary` results with a 30-60 second TTL and invalidate after writing new feedback.
- **Use read-only mode for frontends.** `new SatiSDK({ network: "mainnet" })` - no signer needed for search and display.
- **Server-side signer for writes.** Keep your signing key on the server. Budget ~0.01 SOL per 5 feedback submissions.
- **Agent metadata on IPFS.** `registerIPFS()` works out of the box - no API keys needed. For production, you can pass your own `pinataJwt` for full control over your IPFS pins. Use `registerHTTP()` only if you need mutable metadata at a URL you control.

## Next Steps

- **[API Reference: sati-agent0-sdk](/reference/sati-agent0-sdk)** - full method signatures and types
- **[Query Reputation](/guides/query-reputation)** - read-only integration for displaying scores
- **[Browser Wallet Flow](/guides/browser-wallet)** - collect feedback from browser wallets
- **[How It Works](/how-it-works)** - understand blind feedback and compression
