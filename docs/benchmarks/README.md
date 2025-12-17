# Compute Unit Benchmarks

This directory contains compute unit (CU) measurements for all SATI Registry instructions.

## Running Benchmarks

```bash
cd programs/sati-registry
cargo bench
```

Results are written to `compute_units.md` in this directory.

## Benchmark Categories

### Protocol Setup Instructions
- `initialize` - One-time setup to create registry and link TokenGroup (~11K CU)

### Authority Management
- `update_registry_authority_transfer` - Transfer authority to new pubkey (~3.5K CU)
- `update_registry_authority_renounce` - Renounce authority (make immutable) (~3.5K CU)

### Agent Registration
Agent registration creates a Token-2022 NFT with multiple extensions. The CU cost scales with metadata size:

- `register_agent_minimal` - No additional metadata, short name/symbol (~58K CU)
- `register_agent_typical_3_fields` - 3 metadata entries (~83K CU)
- `register_agent_max_10_fields` - Maximum 10 metadata entries (~168K CU)
- `register_agent_soulbound` - Non-transferable variant (~79K CU)

### Registration CU Breakdown

The `register_agent` instruction performs multiple Token-2022 CPIs:
1. **Create account** - System program CPI for mint account
2. **Initialize extensions** - MemberPointer, MetadataPointer, (NonTransferable)
3. **Initialize mint** - Token-2022 initialize_mint2
4. **Initialize metadata** - Token metadata extension
5. **Add metadata fields** - One CPI per additional field
6. **Initialize group member** - TokenGroup member extension
7. **Create ATA** - Associated token account
8. **Mint token** - Mint 1 NFT to owner
9. **Renounce authority** - Set mint authority to None

Each additional metadata field adds ~3-5K CU due to the token metadata update CPI.

## Fee Estimation

To estimate actual SOL costs:

```
Base Fee = 5,000 lamports (signature)
Priority Fee = CU * microLamports_per_CU

Example at 1,000 microLamports/CU:
- register_agent_minimal (~58K CU) = 5,000 + 58,000 = ~0.000063 SOL
- register_agent_typical (~83K CU) = 5,000 + 83,000 = ~0.000088 SOL
- register_agent_max_10_fields (~168K CU) = 5,000 + 168,000 = ~0.000173 SOL
```

Note: Actual rent costs for the NFT mint account (~0.002 SOL) are in addition to compute fees.

## Interpreting Results

- **CU Budget**: Solana allows 1,400,000 CU per transaction
- **SATI CU Range**: ~3.5K CU (authority ops) to ~168K CU (max metadata registration)
- **Headroom**: Even worst case uses only ~12% of budget
- **Delta Column**: Shows change from previous benchmark run

## Historical Results

Results are committed to this repo to:
1. Track performance regressions
2. Document expected CU costs for integrators
3. Compare before/after for optimizations

When making program changes, run benchmarks and include the diff in PRs if significant changes occur.
