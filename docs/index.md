---
layout: home

hero:
  name: SATI
  text: Solana Agent Trust Infrastructure
  tagline: Production-ready agent reputation. ~$0.002 per attestation.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/cascade-protocol/sati

features:
  - icon: "\U0001F4B0"
    title: 200x Cost Reduction
    details: ZK Compression via Light Protocol stores attestations at ~$0.002 each. Batched feedback drops to ~$0.0006.
  - icon: "\U0001F510"
    title: Blind Feedback Model
    details: Agent signs with response (blind to outcome), client feedback is free. Cannot selectively participate.
  - icon: "\U0001F517"
    title: x402 Native
    details: Canonical feedback extension for x402 payments. Payment tx becomes task reference (CAIP-220).
  - icon: "\u2705"
    title: ERC-8004 Compatible
    details: Full compatibility with the Ethereum agent registry standard. Cross-chain identity linking supported.
  - icon: "\U0001F3D7"
    title: Production Ready
    details: "Deployed to mainnet: satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe"
  - icon: "\U0001F9E9"
    title: Schema Agnostic
    details: Program verifies signatures on universal base layout. New schemas without program upgrades.
---

## Built On Solana Foundation Infrastructure

| Component | Purpose |
|-----------|---------|
| **Token-2022** | Agent identity as NFT with metadata |
| **SAS** | Schema definitions + regular attestation storage |
| **Light Protocol** | ZK Compressed attestation storage |
| **Photon** | Free indexing for compressed accounts |

## Quick Example

```typescript
import { Sati } from '@cascade-fyi/sati-sdk'

const sati = new Sati({
  network: 'mainnet',
  rpcUrl: 'https://mainnet.helius-rpc.com?api-key=YOUR_KEY',
})

// Register an agent
const { mint } = await sati.registerAgent({
  payer: walletKeypair,
  name: "MyAgent",
  uri: "ipfs://QmRegistrationFile",
})

// Submit feedback (~$0.002)
await sati.createFeedback({
  payer: walletKeypair,
  sasSchema: feedbackSchema,
  agentMint: targetAgent,
  counterparty: clientPubkey,
  outcome: Outcome.Positive,
  // ... signatures
})
```

## Deployed Addresses

| Network | Program ID |
|---------|------------|
| Mainnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |
| Devnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |

| Asset | Address |
|-------|---------|
| TokenGroup Mint | `satiG7i9iyFxjq23sdyeLB4ibAHf6GXCARuosGeqane` |
