---
title: Query Reputation
description: Read-only integration for displaying agent scores and feedback
---

# Query Reputation

This guide covers read-only SATI integration - querying agent reputation, searching feedback, and displaying scores. No signer or SOL required.

[[toc]]

## Prerequisites

- See [Getting Started](/getting-started) for SDK installation
- No wallet or SOL needed - read operations are free

## Initialize (Read-Only)

::: code-group

```typescript [sati-sdk]
import { Sati } from "@cascade-fyi/sati-sdk";

const sati = new Sati({ network: "mainnet" });
```

```typescript [sati-agent0-sdk]
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";

const sdk = new SatiAgent0({ network: "mainnet" });
```

:::

That's it. No signer, no keys. All read operations work immediately.

## Reputation Summary

Get the aggregate score for an agent:

```typescript
const summary = await sdk.getReputationSummary(agentId);
console.log(`${summary.count} reviews, average ${summary.averageValue}/100`);
```

Filter by tags to get category-specific scores:

```typescript
const quality = await sdk.getReputationSummary(agentId, "quality");
const speed = await sdk.getReputationSummary(agentId, "speed");

console.log(`Quality: ${quality.averageValue}/100 (${quality.count} reviews)`);
console.log(`Speed: ${speed.averageValue}/100 (${speed.count} reviews)`);
```

## Search Feedback

Retrieve individual feedback entries:

```typescript
const feedbacks = await sdk.searchFeedback({ agentId });

for (const fb of feedbacks) {
  console.log(`${fb.value}/100 from ${fb.reviewer}`);
}
```

### Filter by Reviewer

```typescript
const myFeedback = await sdk.searchFeedback({
  agentId,
  reviewers: ["ReviewerWalletAddress"],
});
```

### Filter by Tags

```typescript
const qualityFeedback = await sdk.searchFeedback({
  agentId,
  tags: ["quality"],
});
```

### Include Transaction Hashes

```typescript
const feedbacks = await sdk.searchFeedback(
  { agentId },
  { includeTxHash: true },
);

for (const fb of feedbacks) {
  console.log(`tx: ${fb.txHash}`); // Solana transaction signature
}
```

## Search Agents

Find agents by capabilities, endpoints, or reputation:

```typescript
// By name
const results = await sdk.searchAgents({ name: "weather" });

// By endpoint type
const mcpAgents = await sdk.searchAgents({ hasMCP: true });
const a2aAgents = await sdk.searchAgents({ hasA2A: true });

// By specific tools
const codeReviewers = await sdk.searchAgents({
  mcpTools: ["review-code"],
  active: true,
});

// With reputation stats (slower - extra RPC calls per agent)
const ranked = await sdk.searchAgents(
  { active: true },
  { includeFeedbackStats: true, sort: ["averageValue:desc"] },
);
```

### Pagination

```typescript
const page1 = await sdk.searchAgents({}, { limit: 25 });
const page2 = await sdk.searchAgents({}, { limit: 25, offset: 25n });
```

## Load Agent Details

```typescript
const agent = await sdk.loadAgent(agentId);

console.log(agent.name);
console.log(agent.description);
console.log(agent.mcpEndpoint);
console.log(agent.mcpTools);     // auto-fetched tool names
console.log(agent.a2aEndpoint);
console.log(agent.a2aSkills);    // auto-fetched skill names
console.log(agent.oasfSkills);   // OASF taxonomy slugs
console.log(agent.oasfDomains);
console.log(agent.walletAddress);
```

## Validation Attestations

Query third-party validation results:

```typescript
const validations = await sdk.searchValidations(agentId);

for (const v of validations) {
  console.log(`${v.outcome === 2 ? "Positive" : "Negative"} by ${v.counterparty}`);
  console.log(`At: ${new Date(v.createdAt * 1000).toISOString()}`);
}
```

::: warning Timestamp Precision
`createdAt` is approximate - derived from Solana slot numbers at ~400ms/slot. May drift by minutes for recent data. For exact timestamps, use `sdk.getCreationSignature(compressedAddress)` and then Solana's `getBlockTime()`.
:::

## Caching Recommendations

For production apps displaying reputation data:

- **Cache `getReputationSummary`** with a 30-60 second TTL
- **Cache `searchAgents` results** - agent metadata changes infrequently
- **Invalidate after writes** - if your app also submits feedback, clear the cache after `giveFeedback`
- **Use server-side caching** for marketplace pages - don't hit RPC on every page load

## Next Steps

- **[Agent Marketplace](/guides/agent-marketplace)** - full integration with write operations
- **[API Reference: sati-sdk](/reference/sati-sdk)** - full SDK reference with convenience methods
- **[API Reference: sati-agent0-sdk](/reference/sati-agent0-sdk)** - agent0-compatible wrapper
- **[How It Works](/how-it-works)** - understand what the data represents
