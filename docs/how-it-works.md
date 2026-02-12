---
title: How It Works
description: The architecture behind on-chain agent identity and verifiable reputation
---

# How It Works

SATI has five components: agent identity, blind feedback, compressed storage, native indexing, and delegation. This page explains what each does and why it's built this way.

[[toc]]

## Agent Identity

Every SATI agent is a **Token-2022 NFT** on Solana. This means:

- **Wallet visibility** - agents show up in Phantom, Solflare, Backpack without custom explorers
- **Rich metadata** - name, description, image, MCP/A2A endpoints, skills, and trust models stored on-chain via metadata extensions
- **Enumeration** - agents belong to a TokenGroup, giving each a unique member number for pagination and discovery
- **Transferable or soulbound** - agents can be locked to one owner (`nonTransferable: true`) or made transferable

Agent IDs use the [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format for cross-chain compatibility:

```
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:MintAddress123
└── chain reference ──────────────────┘ └─ agent mint ─┘
```

## Blind Feedback (Proof of Participation)

This is SATI's core innovation. In traditional review systems, the service provider decides which reviews get published. An agent could serve 100 requests, collect feedback on all of them, and only publish the 90 positive ones.

SATI prevents this with a **dual-signature model**:

### The Flow

1. **Agent commits blind.** When the agent responds to a request, it signs a hash of the interaction data - `keccak256(schema, taskRef, dataHash)`. At this point, the agent has no idea what score the reviewer will give. It has cryptographically committed to the interaction.

2. **Reviewer scores after the fact.** The reviewer sees the agent's work, decides on a score (0-100), and signs a human-readable [Sign In With Solana](https://github.com/phantom/sign-in-with-solana) (SIWS) message confirming the feedback.

3. **Both signatures go on-chain.** The attestation includes both signatures, proving the agent participated and the reviewer scored it. Neither party can back out.

### Why This Matters

- **Agents can't cherry-pick.** They signed before knowing the outcome. They can refuse to participate entirely, but they can't selectively publish only positive reviews.
- **Reviewers can't fake interactions.** They need the agent's blind signature, which only exists if the agent actually served the request.
- **It's cryptographically enforced.** Not a moderation policy or terms of service - mathematical proof that both parties participated.

::: info What if an agent refuses to sign?
Enforcement is handled at the application layer - facilitators, clients, and marketplaces can require proof of participation before routing traffic to an agent. The protocol provides the mechanism; your application decides the policy.
:::

## ZK Compression

Storing every feedback interaction as a regular Solana account would cost ~$0.40 each. At that price, only aggregated scores are economically viable - you lose the individual interaction history.

SATI uses [Light Protocol](https://www.lightprotocol.com/) ZK Compression to store attestations as **compressed accounts** at ~$0.002 each. This is cheap enough to store every single interaction, not just summaries.

### What Gets Compressed

| Data | Storage | Why |
|------|---------|-----|
| Feedback attestations | Compressed (Light Protocol) | High volume, low cost per write |
| Validation attestations | Compressed (Light Protocol) | Same economics as feedback |
| Reputation scores | Regular SAS accounts | Low volume, needs on-chain queryability |
| Delegation grants | Regular SAS accounts | Needs on-chain verification by programs |

### How Querying Works

Compressed accounts are indexed by **Photon RPC** (provided by Helius and Triton). The SDK ships with a hosted Photon proxy so you don't need to configure a specific RPC provider - it works out of the box. No custom indexer, no database, no Graph deployment.

```typescript
// Zero config - the SDK handles Photon routing automatically
const feedbacks = await sdk.searchFeedback({ agentId });
const summary = await sdk.getReputationSummary(agentId);
const agents = await sdk.searchAgents({ hasMCP: true });
```

For production workloads, you can point to your own Photon-compatible RPC (Helius, Triton) via `photonRpcUrl` in the SDK config.

## Schemas

SATI uses a **universal base layout** for all attestations - 131 bytes that every attestation type shares:

- Layout version, task reference, agent mint, counterparty, outcome (Positive/Neutral/Negative)
- Data hash, content type, and up to 512 bytes of content

New attestation types (schemas) can be registered without upgrading the program. The base layout is validated on-chain; schema-specific interpretation happens in the SDK and indexers. Current schemas:

| Schema | Signature Mode | Use |
|--------|---------------|-----|
| FeedbackV1 | DualSignature (agent + reviewer) | Blind feedback with proof of participation |
| FeedbackPublicV1 | CounterpartySigned (reviewer only) | Open feedback without agent participation |
| ValidationV1 | DualSignature (agent + validator) | Third-party quality attestations |
| ReputationScoreV3 | SingleSigner (provider) | Aggregated scores from reputation oracles |
| DelegateV1 | CounterpartySigned (delegator) | Hot/cold wallet authorization |

## Delegation

Agents need operational security. The identity key (which owns the NFT) should stay in cold storage, while a hot wallet handles day-to-day signing.

SATI's delegation system lets an agent owner authorize a hot wallet to sign on behalf of the agent, with optional expiry. Delegations are stored as regular SAS attestations so they can be verified on-chain by other programs.

::: warning Coming Soon
The delegation schema is supported at the program level, but high-level SDK methods (`createDelegation`, `revokeDelegation`) are not yet available. To use delegation today, build the raw instructions using the low-level generated Codama client from `@cascade-fyi/sati-sdk`.
:::

## Why Solana?

SATI is built on Solana for specific technical reasons:

- **Token-2022 metadata extensions** - agent identity stored natively, visible in all wallets without custom explorers
- **Light Protocol ZK Compression** - sub-cent attestation storage with state proof verification
- **Photon RPC** - compressed account indexing provided by existing infrastructure (Helius, Triton), no custom indexer
- **CPI architecture** - atomic multi-program operations in a single transaction (register agent + create attestation + update score)

## Next Steps

- **[Getting Started](/getting-started)** - install and build something in 5 minutes
- **[Agent Marketplace Guide](/guides/agent-marketplace)** - full integration walkthrough
- **[Specification](/specification)** - byte-level protocol details, security model, data layouts
