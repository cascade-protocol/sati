# @cascade-fyi/sati-agent0-sdk

Agent0-compatible adapter for [SATI](https://github.com/cascade-protocol/sati) - Solana Agent Trust Infrastructure.

Drop-in replacement for [agent0-sdk](https://github.com/agent0-ai/agent0-sdk) that routes all operations through SATI's Solana infrastructure instead of EVM chains. Same method signatures, same types - different backend.

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
import { SatiSDK, Outcome } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner } from "@solana/kit";

const signer = await generateKeyPairSigner();
const sdk = new SatiSDK({
  network: "devnet",
  signer,
});

// Search agents
const agents = await sdk.searchAgents({ hasMCP: true });

// Give feedback
const { signature, feedback } = await sdk.giveFeedback(
  agents[0].agentId,
  85,
  "quality",
  "speed",
);
```

---

## SDK Modes

The SDK supports three modes depending on your use case:

```typescript
// Read-only (no signer) - search agents, read feedback
const readOnly = new SatiSDK({ network: "devnet" });

// Server-side (KeyPairSigner) - full write access
const server = new SatiSDK({ network: "devnet", signer });

// Browser wallet (TransactionSender) - wallet-signed writes
const browser = new SatiSDK({ network: "devnet", transactionSender: walletAdapter });
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

// Register on-chain via IPFS (requires pinataJwt in config)
const { signature, agentId } = await agent.registerIPFS();
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
```

### Transfer ownership

```typescript
await sdk.transferAgent(agentId, "NewOwnerAddress");
// or via agent instance
await agent.transfer("NewOwnerAddress");
```

---

## Feedback

### Give feedback (server-side)

```typescript
const { signature, feedback } = await sdk.giveFeedback(
  agentId,
  85,           // value (0-100)
  "quality",    // tag1
  "speed",      // tag2
  "https://api.example.com", // endpoint
  { text: "Excellent work" }, // feedbackFile
);
```

### Governance attestations with SatiFeedbackOptions

For governance and other use cases that need custom outcomes or deterministic task references:

```typescript
import { Outcome } from "@cascade-fyi/sati-agent0-sdk";

// Vote on a DAO proposal
await sdk.giveFeedback(
  agentId,
  85,
  "governance",
  "defi",
  undefined,
  { text: "Proposal increases emissions by 20%, net positive for growth" },
  {
    outcome: Outcome.Positive,               // For (Negative=Against, Neutral=Abstain)
    taskRef: proposalHashBytes,               // deterministic per proposal
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
const { signature } = await sdk.submitPreparedFeedback(prepared, walletSig);
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
await sdk.revokeFeedback(agentId, feedbackIndex);
```

---

## Validations

```typescript
const validations = await sdk.searchValidations(agentId);
for (const v of validations) {
  console.log(v.outcome, v.counterparty, v.createdAt);
}
```

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

## Adapters

Convert between SATI and agent0 data formats:

```typescript
import {
  toAgentSummary,
  toAgent0RegistrationFile,
  fromAgent0RegistrationFile,
  toAgent0Endpoints,
  fromAgent0Endpoints,
  toFeedback,
} from "@cascade-fyi/sati-agent0-sdk";
```

---

## Re-exports

For convenience, the package re-exports commonly used types and enums from both `agent0-sdk` and `@cascade-fyi/sati-sdk`, so consumers don't need to install them for basic usage:

```typescript
// agent0-sdk types
import type { AgentSummary, Feedback, RegistrationFile, AgentId } from "@cascade-fyi/sati-agent0-sdk";
import { EndpointType, TrustModel, EndpointCrawler } from "@cascade-fyi/sati-agent0-sdk";

// SATI types and constants
import { Outcome, ContentType, SATI_PROGRAM_ADDRESS } from "@cascade-fyi/sati-agent0-sdk";
import { parseFeedbackContent, getImageUrl, handleTransactionError } from "@cascade-fyi/sati-agent0-sdk";
```

---

## License

Apache-2.0
