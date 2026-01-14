---
title: Agent Registration
description: Registering AI agents with Token-2022 NFT identity
---

# Agent Registration

SATI agents are represented as Token-2022 NFTs with metadata. This provides:

- Verifiable on-chain identity
- Standard metadata format (ERC-8004 compatible)
- Group membership for ecosystem discovery
- Enumeration via AgentIndex PDAs

## Token-2022 NFT Structure

Each agent is a non-fungible token with these extensions:

| Extension | Purpose |
|-----------|---------|
| **TokenMetadata** | Name, symbol, URI, additional fields |
| **TokenGroupMember** | Membership in SATI TokenGroup |
| **NonTransferable** | Optional soulbound mode |

## Registration

```typescript
import { SatiClient } from '@cascade-fyi/sati-sdk'

const sati = new SatiClient({ rpc })

const { mint, signature } = await sati.registerAgent({
  payer: walletKeypair,
  name: "MyTradingAgent",
  symbol: "AGENT",
  uri: "https://example.com/agent.json",
  additionalMetadata: [
    ["version", "1.0.0"],
    ["capabilities", "trading,analysis"],
    ["agentWallet", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxyJnw..."],
  ],
})

console.log(`Agent mint: ${mint}`)
console.log(`Transaction: ${signature}`)
```

**Cost**: ~0.003 SOL

## Registration File (ERC-8004)

The `uri` should point to an ERC-8004 compatible registration file:

```json
{
  "$schema": "https://erc8004.org/schema/0.1.0/registration.json",
  "name": "MyTradingAgent",
  "description": "Autonomous trading agent for DeFi",
  "version": "1.0.0",
  "capabilities": ["trading", "analysis", "reporting"],
  "registrations": [
    {
      "chainId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "agentId": "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5",
      "agentWallet": "7S3P4HxyJnwKvPHjdubtqhC3HxnZNXs..."
    }
  ],
  "x402": {
    "endpoint": "https://api.myagent.com/x402",
    "supportedSchemes": ["exact_svm"]
  }
}
```

## Metadata Fields

### Required

| Field | Description |
|-------|-------------|
| `name` | Human-readable agent name |
| `uri` | URL to registration file |

### Recommended

| Field | Key | Description |
|-------|-----|-------------|
| Symbol | `symbol` | Short identifier (e.g., "AGENT") |
| Version | `version` | Agent software version |
| Agent Wallet | `agentWallet` | CAIP-10 address for signing |
| Capabilities | `capabilities` | Comma-separated capability list |

## Soulbound Agents

For agents that should never be transferred:

```typescript
const { mint } = await sati.registerAgent({
  payer: walletKeypair,
  name: "MySoulboundAgent",
  uri: "https://example.com/agent.json",
  soulbound: true,  // Non-transferable
})
```

This uses Token-2022's NonTransferable extension to prevent ownership changes.

## Agent Enumeration

All registered agents are indexed via AgentIndex PDAs:

```typescript
// Get agent by member number
const agent = await sati.getAgentByMemberNumber(1n)

// List all agents
const agents = await sati.listAllAgents()
for (const agent of agents) {
  console.log(`Agent ${agent.memberNumber}: ${agent.mint}`)
}
```

### AgentIndex PDA

Each agent gets an AgentIndex PDA at registration:

```
PDA seeds: ["agent_index", member_number.to_le_bytes()]
```

| Field | Type | Description |
|-------|------|-------------|
| `mint` | Pubkey | Agent mint address |
| `bump` | u8 | PDA bump |

This enables O(1) agent lookup by member number and enumeration without external indexing.

## Querying Agents

### By Mint Address

```typescript
const agent = await sati.getAgent(mintAddress)

console.log(`Name: ${agent.name}`)
console.log(`URI: ${agent.uri}`)
console.log(`Owner: ${agent.owner}`)
```

### By Owner

```typescript
// Find all agents owned by a wallet
const myAgents = await sati.getAgentsByOwner(walletAddress)
```

### With Metadata

```typescript
const agent = await sati.getAgent(mintAddress)

// Access additional metadata
for (const [key, value] of agent.additionalMetadata) {
  console.log(`${key}: ${value}`)
}
```

## Transferring Agents

Unless soulbound, agents can be transferred using standard Token-2022 transfers:

```typescript
import { transfer } from '@solana/spl-token'

await transfer(
  connection,
  payer,
  sourceAta,
  destinationAta,
  owner,
  1,  // Amount (1 for NFT)
  [],
  undefined,
  TOKEN_2022_PROGRAM_ID
)
```

::: warning Delegation Note
When an agent is transferred, existing delegations become invalid. The delegation stores the owner at creation time and verifies it hasn't changed.
:::

## Registry Information

Query the global registry:

```typescript
const registry = await sati.getRegistry()

console.log(`Total agents: ${registry.totalAgents}`)
console.log(`Group mint: ${registry.groupMint}`)
console.log(`Authority: ${registry.authority}`)
```
