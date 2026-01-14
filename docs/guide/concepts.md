---
title: Core Concepts
description: Understanding SATI's blind feedback model, incentive alignment, and x402 integration
---

# Core Concepts

SATI solves the economics of on-chain feedback through several key innovations.

## Blind Feedback Model

The breakthrough enabling free on-chain feedback. Agent and counterparty sign different data at different times:

| Party | Signs | When | Proves |
|-------|-------|------|--------|
| Agent | `interaction_hash = keccak256(schema \|\| task_ref \|\| data_hash)` | With response | "I served this task" |
| Counterparty | Human-readable SIWS message | After service | "I gave this feedback" |

### Flow

```
Client pays (x402) → Agent responds + signs (blind) → Client signs feedback → Agent/facilitator submits
```

### Why It Works

**Key insight**: Agent signs BEFORE knowing feedback sentiment — cannot selectively participate.

The agent commits to the interaction without knowing if the feedback will be positive or negative. This eliminates cherry-picking where agents only publish favorable reviews.

::: info Enforcement
The protocol does not enforce that agents sign with every response. Enforcement happens at the application layer:
- **Facilitators** can require agent signatures before settling payments
- **Clients** can refuse to pay agents that don't participate
- **Marketplaces** can filter for agents with reputation participation
:::

## Incentive Alignment

Who pays for submitting feedback to the blockchain?

| Feedback | Who Pays | Why |
|----------|----------|-----|
| Positive | Agent | Benefits from reputation boost |
| Negative | Client | Motivated to warn others |
| None | No one | Client chose not to sign |

This natural alignment means:
- Good agents are rewarded with free positive reviews
- Bad actors face accountability from motivated clients
- No spam because someone must pay

## x402 Integration

SATI is the canonical feedback extension for [x402](https://x402.org) payments.

### Payment as Task Reference

The payment transaction hash becomes the `task_ref` in CAIP-220 format:

```
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:4xJ2pNdZ...
```

This creates an immutable link between payment and feedback.

### Facilitator Role

x402 facilitators are natural feedback managers:
- Already in the payment flow
- Trusted by both parties
- Can batch multiple feedback submissions
- Can require agent signatures before settlement

### Integration Example

```typescript
// In x402 payment flow
const paymentTx = await facilitator.processPayment(request)

// Agent signs with response (blind to outcome)
const agentSig = await agent.signInteraction({
  schema: FEEDBACK_SCHEMA,
  taskRef: `solana:${CHAIN_ID}:${paymentTx}`,
  dataHash: keccak256(feedbackData),
})

// Client can later submit feedback
const feedback = await sati.giveFeedback({
  agentMint,
  taskRef: `solana:${CHAIN_ID}:${paymentTx}`,
  score: 100,
  agentSignature: agentSig,
  // ... client signs this message
})
```

## Schema Architecture

SATI uses a universal base layout that all attestation schemas share:

```
┌─────────────────────────────────────────────────────────────┐
│                Universal Base (131 bytes)                    │
├─────────────────────────────────────────────────────────────┤
│ task_ref: [u8; 32]      - Payment/interaction reference     │
│ token_account: [u8; 32] - Agent ATA                         │
│ counterparty: [u8; 32]  - Counterparty pubkey               │
│ outcome: u8             - Outcome/score                     │
│ data_hash: [u8; 32]     - Hash of schema-specific data      │
│ content_type: u8        - Content encoding                  │
│ content: Vec<u8>        - Variable-length content           │
└─────────────────────────────────────────────────────────────┘
```

### Schema Agnostic Verification

The SATI program verifies signatures against this base layout only. This means:

- **New schemas without upgrades** — Add schemas via SAS, not program changes
- **Consistent security** — Same signature verification for all schemas
- **Forward compatible** — Schema evolution doesn't break existing code

### Available Schemas

| Schema | Storage | Signature Mode | Purpose |
|--------|---------|----------------|---------|
| FeedbackV1 | Compressed | DualSignature | Standard feedback (agent + client) |
| FeedbackPublicV1 | Compressed | CounterpartySigned | Public feedback (client only) |
| ValidationV1 | Compressed | DualSignature | Third-party validation |
| ReputationScoreV1 | Regular | CounterpartySigned | Aggregated scores |
| DelegateV1 | Regular | AgentOwnerSigned | Hot wallet delegation |

## No Reputation Monopoly

SATI deliberately keeps aggregation off-chain:

### Why No On-Chain Scores?

- **Too easily gamed** — Sybil attacks pump scores, spam tanks competitors
- **One-size-fits-all doesn't work**:
  - Time-weighted? (recent feedback matters more)
  - Reviewer-weighted? (trusted reviewers count more)
  - Context-specific? (good at task A, bad at B)
  - Payment-verified only? (filter out spam)

### Separation of Concerns

```
SATI = Raw attestations (truth)
         ↓
Reputation Oracles = Scoring (interpretation)
```

This enables multiple reputation providers to compete with different algorithms. SATI stores the facts, others interpret them.

## Storage Options

### Compressed (Light Protocol)

- **Cost**: ~$0.002 per attestation
- **Indexing**: Free via Photon
- **Use case**: High-volume feedback, validation
- **Tradeoff**: Not directly RPC queryable

### Regular (SAS)

- **Cost**: ~0.002 SOL (~$0.40 at $200/SOL)
- **Indexing**: Standard RPC getProgramAccounts
- **Use case**: ReputationScore, Delegation
- **Benefit**: Direct on-chain queryability
