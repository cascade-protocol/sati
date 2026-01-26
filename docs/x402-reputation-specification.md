# x402 Reputation Extension Specification v1.0

**Status:** Draft
**Version:** 1.0.0
**Date:** January 2026
**License:** Apache 2.0

---

## Abstract

This specification defines the `reputation` extension for x402 protocol, enabling agents to declare their on-chain reputation identities and provide cryptographic signatures as proof of service completion. The extension facilitates verifiable feedback submission by linking payment transactions to reputation records across multiple blockchain networks.

---

## Table of Contents

1. [Core Requirements](#1-core-requirements)
2. [Introduction](#2-introduction)
3. [Extension Structure](#3-extension-structure)
4. [Message Flow](#4-message-flow)
5. [Signature Protocol](#5-signature-protocol)
6. [Feedback Structure](#6-feedback-structure)
7. [Registration File](#7-registration-file)
8. [Security](#8-security)
9. [References](#9-references)

---

## 1. Core Requirements

**This section summarizes the essential MUST/SHOULD requirements. Read these first; skip to Section 2 for details.**

### 1.1 Agent Requirements

**Identity Declaration (402 Response):**
- MUST include `reputation` extension in 402 response
- MUST declare at least one registration with `agentRegistry`, `agentId`, `reputationRegistry`
- MAY declare multiple registrations for multi-chain support
- MAY include `backend` hint ("sati" or "erc8004") for client convenience
- MAY include `endpoint` (agent's service URL)

**Signature (PAYMENT-RESPONSE):**
- MUST sign WITH every response (blind commitment)
- MUST sign BEFORE sending response (BEFORE knowing client feedback)
- MUST use format: `interactionHash = keccak256(UTF8(taskRef) || UTF8(requestBody) || UTF8(responseBody))`
- MUST include `InteractionData` with `taskRef`, `interactionHash`, `agentSignature`, `timestamp`
- Note: Only HTTP bodies are hashed, not headers/status codes

**Signature Algorithm:**
- Single-chain: MUST use native algorithm (Ed25519 for Solana, secp256k1 for EVM)
- Multi-chain: SHOULD use secp256k1 for all networks (simplifies key management)

### 1.2 Client Requirements

**Verification:**
- MUST fetch agent's registration file from on-chain URI
- MUST verify `agentSignature` against authorized signers in registration file
- MUST check signer validity period (`validFrom` to `validUntil`)
- MUST verify `taskRef` matches actual payment transaction
- MUST verify `networkId` matches chosen payment network

**Feedback (Optional):**
- If submitting feedback, MUST include 4 x402 fields in feedbackURI: `taskRef`, `interactionHash`, `agentSignature`, `clientSignature`
- MUST include `value` and `valueDecimals` (ERC-8004 January 2026 requirement)
- Client signature: `keccak256(UTF8(agentRegistry) || UTF8(agentId) || UTF8(taskRef) || uint8(value))`
- feedbackHash: `keccak256(JSON.stringify(feedbackURIContent))`

### 1.3 Network Coupling

**Rule:** Payment network determines reputation backend automatically. The network is embedded in the CAIP-10 `agentRegistry` format.

| Payment Network | Reputation Backend | agentRegistry Format (CAIP-10) |
|-----------------|-------------------|------------------------------|
| Solana mainnet | SATI | `solana:5eykt4...:satiRkx...` |
| Base | ERC-8004 | `eip155:8453:0x8004A818...` |
| Ethereum | ERC-8004 | `eip155:1:0x...` |

Clients extract the network from the CAIP-10 `agentRegistry` prefix (e.g., `solana:5eykt4...` or `eip155:8453`).

---

## 2. Introduction

### 2.1 Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" are per [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

- **Agent**: Service provider (seller)
- **Client**: Service consumer (buyer)
- **Backend**: On-chain reputation system (ERC-8004, SATI)
- **Registry**: Smart contract storing agent identities
- **Registration File**: Off-chain JSON with agent metadata and authorized signers

### 2.2 Design Principles

- **Uniform protocol**: Concrete signature and feedback formats across all backends
- **Multi-chain native**: Single agent can operate on multiple networks
- **Network coupling**: Payment network determines reputation backend
- **Blind commitment**: Agents sign every response before knowing feedback outcome

---

## 3. Extension Structure

### 3.1 ReputationInfo (in 402 Response)

```typescript
interface ReputationInfo {
  version: string;                     // "1.0.0"
  registrations: AgentRegistration[];  // At least one registration (follows ERC-8004 terminology)
  endpoint?: string;                   // Optional: Agent's service endpoint URL
  feedbackAggregator?: string;         // Optional: Third-party endpoint for feedback submission
}

interface AgentRegistration {
  agentRegistry: string;           // CAIP-10: Identity Registry ("eip155:8453:0x8004A818..." or "solana:5eykt4...:satiRkx...")
  agentId: string;                 // tokenId (EVM) or Mint address (Solana)
  reputationRegistry: string;      // CAIP-10: Reputation Registry (may be same as agentRegistry for SATI)
  backend?: string;                // Optional hint: "erc8004" or "sati"
}
```

**Note:** Field naming follows ERC-8004 terminology (`registrations`, not `identities`) for consistency.

**Note on ERC-8004's Two-Registry Model:**

ERC-8004 separates identity and reputation into two contracts:
- **Identity Registry** (ERC-721): Stores agent NFTs, tokenURI, agentWallet metadata
- **Reputation Registry**: Stores feedback, references Identity Registry via `getIdentityRegistry()`

For SATI on Solana, both registries may be the same program address. The structure accommodates both architectures.

**endpoint (Optional):**

The agent's service endpoint URL. This allows clients to discover the agent's API location. Example: `"https://agent.example.com/api/generate"`

**feedbackAggregator (Optional):**

If provided, this is a third-party endpoint where clients can POST feedback for batch submission:

- **Purpose**: Aggregator pays gas fees on behalf of clients
- **Flow**: Client POSTs feedbackURI JSON → Aggregator batches multiple feedbacks → Submits to on-chain registry
- **Benefit**: Clients don't need native tokens (ETH/SOL) to pay gas

Example: An agent or third-party service runs a feedback aggregator at `https://feedback.example/submit` that accepts feedback submissions and batches them for cost efficiency.

### 3.2 InteractionData (in PAYMENT-RESPONSE)

```typescript
interface InteractionData {
  networkId: string;         // CAIP-2: payment network (convenience field, embedded in taskRef)
  agentId: string;           // Agent identifier on this network (convenience field)
  taskRef: string;           // CAIP-220: "solana:5eykt4...:5A2CSREG..." or "eip155:8453:0xec2fff..."
  interactionHash: string;   // Hex: keccak256(taskRef || requestBody || responseBody)
  agentSignature: string;    // Hex: signature bytes (algorithm in registration file)
  timestamp: number;         // Unix timestamp (metadata, NOT part of signed message)
}
```

**Note on networkId/agentId:** These fields are provided for convenience so clients can identify the agent identity without parsing `taskRef`. The network is already embedded in the CAIP-220 `taskRef` format.

**Note on timestamp:** The timestamp is metadata indicating when the signature was created. It is NOT included in the signed message (only `taskRef`, `requestBody`, `responseBody` are hashed).

### 3.3 Client Identity (Optional - for Bidirectional Rating)

If the client is also a registered agent, they MAY declare their identity in the payment request to enable bidirectional rating:

```typescript
// In x402 PaymentPayload extensions
interface ClientIdentity {
  clientAgentRegistry: string;     // CAIP-10: Client's Identity Registry
  clientAgentId: string;           // Client's agent identifier
}
```

**Usage:**

When a client who is also a registered agent makes a payment, they can include their identity so the server can optionally rate them back:

```json
{
  "x402PaymentPayload": { /* standard fields */ },
  "extensions": {
    "reputation": {
      "clientAgentRegistry": "eip155:8453:0x8004A818...",
      "clientAgentId": "99"
    }
  }
}
```

Per ERC-8004 spec (line 229), when submitting feedback where the client is an agent, use their on-chain `agentWallet` as the `clientAddress` to facilitate reputation aggregation.

---

## 4. Message Flow

### 4.1 Complete Flow

```
1. Client → Agent: GET /resource
2. Agent → Client: 402 Payment Required + reputation extension (declares identities)
3. Client: (Optional) Verifies payTo address matches on-chain agentWallet
4. Client → Agent: GET /resource + PAYMENT-SIGNATURE (pays on chosen network)
5. Agent: Performs work + computes interactionHash + signs
6. Agent → Client: 200 OK + PAYMENT-RESPONSE (includes InteractionData with signature)
7. Client: Verifies signature against registration file
8. Client: (Optional) Submits feedback to reputation registry
```

**Payment Address Verification (Step 3):**

Clients SHOULD verify the `payTo` address in the 402 response matches the on-chain verified `agentWallet` before sending payment:

- **ERC-8004**: Check `endpoints` array in registration file for `agentWallet` entry (e.g., `"endpoint": "eip155:8453:0x742d35..."`)
- **SATI**: Query on-chain agent metadata for wallet address

This prevents payment fraud where a compromised agent server advertises a different payment address than the registered on-chain identity.

### 4.2 Wire Format Example

**402 Response:**

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "AgentWallet...",
      "maxAmountRequired": "1000"
    }
  ],
  "extensions": {
    "reputation": {
      "info": {
        "version": "1.0.0",
        "registrations": [{
          "agentRegistry": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe",
          "agentId": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
          "reputationRegistry": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe",
          "backend": "sati"
        }],
        "endpoint": "https://agent.example/weather"
      },
      "schema": { /* JSON Schema */ }
    }
  }
}
```

**PAYMENT-RESPONSE (decoded):**

```json
{
  "settlementResponse": {
    "success": true,
    "txHash": "5A2CSREGntKZu8f2...",
    "networkId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
  },
  "extensions": {
    "reputation": {
      "networkId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "agentId": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "taskRef": "solana:5eykt4...:5A2CSREGntKZu8f2...",
      "interactionHash": "0x123abc456def...",
      "agentSignature": "a1b2c3d4e5f6...",
      "timestamp": 1737763200
    }
  }
}
```

---

## 5. Signature Protocol

### 5.1 Interaction Hash (Uniform Format)

```
interactionHash = keccak256(UTF8(taskRef) || UTF8(requestBody) || UTF8(responseBody))
```

**Components:**
- `taskRef`: CAIP-220 payment transaction reference
- `requestBody`: UTF-8 encoded HTTP request body (the POST/GET body sent by client, empty string if no body)
- `responseBody`: UTF-8 encoded HTTP response body (the 200 response body from agent)

**Rationale:** Using only HTTP bodies (not headers/status codes) ensures deterministic serialization. Both parties can reconstruct the exact hash without ambiguity about which headers to include or how to serialize them.

### 5.2 Signature Timing

Agents MUST:
- Compute `interactionHash` AFTER completing service
- Sign `interactionHash` BEFORE sending response to client
- Include signature WITH every PAYMENT-RESPONSE (blind commitment)

This ensures agents cannot selectively provide signatures only for favorable interactions.

### 5.3 Signature Algorithms

**Single-Chain Agents:**

| Network | Algorithm | Curve | Length |
|---------|-----------|-------|--------|
| Solana | Ed25519 | Curve25519 | 64 bytes |
| EVM | ECDSA | secp256k1 | 64 bytes (r+s) |

**Multi-Chain Agents (Recommended):**
- Use secp256k1 for ALL networks
- Simplifies key management (one keypair for all chains)
- EVM: Native support
- Solana/SATI: Signature stored for future verification

### 5.4 Verification (Client)

```typescript
// 1. Fetch registration file
const uri = await registry.tokenURI(agentId);
const registrationFile = await fetch(uri).then(r => r.json());

// 2. Find matching registration
const reg = registrationFile.registrations.find(
  r => r.agentRegistry === expectedRegistry && r.agentId === expectedAgentId
);

if (!reg) {
  throw new Error('Agent not registered on this network');
}

// 3. Get valid signers from TOP-LEVEL signers array
// Note: signers array is top-level (not per-registration) per Section 7.2
// Multi-chain agents use the same signing keys across all registrations
const now = Math.floor(Date.now() / 1000);
const validSigners = registrationFile.signers.filter(s =>
  s.validFrom <= now && (s.validUntil === null || s.validUntil > now)
);

if (validSigners.length === 0) {
  throw new Error('No valid signers found');
}

// 4. Verify signature
const isValid = validSigners.some(signer =>
  verifySignature({
    message: interactionData.interactionHash,
    signature: interactionData.agentSignature,
    publicKey: signer.publicKey,
    algorithm: signer.algorithm
  })
);

// 5. Additional checks
assert(taskRef === paymentTx, "taskRef must match payment");
assert(networkId === chosenNetwork, "network must match payment");
// Recompute interactionHash and verify it matches
```

---

## 6. Feedback Structure

### 6.1 feedbackURI JSON

Feedback submissions MUST include a `feedbackURI` pointing to JSON with this structure:

```json
{
  // ERC-8004 required fields
  "agentRegistry": "solana:5eykt4...:satiRkx...",
  "agentId": "7xKXtg2CW87...",
  "clientAddress": "solana:5eykt4...:ClientWallet...",
  "createdAt": "2026-01-26T12:00:00Z",
  "value": 95,
  "valueDecimals": 0,

  // x402 reputation fields (REQUIRED)
  "taskRef": "solana:5eykt4...:5A2CSREG...",
  "interactionHash": "0x123abc456def...",
  "agentSignature": "a1b2c3d4e5f6...",
  "clientSignature": "fedcba987654...",

  // Optional
  "tags": ["proof-of-participation", "x402-resource-delivered"],
  "comment": "Excellent service"
}
```

**Note on value/valueDecimals:** ERC-8004 January 2026 update requires both fields for decimal/negative number support. Examples: `{"value": 95, "valueDecimals": 0}` = 95, `{"value": 950, "valueDecimals": 1}` = 95.0, `{"value": -10, "valueDecimals": 0}` = -10.

### 6.2 Client Signature

```
clientMessage = keccak256(UTF8(agentRegistry) || UTF8(agentId) || UTF8(taskRef) || uint8(value))
clientSignature = sign(clientMessage, clientPrivateKey)
```

**Why different from agent signature?**

- **Agent signature** (Section 5.1): Signs `interactionHash` to prove service was rendered (blind commitment before knowing feedback)
- **Client signature** (this section): Signs feedback content (`agentRegistry`, `agentId`, `taskRef`, `value`) to prove authenticity of the review

This dual-signature model ensures:
1. Agents cannot selectively provide signatures only for favorable interactions
2. Clients cannot reuse an agent's signature with a different rating
3. Both parties cryptographically attest to their respective claims

### 6.3 Tag Conventions

**ERC-8004 Two-Tag Model:**

ERC-8004 uses two tags per feedback:
- **tag1**: What is being measured (dimension)
- **tag2**: Qualifier or proof level

**x402-specific tag pairs:**

| tag1 (dimension) | tag2 (qualifier) | Meaning |
|------------------|------------------|---------|
| `x402-resource-delivered` | `proof-of-participation` | Resource delivered with agent signature |
| `x402-resource-missing` | `proof-of-participation` | Agent signed but failed to deliver |
| `x402-response-delayed` | `proof-of-participation` | Exceeded timeout but eventually delivered |
| `x402-payment-amount` | `mismatch` | Agent requested different amount than declared |

**ERC-8004 standard tag examples:**
- `starred` / `5` (5-star rating)
- `uptime` / `high` (availability measurement)
- `successRate` / `95` (success percentage)
- `response-time` / `fast` (performance metric)

Use kebab-case for all tags. Combine x402 tags with standard tags for rich context.

### 6.4 Backend Submission

**feedbackHash Computation:**

```
feedbackHash = keccak256(JSON.stringify(feedbackURIContent))
```

The `feedbackHash` is a commitment to the feedback content, computed by hashing the JSON string of the feedbackURI document.

**ERC-8004 Submission Example:**

```solidity
// 1. Upload feedbackURI JSON to IPFS or HTTPS
const feedbackURIContent = { /* JSON from Section 6.1 */ };
const feedbackURI = "ipfs://QmX...";  // or https://...
const feedbackHash = keccak256(JSON.stringify(feedbackURIContent));

// 2. Call ERC-8004 registry
registry.giveFeedback(
  agentId: "42",
  value: 95,
  valueDecimals: 0,
  tag1: "x402-resource-delivered",
  tag2: "proof-of-participation",
  endpoint: "https://agent.example/weather",  // optional
  feedbackURI: feedbackURI,
  feedbackHash: feedbackHash
);
```

**SATI Submission Example:**

```typescript
// Use FeedbackPublicV1 schema for open feedback without agent authorization
const feedbackAccount = await satiClient.createFeedback({
  agentId: "7xKXtg2CW87...",
  clientAddress: "ClientWallet...",
  taskRef: "solana:5eykt4...:5A2CSREG...",
  value: 95,
  valueDecimals: 0,
  tags: ["x402-resource-delivered", "proof-of-participation"],
  feedbackURI: "ipfs://QmX...",
  agentSignature: "a1b2c3d4e5f6...",  // from PAYMENT-RESPONSE
  clientSignature: "fedcba987654...",
  interactionHash: "0x123abc456def..."
});
```

---

## 7. Registration File

### 7.1 URI Storage

- **SATI**: `TokenMetadata.uri` in Token-2022 NFT
- **ERC-8004**: `tokenURI(agentId)` in ERC-721 contract

### 7.2 Schema

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Agent Name",
  "description": "Agent description",
  "image": "https://...",

  "registrations": [
    {
      "agentId": "7xKXtg2CW87...",
      "agentRegistry": "solana:5eykt4...:satiRkx..."
    },
    {
      "agentId": "42",
      "agentRegistry": "eip155:8453:0x8004A818..."
    }
  ],

  "signers": [
    {
      "publicKey": "a1b2c3d4...",       // Hex-encoded (no 0x prefix)
      "algorithm": "ed25519",           // or "secp256k1"
      "role": "owner",                  // or "delegate"
      "validFrom": 1737763200,          // Unix timestamp
      "validUntil": null,               // null = no expiry
      "comment": "Hot wallet for Solana signing"
    },
    {
      "publicKey": "04abc123def456...",
      "algorithm": "secp256k1",
      "role": "owner",
      "validFrom": 1737763200,
      "validUntil": null,
      "comment": "Signing key for EVM chains"
    }
  ]
}
```

**Important:** Per ERC-8004 line 123, "all fields in the registration are mandatory" - the `registrations` array MUST contain ONLY `agentId` and `agentRegistry`. The `signers` array is a **top-level field** added by the x402-reputation extension, not inside the `registrations` array.

**Note on agentWallet vs signers:**

ERC-8004 defines `agentWallet` as the on-chain verified payment address (where the agent receives payments). This is separate from the `signers` array:

- **agentWallet** (ERC-8004 metadata): Payment address, set on-chain with EIP-712 signature
- **signers** (x402-reputation): Keys for signing responses, stored in registration file

**Separation of concerns:**
- Payment security: agentWallet must be secure cold wallet
- Operational signing: signers can be hot wallets for automated response signing
- Multi-chain: Single agent may have different payment addresses per chain but unified signing keys

Clients SHOULD verify the `payTo` address in 402 responses matches the on-chain `agentWallet` before sending payment (see Section 4.1).

### 7.3 Key Rotation

1. Update registration file with new signer (or set `validUntil` on old key)
2. Re-upload to IPFS or update HTTPS file
3. Call on-chain: `setAgentURI(agentId, newUri)` (emits `URIUpdated` event)
4. **Grace period**: Overlap old/new keys by 24 hours to prevent verification failures

---

## 8. Security

### 8.1 Critical Requirements

- ✅ Always verify signatures cryptographically before trusting data
- ✅ Fetch registration file from on-chain URI (never trust x402 headers alone)
- ✅ Check signer validity period (`validFrom` to `validUntil`)
- ✅ Verify `taskRef` matches actual payment transaction
- ✅ Use IPFS CID verification or HTTPS for registration file integrity

### 8.2 Timestamp Validation

- MAY validate `timestamp` field with ±300 second tolerance
- Do NOT reject based solely on timestamp (clock skew between systems)

### 8.3 Key Compromise

If a signing key is compromised:
1. Immediately update registration file to set `validUntil` = current timestamp
2. Create new signing key with fresh `validFrom`
3. Update on-chain URI
4. Note: Past signatures remain valid (cannot retroactively invalidate)

### 8.4 Replay Protection

- Agents SHOULD ensure `taskRef` values are unique per interaction
- Clients SHOULD verify `taskRef` matches their payment transaction
- Backends MAY implement additional replay protection (e.g., SATI uses deterministic PDA derivation)

---

## 9. References

- [x402 Protocol](https://github.com/coinbase/x402)
- [CAIP-2: Chain ID](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-2.md)
- [CAIP-10: Account ID](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-10.md)
- [CAIP-220: Transaction Hash](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-220.md)
- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [SATI Specification](https://github.com/cascade-fyi/sati/blob/main/docs/specification.md)
- [RFC 2119: Key words](https://www.rfc-editor.org/rfc/rfc2119)

---

## Changelog

### Version 1.0.0 (January 2026)

**Core Protocol:**
- **Uniform signature format**: `keccak256(taskRef || requestBody || responseBody)` - only HTTP bodies, no headers
- **Required signature timing**: Agents MUST sign WITH every response (blind commitment)
- **Simplified InteractionData**: Flat structure with `interactionHash` and `agentSignature`
- **Dual-signature model**: Agent signs interaction, client signs feedback

**ERC-8004 Alignment:**
- **Strict registrations array compliance**: ONLY `agentId` and `agentRegistry` per ERC-8004 line 123
- **Signers as top-level field**: Moved outside `registrations` array (x402-reputation extension to registration file)
- **Consistent terminology**: Use `registrations` (not `identities`) throughout
- **Simplified AgentRegistration**: Use `agentRegistry` (CAIP-10) instead of splitting network/registry
- **Two-registry model**: Separate `agentRegistry` (identity) and `reputationRegistry` (feedback)
- **agentWallet separation**: Payment address distinct from signing keys
- **valueDecimals support**: January 2026 ERC-8004 update for decimal/negative values
- **Two-tag model**: tag1 (dimension) and tag2 (qualifier)

**Feedback Structure:**
- **Defined feedbackURI**: ERC-8004 baseline + 4 x402 fields (taskRef, interactionHash, agentSignature, clientSignature)
- **feedbackHash**: `keccak256(JSON.stringify(feedbackURIContent))`
- **Backend submission examples**: ERC-8004 `giveFeedback()` and SATI `FeedbackPublicV1`

**Additional Features:**
- Optional `endpoint` field (agent's service URL for discovery)
- Optional client identity for bidirectional rating
- Optional `feedbackAggregator` endpoint (gas-free submission)
- Payment address verification guidance
- Multi-chain identity support with secp256k1 recommendation
- Registration file with authorized signers (hot/cold wallet separation)

---

**End of Specification**
