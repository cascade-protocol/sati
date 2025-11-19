# SATI: Solana Agent Trust Infrastructure

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Status: Community Standard (Proposed)](https://img.shields.io/badge/Status-Proposed-yellow.svg)]()

**Solana's answer to Ethereum's ERC-8004** - A four-registry protocol enabling autonomous AI agents to establish verifiable identity, accumulate portable reputation, manage user delegation, and handle payment mandate lifecycle across organizational boundaries.

---

## 🎯 The Problem

Solana has **50,000+ AI agents** deployed (ElizaOS, Solana Agent Kit, GOAT) but **zero formal standards** for:
- ✗ Agent identity and discovery
- ✗ Cross-platform reputation
- ✗ User-to-agent delegation
- ✗ Payment mandate lifecycle (IntentMandate/CartMandate)
- ✗ Work validation proofs

Meanwhile, Ethereum has ERC-8004 and Google's AP2 protocol. Protocols like Hubble AI choose Base because Solana lacks complete agent infrastructure.

**SATI fixes this.** First Solana standard with **complete AP2 support.**

---

## 🏗️ Architecture

SATI provides four composable registries:

### 1. Identity Registry (SATI-native, ZK Compressed)
- Globally unique agent identifiers
- DID support (did:solana, did:pkh, did:web)
- Protocol endpoint discovery (A2A, MCP, AP2)
- **Cost: $2,000 for 1M agents** (vs $3.4M traditional)

### 2. Reputation Registry (SATI-native, Event-Based)
- Pre-authorized client feedback (spam resistant)
- x402 payment proof integration
- Off-chain details with on-chain commitments
- **150ms finality** with Alpenglow

### 3. Delegation Registry (SAS-based Attestations)
- User→agent authorization with expiry
- Capability scoping and spending limits
- Built on Solana Attestation Service primitives

### 4. Mandate Registry (SATI-native, ZK Compressed)
- **Full AP2 IntentMandate & CartMandate support**
- Lifecycle states (Active/Revoked/Executed/Zombie/Amended)
- Context drift detection (prevents "zombie mandates")
- Revalidation triggers for changed user context
- **First Solana solution to AP2 mandate lifecycle problem**

**Plus:** TEE validation attestations (Phala, Intel TDX, AMD SEV) via SAS

---

## 🚀 Quick Start

```bash
# Clone repository
git clone https://github.com/tenequm/sati.git
cd sati

# Install dependencies (uses pnpm)
pnpm install

# Build programs (requires Anchor 0.32.1+)
anchor build

# Build SDK
cd sdk && pnpm build

# Run tests
anchor test
```

**Note:** This is a scaffolded repository. Full implementation planned for Q1 2026 (13-week roadmap).

**Requirements:**
- Rust 1.89.0
- Solana CLI 1.18+
- Anchor 0.32.1+
- Node.js 18+
- pnpm (not npm/yarn)

---

## 💡 Why SATI?

| Feature | SATI | aeamcp | s8004 | ERC-8004 |
|---------|------|--------|-------|----------|
| **ZK Compression** | ✅ 1,600x cheaper | ❌ | ❌ | N/A |
| **Alpenglow Ready** | ✅ 150ms finality | ❌ | ❌ | N/A |
| **SAS Integration** | ✅ Production-tested | ❌ | ❌ | N/A |
| **Cross-chain DIDs** | ✅ Ethereum compatible | ❌ | ❌ | ✅ |
| **User Delegation** | ✅ Native | Planned | ❌ | ❌ |
| **Mandate Lifecycle** | ✅ Full AP2 support | ❌ | ❌ | ❌ |
| **Zombie Detection** | ✅ Context drift | ❌ | ❌ | ❌ |
| **Status** | Proposed | Devnet | POC | Draft |

---

## 🎯 Use Cases

**For Agent Frameworks:**
- ElizaOS, Solana Agent Kit, GOAT can use SATI for identity
- Agents gain portable reputation across platforms
- Cross-framework agent discovery becomes possible

**For Payment Protocols:**
- x402 agents get verifiable identities
- Payment proofs integrate with reputation
- **Full AP2 mandate lifecycle support** (IntentMandate/CartMandate)
- Context drift detection prevents "zombie mandate" chargebacks
- Value-weighted feedback prevents Sybil attacks

**For Enterprises:**
- Hubble AI can build on Solana (complete AP2 + ERC-8004 compatibility)
- Trust infrastructure for PayAI ecosystem
- Cross-chain agent interoperability (Solana ↔ Ethereum)
- Regulatory compliance (context revalidation for subscription-style payments)

---

## 📚 Documentation

- [Complete Specification](./docs/SPECIFICATION.md) - 14,000 word technical spec
- [Architecture Overview](./docs/ARCHITECTURE.md) - Visual system design
- [ERC-8004 Comparison](./docs/COMPARISON_ERC8004.md) - Alignment analysis
- [TypeScript SDK](./sdk/) - Developer integration guide

---

## 🛣️ Roadmap

**Phase 1: Core Infrastructure (13 weeks)**
- Identity Registry with ZK Compression
- Reputation Registry with x402 integration
- **Mandate Registry with full AP2 lifecycle support**
- **Context drift detection and zombie mandate prevention**
- SAS delegation and validation schemas
- Cross-chain DID support

**Phase 2: Advanced Features (6 months post-launch)**
- Multi-validator consensus orchestrator
- zkML validation implementation
- Wormhole/LayerZero bridge integration
- Light client cross-chain verification
- Advanced mandate revalidation automation

---

## 🤝 Contributing

SATI is a community-driven standard. We welcome:
- Feedback on specification
- Integration proposals (frameworks, protocols)
- Implementation contributions
- Documentation improvements

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 🙏 Acknowledgments

**Inspired by:**
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) (Ethereum Foundation, MetaMask, Google, Coinbase)
- [Solana Attestation Service](https://github.com/civic/solana-attestation-service) (Solana Foundation)
- Google's Agent-to-Agent (A2A) Protocol
- Anthropic's Model Context Protocol (MCP)

**Built on:**
- [Light Protocol ZK Compression](https://www.lightprotocol.com) (1,600x cost reduction)
- [Anchor Framework](https://www.anchor-lang.com) (Solana development)
- [Solana Attestation Service](https://github.com/civic/solana-attestation-service) (Attestation primitives)

**Motivated by:**
- Seeing Hubble AI choose Base due to ERC-8004
- Realizing Solana's 50,000+ agents lack trust infrastructure
- Believing Solana deserves best-in-class agent standards

---

## 📞 Connect

- **Twitter:** [@opwizardx](https://twitter.com/opwizardx)
- **Related Project:** [CascadePay](https://github.com/tenequm/cascadepay) (x402 payment splitting)
- **Discussion:** [GitHub Discussions](https://github.com/tenequm/sati/discussions)

**Built during [Solana x402 Hackathon](https://payai.network) - November 2025**

---

## 📄 License

[Apache License 2.0](./LICENSE)

Copyright 2025 Cascade Protocol

*SATI is free to use, modify, and build upon under the Apache 2.0 license.*
