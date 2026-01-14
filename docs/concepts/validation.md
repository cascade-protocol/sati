---
title: Validation
description: Understanding ERC-8004 Validations and how they enable quality gates for AI agent actions
---

# Validation

SATI's ValidationV1 schema implements the validation pattern defined in [ERC-8004 (Trustless Agents)](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098). This page explains what validations are for and how they work.

## Core Purpose

From the ERC-8004 specification:

> "This registry enables agents to request verification of their work and allows validator smart contracts to provide responses that can be tracked on-chain."

::: info Key Insight
The Validation Registry was designed to **log/audit that validation was successful**, while the actual validation mechanisms happen somewhere else (TEE, zkML, consensus, etc.).
:::

## Primary Use Cases

### 1. Escrow Release

The most discussed use case in ERC-8004:

```
Alice wants work done → Deposits escrow
Bob (agent) does work → Requests validation
Validator confirms quality → ValidationResponse(score=100)
Smart contract reads validation → Releases escrow to Bob
```

This creates trustless payment flows where funds are only released after verified completion.

### 2. Work Verification Methods

Validators can use various mechanisms to verify agent work:

| Method | Description |
|--------|-------------|
| **Stake-secured re-execution** | Validators re-run the job and compare results |
| **zkML verifiers** | Cryptographic proofs of ML inference |
| **TEE oracles** | Trusted Execution Environment attestations |
| **Consensus** | Multiple validators must agree |
| **Trusted judges** | Human or DAO voting |

### 3. Workflow Gating

Enable complex workflows where tasks only execute if prerequisite tasks were validated:

```
Task A → Validation → Task B → Validation → Task C
```

Each step only proceeds if the previous validation passed with sufficient certainty.

### 4. Quality Gate Before Action

Validate agent decisions **before** executing them on-chain. This is the pattern for trading agents:

```
Agent makes prediction → Validator validates → Trade executes (if passed)
```

## ERC-8004 Flow Mapping

The ERC-8004 validation pattern maps directly to SATI's ValidationV1 schema:

| ERC-8004 Pattern | SATI Implementation |
|------------------|---------------------|
| Agent does work | Agent makes prediction/decision |
| Requests validation | Submits to validator |
| Validator evaluates | Validator checks params |
| ValidationResponse | ValidationV1 attestation |
| Escrow releases | Action executes |

## ValidationV1 Schema

SATI implements validation through the ValidationV1 schema:

```
┌─────────────────────────────────────────────────────────────┐
│                    ValidationV1 Layout                       │
├─────────────────────────────────────────────────────────────┤
│ task_ref: [u8; 32]      - Reference to validated work       │
│ agent_mint: [u8; 32]    - Agent being validated             │
│ counterparty: [u8; 32]  - Validator pubkey                  │
│ outcome: u8             - 0=Fail, 1=Inconclusive, 2=Pass    │
│ data_hash: [u8; 32]     - Hash of validation data           │
│ content_type: u8        - Content encoding                  │
│ content: Vec<u8>        - Validation details                │
└─────────────────────────────────────────────────────────────┘
```

### Outcome Values

| Value | Meaning | Action |
|-------|---------|--------|
| 0 | Fail | Block action |
| 1 | Inconclusive | Manual review required |
| 2 | Pass | Proceed with action |

### Signature Mode

ValidationV1 uses **DualSignature** mode:
- Agent signs the interaction hash (commits to the work)
- Validator signs the validation result

This creates a complete audit trail where both parties have committed to the interaction.

## Example: Trading Agent

A trading agent using SATI validation:

```typescript
// 1. Agent analyzes market and makes prediction
const prediction = await agent.analyzePredictionMarket(marketId)

// 2. Agent signs blind commitment (before knowing if correct)
const agentSig = await agent.signInteraction({
  schema: VALIDATION_SCHEMA,
  taskRef: `kalshi:${marketId}:${timestamp}`,
  dataHash: keccak256(prediction),
})

// 3. Validator checks prediction quality
const validationResult = await validator.validate({
  prediction,
  marketData,
  riskParams,
})

// 4. Only execute trade if validation passed
if (validationResult.outcome === 2) { // Pass
  await executeTrade(prediction)
}
```

## Validator Types

Different validators serve different purposes:

| Validator Type | Best For | Trust Model |
|----------------|----------|-------------|
| **AI Consensus** | Multi-model agreement | Decentralized |
| **Risk Engines** | Financial decisions | Specialized |
| **TEE Oracles** | Sensitive computations | Hardware-backed |
| **Human Judges** | Subjective quality | Social |
| **Re-execution** | Deterministic tasks | Cryptographic |

## Integration with x402

When integrated with the x402 payment protocol:

1. Client pays for AI service (x402)
2. Agent responds with signed commitment
3. Payment tx hash becomes `task_ref` (CAIP-220)
4. Facilitator can batch validation attestations
5. Validation determines settlement/action

This makes validation a natural part of the payment flow.

## Further Reading

- [ERC-8004 Trustless Agents](https://ethereum-magicians.org/t/erc-8004-trustless-agents/25098) - Original specification
- [SATI Specification](/specification) - Full technical specification
- [Feedback & Reputation](/guide/feedback) - Related feedback patterns
