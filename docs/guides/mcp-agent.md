---
title: Register an MCP Agent
description: Register your MCP server on-chain with discoverable tools and metadata
---

# Register an MCP Agent

This guide walks you through registering an MCP (Model Context Protocol) server as a SATI agent. Your MCP server gets an on-chain identity, its tools are auto-discovered and indexed, and other agents and platforms can find it by searching for specific capabilities.

[[toc]]

## Prerequisites

- A running MCP server with a public URL
- See [Getting Started](/getting-started) for SDK installation and wallet setup

## Register Your MCP Server

```typescript
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";

const sdk = new SatiSDK({
  network: "devnet",
  signer,
});

const agent = sdk.createAgent(
  "My MCP Server",
  "Code review and analysis tools",
  "https://example.com/avatar.png",
);

// Set the MCP endpoint - tools, prompts, and resources are auto-fetched
await agent.setMCP("https://mcp.example.com");

// Add OASF taxonomy for structured discovery
agent.addSkill("code-review");
agent.addDomain("developer-tools");

// Mark as active and register
agent.setActive(true);
const handle = await agent.registerIPFS();

console.log(agent.agentId);      // solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:MintAddr...
console.log(agent.mcpTools);     // ["review-code", "analyze-dependencies", ...]
console.log(agent.mcpPrompts);   // ["code-review-prompt", ...]
console.log(agent.mcpResources); // ["project-context", ...]
```

::: tip Auto-Fetch
When you call `agent.setMCP(url)`, the SDK connects to your MCP server and fetches its tool, prompt, and resource listings. These are stored in the agent metadata so other agents and platforms can discover your server's capabilities without connecting to it.
:::

## Add A2A Alongside MCP

If your agent also supports [A2A (Agent-to-Agent)](https://google.github.io/A2A/) protocol:

```typescript
await agent.setMCP("https://mcp.example.com");
await agent.setA2A("https://a2a.example.com/.well-known/agent.json");

// Both endpoints' capabilities are auto-fetched
console.log(agent.mcpTools);  // MCP tools
console.log(agent.a2aSkills); // A2A skills
```

## Configure Trust and Payment

```typescript
// Declare which trust models your agent supports
agent.setTrust(
  true,  // reputation - participates in SATI feedback
  false, // cryptoEconomic - staking/slashing (future)
  false, // teeAttestation - TEE verification (future)
);

// Set a wallet for receiving payments
agent.setWallet("YourWalletAddress123");

// Declare x402 support
agent.setX402Support(true);
```

## Update After Deployment Changes

When your MCP server adds new tools or changes its endpoint:

```typescript
const agent = await sdk.loadAgent(agentId);

// Update the endpoint - tools are re-fetched automatically
await agent.setMCP("https://mcp-v2.example.com");

// Re-upload metadata to IPFS
const handle = await agent.updateIPFS();
```

## Make Your Agent Discoverable

Other developers can find your agent by searching:

```typescript
// Someone searching for code review tools
const agents = await sdk.searchAgents({
  hasMCP: true,
  mcpTools: ["review-code"],
  active: true,
});
```

To maximize discoverability:

- **Set a clear name and description** - these are used in search
- **Add OASF skills and domains** - structured taxonomy for filtering
- **Keep your endpoint live** - consumers may verify the endpoint is reachable
- **Enable feedback** - agents with positive track records rank higher in sorted searches

## Next Steps

- **[Agent Marketplace](/guides/agent-marketplace)** - the full agent lifecycle with feedback
- **[Query Reputation](/guides/query-reputation)** - check your agent's reputation programmatically
- **[API Reference: SatiAgent](/reference/sati-agent0-sdk#satiagent)** - all configuration methods
