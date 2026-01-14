---
title: Delegation
description: Hot/cold wallet separation with DelegateV1 attestations
---

# Delegation

SATI supports hot/cold wallet separation through delegation attestations. This allows:

- **Cold wallet** (agent owner): Holds the NFT, creates delegations
- **Hot wallet** (delegate): Signs attestations on behalf of the agent

## Why Delegation?

| Without Delegation | With Delegation |
|-------------------|-----------------|
| Private key on server | Private key in cold storage |
| Single point of failure | Compromised hot wallet = revoke & redeploy |
| No key rotation | Rotate hot wallets freely |

## Creating a Delegation

Only the agent owner can create delegations:

```typescript
const delegation = await sati.createDelegation({
  payer: ownerKeypair,  // Must be agent owner
  agentMint: myAgent,
  delegate: hotWalletPubkey,
  expiry: Math.floor(Date.now() / 1000) + 86400 * 30,  // 30 days
})

console.log(`Delegation created: ${delegation.attestationPda}`)
```

**Cost**: ~0.002 SOL (reclaimable on revocation)

## Delegation Fields

| Field | Type | Description |
|-------|------|-------------|
| `token_account` | Pubkey | Agent's ATA (identifies the agent) |
| `counterparty` | Pubkey | Delegate's public key |
| `data_hash` | Pubkey | Owner at delegation time (for binding) |
| `expiry` | i64 | Unix timestamp expiration |

## Using a Delegation

Delegates can sign attestations on behalf of the agent:

```typescript
// Hot wallet signs feedback for agent it's delegated to
const feedback = await sati.giveFeedback({
  payer: hotWalletKeypair,
  agentMint: agentMint,
  score: 100,
  taskRef: paymentTx,
  // Delegate signs instead of owner
  signer: hotWalletKeypair,
  delegationAttestation: delegationPda,  // Proves authorization
  counterpartySignature: clientSig,
  counterpartyPubkey: clientPubkey,
})
```

The program verifies:
1. Delegation attestation exists
2. Delegate matches signer
3. Agent mint matches target
4. Owner hasn't changed (NFT not transferred)
5. Delegation hasn't expired

## Revoking a Delegation

Owner can revoke at any time:

```typescript
await sati.revokeDelegation({
  payer: ownerKeypair,
  delegationPda: delegationAttestation,
})
```

**Cost**: Transaction fee only (~0.000005 SOL). Rent (~0.002 SOL) returned.

## Querying Delegations

### For an Agent

```typescript
const delegations = await sati.getDelegationsForAgent(agentMint)

for (const d of delegations) {
  console.log(`Delegate: ${d.delegate}`)
  console.log(`Expires: ${new Date(d.expiry * 1000)}`)
}
```

### For a Delegate

```typescript
// Find all agents this wallet can sign for
const delegations = await sati.getDelegationsByDelegate(hotWalletPubkey)

for (const d of delegations) {
  console.log(`Agent: ${d.agentMint}`)
}
```

### Verify Delegation

```typescript
const isValid = await sati.verifyDelegation(
  hotWalletPubkey,
  agentMint
)

if (isValid) {
  console.log('Delegation is active')
} else {
  console.log('No valid delegation')
}
```

## Delegation Expiry

Delegations have built-in expiration:

```typescript
// Short-lived delegation (24 hours)
const shortDelegation = await sati.createDelegation({
  // ...
  expiry: Math.floor(Date.now() / 1000) + 86400,
})

// Long-lived delegation (1 year)
const longDelegation = await sati.createDelegation({
  // ...
  expiry: Math.floor(Date.now() / 1000) + 86400 * 365,
})

// No expiry (use max timestamp)
const permanentDelegation = await sati.createDelegation({
  // ...
  expiry: 9999999999,  // Year 2286
})
```

## Security Model

### Owner Binding

The delegation stores the owner at creation time:

```
data_hash = owner_pubkey
```

If the agent NFT is transferred, existing delegations become invalid because the new owner didn't create them.

### Delegation Schema

DelegateV1 uses `AgentOwnerSigned` mode:
- Only agent owner can create delegations
- Only agent owner can revoke delegations
- Prevents delegates from delegating further

### Best Practices

1. **Short expiry**: Use minimal necessary duration
2. **Separate hot wallets**: One per service/server
3. **Monitor usage**: Track delegation usage patterns
4. **Quick revocation**: Have revocation scripts ready

## Example: Facilitator Setup

```typescript
// Setup: Create delegation for facilitator hot wallet
const facilDelegation = await sati.createDelegation({
  payer: ownerColdWallet,
  agentMint: myAgent,
  delegate: facilitatorHotWallet,
  expiry: Math.floor(Date.now() / 1000) + 86400 * 7,  // 1 week
})

// Runtime: Facilitator submits feedback using delegation
const feedback = await sati.giveFeedback({
  payer: facilitatorHotWallet,
  agentMint: myAgent,
  signer: facilitatorHotWallet,
  delegationAttestation: facilDelegation.attestationPda,
  // ... other fields
})

// Maintenance: Rotate delegation weekly
await sati.revokeDelegation({
  payer: ownerColdWallet,
  delegationPda: facilDelegation.attestationPda,
})

const newDelegation = await sati.createDelegation({
  payer: ownerColdWallet,
  agentMint: myAgent,
  delegate: newFacilitatorHotWallet,
  expiry: Math.floor(Date.now() / 1000) + 86400 * 7,
})
```
