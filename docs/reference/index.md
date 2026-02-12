---
title: API Reference
description: SDK reference documentation for SATI
---

# API Reference

SATI provides two SDK packages at different abstraction levels.

## [@cascade-fyi/sati-sdk](/reference/sati-sdk)

Full-featured SDK for SATI on Solana. Agent registration, feedback, search, reputation, and low-level attestation access. **Start here** for Solana-native development.

```bash
pnpm add @cascade-fyi/sati-sdk
```

## [@cascade-fyi/sati-agent0-sdk](/reference/sati-agent0-sdk)

Thin adapter that wraps sati-sdk with [agent0-sdk](https://www.npmjs.com/package/agent0-sdk) types (AgentId, Feedback, AgentSummary, etc.). Use this if your codebase already depends on agent0-sdk or you need ERC-8004 type compatibility.

```bash
pnpm add @cascade-fyi/sati-agent0-sdk
```
