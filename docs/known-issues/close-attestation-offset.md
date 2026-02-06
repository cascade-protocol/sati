# Off-by-one in close attestation instructions

## Summary

Both `close_regular_attestation` and `close_compressed_attestation` have an off-by-one error when parsing `agent_mint` and `counterparty` from attestation data. They skip the 1-byte `layout_version` prefix incorrectly, reading from offset 32 instead of 33.

## Impact

- `updateReputationScore` (close + recreate flow) fails with error `#6038 AgentMintAccountMismatch`
- Any future close operation on Regular or Compressed attestations will fail
- **Create** instructions are unaffected (they use the correct named offsets)

## Root cause

`close_regular_attestation.rs:80-84` uses hardcoded offsets that forget the `layout_version` byte:

```rust
// BUG: reads task_ref[31] + agent_mint[0..30] instead of agent_mint[0..31]
let agent_mint_bytes: [u8; 32] = attestation_data[SAS_DATA_OFFSET + 32..SAS_DATA_OFFSET + 64]
let counterparty_bytes: [u8; 32] = attestation_data[SAS_DATA_OFFSET + 64..SAS_DATA_OFFSET + 96]
```

Same in `close_compressed_attestation.rs:60-63`:

```rust
// BUG: same off-by-one on the data blob directly
let agent_mint_bytes: [u8; 32] = params.current_data[32..64]
let counterparty_bytes: [u8; 32] = params.current_data[64..96]
```

The data layout is: `layout_version(1) + task_ref(32) + agent_mint(32) + counterparty(32) + ...`

So `agent_mint` starts at byte 33, not 32. The `create_regular_attestation.rs` correctly uses named offsets from `constants::offsets` module (`AGENT_MINT = 33`, `COUNTERPARTY = 65`).

## Fix

Use named offsets from `crate::constants::offsets` instead of hardcoded arithmetic:

### `close_regular_attestation.rs`

```rust
use crate::constants::offsets;

let agent_mint_bytes: [u8; 32] = attestation_data
    [SAS_DATA_OFFSET + offsets::AGENT_MINT..SAS_DATA_OFFSET + offsets::COUNTERPARTY]
    .try_into()
    .map_err(|_| SatiError::InvalidSignature)?;
let counterparty_bytes: [u8; 32] = attestation_data
    [SAS_DATA_OFFSET + offsets::COUNTERPARTY..SAS_DATA_OFFSET + offsets::OUTCOME]
    .try_into()
    .map_err(|_| SatiError::InvalidSignature)?;
```

### `close_compressed_attestation.rs`

```rust
use crate::constants::offsets;

let agent_mint_bytes: [u8; 32] = params.current_data
    [offsets::AGENT_MINT..offsets::COUNTERPARTY]
    .try_into()
    .map_err(|_| SatiError::InvalidSignature)?;
let counterparty_bytes: [u8; 32] = params.current_data
    [offsets::COUNTERPARTY..offsets::OUTCOME]
    .try_into()
    .map_err(|_| SatiError::InvalidSignature)?;
```

Also update the minimum size checks accordingly:
- Regular: `SAS_DATA_OFFSET + 96` -> `SAS_DATA_OFFSET + offsets::OUTCOME` (97)
- Compressed: `96` -> `offsets::OUTCOME` (97)

## Why it was never caught

- All compressed schemas (Feedback, Validation) have `closeable: false`
- ReputationScoreV3 (the only closeable Regular schema) close path was never exercised in tests or production
- The bug only manifests when closing attestations, not when creating them

## Files to change

| File | Line |
|------|------|
| `programs/sati/src/instructions/attestation/close_regular_attestation.rs` | 75-84 |
| `programs/sati/src/instructions/attestation/close_compressed_attestation.rs` | 55-65 |

## After fix

Requires program rebuild and redeployment to devnet/mainnet. Then `updateReputationScore` (close + recreate) will work.
