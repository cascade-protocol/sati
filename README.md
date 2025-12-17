# SATI: Solana Agent Trust Infrastructure

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: Implementation Ready](https://img.shields.io/badge/Status-Implementation_Ready-green.svg)]()

**Solana's answer to Ethereum's ERC-8004** - A lightweight agent trust infrastructure providing ERC-8004 compatible identity, reputation, and validation using native Solana primitives.

---

## Overview

SATI v2 combines three components:

| Component | Purpose |
|-----------|---------|
| **SATI Registry** | Canonical entry point, atomic registration, collection authority |
| **Token-2022** | Agent identity NFTs with metadata and collection membership |
| **SAS** | Reputation and validation attestations |

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
│  • TokenGroup            │  │  • ValidationRequest schema      │
│  • Direct updates/xfers  │  │  • ValidationResponse schema     │
└──────────────────────────┘  └──────────────────────────────────┘
```

---

## Why SATI?

| Feature | SATI v2 | ERC-8004 |
|---------|---------|----------|
| **Identity** | Token-2022 NFT | ERC-721 NFT |
| **Wallet support** | Phantom, Solflare, Backpack | MetaMask, etc. |
| **Metadata** | On-chain (TokenMetadata extension) | On-chain (tokenURI) |
| **Collections** | TokenGroup extension | Contract-level |
| **Transfers** | Native token instruction | transferFrom() |
| **Reputation** | SAS attestations | On-chain events |
| **Finality** | ~400ms (Alpenglow: 150ms) | ~12s |

---

## Quick Start

```bash
# Clone repository
git clone https://github.com/tenequm/sati.git
cd sati

# Install dependencies
pnpm install

# Build program
anchor build

# Build SDK
pnpm --filter @sati/sdk build

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
import {
  getRegisterAgentInstructionAsync,
  SATI_REGISTRY_PROGRAM_ADDRESS,
} from "@sati/sdk";

// Register an agent
const registerIx = await getRegisterAgentInstructionAsync({
  payer,
  owner: payer.address,
  groupMint,
  agentMint,
  agentTokenAccount,
  name: "MyAgent",
  symbol: "SATI",
  uri: "ipfs://QmRegistrationFile",
  additionalMetadata: [
    { key: "agentWallet", value: `solana:${payer.address}` },
    { key: "a2a", value: "https://agent.example/.well-known/agent-card.json" },
  ],
  nonTransferable: false,
});
```

See [examples/](./examples/) for complete usage examples.

---

## Performance & Costs

| Operation | Compute Units | Est. Cost (SOL) |
|-----------|---------------|-----------------|
| Register agent (minimal) | 58,342 | ~0.003 |
| Register agent (3 metadata fields) | 82,877 | ~0.0035 |
| Register agent (max 10 fields) | 168,097 | ~0.005 |
| Update metadata | - | ~0.00001 |
| Transfer agent | - | ~0.00001 |

Token-2022's embedded extensions keep costs low by storing metadata directly in the mint account.

See [benchmarks](./docs/benchmarks/) for detailed measurements.

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

**Program Audits:** Planned for Q1 2026 pre-mainnet.

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
- **Discussion:** [GitHub Discussions](https://github.com/tenequm/sati/discussions)

---

## License

[Apache License 2.0](./LICENSE)

Copyright 2025 Cascade Protocol
