# SATI Transaction Size Guide

Understanding Solana's transaction size constraints and how SATI optimizes for them.

---

## Solana Transaction Limits

| Limit | Value | Notes |
|-------|-------|-------|
| **Raw transaction size** | 1232 bytes | Hard limit, cannot be exceeded |
| **Base64 encoded size** | 1644 bytes | What RPC APIs report |
| **Signatures** | 64 bytes each | Typically 1 payer signature |
| **Message header** | 3 bytes | Compact header format |

The 1232-byte limit is the primary constraint for SATI attestations.

---

## Transaction Component Breakdown

### DualSignature Attestation (Feedback/Validation)

This is the most size-constrained transaction type due to the SIWS message.

| Component | Size (bytes) | Notes |
|-----------|--------------|-------|
| **Transaction header** | ~100 | Signatures, message header, blockhash |
| **Ed25519 instruction** | ~504 | See breakdown below |
| **CreateAttestation instruction** | ~180-250 | Depends on content size |
| **Account addresses** | ~50 (with ALT) | ~500 without ALT |
| **Agent ATA** | 32 | User-specific, never in global ALT |
| **Light Protocol proof** | ~300 | Validity proof for compressed account |
| **Total (typical)** | ~1180 | Leaves ~50-70 bytes for content |

### SingleSignature Attestation (ReputationScore)

| Component | Size (bytes) | Notes |
|-----------|--------------|-------|
| **Transaction header** | ~100 | Same as above |
| **Ed25519 instruction** | ~144 | Only interaction hash (32 bytes) |
| **CreateAttestation instruction** | ~180-250 | Same |
| **Account addresses** | ~50 (with ALT) | Same |
| **Agent ATA** | 32 | User-specific, never in global ALT |
| **Light Protocol proof** | ~300 | Same |
| **Total (typical)** | ~850 | More headroom (~240 bytes for content) |

---

## Ed25519 Instruction Size

The Ed25519 precompile instruction verifies signatures. Its size depends on the message being signed.

### Structure

```
Header (2 bytes):
  - num_signatures: u8
  - padding: u8

Per signature (14 bytes offset struct + payload):
  - signature_offset: u16
  - signature_instruction_index: u16
  - pubkey_offset: u16
  - pubkey_instruction_index: u16
  - message_offset: u16
  - message_size: u16
  - message_instruction_index: u16

Payload per signature:
  - pubkey: 32 bytes
  - signature: 64 bytes
  - message: variable
```

### DualSignature (2 signatures)

| Part | Size | Notes |
|------|------|-------|
| Header | 2 | num_signatures + padding |
| Offset structs | 28 | 14 bytes × 2 signatures |
| Agent pubkey | 32 | Ed25519 public key |
| Agent signature | 64 | Ed25519 signature |
| Agent message | 32 | `interaction_hash` (Keccak256) |
| Counterparty pubkey | 32 | Ed25519 public key |
| Counterparty signature | 64 | Ed25519 signature |
| Counterparty message | ~250 | SIWS message (variable) |
| **Total** | **~504** | |

### SingleSignature (1 signature)

| Part | Size | Notes |
|------|------|-------|
| Header | 2 | |
| Offset struct | 14 | |
| Pubkey | 32 | |
| Signature | 64 | |
| Message | 32 | `interaction_hash` |
| **Total** | **~144** | |

---

## SIWS Message Format

The counterparty signs a human-readable "Sign-In With Solana" style message:

```
SATI Feedback

Agent: 7HCCiuYUHptR1SXXHBRqkKUPb5G3hPvnKfy5v8n2cFmY
Task: 3Dq8YxkzJ2mVvJf5RzDqNPPq8TmDvU9YzKDsQfLPJYvN
Outcome: Positive
Details: (none)

Sign to create this attestation.
```

### SIWS Message Size Calculation

| Field | Size | Notes |
|-------|------|-------|
| Schema header | ~20 | "SATI Feedback\n\n" |
| Agent line | ~53 | "Agent: " + 44 (base58 pubkey) + "\n" |
| Task line | ~51 | "Task: " + 44 (base58 hash) + "\n" |
| Outcome line | ~18 | "Outcome: Positive\n" |
| Details line | ~17 | "Details: (none)\n" |
| Footer | ~35 | "\nSign to create this attestation." |
| **Total (no content)** | **~194** | Minimum SIWS message |
| **With content** | ~194 + N | N = content string length |

**Important**: The SIWS message includes the `Details` field which shows attestation content. Larger content = larger SIWS message = larger transaction.

---

## Address Lookup Tables (ALT)

ALTs are **required** for DualSignature attestations to fit within the transaction size limit.

### How ALTs Work

- Without ALT: Each account address = 32 bytes
- With ALT: Each account address = 1 byte (index into table)
- **Savings**: 31 bytes per address

### Required Addresses in ALT

A typical DualSignature attestation needs ~20 addresses:

| Category | Count | Without ALT | With ALT |
|----------|-------|-------------|----------|
| Light Protocol PDAs | 8 | 256 bytes | 8 bytes |
| SATI program + PDAs | 4 | 128 bytes | 4 bytes |
| Token-2022 + agent ATA | 2 | 64 bytes | 2 bytes |
| System programs | 4 | 128 bytes | 4 bytes |
| Schema config PDA | 1 | 32 bytes | 1 byte |
| **Total** | **~19** | **~608 bytes** | **~19 bytes** |

**Savings: ~589 bytes** — this is why ALTs are mandatory for DualSignature.

