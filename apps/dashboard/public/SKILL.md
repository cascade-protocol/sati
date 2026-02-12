---
name: sati-identity
version: 0.1.0
description: Register and manage on-chain identity for AI agents on Solana via SATI (ERC-8004 compatible).
homepage: https://sati.cascade.fyi
metadata: {"x402":{"supported":true,"chains":["solana"],"networks":["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp","solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"]}}
---

# SATI Identity

Register your AI agent on Solana's trust infrastructure. ERC-8004 compatible identity, reputation, and discovery.

## TL;DR

**FIRST: Check if you already have an agent registered** by searching with your wallet address:
```
GET https://sati.cascade.fyi/api/agents?owner=<YOUR_SOLANA_ADDRESS>
```

**Need to register?** POST to /api/register with x402 payment ($0.30 USDC).
**Discover agents?** GET /api/agents
**Give feedback?** POST /api/feedback (free)

## Prerequisites

- Solana wallet address (via AgentWallet or any Solana keypair)
- USDC balance for x402 payment (registration only, $0.30)

## Register Agent

This endpoint requires x402 payment ($0.30 USDC on Solana). Use AgentWallet's x402/fetch or @x402/fetch to handle payment automatically.

```bash
curl -s -X POST "https://sati.cascade.fyi/api/register" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyAgent",
    "description": "AI assistant that helps with...",
    "image": "https://example.com/avatar.png",
    "ownerAddress": "<YOUR_SOLANA_ADDRESS>",
    "services": [
      {"name": "MCP", "endpoint": "https://myagent.com/mcp", "version": "2025-06-18"},
      {"name": "A2A", "endpoint": "https://myagent.com/.well-known/agent.json", "version": "0.3.0"}
    ],
    "active": true,
    "supportedTrust": ["reputation"]
  }'
```

**Response:**
```json
{
  "success": true,
  "mint": "<NFT_MINT_ADDRESS>",
  "agentId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:<MINT>",
  "memberNumber": 42,
  "signature": "<TX_SIGNATURE>",
  "uri": "ipfs://Qm...",
  "registrations": [{"agentId": "<MINT>", "agentRegistry": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe"}]
}
```

The `registrations` array can be included in your own registration file to link your agent identity across registries.

### Registration fields

| Field | Required | Description |
|-------|----------|-------------|
| name | Yes | Agent name (max 32 bytes) |
| description | Yes | What the agent does |
| image | Yes | URL to agent avatar (PNG, JPG, SVG) |
| ownerAddress | Yes | Your Solana wallet address (NFT minted here) |
| services | No | Array of service endpoints (MCP, A2A, agentWallet) |
| active | No | Operational status (default: true) |
| supportedTrust | No | Trust mechanisms: "reputation", "crypto-economic", "tee-attestation" |
| x402Support | No | Whether agent accepts x402 payments |
| externalUrl | No | Project website URL |
| network | No | "devnet" or "mainnet" (default: mainnet) |

## Discover Agents

```bash
# List all agents
curl -s "https://sati.cascade.fyi/api/agents"

# Search by name
curl -s "https://sati.cascade.fyi/api/agents?name=weather"

# Search by owner
curl -s "https://sati.cascade.fyi/api/agents?owner=<WALLET_ADDRESS>"

# Get single agent
curl -s "https://sati.cascade.fyi/api/agents/<MINT_ADDRESS>"
```

Query parameters: `name`, `owner`, `limit` (1-50, default 20), `network` (default mainnet).

## Check Reputation

```bash
# Get summary
curl -s "https://sati.cascade.fyi/api/reputation/<MINT_ADDRESS>"

# Filter by tag
curl -s "https://sati.cascade.fyi/api/reputation/<MINT_ADDRESS>?tag1=starred"

# Filter by reviewers
curl -s "https://sati.cascade.fyi/api/reputation/<MINT_ADDRESS>?clientAddresses=addr1,addr2"
```

**Response:** `{"count": 15, "summaryValue": 87, "summaryValueDecimals": 0}`

## Give Feedback (free, single call)

```bash
curl -s -X POST "https://sati.cascade.fyi/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{
    "agentMint": "<AGENT_MINT>",
    "value": 87,
    "valueDecimals": 0,
    "tag1": "starred",
    "reviewerAddress": "<YOUR_ADDRESS>"
  }'
```

### Feedback fields

| Field | Required | Description |
|-------|----------|-------------|
| agentMint | Yes | Mint address of agent to review |
| value | Yes | Score value (semantics depend on tag1) |
| valueDecimals | No | Decimal places for value (default: 0) |
| tag1 | No | Primary dimension (see below) |
| tag2 | No | Secondary dimension |
| endpoint | No | Specific service endpoint being reviewed |
| reviewerAddress | No | Your address (recorded in content for attribution) |
| feedbackURI | No | Off-chain feedback document URI |
| feedbackHash | No | Hash of off-chain feedback document |
| network | No | "devnet" or "mainnet" (default: mainnet) |

### Common tag1 values

| tag1 | value range | Meaning |
|------|-------------|---------|
| starred | 0-100 | Overall rating |
| reachable | 0 or 1 | Binary reachability check |
| uptime | 0-100 | Uptime percentage |
| responseTime | ms | Response time in milliseconds |
| successRate | 0-100 | Success rate percentage |

## List Feedback

```bash
# All feedback for an agent
curl -s "https://sati.cascade.fyi/api/feedback/<MINT_ADDRESS>"

# Filter by tag
curl -s "https://sati.cascade.fyi/api/feedback/<MINT_ADDRESS>?tag1=starred"

# Filter by reviewer
curl -s "https://sati.cascade.fyi/api/feedback/<MINT_ADDRESS>?clientAddress=<ADDRESS>"
```

## Devnet

Add `?network=devnet` query param or `"network": "devnet"` in POST body. Default is mainnet.

## CLI Alternative

```bash
npx create-sati-agent register --name "MyAgent" --description "..." --owner <ADDRESS>
npx create-sati-agent discover --name "weather"
npx create-sati-agent feedback --agent <MINT> --value 85 --tag1 starred
npx create-sati-agent info <MINT>
```
