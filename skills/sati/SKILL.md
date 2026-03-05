---
name: sati-sdk
description: "Build with SATI (Solana Agent Trust Infrastructure) - on-chain agent identity, verifiable reputation, and blind feedback on Solana. Use when registering AI agents on-chain via Token-2022 NFTs, giving or searching feedback, querying agent reputation, building registration files (ERC-8004), encrypting attestation content, or integrating SATI into TypeScript/Node.js projects. Covers: CLI onboarding (create-sati-agent), agent registration, feedback (give/search/revoke), reputation summaries, agent search/discovery, validation attestations, EVM address linking, content encryption, and metadata uploading. Triggers on SATI, sati-sdk, create-sati-agent, agent registration solana, agent reputation, blind feedback, compressed attestation, Light Protocol attestation, ERC-8004 registration file, agent identity NFT, register agent CLI."
---

# SATI

Solana Agent Trust Infrastructure. Agents get Token-2022 NFT identities, accumulate verifiable feedback via ZK-compressed attestations (Light Protocol), and can be discovered on-chain.

Program ID (all networks): `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe`

## Quick Start (CLI)

Fastest path - zero to registered agent in ~5 minutes:

```bash
npx create-sati-agent init      # Creates agent-registration.json + keypair
# Edit agent-registration.json with your agent details
npx create-sati-agent publish    # Publishes to devnet (free, auto-funded)
```

Mainnet:

```bash
npx create-sati-agent publish --network mainnet  # ~0.003 SOL
```

All commands: `init`, `publish`, `search`, `info [MINT]`, `give-feedback`, `transfer <MINT>`. All support `--help`, `--json`, `--network devnet|mainnet`.

### agent-registration.json

The registration file follows the [ERC-8004 Registration standard](https://github.com/erc-8004/best-practices/blob/main/Registration.md):

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "MyAgent",
  "description": "AI assistant that does X for Y",
  "image": "https://example.com/avatar.png",
  "properties": {
    "files": [{"uri": "https://example.com/avatar.png", "type": "image/png"}],
    "category": "image"
  },
  "services": [
    {
      "name": "MCP",
      "endpoint": "https://myagent.com/mcp",
      "version": "2025-06-18",
      "mcpTools": ["search", "summarize", "analyze"],
      "mcpPrompts": ["data-analysis"],
      "mcpResources": ["knowledge-base"]
    },
    {
      "name": "A2A",
      "endpoint": "https://myagent.com/.well-known/agent-card.json",
      "a2aSkills": ["natural_language_processing/information_retrieval_synthesis/question_answering"]
    }
  ],
  "supportedTrust": ["reputation"],
  "active": false,
  "x402Support": false,
  "registrations": []
}
```

Service types (see [ERC-8004 best practices](https://github.com/erc-8004/best-practices) for detailed guidance):
- `MCP` - Model Context Protocol. Fields: `mcpTools` (tool names as strings), `mcpPrompts`, `mcpResources`. The `version` field is the MCP spec version your server supports (e.g., `"2025-06-18"`).
- `A2A` - Agent-to-Agent. Fields: `a2aSkills` (OASF skill paths). Endpoint should point to your agent card JSON.
- `OASF` - Open Agent Skills Framework. Fields: `skills`, `domains`.
- `ENS`, `DID`, `agentWallet` - Identity services.

> **Note:** When publishing via CLI (`npx create-sati-agent publish`), the CLI auto-discovers MCP tools by calling your MCP endpoint. Your MCP server must be running and reachable during publish. If your server requires auth, you'll see a non-blocking reachability warning - you can safely ignore it and list tools manually in the JSON.

### Mainnet deployment flow

```bash
npx create-sati-agent init                          # 1. Create template + keypair
npx create-sati-agent publish                        # 2. Test on devnet (free, default)
npx create-sati-agent info <MINT> --network devnet   # 3. Verify
npx create-sati-agent publish --network mainnet      # 4. Go live (~0.003 SOL)
npx create-sati-agent transfer <MINT> \
  --new-owner <SECURE_WALLET> --network mainnet      # 5. Move to hardware wallet
```

### CLI feedback

```bash
npx create-sati-agent give-feedback \
  --agent <MINT> --tag1 starred --value 85 --network mainnet
