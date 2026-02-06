# SATI: Solana Agent Trust Infrastructure

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Trust infrastructure for million-agent economies on Solana** — identity, reputation, and validation designed for continuous feedback at scale.

---

## Overview

SATI enables agents to establish trust across organizational boundaries without pre-existing relationships. Built on Solana Attestation Service (SAS), SATI is architected for **compression-ready reputation** — storing complete feedback histories on-chain rather than just averages.

| Component | Purpose |
|-----------|---------|
| **SATI Program** | Agent registration, signature verification, attestation storage routing |
| **Token-2022** | Agent identity NFTs with metadata and collection membership |
| **Light Protocol** | ZK-compressed attestation storage (~200x cheaper) |
| **SAS** | Regular attestation storage (ReputationScoreV3) |

```
┌───────────────────────────┐
│      Token-2022           │
│  • Identity storage       │
│  • TokenMetadata          │
│  • TokenGroup             │
└───────────────────────────┘
          ▲
          │ (CPI: mint NFT)
┌─────────────────────────────────────────────────────────────────┐
│                         SATI Program                             │
│           (satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe)          │
├─────────────────────────────────────────────────────────────────┤
│  Registry:                                                       │
│    initialize()              → Create registry + TokenGroup      │
│    register_agent()          → Token-2022 NFT + group membership │
│    update_registry_authority() → Transfer/renounce control       │
│  Attestation:                                                    │
│    register_schema_config()  → Register schema + storage type    │
│    create_attestation()      → Verify sigs → route to storage    │
│    close_attestation()       → Close/nullify attestation         │
└─────────────────────────────────────────────────────────────────┘
          │                                         │
          │ (CPI: compressed)                       │ (CPI: regular)
          ▼                                         ▼
┌───────────────────────────┐         ┌────────────────────────────┐
│   Light Protocol          │         │  Solana Attestation Service│
│   (Compressed Storage)    │         │  (Regular Storage)         │
├───────────────────────────┤         ├────────────────────────────┤
│ • Feedback attestations   │         │ • ReputationScore          │
│ • Validation attestations │         │ • On-chain queryable       │
│ • ~$0.002 per attestation │         │                            │
└───────────────────────────┘         └────────────────────────────┘
```

---

## Why SATI?

**Proof of participation.** SATI implements a blind feedback model where agents sign BEFORE knowing feedback sentiment — they cannot selectively participate in only positive reviews. This security guarantee was removed from ERC-8004 in January 2026.

- **Cryptographic proof of interaction** — Both parties must sign; agent commits before knowing outcome
- **Native indexing** — Photon provides query capabilities for compressed accounts via standard RPC
- **Complete histories, not just averages** — Store every feedback on-chain, aggregate algorithmically
- **Sub-second finality** — ~400ms today, ~150ms with Alpenglow
- **Native wallet support** — Agents visible in Phantom, Solflare, Backpack

| Capability | SATI |
|------------|------|
| Proof of participation | Agent signs before outcome known |
| Native indexing | Photon RPC for compressed accounts |
| Feedback cost | ~$0.002 per attestation |
| On-chain history | Full (not just aggregates) |

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
import { Sati } from "@cascade-fyi/sati-sdk";

// Initialize client (auto-loads deployed schema addresses)
const sati = new Sati({ network: "mainnet" }); // or "devnet"

// Register an agent
const { mint, memberNumber } = await sati.registerAgent({
  payer: keypair,
  name: "MyAgent",
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

See the [SDK documentation](./packages/sdk/README.md) for complete usage examples.

---

## Costs

**Registration** (one-time, rent is reclaimable):

| Operation | Cost (SOL) |
|-----------|------------|
| Register agent (minimal) | ~0.003 |
| Register agent (3 metadata fields) | ~0.0035 |
| Register agent (max 10 fields) | ~0.005 |

**Reputation** (per attestation):

| Operation | Cost |
|-----------|------|
| Feedback (single) | ~$0.002 (~0.00002 SOL) |
| Feedback (batched 5/tx) | ~$0.001 (amortized) |
| Validation | ~$0.002 |

See [benchmarks](./docs/benchmarks/) for detailed CU measurements.

---

## Architecture Benefits

**Why this design matters:**

Systems constrained by gas costs store only aggregates (averages, counts). SATI stores complete histories, enabling:
- Spam detection via pattern analysis
- Reviewer reputation (weight feedback by reviewer quality)
- Time-decay scoring (recent feedback matters more)
- Payment-verified feedback (x402 proofs)

**Native indexing via Photon:**
- Compressed accounts queryable via standard RPC
- Same trust model as reading blockchain state
- No external indexing infrastructure required

---

## ERC-8004 Compatibility

SATI achieves **100% functional compatibility** with ERC-8004:

| ERC-8004 Feature | SATI Equivalent |
|------------------|-----------------|
| `registrationFile` | Token-2022 `uri` field (IPFS/HTTP) |
| `transfer()` | Native Token-2022 transfer |
| `setApprovalForAll()` | Token-2022 delegate |
| `giveFeedback()` | Blind feedback model (DualSignature) |
| `feedbackAuth` (removed Jan 2026) | N/A — SATI uses stronger dual-signature |
| Collection membership | TokenGroup extension |

---

## Documentation

📚 **[sati.cascade.fyi](https://cascade-protocol.github.io/sati/)** — Full documentation site

- [Getting Started](https://cascade-protocol.github.io/sati/getting-started) — 5-minute quickstart
- [Core Concepts](https://cascade-protocol.github.io/sati/guide/concepts) — Blind feedback, x402 integration
- [Specification](https://cascade-protocol.github.io/sati/specification) — Complete technical reference
- [TypeScript SDK](./packages/sdk/) — Developer SDK with generated client

---

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability reporting.

**Deployment Status:** Deployed on Mainnet and Devnet
**On-chain Verification:** [Program on Solana Explorer](https://explorer.solana.com/address/satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe)

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
