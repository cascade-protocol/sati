---
title: x402 Payment Feedback
description: Link feedback directly to x402 payment transactions
---

# x402 Payment Feedback

::: warning Coming Soon
This guide is under active development. SATI is designed as the feedback extension for [x402](https://x402.org) payments (see [PR #1024](https://github.com/coinbase/x402/pull/1024)), but the end-to-end integration guide is not yet ready.
:::

## What This Will Cover

- Linking feedback attestations to x402 payment transaction hashes
- The payment-as-taskRef model: the payment tx becomes the deterministic reference for feedback
- Who pays for on-chain submission (agent pays for positive, client pays for negative)
- Integrating SATI feedback into x402 seller and buyer flows

## In the Meantime

- Read [How It Works](/how-it-works) to understand blind feedback and proof of participation
- See the [Agent Marketplace](/guides/agent-marketplace) guide for the general feedback flow
- Check the [sati-agent0-sdk reference](/reference/sati-agent0-sdk) for `giveFeedback` and `prepareFeedback` API details
- Follow progress on [GitHub](https://github.com/cascade-protocol/sati)
