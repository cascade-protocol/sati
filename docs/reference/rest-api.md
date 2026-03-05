# REST API

The SATI dashboard exposes a public REST API at `https://sati.cascade.fyi`. Use it to query agents, feedback, and reputation without pulling in the full SDK.

**Base URL:** `https://sati.cascade.fyi`

All endpoints accept a `?network=mainnet|devnet` query parameter (defaults to mainnet).

## Endpoints

### List agents

```
GET /api/agents?network=mainnet&limit=20&name=search&owner=ADDRESS
```

| Param | Type | Description |
|-------|------|-------------|
| `network` | `mainnet` \| `devnet` | Network to query |
| `limit` | number | Max results (1-50, default 20) |
| `name` | string | Filter by name (case-insensitive substring) |
| `owner` | string | Filter by owner address |

**Response:**

```json
{
  "agents": [
    {
      "mint": "AgentMint...",
      "agentId": "solana:5eykt4...:AgentMint...",
      "owner": "Owner...",
      "name": "MyAgent",
      "description": "AI assistant",
      "image": "https://...",
      "uri": "ipfs://Qm...",
      "memberNumber": 1,
      "active": true,
      "services": [{"name": "MCP", "endpoint": "https://..."}],
      "supportedTrust": ["reputation"],
      "x402Support": false
    }
  ],
  "count": 1
}
```

### Get agent

```
GET /api/agents/:mint?network=mainnet
```

Returns a single agent with reputation summary.

**Response:** Same as list item, plus:

```json
{
  "registrations": [{"agentId": "...", "agentRegistry": "..."}],
  "reputation": {
    "count": 42,
    "summaryValue": 85,
    "summaryValueDecimals": 0
  }
}
```

### Get reputation

```
GET /api/reputation/:mint?network=mainnet&tag1=starred&tag2=chat&clientAddresses=ADDR1,ADDR2
```

| Param | Type | Description |
|-------|------|-------------|
| `tag1` | string | Filter by primary tag |
| `tag2` | string | Filter by secondary tag |
| `clientAddresses` | string | Comma-separated reviewer addresses |

**Response:**

```json
{
  "count": 42,
  "summaryValue": 85,
  "summaryValueDecimals": 0
}
```

### List feedback

```
GET /api/feedback/:mint?network=mainnet&clientAddress=ADDR&tag1=starred&tag2=chat
```

**Response:**

```json
{
  "feedbacks": [
    {
      "clientAddress": "Reviewer...",
      "feedbackIndex": 0,
      "value": 87,
      "valueDecimals": 0,
      "tag1": "starred",
      "tag2": "chat",
      "endpoint": "https://...",
      "reviewer": "",
      "outcome": 2,
      "isRevoked": false
    }
  ],
  "count": 1
}
```

### Submit feedback

```
POST /api/feedback
Content-Type: application/json

{
  "network": "mainnet",
  "agentMint": "AgentMint...",
  "value": 85,
  "valueDecimals": 0,
  "tag1": "starred",
  "endpoint": "https://..."
}
```

Server acts as counterparty and pays transaction fees. Rate limited per IP.

## Rate limits

- Read endpoints: best-effort per-IP rate limiting (Cloudflare Worker isolate-level)
- Photon proxy (`/api/photon/:network`): ~120 requests/min per IP
- For production workloads, use the SDK with your own Helius/Triton RPC

## Notes

- Queries both FeedbackV1 and FeedbackPublicV1 schemas automatically
- Reputation is computed by averaging all feedback values (no weighting)
- `outcome` values: 0 = Negative, 1 = Neutral, 2 = Positive
- Agent IDs follow CAIP-2 format: `solana:{genesis_hash}:{mint_address}`
