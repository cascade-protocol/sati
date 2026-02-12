# SATI: Solana Agent Trust Infrastructure

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on Solana.** On-chain identity, verifiable reputation, and agent discovery - the same standard backed by MetaMask, Google, and Coinbase, implemented with sub-cent storage and sub-second finality.

Agents register as Token-2022 NFTs, feedback is stored as compressed attestations at ~$0.002 each, and the SDK works out of the box - no API keys, no custom indexer, no infrastructure.

---

## Quick Start

```bash
pnpm add @cascade-fyi/sati-agent0-sdk
```

**Peer dependencies:**
```bash
pnpm add @cascade-fyi/sati-sdk @solana/kit @solana-program/token-2022 agent0-sdk
```

```typescript
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner, createSolanaRpc } from "@solana/kit";

// 1. Create a funded devnet wallet
const signer = await generateKeyPairSigner();
const rpc = createSolanaRpc("https://api.devnet.solana.com");
await rpc.requestAirdrop(signer.address, 1_000_000_000n).send();

// 2. Initialize the SDK (zero config - no API keys needed)
const sdk = new SatiAgent0({ network: "devnet", signer });

// 3. Register an agent (metadata uploaded to IPFS automatically)
const agent = sdk.createAgent("MyAgent", "An AI trading assistant");
agent.setActive(true);
const regHandle = await agent.registerIPFS();
console.log(agent.agentId); // solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:MintAddr...

// 4. Give feedback (0-100 score with optional tags)
const fbHandle = await sdk.giveFeedback(agent.agentId!, 85, "quality", "speed");
const { result: feedback } = await fbHandle.waitMined();

// 5. Query reputation
const summary = await sdk.getReputationSummary(agent.agentId!);
console.log(`${summary.count} reviews, avg ${summary.averageValue}`);
```

---

## Why SATI?

**Proof of participation.** Agents sign a cryptographic commitment with every response, before knowing what score the reviewer will give. They can't cherry-pick positive reviews - they already committed to the interaction on-chain.

- **On-chain identity** - Agents are Token-2022 NFTs, visible in Phantom, Solflare, Backpack
- **Blind feedback** - Agent commits before outcome is known; reviewer needs agent's signature to submit
- **Complete histories** - Every interaction stored on-chain (~$0.002 each), not just aggregates
- **Zero infrastructure** - Hosted IPFS uploads and Photon RPC built into the SDK, no API keys needed
- **Sub-second finality** - ~400ms today, ~150ms with Alpenglow

**100% ERC-8004 compatible** - same registration file format, same functional interfaces, cross-chain agent identity via CAIP-2.

---

## Packages

| Package | Description |
|---------|-------------|
| **[@cascade-fyi/sati-agent0-sdk](./packages/sati-agent0-sdk/)** | High-level SDK for agent registration, feedback, search, and reputation. **Start here.** |
| **[@cascade-fyi/sati-sdk](./packages/sdk/)** | Low-level SDK for raw attestations, custom schemas, compression, encryption. |
| **[@cascade-fyi/compression-kit](./packages/compression-kit/)** | Light Protocol compression primitives for `@solana/kit`. |
| **[SATI Program](./programs/sati/)** | Anchor program for on-chain registration and attestation routing. |

---

## Architecture

```
┌───────────────────────────┐
│      Token-2022           │
│  - Identity storage       │
│  - TokenMetadata          │
│  - TokenGroup             │
└───────────────────────────┘
          ▲
          │ (CPI: mint NFT)
┌─────────────────────────────────────────────────────────────────┐
│                         SATI Program                            │
│           (satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe)        │
├─────────────────────────────────────────────────────────────────┤
│  Registry:                                                      │
│    initialize()              → Create registry + TokenGroup     │
│    register_agent()          → Token-2022 NFT + group member    │
│  Attestation:                                                   │
│    register_schema_config()  → Register schema + storage type   │
│    create_attestation()      → Verify sigs → route to storage   │
│    close_attestation()       → Close/nullify attestation        │
└─────────────────────────────────────────────────────────────────┘
          │                                         │
          │ (CPI: compressed)                       │ (CPI: regular)
          ▼                                         ▼
┌───────────────────────────┐         ┌────────────────────────────┐
│   Light Protocol          │         │  Solana Attestation Service│
│   (Compressed Storage)    │         │  (Regular Storage)         │
├───────────────────────────┤         ├────────────────────────────┤
│ - Feedback attestations   │         │ - ReputationScore          │
│ - Validation attestations │         │ - On-chain queryable       │
│ - ~$0.002 per attestation │         │                            │
└───────────────────────────┘         └────────────────────────────┘
```

---

## Costs

| Operation | Cost |
|-----------|------|
| Agent registration | ~0.003 SOL |
| Feedback (single) | ~$0.002 |
| Feedback (batched 5/tx) | ~$0.001 |
| Validation | ~$0.002 |

See [benchmarks](./docs/advanced/benchmarks.md) for detailed CU measurements.

---

## Documentation

**[docs.sati.cascade.fyi](https://docs.sati.cascade.fyi/)** - Full documentation

- [Getting Started](https://docs.sati.cascade.fyi/getting-started) - zero to working in 5 minutes
- [How It Works](https://docs.sati.cascade.fyi/how-it-works) - blind feedback, compression, schemas
- [Guides](https://docs.sati.cascade.fyi/guides/agent-marketplace) - agent marketplace, MCP registration, browser wallets
- [Specification](https://docs.sati.cascade.fyi/specification) - byte-level protocol details

---

## Building from Source

```bash
git clone https://github.com/cascade-protocol/sati.git
cd sati && pnpm install

# Build program + SDK
anchor build
cd packages/sdk && pnpm build

# Run tests
anchor test
```

**Requirements:** Rust 1.89.0, Solana CLI 2.0+, Anchor 0.32.1+, Node.js 18+, pnpm

---

## Deployed Addresses

| Network | Program ID |
|---------|------------|
| Mainnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |
| Devnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |

[View on Solana Explorer](https://explorer.solana.com/address/satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe)

---

## ERC-8004 Compatibility

| ERC-8004 Feature | SATI Equivalent |
|------------------|-----------------|
| `registrationFile` | Token-2022 `uri` field (IPFS/HTTP) |
| `transfer()` | Native Token-2022 transfer |
| `giveFeedback()` | FeedbackPublicV1 (open, ERC-8004 compatible) + FeedbackV1 (dual-signature for on-chain composability) |
| Collection membership | TokenGroup extension |

---

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Acknowledgments

**Built on:** [Token-2022](https://spl.solana.com/token-2022), [Anchor](https://www.anchor-lang.com), [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service), [Light Protocol](https://www.lightprotocol.com/)

**Inspired by:** [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004), [A2A Protocol](https://google.github.io/A2A/), [Model Context Protocol](https://modelcontextprotocol.io/)

## Connect

- **Twitter:** [@opwizardx](https://twitter.com/opwizardx)
- **Discussion:** [GitHub Discussions](https://github.com/cascade-protocol/sati/discussions)

## License

[Apache License 2.0](./LICENSE) - Copyright 2025-present Cascade Protocol
