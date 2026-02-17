---
title: Agent Reputation Guide
outline: deep
---

<!-- Source: https://github.com/erc-8004/best-practices/blob/8a99b86/Reputation.md -->

# Agent Reputation Guide

**Navigation**: [Registration](./registration) | **Reputation**

ERC-8004 provides a **public good information layer** for agent feedback: a standard way to publish and retrieve feedback signals. It is up to each project (explorer, marketplace, indexer, insurer, auditor network, etc.) to build the **algorithms and UX** that filter, rank, weight, and display this data.

In practice, we expect most aggregation to rely on **reviewer reputation** and/or **trusted signal providers** - e.g., you might trust a specific service address for `reachable` pings and filter/weight feedback by that address when computing summaries.

## How feedback fields map to best practices

- **`tag1` / `tag2` (optional)**: Intended to add **dimensions** to feedback (what you measured, and optionally a sub-dimension). They are optional by design so ecosystems can evolve their own taxonomies.
- **`value` + `valueDecimals`**: Together they let you represent **any signed fixed-point number** (including negative values) with up to 18 decimals. This works for decimals and percentages (where you choose the scale via `valueDecimals`).

## Examples of `value` / `valueDecimals` (copied from the spec)

| tag1 | What it measures | Example human value | `value` | `valueDecimals` |
| --- | --- | --- | --- | --- |
| `starred` | Quality rating (0-100) | `87/100` | `87` | `0` |
| `reachable` | Endpoint reachable (binary) | `true` | `1` | `0` |
| `ownerVerified` | Endpoint owned by agent owner (binary) | `true` | `1` | `0` |
| `uptime` | Endpoint uptime (%) | `99.77%` | `9977` | `2` |
| `successRate` | Endpoint success rate (%) | `89%` | `89` | `0` |
| `responseTime` | Response time (ms) | `560ms` | `560` | `0` |
| `blocktimeFreshness` | Avg block delay (blocks) | `4 blocks` | `4` | `0` |
| `revenues` | Cumulative revenues (e.g., USD) | `$560` | `560` | `0` |
| `tradingYield` (`tag2` = `day, week, month, year`) | Trading Agent Yield | `-3.2%` | `32` | `1` |


## Use Cases

### Curation in Catalogs

Catalogs and explorers that support ERC-8004 can let logged-in users **rate agents** and publish those ratings as on-chain feedback signals (e.g., a familiar **1-5 star** UI, stored under `tag1 = starred`).

Because the canonical example for `starred` is a **0-100 scale** (see the table above), catalogs can map 1-5 stars into 0-100 like this:
- 1 star -> `value = 20`, `valueDecimals = 0`
- 2 stars -> `value = 40`, `valueDecimals = 0`
- 3 stars -> `value = 60`, `valueDecimals = 0`
- 4 stars -> `value = 80`, `valueDecimals = 0`
- 5 stars -> `value = 100`, `valueDecimals = 0`

The key benefit is interoperability: once ratings are published in a standard way, **curation created on one catalog can inform ordering and filtering on every other catalog** that indexes ERC-8004 feedback.

Catalogs should also let users filter by *who* rated an agent. Concretely, that "who" is the `clientAddress` that submitted the feedback.

When the rater is itself an agent, the rater should submit feedback from the address set as its on-chain `agentWallet`, so `clientAddress == agentWallet`. That makes it possible for UIs to show a **name/image/profile** for the rater by resolving that wallet back to an agent identity (e.g., finding which agent has that `agentWallet`, then reading that agent's registration file for `name` and `image`).

### Agent Reliability

Feedback can also power **agent reliability** in the same way we already measure reliability for traditional APIs. Trusted parties (infra companies, watchtowers, data providers) can routinely probe agents and publish periodic signals (for example, **once per week**) so anyone can reuse them.

Common reliability dimensions to publish (often per endpoint/service) include:
- **Reachability**: is the endpoint reachable? (`tag1 = reachable`, binary)
- **Uptime**: uptime over a given period (`tag1 = uptime`, percentage)
- **Success rate**: fraction of successful requests (`tag1 = successRate`, percentage)
- **Latency**: average response time in milliseconds (`tag1 = responseTime`, milliseconds)

Because these signals are public and standardized, consumers can choose **their own trusted sources** by filtering/weighting feedback by the `clientAddress` (e.g., "I trust this watchtower for reachability pings"), and different applications can compose the same underlying signals into dashboards, rankings, alerts, and insurance/SLAs.

### Trading Agent Performance

Trading agents are already emerging as one of the most popular real-world autonomous agent use cases, and ERC-8004 feedback can make their performance **public, comparable, and composable** across catalogs and explorers.

Different trading agents may optimize for different objectives, for example:
- **Yield optimization on stablecoins** (lower volatility, tighter risk constraints)
- **More speculative strategies** (higher volatility, directional bets)
- **Portfolio management with defined risk profiles** (conservative/balanced/aggressive)

Independent rankers and analytics providers can track on-chain performance and publish standardized signals at different granularities (e.g., **daily / weekly / monthly / yearly**) using `tag1 = tradingYield` and `tag2` to encode the time window (`day`, `week`, `month`, `year`). This is a good fit for the table's example and keeps the dimension explicit and filterable.

Once published, any consumer can choose which rankers to trust (via `clientAddress`) and then aggregate/filter those signals to build leaderboards, strategy comparisons, alerts, and portfolio allocation tools - without data silos.

### Revenue Performance

Cumulative revenue since inception can be a crucial signal for clients: it helps them assess whether an agent is **battle-tested**, whether it is actually being used in production, and whether they should trust it enough to buy from it.

Revenue is **not directly computable on-chain** in a clean, universal way (smart contracts can't conveniently aggregate "all payments" from the full stream of chain activity and events).

Even for off-chain indexers, it's not straightforward to distinguish between **generic transfers** and **x402 payments** (or to reliably attribute transfers to completed service executions). In practice, this data is often best known by the **facilitator** (or by specialized infrastructure that can interpret the payment + service context).

ERC-8004 feedback makes it possible for those parties to publish standardized revenue signals (e.g., `tag1 = revenues`) on-chain. Each publisher can post the cumulative revenue value they observe for a given agent, making these data points **public** and available to the entire community - so catalogs, explorers, and other applications can filter/weight by trusted `clientAddress` and build consistent views without relying on a single proprietary dashboard.

More use cases coming soon!

## Expandability

For simplicity, the use cases on this page focus on signals that can be expressed with **on-chain fields only**. However, ERC-8004 is designed to be expandable: feedback can optionally include an **off-chain file URI** (for example an IPFS URI) containing richer context, plus a hash for integrity when applicable.