```

Feedback tag conventions:

| tag1 | value range | meaning |
|------|-------------|---------|
| `starred` | 0-100 | Overall rating |
| `reachable` | 0 or 1 | Health check (1 = reachable) |
| `uptime` | 0-100 | Uptime percentage |
| `responseTime` | ms | Latency in milliseconds |
| `successRate` | 0-100 | Success percentage |

### Monitoring agent health

Automate health checks with a cron job or scheduled task:

```bash
# Check if endpoint is reachable and report to SATI
curl -sf https://myagent.com/mcp > /dev/null && \
  npx create-sati-agent give-feedback --agent <MINT> --tag1 reachable --value 1 --network mainnet || \
  npx create-sati-agent give-feedback --agent <MINT> --tag1 reachable --value 0 --network mainnet
```

### Reputation badge

Add a reputation badge to your README:

```markdown
![SATI Reputation](https://sati.cascade.fyi/api/badge/<YOUR_MINT>?network=mainnet)
```

Or link to your dashboard page:

```markdown
[Reputation](https://sati.cascade.fyi/agent/<YOUR_MINT>)
```

---

## SDK (Programmatic)

`@cascade-fyi/sati-sdk` is the primary SDK for all SATI integrations.

```bash
npm install @cascade-fyi/sati-sdk
# Peer deps:
npm install @solana/kit @solana-program/token-2022
```

### Initialize

```typescript
import { Sati, createSatiUploader, address } from "@cascade-fyi/sati-sdk";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const sati = new Sati({ network: "mainnet" });
// Options: network, rpcUrl, wsUrl, photonRpcUrl, onWarning, transactionConfig, feedbackCacheTtlMs
```

Load a wallet:

```typescript
import { readFileSync } from "node:fs";
const bytes = new Uint8Array(JSON.parse(readFileSync("wallet.json", "utf8")));
const payer = await createKeyPairSignerFromBytes(bytes);
```

### 1. Register an Agent

#### Quick (fluent builder)

```typescript
const builder = sati.createAgentBuilder("MyAgent", "AI assistant", "https://example.com/avatar.png");
builder
  .setMCP("https://mcp.example.com", "2025-06-18", { tools: ["search"] })
  .setA2A("https://a2a.example.com/.well-known/agent-card.json")
  .setX402Support(true)
  .setActive(true);

const result = await builder.register({
  payer,
  uploader: createSatiUploader(), // Zero-config IPFS upload
});
// result.mint - agent NFT address, result.memberNumber, result.signature
```

#### Direct

```typescript
import { buildRegistrationFile, createSatiUploader } from "@cascade-fyi/sati-sdk";

const regFile = buildRegistrationFile({
  name: "MyAgent",
  description: "AI assistant",
  image: "https://example.com/avatar.png",
  services: [{ name: "MCP", endpoint: "https://mcp.example.com" }],
  active: true,
});

const uploader = createSatiUploader();
const uri = await uploader.upload(regFile);

const result = await sati.registerAgent({
  payer,
  name: "MyAgent",
  uri,
  nonTransferable: false, // default: false. Set true for soulbound (non-transferable) agents.
});
```

Uploaders: `createSatiUploader()` (zero-config, uses hosted IPFS via `sati.cascade.fyi`) or `createPinataUploader(jwt)`.

### 2. Give Feedback

#### Public feedback (simple)

`giveFeedback` uses the **FeedbackPublicV1** schema (CounterpartySigned mode) - the reviewer signs and submits in one call. No agent co-signature required.

```typescript
import { Outcome } from "@cascade-fyi/sati-sdk";

const { signature, attestationAddress } = await sati.giveFeedback({
  payer,                              // Reviewer wallet (pays + signs)
  agentMint: address("Agent..."),     // Agent to review
  outcome: Outcome.Positive,          // Positive | Negative | Neutral (default: Neutral)
  value: 87,                          // Numeric score (optional)
  valueDecimals: 0,                   // Decimal places for value
  tag1: "starred",                    // Primary dimension
  tag2: "chat",                       // Secondary dimension (optional)
  message: "Great response time",     // Human-readable (optional)
  endpoint: "https://agent.example",  // Endpoint reviewed (optional)
  taskRef: txHashBytes,               // 32-byte task reference (optional, e.g. payment tx hash)
});
```

#### Blind feedback (dual-signature)

For proof-of-participation, use the **FeedbackV1** schema (DualSignature mode). The agent signs a blind commitment *before* knowing the outcome. Use the lower-level `createFeedback()` method with both `agentSignature` and `counterpartyMessage`. See the specification for the full blind feedback flow.

#### Browser wallet flow (two-step)

The platform server prepares a SIWS (Sign In With Solana) message, the user signs it in their browser wallet, and the platform submits the transaction.

```typescript
import { hexToBytes, bytesToHex } from "@cascade-fyi/sati-sdk";

// Step 1: Server prepares feedback data
const prepared = await sati.prepareFeedback({
  counterparty: address("UserWallet..."),
  agentMint: address("Agent..."),
  outcome: Outcome.Positive,
  value: 90,
  tag1: "starred",
});

// Step 2: Send to frontend (only messageBytes needs to cross the wire)
// The server keeps the full `prepared` object; only send what the frontend needs to sign.
const payload = {
  messageHex: bytesToHex(prepared.messageBytes),
};

// Step 3: Frontend - user signs with wallet adapter
const messageBytes = hexToBytes(payload.messageHex);
const signature = await wallet.signMessage(messageBytes); // Returns Uint8Array (Ed25519 signature)

// Step 4: Server submits with platform payer (uses the full `prepared` object kept server-side)
const result = await sati.submitPreparedFeedback({
  payer: platformPayer,           // Platform pays gas
  prepared,                       // Full PreparedFeedbackData from step 1
  counterpartySignature: signature, // User's 64-byte Ed25519 signature
});
```

> **Note:** `PreparedFeedbackData` contains multiple `Uint8Array` fields (`messageBytes`, `taskRef`, `dataHash`, `content`). If you need to serialize the entire object to JSON (e.g. for a stateless API), convert all `Uint8Array` fields with `bytesToHex()` and restore with `hexToBytes()`. The recommended pattern above avoids this by keeping `prepared` server-side.

#### Revoke feedback

```typescript
await sati.revokeFeedback({ payer, attestationAddress: address("Attest...") });
```

### 3. Search Feedback

`searchFeedback` queries only the **FeedbackPublicV1** schema. Use `searchAllFeedback` to query both FeedbackPublicV1 and FeedbackV1 (blind) schemas.

```typescript
// Search FeedbackPublicV1 for a specific agent
const feedbacks = await sati.searchFeedback({
  agentMint: address("Agent..."),
  tag1: "starred",
  minValue: 70,
  outcome: Outcome.Positive,  // Filter by outcome (optional)
  includeTxHash: true,
});
// Returns: ParsedFeedback[] with compressedAddress, outcome, value, tag1, tag2, message, createdAt

// Search FeedbackPublicV1 across all agents (omit agentMint)
const allPublic = await sati.searchFeedback({});

// Search BOTH schemas (FeedbackPublicV1 + FeedbackV1)
const combined = await sati.searchAllFeedback({
  agentMint: address("Agent..."),
});
```

To distinguish blind (FeedbackV1) from public (FeedbackPublicV1) in raw results, compare `attestation.sasSchema` against `sati.feedbackSchema` vs `sati.feedbackPublicSchema`.

**Bulk ingestion (for indexers/scoring providers):**

```typescript
// Auto-paginating async iterator across both schemas
for await (const page of sati.listAllFeedbacks({ agentMint: address("Agent...") })) {
  for (const item of page.items) {
    // item.data: { taskRef, agentMint, counterparty, dataHash, outcome, contentType, content }
    // item.raw.slotCreated (bigint) for on-chain slot
    // item.address is Uint8Array - decode with getAddressDecoder().read(item.address, 0)
    const parsed = parseFeedbackContent(item.data.content, item.data.contentType);
    // parsed: { value, valueDecimals, tag1, tag2, m (message), endpoint, reviewer, feedbackURI, feedbackHash }
  }
}

// Omit agentMint to iterate ALL feedback across all agents
for await (const page of sati.listAllFeedbacks()) { /* ... */ }
```

Note: `searchFeedback`/`searchAllFeedback` return `ParsedFeedback[]` (fully parsed). `listAllFeedbacks` returns raw `ParsedAttestation` pages where content is still bytes - use `parseFeedbackContent(item.data.content, item.data.contentType)` to extract fields. `createdAt` timestamps in `ParsedFeedback` are approximate - derived from Solana slot numbers using ~400ms/slot estimate.

### 4. Reputation Summary

```typescript
const summary = await sati.getReputationSummary(address("Agent..."));
// { count: 42, averageValue: 85.3 }

// Filter by tags:
const filtered = await sati.getReputationSummary(address("Agent..."), "starred", "chat");
```

Note: `getReputationSummary` queries both FeedbackPublicV1 and FeedbackV1 schemas. `count` only includes feedback entries that have a `value` field set. An agent with 10 feedback entries but none containing `value` will show `count: 0`. The REST API returns `summaryValue` (integer) instead of `averageValue` (float), and its `count` includes all entries regardless of `value`.

### 5. Agent Discovery

```typescript
// Load single agent (on-chain data only - no description, image, or services)
const agent = await sati.loadAgent(address("Mint..."));
// AgentIdentity: { mint, owner, name, uri, memberNumber, nonTransferable }
// For rich metadata (description, image, services, active), fetch the registration file:
const regFile = await fetchRegistrationFile(agent.uri);
// regFile: { name, description, image, services, active, x402Support, supportedTrust, ... }

// Load multiple agents in batch (single batched RPC call)
const agents = await sati.loadAgents([mint1, mint2, mint3]);
// Returns: (AgentIdentity | null)[] - null for invalid/missing mints

// Get agent by member number (1-indexed)
const first = await sati.getAgentByMemberNumber(1n);

// Search agents with filters
const results = await sati.searchAgents({
  endpointTypes: ["MCP"],
  active: true,
  includeFeedbackStats: true,
  limit: 50,
});
// AgentSearchResult[]: { identity, registrationFile, feedbackStats }

// List all agents with pagination (lighter than searchAgents - no registration file fetch)
// Default limit: 100, offset: 0, order: "newest"
const page = await sati.listAllAgents({ limit: 20, offset: 0, order: "newest" });
// { agents: AgentIdentity[], totalAgents: bigint }

// List by owner
const myAgents = await sati.listAgentsByOwner(address("Owner..."));

// Registry stats
const stats = await sati.getRegistryStats();
// { totalAgents, groupMint, authority, isImmutable }
```

### 6. Update Agent Metadata

```typescript
// Via builder
builder.updateInfo({ description: "Updated description" });
builder.setMCP("https://new-mcp.example.com");
await builder.update({ payer, owner: ownerKeypair, uploader: createSatiUploader() });

// Direct
await sati.updateAgentMetadata({
  payer,
  owner: ownerKeypair,
  mint: address("Mint..."),
  updates: { name: "NewName", uri: "ipfs://Qm..." },
});
```

### 7. Link EVM Address

Cross-chain identity linking via secp256k1 signature:

```typescript
await sati.linkEvmAddress({
  payer,
  agentMint: address("Mint..."),
  evmAddress: "0x1234...abcd",
  chainId: "eip155:8453", // Base
  signature: secp256k1Sig, // 64 bytes: r || s
  recoveryId: 0,
});
```

> **Note:** EVM links are stored as Anchor events only (not in on-chain accounts). There is no SDK query method to read past links - you need a Solana transaction log indexer (Helius, Yellowstone) to retrieve them.

### 8. Content Encryption

X25519-XChaCha20-Poly1305 for private feedback:

```typescript
import {
  deriveEncryptionKeypair,
  encryptContent,
  decryptContent,
  serializeEncryptedPayload,
  deserializeEncryptedPayload,
} from "@cascade-fyi/sati-sdk";

// Derive from Ed25519 keypair
const encKeys = deriveEncryptionKeypair(ed25519PrivateKeyBytes);
const encrypted = encryptContent(plaintext, recipientX25519PublicKey);
const bytes = serializeEncryptedPayload(encrypted);
// ... store bytes as attestation content ...
const decrypted = decryptContent(deserializeEncryptedPayload(bytes), recipientPrivateKey);
```

### 9. Registration File (ERC-8004)

```typescript
import {
  buildRegistrationFile,
  validateRegistrationFile,
  fetchRegistrationFile,
  getImageUrl,
} from "@cascade-fyi/sati-sdk";

// Validate untrusted data
const result = validateRegistrationFile(untrustedData);
if (!result.ok) console.error(result.errors);

// Fetch from URI (IPFS/HTTP)
const regFile = await fetchRegistrationFile("ipfs://Qm...");
const imageUrl = getImageUrl(regFile);
```

See the [ERC-8004 registration best practices](https://github.com/erc-8004/best-practices/blob/main/Registration.md) for guidance on name, image, description, and services.

### 10. Reputation Scoring (on-chain)

For scoring providers publishing computed scores back on-chain (ReputationScoreV3 schema):

```typescript
import { ContentType, parseReputationScoreContent } from "@cascade-fyi/sati-sdk";

// Publish/update a score (idempotent - closes existing + creates new in one tx)
await sati.updateReputationScore({
  payer,
  provider: providerKeypair,     // Scoring provider's KeyPairSigner
  sasSchema: sati.reputationScoreSchema,
  satiCredential: sati.credential,
  agentMint: address("Agent..."),
  outcome: Outcome.Positive,
  contentType: ContentType.JSON,
  content: new TextEncoder().encode(JSON.stringify({ score: 85, factors: { ... } })),
});

// Read existing scores for an agent
const scores = await sati.listReputationScores(
  address("Agent..."),
  sati.reputationScoreSchema,
);
for (const score of scores) {
  const parsed = parseReputationScoreContent(score.content, score.contentType);
  // parsed: { score, factors, ... }
}

// Get a specific provider's score
const score = await sati.getReputationScore(
  address("Provider..."),
  address("Agent..."),
  sati.credential,
  sati.reputationScoreSchema,
);
```

### Platform integration notes

**Ownership model:** `registerAgent({ payer, owner })` - the `payer` pays gas, the `owner` receives the NFT. A platform can register agents on behalf of operators. Only the `owner` can update metadata. Reputation stays with the mint address (portable across owners).

**Outcome enum values:** `Negative = 0`, `Neutral = 1`, `Positive = 2`. Use `getOutcomeLabel(outcome)` for display strings.

### REST API

The dashboard at `sati.cascade.fyi` exposes a public REST API. See `docs/reference/rest-api.md` for full endpoint documentation. Key endpoints:

- `GET /api/agents` - list/search agents (supports `name`, `owner`, `endpointTypes`, `order`, pagination)
- `GET /api/agents/:mint` - single agent with reputation summary
- `GET /api/feedback/:mint` - feedback for an agent (paginated with `limit`/`offset`)
- `GET /api/feedback` - global feedback across all agents (paginated)
- `GET /api/reputation/:mint` - reputation summary with tag/reviewer filters
- `GET /api/stats` - registry statistics (`totalAgents`, `groupMint`, etc.)
- `GET /api/badge/:mint` - SVG reputation badge for README embedding

### Configuration

```typescript
const sati = new Sati({
  network: "mainnet",           // "mainnet" | "devnet" | "localnet"
  rpcUrl: "https://...",        // Custom Solana RPC (optional)
  photonRpcUrl: "https://...",  // Photon/Helius RPC for Light Protocol queries (optional)
  onWarning: (w) => console.warn(w.code, w.message),
  feedbackCacheTtlMs: 30_000,  // Cache TTL (default 30s, 0 to disable)
  transactionConfig: {
    priorityFeeMicroLamports: 50_000, // Default on mainnet
    computeUnitLimit: 400_000,
    maxRetries: 2,                    // Blockhash expiration retries
  },
});
```

**RPC endpoints**: By default, the SDK routes all RPC calls through hosted proxies at `sati.cascade.fyi` (backed by Helius), rate-limited to ~120 req/min per IP. For production workloads, provide your own Helius or Triton RPC URLs via `rpcUrl` and `photonRpcUrl` to get higher limits.

### Key Types

| Type | Description |
|------|-------------|
| `AgentIdentity` | On-chain agent: mint, owner, name, uri, memberNumber (`bigint`), nonTransferable, additionalMetadata |
| `RegistrationFile` | ERC-8004 metadata with services, trust mechanisms |
| `GiveFeedbackParams` | Simplified feedback input (FeedbackPublicV1) |
| `ParsedFeedback` | Feedback with value, tags, message, createdAt, counterparty |
| `FeedbackContent` | Raw content: value, valueDecimals, tag1, tag2, m (message), endpoint, reviewer, feedbackURI, feedbackHash |
| `ReputationSummary` | Aggregated count + averageValue |
| `AgentSearchResult` | Identity + registrationFile + optional feedbackStats |
| `Outcome` | Enum: Positive (2), Negative (0), Neutral (1) |
| `MetadataUploader` | Interface for pluggable storage (IPFS, Arweave, etc.) |

### Error Handling

```typescript
import { SatiError, DuplicateAttestationError, AgentNotFoundError } from "@cascade-fyi/sati-sdk";

try {
  await sati.giveFeedback(params);
} catch (e) {
  if (e instanceof DuplicateAttestationError) {
    // Same taskRef + counterparty + agent already exists
  }
}
```

## Costs

| Operation | Cost |
|-----------|------|
| Agent registration | ~0.003 SOL |
| Agent transfer | ~0.0005 SOL |
| Feedback attestation | ~0.00001 SOL (compressed) |
| Devnet | Free (auto-funded faucet) |

## Common Issues

- **Blockhash expired** - Solana transactions must land within ~60 seconds. Retry the command/call.
- **Insufficient funds (mainnet)** - Send ~0.01 SOL to your wallet address. CLI shows the address on failure.
- **Permission denied on update** - Wrong keypair. Use `--keypair /path/to/original.json` with the CLI, or ensure the correct `owner` KeyPairSigner in SDK.
- **Feedback schema not deployed** - Make sure you're on the right network. Schemas are deployed on both devnet and mainnet.
- **Rate limited (429)** - The hosted RPC proxies are rate-limited to ~120 req/min per IP. For production, provide your own RPC via `rpcUrl` and `photonRpcUrl`.