### What Must Be in the ALT

For transactions to work, these addresses **must** be in the lookup table:

1. **Schema Config PDA** — Derived from the SAS schema address
2. **Agent ATA** — The agent's Token-2022 associated token account
3. **Light Protocol PDAs** — State trees, nullifier queues, cpiSigner, etc.
4. **System Programs** — Ed25519, Token-2022, System Program, etc.

If any required address is missing, the transaction will exceed the size limit.

---

## Maximum Attestation Content Size

### Calculation

Starting from the 1232-byte limit:

```
Available for content = 1232 - fixed_overhead - variable_overhead

Fixed overhead (~882 bytes):
  - Transaction header: 100
  - Ed25519 base (without message): 254
  - CreateAttestation base: 100
  - Account addresses (with ALT): 50
  - Agent ATA (NEVER in ALT): 32       ← User-specific, unavoidable
  - Light Protocol proof: 300
  - Misc (blockhash, etc.): 46

Variable overhead:
  - SIWS message base: ~194 bytes
  - Content appears TWICE: in data blob AND in SIWS message
```

**Note**: The agent's ATA (Associated Token Account) is derived from the agent's mint and owner. Since every user has a unique agent, their ATA can never be in a global lookup table. This adds 32 bytes of unavoidable overhead to every transaction.

### Maximum Content by Mode

| Mode | SIWS Message | Max Content | Notes |
|------|--------------|-------------|-------|
| **DualSignature** | Yes (~194 + content) | **~75 bytes** | Content counted twice |
| **SingleSignature** | No | **~250 bytes** | More headroom |

### DualSignature Content Limit Derivation

```
1232 - 882 (fixed) = 350 bytes remaining

350 bytes must fit:
  - SIWS base message: 194 bytes
  - Content in SIWS: N bytes
  - Content in data blob: N bytes

350 = 194 + N + N
350 = 194 + 2N
2N = 156
N = 78 bytes

Safe maximum: ~75 bytes (with margin)
```

### SingleSignature Content Limit

```
1232 - 882 (fixed) = 350 bytes remaining
No SIWS message, so:
  - Content in data blob only: N bytes

Safe maximum: ~250 bytes (with margin for proof variance)
```

---

## Practical Recommendations

### For SDK Users

1. **Always use Address Lookup Tables** for DualSignature attestations
2. **Keep content under 70 bytes** for DualSignature mode (safe margin)
3. **Use ContentType.IPFS or ContentType.Arweave** for large content (store hash only)
4. **Pre-compute lookup table addresses** before transaction building

### SDK Constants and Validation

The SDK provides constants and validation functions to enforce content size limits:

```typescript
import {
  MAX_DUAL_SIGNATURE_CONTENT_SIZE,   // 70 bytes
  MAX_SINGLE_SIGNATURE_CONTENT_SIZE, // 240 bytes
  getMaxContentSize,
  validateContentSize,
  SignatureMode,
} from "@cascade-fyi/sati-sdk";

// Get max content size for a mode
const maxDual = getMaxContentSize(SignatureMode.DualSignature);   // 70
const maxSingle = getMaxContentSize(SignatureMode.SingleSigner);  // 240

// Validate content before building transaction
const content = new TextEncoder().encode('{"score":85}');

// Option 1: Throws on error (default)
validateContentSize(content, SignatureMode.DualSignature);

// Option 2: Returns result without throwing
const result = validateContentSize(content, SignatureMode.DualSignature, {
  throwOnError: false
});
if (!result.valid) {
  console.log(`Content too large: ${result.actualSize}/${result.maxSize} bytes`);
  console.log(result.error); // Includes suggestion to use IPFS/Arweave
}
```

**Note**: `createFeedback()`, `buildFeedbackTransaction()`, and `createValidation()` automatically validate content size and throw an error if the limit is exceeded.

### For Content Design

| Content Size | Recommendation |
|--------------|----------------|
| < 70 bytes | Store directly (JSON, UTF-8) for DualSignature |
| < 240 bytes | Store directly for SingleSignature |
| > 240 bytes | Must use IPFS/Arweave reference |

### Content Examples That Fit

**DualSignature (< 70 bytes):**
```json
{"score":85,"tags":["helpful"]}
```

**SingleSignature (< 240 bytes):**
```json
{"score":92,"methodology":"weighted_average","confidence":0.95,"factors":{"response_time":0.9,"accuracy":0.95,"satisfaction":0.91}}
```

---

## Troubleshooting

### "Transaction too large" Error

**Cause**: Transaction exceeds 1232 bytes

**Solutions**:
1. Ensure lookup table contains all required addresses
2. Reduce content size
3. Use IPFS/Arweave for content, store only the hash

### "Invalid lookup table index" Error

**Cause**: Transaction references an address by ALT index, but the address isn't in the table

**Solutions**:
1. Verify the lookup table contains the schema config PDA
2. Verify the lookup table contains the agent's ATA
3. Recreate lookup table with all required addresses

### Size Debugging

To debug transaction size, serialize and measure:

```typescript
const txBytes = transaction.serialize();
console.log(`Transaction size: ${txBytes.length} bytes`);
// Must be <= 1232
```

---

## References

- [Solana Transaction Size Limits](https://solana.com/docs/core/transactions#transaction-size)
- [Address Lookup Tables](https://solana.com/docs/advanced/lookup-tables)
- [Ed25519 Instruction Format](https://docs.solanalabs.com/runtime/programs#ed25519-program)
- [SATI Specification](./specification.md)
