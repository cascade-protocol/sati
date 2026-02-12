---
title: "@cascade-fyi/sati-agent0-sdk"
description: API reference for the agent0-compatible SATI adapter
---

# @cascade-fyi/sati-agent0-sdk

Thin adapter that wraps [@cascade-fyi/sati-sdk](/reference/sati-sdk) with [agent0-sdk](https://www.npmjs.com/package/agent0-sdk) types (`AgentId`, `Feedback`, `AgentSummary`, etc.). Use this if your codebase already depends on agent0-sdk or you need ERC-8004 type compatibility. For Solana-native development, start with [sati-sdk](/reference/sati-sdk) directly.

[[toc]]

## SatiAgent0

### Constructor

```typescript
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";

const sdk = new SatiAgent0(config: SatiAgent0Config);
```

#### SatiAgent0Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `network` | `"mainnet" \| "devnet" \| "localnet"` | Yes | SATI network |
| `signer` | `KeyPairSigner` | No | Server-side write access |
| `transactionSender` | `SatiTransactionSender` | No | Browser wallet write access |
| `rpcUrl` | `string` | No | Custom RPC URL (overrides network default) |
| `pinataJwt` | `string` | No | Pinata JWT for IPFS uploads |
| `onWarning` | `(warning: SatiWarning) => void` | No | Non-fatal warning callback |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `network` | `"mainnet" \| "devnet" \| "localnet"` | Configured network |
| `chain` | `string` | CAIP-2 chain reference |
| `isReadOnly` | `boolean` | `true` if no signer/sender configured |
| `sati` | `Sati` | Underlying low-level SATI client |
| `feedbackSchema` | `string \| undefined` | Feedback schema address |
| `feedbackPublicSchema` | `string \| undefined` | FeedbackPublic schema address |
| `validationSchema` | `string \| undefined` | Validation schema address |
| `lookupTable` | `string \| undefined` | Address Lookup Table address |

---

### Agent Methods

#### createAgent

Create a new agent in memory. Call `agent.registerIPFS()` or `agent.registerHTTP()` to register on-chain.

```typescript
sdk.createAgent(name: string, description: string, image?: URI): SatiAgent
```

#### loadAgent

Load an existing agent by its CAIP-2 agent ID.

```typescript
await sdk.loadAgent(agentId: AgentId): Promise<SatiAgent>
```

#### searchAgents

Search agents with filters.

```typescript
await sdk.searchAgents(
  filters?: SearchFilters,
  options?: SatiSearchOptions,
): Promise<AgentSummary[]>
```

**SatiSearchOptions** extends agent0-sdk's `SearchOptions`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `includeFeedbackStats` | `boolean` | `false` | Fetch feedbackCount + averageValue per agent (slower) |
| `limit` | `number` | `100` | Max results |
| `offset` | `bigint` | - | Offset (1-based member number) for pagination |
| `sort` | `string[]` | - | Sort keys, e.g. `["averageValue:desc"]` |

**SearchFilters** - agent0-sdk compatible. Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Substring match on agent name |
| `agentIds` | `AgentId[]` | Filter to specific agents |
| `hasMCP` / `hasA2A` | `boolean` | Require endpoint type |
| `mcpTools` / `a2aSkills` | `string[]` | Match at least one listed tool/skill |
| `active` | `boolean` | Filter by active status |
| `x402support` | `boolean` | Filter by x402 support |
| `feedback` | `FeedbackFilters` | Reputation-based filtering |
| `oasfSkills` / `oasfDomains` | `string[]` | OASF taxonomy match |

#### transferAgent

Transfer agent ownership.

```typescript
await sdk.transferAgent(
  agentId: AgentId,
  newOwner: Address,
): Promise<SolanaTransactionHandle<{ txHash: string; from: string; to: string; agentId: AgentId }>>
```

---

### Feedback Methods

#### giveFeedback

Give feedback to an agent. Uses FeedbackPublicV1 schema.

```typescript
await sdk.giveFeedback(
  agentId: AgentId,
  value: number | string,       // 0-100
  tag1?: string,
  tag2?: string,
  endpoint?: string,
  feedbackFile?: FeedbackFileInput,
): Promise<SolanaTransactionHandle<Feedback>>
```

SATI-specific fields can be passed via `feedbackFile`:
- `feedbackFile.outcome` - `Outcome.Negative | Outcome.Neutral | Outcome.Positive` (default: Neutral)
- `feedbackFile.taskRef` - `Uint8Array` (32 bytes, default: random)

#### prepareFeedbackFile

Build an optional off-chain feedback file payload.

```typescript
sdk.prepareFeedbackFile(
  input: FeedbackFileInput,
  extra?: Record<string, unknown>,
): FeedbackFileInput
```

#### prepareFeedback

Prepare feedback for browser wallet signing (step 1 of 2).

```typescript
await sdk.prepareFeedback(
  agentId: AgentId,
  value: number,
  tag1?: string,
  tag2?: string,
  opts?: {
    endpoint?: string;
    text?: string;
    counterparty?: string;
    outcome?: Outcome;
    taskRef?: Uint8Array;
  },
): Promise<PreparedFeedback>
```

#### submitPreparedFeedback

Submit wallet-signed feedback (step 2 of 2). Requires a `KeyPairSigner` on the SDK.

```typescript
await sdk.submitPreparedFeedback(
  prepared: PreparedFeedback,
  counterpartySignature: Uint8Array,
): Promise<SolanaTransactionHandle<Feedback>>
```

#### searchFeedback

Search feedback with filters.

```typescript
await sdk.searchFeedback(
  filters: FeedbackSearchFilters,
  options?: SatiFeedbackSearchOptions,
): Promise<Feedback[]>
```

**SatiFeedbackSearchOptions:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `includeTxHash` | `boolean` | `false` | Populate `txHash` per result (1 RPC call each) |
| `minValue` / `maxValue` | `number` | - | Filter by value range |

**FeedbackSearchFilters** - key fields:

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | `AgentId` | Filter to specific agent |
| `agents` | `AgentId[]` | Filter to multiple agents |
| `reviewers` | `Address[]` | Filter by reviewer wallet(s) |
| `tags` | `string[]` | Filter by tag1/tag2 |

#### getReputationSummary

Aggregate feedback stats for an agent.

```typescript
await sdk.getReputationSummary(
  agentId: AgentId,
  tag1?: string,
  tag2?: string,
): Promise<{ count: number; averageValue: number }>
```

#### revokeFeedback

Revoke feedback. Two overloads:

```typescript
// Preferred: pass Feedback object (stable addressing)
await sdk.revokeFeedback(feedback: Feedback): Promise<SolanaTransactionHandle<Feedback>>

// Legacy: by index (fragile)
await sdk.revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<SolanaTransactionHandle<Feedback>>
```

#### revokeFeedbackByAddress

Revoke by compressed account address.

```typescript
await sdk.revokeFeedbackByAddress(
  compressedAddress: string,
): Promise<SolanaTransactionHandle<{ signature: string }>>
```

---

### Validation Methods

#### searchValidations

Query validation attestations for an agent.

```typescript
await sdk.searchValidations(agentId: AgentId): Promise<ValidationResult[]>
```

**ValidationResult:**

| Field | Type | Description |
|-------|------|-------------|
| `outcome` | `number` | 0=Negative, 2=Positive |
| `agentMint` | `string` | Agent mint address |
| `counterparty` | `string` | Validator address |
| `createdAt` | `number` | Unix timestamp (approximate) |
| `compressedAddress` | `string` | For tx lookup |

---

## SatiAgent

Returned by `sdk.createAgent()` or `sdk.loadAgent()`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `agentId` | `AgentId \| undefined` | Set after registration |
| `agentURI` | `URI \| undefined` | On-chain metadata URI |
| `name` | `string` | Agent name |
| `description` | `string` | Agent description |
| `image` | `URI \| undefined` | Avatar URL |
| `mcpEndpoint` | `string \| undefined` | MCP server URL |
| `a2aEndpoint` | `string \| undefined` | A2A agent card URL |
| `walletAddress` | `Address \| undefined` | Payment wallet |
| `mcpTools` | `string[]` | Auto-fetched MCP tools |
| `mcpPrompts` | `string[]` | Auto-fetched MCP prompts |
| `mcpResources` | `string[]` | Auto-fetched MCP resources |
| `a2aSkills` | `string[]` | Auto-fetched A2A skills |
| `oasfSkills` | `string[]` | OASF skill slugs |
| `oasfDomains` | `string[]` | OASF domain slugs |

### Configuration Methods

All return `this` for chaining (except async methods).

```typescript
await agent.setMCP(endpoint: string, version?: string, autoFetch?: boolean): Promise<this>
await agent.setA2A(agentcard: string, version?: string, autoFetch?: boolean): Promise<this>
agent.setENS(name: string, version?: string): this
agent.setWallet(addr: Address): this
agent.addSkill(slug: string): this
agent.removeSkill(slug: string): this
agent.addDomain(slug: string): this
agent.removeDomain(slug: string): this
agent.setActive(active: boolean): this
agent.setX402Support(x402Support: boolean): this
agent.setTrust(reputation?: boolean, cryptoEconomic?: boolean, teeAttestation?: boolean): this
agent.setMetadata(kv: Record<string, unknown>): this
agent.updateInfo(name?: string, description?: string, image?: URI): this
agent.removeEndpoint(opts?: { type?: EndpointType; value?: string }): this
agent.removeEndpoints(): this
```

### Registration Methods

```typescript
// Register new agent via IPFS (requires pinataJwt in SDK config)
await agent.registerIPFS(): Promise<SolanaTransactionHandle<RegistrationFile>>

// Register new agent via HTTP URI
await agent.registerHTTP(agentUri: URI): Promise<SolanaTransactionHandle<RegistrationFile>>

// Update existing agent's IPFS metadata
await agent.updateIPFS(): Promise<SolanaTransactionHandle<RegistrationFile>>

// Update existing agent's URI to HTTP endpoint
await agent.updateHTTP(agentUri: URI): Promise<SolanaTransactionHandle<RegistrationFile>>

// Transfer agent to new owner
await agent.transfer(newOwner: Address): Promise<SolanaTransactionHandle<...>>
```

---

## SolanaTransactionHandle\<T\>

Returned by all write operations. Compatible with agent0-sdk's `TransactionHandle<T>` pattern.

| Member | Type | Description |
|--------|------|-------------|
| `hash` | `string` | Transaction signature (base58) |
| `waitMined()` | `Promise<{ receipt: SolanaReceipt; result: T }>` | Resolves immediately (Solana confirms before returning) |
| `waitConfirmed()` | `Promise<{ receipt: SolanaReceipt; result: T }>` | Alias for `waitMined()` |

```typescript
const handle = await sdk.giveFeedback(agentId, 85);
console.log(handle.hash);                         // signature
const { result: feedback } = await handle.waitMined();
```

---

## Error Classes

All extend `SatiError` which has a `code: string` property.

| Class | Code | Thrown When |
|-------|------|------------|
| `SatiError` | varies | Base class for all errors |
| `AgentNotFoundError` | `AGENT_NOT_FOUND` | Agent mint doesn't exist on-chain |
| `ReadOnlyError` | `READ_ONLY` | Write op without signer/sender |
| `SignerRequiredError` | `SIGNER_REQUIRED` | Op needs `KeyPairSigner` (not just `TransactionSender`) |
| `SchemaNotDeployedError` | `SCHEMA_NOT_DEPLOYED` | SAS schema missing on configured network |
| `InvalidAgentIdError` | `INVALID_AGENT_ID` | Malformed CAIP-2 agent ID |
| `UnsupportedOperationError` | `UNSUPPORTED_OPERATION` | Op not available on SATI (e.g. `appendResponse`) |

---

## Re-exports

The package re-exports commonly used types so consumers don't need to install `agent0-sdk` or `@cascade-fyi/sati-sdk` directly:

```typescript
// agent0-sdk types
import type { AgentSummary, Feedback, RegistrationFile, AgentId } from "@cascade-fyi/sati-agent0-sdk";
import { EndpointType, TrustModel, EndpointCrawler } from "@cascade-fyi/sati-agent0-sdk";

// SATI types and constants
import { SolanaTransactionHandle, SatiError, AgentNotFoundError } from "@cascade-fyi/sati-agent0-sdk";
import { Outcome, ContentType, SATI_PROGRAM_ADDRESS } from "@cascade-fyi/sati-agent0-sdk";
import { parseFeedbackContent, getImageUrl, handleTransactionError } from "@cascade-fyi/sati-agent0-sdk";
```

### Adapter Utilities

```typescript
import {
  SOLANA_CAIP2_CHAINS,        // { mainnet, devnet, localnet }
  formatSatiAgentId,           // (mint, chain) => AgentId
  parseSatiAgentId,            // (agentId) => mint address
  toAgentSummary,              // SATI identity => AgentSummary
  toAgent0RegistrationFile,    // SATI reg => agent0 RegistrationFile
  fromAgent0RegistrationFile,  // agent0 RegistrationFile => SATI params
  toAgent0Endpoints,           // SATI services => agent0 Endpoint[]
  fromAgent0Endpoints,         // agent0 Endpoint[] => SATI services
  toFeedback,                  // SATI attestation => agent0 Feedback
} from "@cascade-fyi/sati-agent0-sdk";
```
