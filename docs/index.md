---
layout: home

hero:
  name: SATI
  text: Your agent endpoint is invisible
  tagline: "ERC-8004 on Solana: on-chain identity and verifiable track record for AI agents."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: How It Works
      link: /how-it-works

features:
  - icon: "\U0001F464"
    title: On-Chain Identity
    details: Agents register as Token-2022 NFTs - visible in Phantom, Solflare, Backpack. Advertise MCP/A2A endpoints, skills, and trust models.
  - icon: "\u2705"
    title: Proof of Participation
    details: Agents cryptographically commit before knowing feedback sentiment. They can't cherry-pick positive reviews.
  - icon: "\U0001F50D"
    title: Zero Infrastructure
    details: No custom indexer, no database, no API keys. The SDK ships with hosted IPFS uploads and Photon RPC - just install and build.
  - icon: "\U0001F4B0"
    title: Sub-Cent Attestations
    details: ~$0.002 per feedback via ZK Compression (Light Protocol). Economically viable to store every interaction, not just aggregates.
---

## The Problem

Thousands of agent endpoints, all anonymous. No identity, no track record, no way to verify delivery before paying. Agents try multiple endpoints before finding one that works. There's no trust layer.

A database of reviews doesn't fix this - the service provider controls the database. They can delete bad reviews, fabricate good ones, or selectively publish only favorable feedback.

## What SATI Gives You

**[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on Solana.** Full feature parity with the agent identity standard - same registration file, same interfaces, same cross-chain IDs (CAIP-2). Agents get portable reputation that travels across chains and platforms instead of staying locked in one ecosystem. [Learn more](/erc-8004).

**A verifiable track record that no one controls.** Feedback lives on Solana - tamper-proof and portable across every platform that reads it. An agent's reputation follows it everywhere, not just on your marketplace.

**Solana-native capabilities beyond the base standard.** The default feedback flow (FeedbackPublicV1) matches ERC-8004. On top of that, Solana's architecture enables enhancements: blind feedback (FeedbackV1) with dual-signature proof of participation makes reputation directly composable by on-chain programs - think reputation-based lending, escrow resolution, or any smart contract that needs trust data. ReputationScore provides a standardized mechanism for reputation providers to publish scoring algorithms on-chain, composable by any Solana program.

## Who Is SATI For?

- **Agent marketplace builders** - add identity, reputation, and discovery to your platform with one SDK integration
- **x402 sellers** - link feedback directly to payment transactions, so your track record proves you delivered
- **Platform operators** - register all your platform's agents with a single integration, give them portable reputation
- **Reputation providers** - publish competing scoring algorithms on top of the same on-chain data

## Ready to Build?

<div class="tip custom-block" style="padding-top: 8px">

Start with the [Getting Started](/getting-started) guide to go from zero to working in 5 minutes, or read [How It Works](/how-it-works) to understand the architecture first.

</div>

### Costs

| Operation | Cost |
|-----------|------|
| Agent registration | ~0.003 SOL |
| Feedback (single) | ~$0.002 |
| Feedback (batched 5/tx) | ~$0.001 |
| Validation | ~$0.002 |

### Deployed Addresses

| Network | Program ID |
|---------|------------|
| Mainnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |
| Devnet | `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe` |
