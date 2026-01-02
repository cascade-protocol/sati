# Deferred Test Implementation Plan

This document tracks test improvements that were identified during the senior-level test suite assessment but deferred for later implementation.

## P0 - Critical (Deferred)

### 1. Convert close_compressed.rs Stubs to Real Integration Tests

**Location:** `programs/sati/tests/attestation/close_compressed.rs`

**Current State:** 5 stub tests (lines 64-242) set up test data and print messages but never execute transactions. Tests verify setup assertions but never call `svm.send_transaction()`.

**Required Tests:**
- `test_close_attestation_counterparty_success` - Full integration with Light Protocol
- `test_close_attestation_agent_via_ata_success` - Agent owner closes via ATA verification
- `test_close_attestation_single_signer_only_provider` - Only counterparty can close in SingleSigner mode
- `test_close_attestation_third_party_rejection` - Random party cannot close
- `test_close_attestation_non_closeable_schema` - Schema with closeable=false rejects close

**Blocker:** Requires Light Protocol localnet infrastructure with prover running.

---

### 2. Add create_regular_attestation Tests

**Location:** New file `programs/sati/tests/attestation/create_regular.rs`

**Current State:** Zero test coverage for `programs/sati/src/instructions/attestation/create_regular_attestation.rs`

**Required Tests:**
- `test_create_regular_attestation_success` - Happy path with valid SAS credential
- `test_create_regular_attestation_wrong_signature` - Invalid Ed25519 signature rejected
- `test_create_regular_attestation_wrong_sas_schema` - Schema mismatch rejected
- `test_create_regular_attestation_invalid_credential` - Invalid SAS credential rejected
- `test_create_regular_attestation_single_signer_mode` - SingleSigner signature verification

**Note:** This is the SAS-based storage path for ReputationScore attestations.

---

### 3. Add close_regular_attestation Tests

**Location:** New file `programs/sati/tests/attestation/close_regular.rs`

**Current State:** Zero test coverage for `programs/sati/src/instructions/attestation/close_regular_attestation.rs`

**Required Tests:**
- `test_close_regular_attestation_by_provider` - Counterparty can close
- `test_close_regular_attestation_by_agent` - Agent owner can close (DualSignature mode)
- `test_close_regular_attestation_unauthorized` - Third party rejection
- `test_close_regular_attestation_sas_cpi` - Verify SAS CPI authorization and data parsing

---

### 4. Unskip createValidation/createReputationScore E2E Tests

**Location:** `packages/sdk/tests/e2e/token-account-validation.test.ts:296, 375`

**Current State:**
```typescript
test.skip("accepts registered agent mint as tokenAccount" /* createValidation */)
test.skip("accepts registered agent mint as tokenAccount" /* createReputationScore */)
```

**Skip Reason:** "lookup table extension not implemented"

**Required:** Extend lookup table or use smaller test data to enable positive E2E coverage for these core attestation types.

---

### 5. Test closeAttestation Authorization Paths Fully

**Location:** `programs/sati/src/instructions/attestation/close_attestation.rs:66-88`

**Current State:** The close authorization logic has multiple code paths:
```rust
match schema_config.signature_mode {
    SignatureMode::SingleSigner => {
        require!(is_counterparty, SatiError::UnauthorizedClose);
    }
    SignatureMode::DualSignature => {
        let is_agent_owner = ctx.accounts.agent_ata.as_ref().is_some_and(...);
        require!(is_counterparty || is_agent_owner, SatiError::UnauthorizedClose);
    }
}
```

**Required Tests:**
- SingleSigner: Agent cannot close (only provider)
- SingleSigner: Random party cannot close
- DualSignature: Both agent and counterparty can close independently
- DualSignature: Random party cannot close
- Edge case: Agent transferred NFT (expired ATA ownership)

---

## Implementation Notes

These tests require:
1. Light Protocol localnet with prover for compressed attestation tests
2. SAS program deployment for regular attestation tests
3. Complex test fixture setup for close authorization paths

Consider implementing when:
- Light Protocol test infrastructure is stable
- SAS integration is finalized
- Before mainnet deployment (security-critical)
