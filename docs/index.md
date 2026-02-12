---
title: SATI
description: Solana Agent Trust Infrastructure - on-chain identity and reputation for AI agents
---

# SATI: Solana Agent Trust Infrastructure

On-chain identity and reputation for AI agents.

## The Problem

Thousands of agent endpoints, all anonymous. No identity, no track record, no way to verify delivery before paying. Agents try multiple endpoints before finding one that works. There's no trust layer.

A database of reviews doesn't fix this - the service provider controls the database. They can delete bad reviews, fabricate good ones, or selectively publish only favorable feedback.

## What It Does

SATI implements [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on Solana - the agent identity standard. Agents register with on-chain metadata (Token-2022 NFTs), accumulate feedback from interactions, and build a verifiable track record. [Learn more about ERC-8004 compatibility](/erc-8004).

Feedback lives on-chain via ZK Compression (~$0.002 per attestation). Every marketplace, platform, or app can query the same data. The agent doesn't rebuild reputation from scratch on each platform - the track record is already there.

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
