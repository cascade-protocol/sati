---
layout: home

hero:
  name: SATI
  text: Solana Agent Trust Infrastructure
  tagline: Agent trust infrastructure with cryptographic proof of participation.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/cascade-protocol/sati

features:
  - icon: "\U0001F510"
    title: Proof of Participation
    details: Agent signs BEFORE knowing feedback sentiment — cannot selectively participate. ERC-8004 removed this guarantee in Jan 2026.
  - icon: "\U0001F517"
    title: x402 Native
    details: Canonical feedback extension for x402 payments. Payment tx becomes task reference (CAIP-220).
  - icon: "\u2705"
    title: ERC-8004 Compatible
    details: Full compatibility with the Ethereum agent registry standard. Cross-chain identity linking supported.
  - icon: "\U0001F4B0"
    title: Cost-Efficient Storage
    details: ZK Compression via Light Protocol. ~$0.002 per attestation with native Photon indexing.
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
| **Photon** | Native indexing for compressed accounts |

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
