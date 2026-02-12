# @cascade-fyi/sati-agent0-sdk

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) agent identity and reputation on Solana. Register agents, collect feedback, query reputation, search by capabilities - all on-chain, zero config.

API-compatible with [agent0-sdk](https://github.com/agent0-ai/agent0-sdk) - same method names and types, but routes through [SATI](https://github.com/cascade-protocol/sati)'s Solana infrastructure instead of EVM chains. Write operations return `SolanaTransactionHandle<T>` (compatible with agent0-sdk's `TransactionHandle` via `.hash`, `.waitMined()`, `.waitConfirmed()`).

## Installation

```bash
pnpm add @cascade-fyi/sati-agent0-sdk
```

**Peer dependencies:**
```bash
pnpm add @cascade-fyi/sati-sdk @solana/kit @solana-program/token-2022 agent0-sdk
```

## Quick Start

```typescript
import { SatiAgent0, Outcome } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner } from "@solana/kit";

const signer = await generateKeyPairSigner();
const sdk = new SatiAgent0({
  network: "devnet",
  signer,
});

// Search agents
const agents = await sdk.searchAgents({ hasMCP: true });

// Give feedback
const handle = await sdk.giveFeedback(agents[0].agentId, 85, "quality", "speed");
const { result: feedback } = await handle.waitMined();
console.log(handle.hash); // transaction signature
```

### Return type differences from agent0-sdk

| Method | agent0-sdk | sati-agent0-sdk |
|---|---|---|
| `giveFeedback` | `TransactionHandle<Feedback>` | `SolanaTransactionHandle<Feedback>` |
| `transferAgent` | `TransactionHandle<TransferResult>` | `SolanaTransactionHandle<TransferResult>` |
| `revokeFeedback` | `TransactionHandle<Feedback>` | `SolanaTransactionHandle<Feedback>` |
| `agent.registerIPFS()` | `TransactionHandle<RegistrationFile>` | `SolanaTransactionHandle<RegistrationFile>` |

`SolanaTransactionHandle<T>` provides the same `.hash`, `.waitMined()`, `.waitConfirmed()` API. Key difference: `.hash` is a base58 Solana signature (not EVM hex), and both `waitMined`/`waitConfirmed` resolve immediately since Solana's `sendAndConfirmTransaction` already waits for confirmation.

---

## SDK Modes

The SDK supports three modes depending on your use case:

```typescript
// Read-only (no signer) - search agents, read feedback
const readOnly = new SatiAgent0({ network: "devnet" });

// Server-side (KeyPairSigner) - full write access
const server = new SatiAgent0({ network: "devnet", signer });

// Browser wallet (TransactionSender) - wallet-signed writes
const browser = new SatiAgent0({ network: "devnet", transactionSender: walletAdapter });
```

---

## Agent Lifecycle

### Create and register an agent

```typescript
const agent = sdk.createAgent("MyAgent", "An AI assistant", "https://example.com/avatar.png");

// Configure endpoints
await agent.setMCP("https://mcp.example.com"); // auto-fetches capabilities
await agent.setA2A("https://a2a.example.com/.well-known/agent.json");
agent.setWallet("WalletAddress123");
agent.addSkill("code-review");
agent.addDomain("defi");

// Set status and trust
agent.setActive(true);
agent.setX402Support(true);
agent.setTrust(true, false, false); // reputation only

// Register on-chain via IPFS (zero config - no API keys needed)
const handle = await agent.registerIPFS();
console.log(agent.agentId, handle.hash);
```

### Update an existing agent

```typescript
const agent = await sdk.loadAgent(agentId);
agent.updateInfo("Updated Name", "Updated description");
await agent.setMCP("https://new-mcp.example.com");

// Re-upload to IPFS and update on-chain URI
const handle = await agent.updateIPFS();
console.log(handle.hash);

// Or update with a custom HTTP URI
await agent.updateHTTP("https://example.com/agent-metadata.json");
```

### Load an existing agent

```typescript
const agent = await sdk.loadAgent("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:MintAddress123");
console.log(agent.name, agent.mcpEndpoint, agent.mcpTools);
```

### Search agents

```typescript
// By name
const results = await sdk.searchAgents({ name: "AI" });

// By capabilities
const mcpAgents = await sdk.searchAgents({ hasMCP: true, mcpTools: ["web-search"] });

// With feedback stats (slower - extra RPC calls)
const ranked = await sdk.searchAgents(
  { active: true },
  { includeFeedbackStats: true, sort: ["averageValue:desc"] },
);

// With pagination
const page = await sdk.searchAgents({}, { limit: 25, offset: 50n });
```

### Transfer ownership

```typescript
const handle = await sdk.transferAgent(agentId, "NewOwnerAddress");
// or via agent instance
await agent.transfer("NewOwnerAddress");
```

---

## Feedback

### Give feedback (server-side)

```typescript
const handle = await sdk.giveFeedback(
  agentId,
  85,           // value (0-100)
  "quality",    // tag1
  "speed",      // tag2
  "https://api.example.com", // endpoint
  { text: "Excellent work" }, // feedbackFile
);
const { result: feedback } = await handle.waitMined();
```

### Governance attestations with outcome/taskRef

For governance and other use cases that need custom outcomes or deterministic task references, pass them via the `feedbackFile` parameter:

```typescript
import { Outcome } from "@cascade-fyi/sati-agent0-sdk";

// Vote on a DAO proposal
const handle = await sdk.giveFeedback(
  agentId,
  85,
  "governance",
  "defi",
  undefined,
  {
    text: "Proposal increases emissions by 20%, net positive for growth",
    outcome: Outcome.Positive,     // For (Negative=Against, Neutral=Abstain)
    taskRef: proposalHashBytes,    // deterministic per proposal
  },
);
```

### Browser wallet flow (prepare + submit)

```typescript
// 1. Prepare on client
const prepared = await sdk.prepareFeedback(agentId, 85, "quality", "speed");

// 2. Wallet signs the SIWS message
const walletSig = await wallet.signMessage(prepared.messageBytes);

// 3. Submit via server-side signer
const handle = await sdk.submitPreparedFeedback(prepared, walletSig);
```

### Search feedback

```typescript
const feedbacks = await sdk.searchFeedback(
  { agentId, tags: ["quality"] },
  { includeTxHash: true },
);
```

### Revoke feedback

```typescript
// Preferred: pass the Feedback object directly (stable addressing)
const [feedback] = await sdk.searchFeedback({ agentId, reviewers: [myAddress] });
const handle = await sdk.revokeFeedback(feedback);

// Legacy: by index (fragile - index can shift as feedbacks are added/removed)
const handle2 = await sdk.revokeFeedback(agentId, 0);
```

---

## Error Handling

All SDK errors extend `SatiError` with a `code` string for programmatic matching:

```typescript
import { SatiError, AgentNotFoundError, ReadOnlyError } from "@cascade-fyi/sati-agent0-sdk";

try {
  await sdk.giveFeedback(agentId, 85);
} catch (err) {
  if (err instanceof AgentNotFoundError) {
    console.log("Agent not found:", err.code); // "AGENT_NOT_FOUND"
  } else if (err instanceof ReadOnlyError) {
    console.log("Need a signer:", err.code); // "READ_ONLY"
  }
}
```

Error classes: `AgentNotFoundError`, `ReadOnlyError`, `SignerRequiredError`, `SchemaNotDeployedError`, `InvalidAgentIdError`, `UnsupportedOperationError`.

---

## Validations

```typescript
const validations = await sdk.searchValidations(agentId);
for (const v of validations) {
  console.log(v.outcome, v.counterparty, v.createdAt);
}
```

Note: `createdAt` is approximate (derived from Solana slot numbers). For exact timestamps, use `sdk.getCreationSignature()` + Solana's `getBlockTime()`.

---

## Agent IDs

SATI uses CAIP-2 format for agent IDs:

```
solana:<chainRef>:<mintAddress>
```

```typescript
import { formatSatiAgentId, parseSatiAgentId, SOLANA_CAIP2_CHAINS } from "@cascade-fyi/sati-agent0-sdk";

const agentId = formatSatiAgentId(mintAddress, SOLANA_CAIP2_CHAINS.mainnet);
// "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:MintAddress123"

const mint = parseSatiAgentId(agentId);
// "MintAddress123"
```

---

## Config Accessors

```typescript
sdk.feedbackSchema;       // Feedback schema address
sdk.feedbackPublicSchema; // FeedbackPublic schema address
sdk.validationSchema;     // Validation schema address
sdk.lookupTable;          // Address Lookup Table address
sdk.chain;                // CAIP-2 chain reference
sdk.isReadOnly;           // true if no signer configured
sdk.sati;                 // underlying Sati client for advanced ops
```

---

## Re-exports

For convenience, the package re-exports commonly used types and enums from both `agent0-sdk` and `@cascade-fyi/sati-sdk`, so consumers don't need to install them for basic usage:

```typescript
// agent0-sdk types
import type { AgentSummary, Feedback, RegistrationFile, AgentId } from "@cascade-fyi/sati-agent0-sdk";
import { EndpointType, TrustModel, EndpointCrawler } from "@cascade-fyi/sati-agent0-sdk";

// SATI types, errors, and constants
import { SolanaTransactionHandle, SatiError, AgentNotFoundError } from "@cascade-fyi/sati-agent0-sdk";
import { Outcome, ContentType, SATI_PROGRAM_ADDRESS } from "@cascade-fyi/sati-agent0-sdk";
import { parseFeedbackContent, getImageUrl, handleTransactionError } from "@cascade-fyi/sati-agent0-sdk";
```

---

## License

Apache-2.0
