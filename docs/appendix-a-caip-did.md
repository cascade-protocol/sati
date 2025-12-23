# Appendix A: CAIP, DID, and ERC-8004 Reference

Detailed format specifications for cross-chain interoperability standards used by SATI.

---

## CAIP-2: Blockchain ID

Chain identifiers follow format: `namespace:reference`

| Chain | CAIP-2 Identifier |
|-------|-------------------|
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Ethereum Mainnet | `eip155:1` |
| Base | `eip155:8453` |

---

## CAIP-10: Account ID

Account identifiers follow format: `chain_id:account_address`

```
// Solana account on mainnet:
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv

// Ethereum account:
eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7
```

---

## DID Support

Agents can advertise DIDs via `additionalMetadata`:

```typescript
["did", "did:web:agent.example.com"]           // Web-based DID
["did", "did:pkh:solana:5eykt4...:7S3P4..."]   // PKH (blockchain account)
["did", "did:key:z6Mkf..."]                    // Key-based DID
```

---

## Endpoint Capability Arrays (ERC-8004 Best Practice)

Registration files can include capability arrays for protocol endpoints:

**MCP Endpoints:**
```json
{
  "name": "MCP",
  "endpoint": "https://api.example.com/mcp",
  "version": "2025-06-18",
  "mcpTools": ["data_analysis", "chart_generation"],
  "mcpPrompts": ["summarize", "explain"],
  "mcpResources": ["database", "files"]
}
```

**A2A Endpoints:**
```json
{
  "name": "A2A",
  "endpoint": "https://api.example.com/a2a",
  "version": "0.30",
  "a2aSkills": ["task_planning", "code_review"]
}
```

**OASF Endpoints** (Open Agentic Schema Framework):

OASF provides standardized skill and domain taxonomies. Reference: [github.com/agntcy/oasf](https://github.com/agntcy/oasf)

```json
{
  "name": "OASF",
  "endpoint": "https://github.com/agntcy/oasf/",
  "version": "v0.8.0",
  "skills": ["natural_language_processing/summarization", "analytical_skills/coding_skills"],
  "domains": ["technology/software_engineering", "finance_and_business"]
}
```

These capability arrays are optional but recommended for agent discoverability.

---

## Full Registration File Example

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "description": "Agent description",
  "image": "https://example.com/agent.png",
  "endpoints": [
    { "name": "A2A", "endpoint": "https://agent.example/agent-card.json", "version": "0.3.0" },
    { "name": "MCP", "endpoint": "https://mcp.agent.example/", "version": "2025-06-18" },
    { "name": "agentWallet", "endpoint": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv" }
  ],
  "registrations": [
    { "agentId": "sati:devnet:ABC123mint", "agentRegistry": "solana:devnet:satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF" },
    { "agentId": 22, "agentRegistry": "eip155:1:0x..." }
  ],
  "supportedTrusts": ["reputation", "validation"],
  "active": true,
  "x402support": true
}
```

**Required fields:** `type`, `name`, `description`, `image`

**Optional fields:**
- `active` — Agent operational status (boolean)
- `x402support` — Accepts x402 payments (boolean)
- `supportedTrusts` — Trust mechanisms: `"reputation"`, `"validation"`, `"crypto-economic"`, `"tee-attestation"`

---

## References

- [ERC-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Best Practices](https://github.com/erc-8004/best-practices)
- [CAIP Standards](https://github.com/ChainAgnostic/CAIPs)
- [OASF (Open Agentic Schema Framework)](https://github.com/agntcy/oasf)
