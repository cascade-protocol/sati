# SATI SDK Test Suite

This directory contains the SDK test suite organized according to the Solana Test Pyramid.

## Test Categories

### Unit Tests (`tests/unit/`)

Pure unit tests with no external dependencies. These test individual functions and modules in isolation.

**Run:** `pnpm vitest run tests/unit/`

| File | Description |
|------|-------------|
| `ed25519.test.ts` | Ed25519 precompile instruction builder |
| `deployed-config.test.ts` | Deployed configuration loading and validation |
| `helpers.test.ts` | Helper functions and utilities |
| `schemas.test.ts` | Schema serialization and deserialization |

### Integration Tests (`tests/integration/`)

Tests that use LiteSVM to simulate a Solana environment without network access.

**Run:** `pnpm vitest run tests/integration/`

| File | Description |
|------|-------------|
| `client.test.ts` | SDK client with LiteSVM (Codama encoders, PDA derivation) |

### E2E Tests (`tests/e2e/`)

End-to-end tests that execute full workflows against a local validator or test network.

**Run:** `pnpm vitest run tests/e2e/`

| File | Description |
|------|-------------|
| `attestation-flow.test.ts` | Complete attestation creation and verification |
| `feedback-flow.test.ts` | Feedback submission and retrieval workflow |

### Test Helpers (`tests/helpers/`)

Shared utilities and fixtures for tests.

| File | Description |
|------|-------------|
| `setup.ts` | Test environment setup |
| `fixtures.ts` | Test data fixtures |
| `mockRpc.ts` | RPC mocking utilities |
| `localValidator.ts` | Local validator management |
| `keys.ts` | Test keypair generation |

## Running Tests

```bash
# All SDK tests
pnpm test

# Unit tests only (fast, no network)
pnpm vitest run tests/unit/

# Integration tests (uses LiteSVM)
pnpm vitest run tests/integration/

# E2E tests (requires local validator)
pnpm vitest run tests/e2e/

# Watch mode during development
pnpm vitest --watch
```

## Test Pyramid Structure

```
                    /\
                   /  \
                  / E2E \          <- Slow, full integration
                 /------\
                /        \
               / Integr.  \        <- LiteSVM simulation
              /------------\
             /              \
            /    Unit        \     <- Fast, isolated
           /------------------\
```

## Best Practices

1. **Unit Tests First**: Write unit tests for all pure functions
2. **LiteSVM for Integration**: Use LiteSVM instead of network calls where possible
3. **E2E for Critical Paths**: Reserve E2E tests for critical user workflows
4. **No Network in CI**: Unit and integration tests should run without network access
5. **Fixtures over Mocks**: Prefer real data fixtures over complex mocks

## Environment Variables

| Variable | Description | Required For |
|----------|-------------|--------------|
| `HELIUS_API_KEY` | Helius RPC API key | E2E tests, Light Protocol |
| `SOLANA_CLUSTER` | Network (devnet/mainnet) | E2E tests |
| `ANCHOR_WALLET` | Wallet path | E2E tests |
