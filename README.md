# SATI: Solana Agent Trust Infrastructure

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: Implementation Ready](https://img.shields.io/badge/Status-Implementation_Ready-green.svg)]()

**Trust infrastructure for million-agent economies on Solana** — identity, reputation, and validation designed for continuous feedback at scale.

---

## Overview

SATI enables agents to establish trust across organizational boundaries without pre-existing relationships. Built on Solana Attestation Service (SAS), SATI is architected for **compression-ready reputation** — storing complete feedback histories on-chain rather than just averages.

| Component | Purpose |
|-----------|---------|
| **SATI Registry** | Canonical entry point, atomic registration, collection authority |
| **Token-2022** | Agent identity NFTs with metadata and collection membership |
| **SAS** | Reputation and validation attestations (compression-ready) |

```
┌─────────────────────────────────────────────────────────────────┐
│                    SATI Registry Program                        │
│           (satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF)         │
├─────────────────────────────────────────────────────────────────┤
│  initialize()              → Create registry + TokenGroup       │
│  register_agent()          → Token-2022 NFT + group membership  │
│  update_registry_authority() → Transfer/renounce control        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────┐  ┌──────────────────────────────────┐
│      Token-2022          │  │  Solana Attestation Service      │
│  • Identity storage      │  │  • FeedbackAuth schema           │
│  • TokenMetadata         │  │  • Feedback schema               │
│  • TokenGroup            │  │  • FeedbackResponse schema       │
│  • Direct updates/xfers  │  │  • ValidationRequest schema      │
│                          │  │  • ValidationResponse schema     │
│                          │  │  • Certification schema          │
└──────────────────────────┘  └──────────────────────────────────┘
```

---

## Why SATI?

**Designed for scale.** SATI uses Solana Attestation Service for reputation, which means:

- **Complete histories, not just averages** — Store every feedback on-chain, aggregate algorithmically
- **Compression-ready** — When SAS ships [ZK-compressed attestations](https://github.com/solana-foundation/solana-attestation-service/pull/101), reputation costs drop ~100x
- **Sub-second finality** — ~400ms today, ~150ms with Alpenglow
- **Native wallet support** — Agents visible in Phantom, Solflare, Backpack

| Capability | Today | With Compression |
|------------|-------|------------------|
| Feedback cost | ~0.002 SOL | ~0.00002 SOL |
| Practical scale | 10K feedbacks | 1M+ feedbacks |
| On-chain history | Full | Full |

**100% ERC-8004 compatible** — same registration file format, same functional interfaces, cross-chain agent identity via DIDs.

---

## Quick Start

```bash
# Clone repository
git clone https://github.com/cascade-protocol/sati.git
cd sati

# Install dependencies
pnpm install

# Build program
anchor build

# Build SDK
pnpm --filter @cascade-fyi/sati-sdk build

# Run tests
anchor test
```

**Requirements:**
- Rust 1.89.0
- Solana CLI 2.0+
- Anchor 0.32.1+
- Node.js 18+
- pnpm

---

## SDK Usage

```typescript
import { SATI } from "@cascade-fyi/sati-sdk";

// Initialize client (auto-loads deployed schema addresses)
const sati = new SATI({ network: "mainnet" }); // or "devnet"

// Register an agent
const { mint, memberNumber } = await sati.registerAgent({
  payer: keypair,
  name: "MyAgent",
  symbol: "SATI",
  uri: "ipfs://QmRegistrationFile",
  additionalMetadata: [
    ["agentWallet", `solana:${keypair.address}`],
    ["a2a", "https://agent.example/.well-known/agent-card.json"],
  ],
});

// Give feedback (uses auto-loaded SAS schemas)
const { attestation } = await sati.giveFeedback({
  payer: keypair,
  agentMint: mint,
  score: 85,
  tag1: "quality",
});
```

See [examples/](./examples/) for complete usage examples.

---

## Costs

**Registration** (one-time, rent is reclaimable):

| Operation | Cost (SOL) |
|-----------|------------|
| Register agent (minimal) | ~0.003 |
| Register agent (3 metadata fields) | ~0.0035 |
| Register agent (max 10 fields) | ~0.005 |

**Reputation** (per attestation):

| Operation | Today | With Compression |
|-----------|-------|------------------|
| Authorize feedback | ~0.002 SOL | ~0.00002 SOL |
| Give feedback | ~0.002 SOL | ~0.00002 SOL |
| Validation request | ~0.002 SOL | ~0.00002 SOL |

See [benchmarks](./docs/benchmarks/) for detailed CU measurements.

---

## Scalability Roadmap

SATI's architecture is designed to scale with Solana's infrastructure:

**Today:** PDA-based attestations via SAS
- Full ERC-8004 compatibility
- Complete on-chain feedback histories
- ~0.002 SOL per attestation

**When SAS ships compressed attestations ([PR #101](https://github.com/solana-foundation/solana-attestation-service/pull/101)):**
- ~100x cost reduction for reputation operations
- Million-agent scale becomes practical
- No SATI code changes required — SAS handles compression transparently

**Why this matters:**
Systems constrained by gas costs store only aggregates (averages, counts). SATI stores complete histories, enabling:
- Spam detection via pattern analysis
- Reviewer reputation (weight feedback by reviewer quality)
- Time-decay scoring (recent feedback matters more)
- Payment-verified feedback (x402 proofs)

---

## ERC-8004 Compatibility

SATI achieves **100% functional compatibility** with ERC-8004:

| ERC-8004 Feature | SATI Equivalent |
|------------------|-----------------|
| `registrationFile` | Token-2022 `uri` field (IPFS/HTTP) |
| `transfer()` | Native Token-2022 transfer |
| `setApprovalForAll()` | Token-2022 delegate |
| `Feedback.request()` | SAS `FeedbackAuth` attestation |
| `Feedback.submit()` | SAS `Feedback` attestation |
| Collection membership | TokenGroup extension |

---

## Documentation

- [Complete Specification](./docs/specification.md) - Full technical specification
- [TypeScript SDK](./sdk/) - Developer SDK with generated client
- [Examples](./examples/) - Usage examples

---

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability reporting.

**Deployment Status:** Mainnet and Devnet
**On-chain Verification:** [Verified via solana-verify](https://explorer.solana.com/address/satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## Acknowledgments

**Inspired by:**
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) (Ethereum Foundation, MetaMask, Google, Coinbase)
- [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service)
- Google's Agent-to-Agent (A2A) Protocol
- Anthropic's Model Context Protocol (MCP)

**Built on:**
- [Token-2022](https://spl.solana.com/token-2022) (SPL Token Extensions)
- [Anchor Framework](https://www.anchor-lang.com)
- [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service)

---

## Connect

- **Twitter:** [@opwizardx](https://twitter.com/opwizardx)
- **Discussion:** [GitHub Discussions](https://github.com/cascade-protocol/sati/discussions)

---

## License

[Apache License 2.0](./LICENSE)

Copyright 2025 Cascade Protocol
