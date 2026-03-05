# Collecting Feedback

You registered your agent. Now what? This guide covers how users actually leave feedback and how to integrate feedback collection into your workflow.

## How feedback reaches your agent

There are three paths for feedback to reach your registered agent:

### 1. SATI Dashboard (zero integration)

Share your agent's dashboard link:

```
https://sati.cascade.fyi/agent/<YOUR_MINT>
```

The dashboard has a "Give Feedback" button. Users connect a Solana wallet and submit feedback directly. No code changes on your side.

**Best for:** standalone agents (MCP servers, A2A endpoints) where you don't control the client.

### 2. CLI (for operators and monitoring)

```bash
npx create-sati-agent give-feedback \
  --agent <MINT> --tag1 starred --value 85 --network mainnet
```

**Best for:** automated health checks, uptime monitoring, internal QA.

### 3. SDK (programmatic, for platforms)

```typescript
import { Sati, Outcome, address } from "@cascade-fyi/sati-sdk";

const sati = new Sati({ network: "mainnet" });

// Server-side: your platform pays, user just rates
const { signature } = await sati.giveFeedback({
  payer,                              // Platform's funded keypair
  agentMint: address("Agent..."),
  outcome: Outcome.Positive,
  value: 87,
  tag1: "starred",
  message: "Fast response",
});
```

**Best for:** marketplaces, facilitators, and platforms that want to embed feedback into their UX.

## Choosing the right feedback schema

SATI has two feedback schemas with different trust properties:

| Schema | Mode | Who signs | Use when |
|--------|------|-----------|----------|
| **FeedbackPublicV1** | CounterpartySigned | Reviewer only | Public reviews, marketplace ratings, health checks |
| **FeedbackV1** | DualSignature | Agent + Reviewer | Proof-of-participation, x402 payments, high-trust scenarios |

`giveFeedback()` uses FeedbackPublicV1 (simple, one signer). For blind feedback with DualSignature, use the lower-level `createFeedback()` - see the [x402 feedback guide](/guides/x402-feedback).

## For standalone agent operators

If you run an MCP server or API and want users to leave feedback:

1. **Add your dashboard link to your README/docs:**
   ```
   Reputation: https://sati.cascade.fyi/agent/<YOUR_MINT>
   ```

2. **Include your mint address in your MCP server's metadata** (the `agent-registration.json` already has it in `registrations[]` after publishing).

3. **Use the REST API to show reputation in your docs:**
   ```bash
   curl https://sati.cascade.fyi/api/reputation/<MINT>?network=mainnet
   # {"count": 42, "summaryValue": 85, "summaryValueDecimals": 0}
   ```

4. **Monitor incoming feedback:**
   ```typescript
   // Poll for new feedback (check periodically)
   const feedbacks = await sati.searchFeedback({
     agentMint: address("YourMint..."),
   });
   console.log(`${feedbacks.length} reviews`);
   ```

## For platforms and marketplaces

If you run a platform where multiple agents operate:

1. **Register agents programmatically** when they join your platform:
   ```typescript
   const result = await sati.registerAgent({
     payer: platformKeypair,
     name: agentName,
     uri: registrationFileUri,
   });
   ```

2. **Collect feedback after each interaction** on behalf of users:
   ```typescript
   await sati.giveFeedback({
     payer: platformKeypair,  // Platform pays ~0.00001 SOL
     agentMint: address(agentMint),
     value: userRating,
     tag1: "starred",
   });
   ```

3. **Display reputation** using the SDK or REST API:
   ```typescript
   const summary = await sati.getReputationSummary(address(agentMint));
   // { count: 42, averageValue: 85.3 }
   ```

4. **Query across all schemas** for complete data:
   ```typescript
   // Includes both FeedbackPublicV1 and FeedbackV1 (blind)
   const allFeedback = await sati.searchAllFeedback({
     agentMint: address(agentMint),
   });
   ```

## Tag conventions

Use consistent tags so reputation aggregates meaningfully:

| tag1 | value range | meaning |
|------|-------------|---------|
| `starred` | 0-100 | Overall rating |
| `reachable` | 0 or 1 | Health check |
| `uptime` | 0-100 | Uptime percentage |
| `responseTime` | ms | Latency in milliseconds |
| `successRate` | 0-100 | Success percentage |

## Cost

Each feedback attestation costs ~0.00001 SOL (compressed via ZK Compression). At $200 SOL, that's $0.002 per review. Devnet is free.
