# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-02-12

### Fixed

- SIWS counterparty message schema name corrected from `FeedbackPublic` to `FeedbackPublicV1` in `giveFeedback()` and `prepareFeedback()` - mismatched name caused signature verification failures on-chain

## [0.3.0] - 2026-02-12

### Added

- `photonRpcUrl` option in `SatiSDKConfig` for overriding the default Photon RPC endpoint

### Changed

- `registerIPFS()` and `updateIPFS()` now fall back to hosted SATI uploader when `pinataJwt` is not configured (zero-config experience - no Pinata JWT needed)
- `pinataJwt` is now optional for all IPFS operations (was required, threw `PINATA_JWT_REQUIRED`)

### Dependencies

- Requires `@cascade-fyi/sati-sdk` >= 0.6.0 (hosted uploader + Photon proxy defaults)

## [0.2.0] - 2026-02-12

### Breaking Changes

- **Write operations now return `SolanaTransactionHandle<T>`** instead of `Promise<{ signature }>` or `Promise<{ signature, feedback }>`. Use `.hash` for the transaction signature, `.waitMined()` or `.waitConfirmed()` for the result. Migration:
  ```typescript
  // Before:
  const { signature, feedback } = await sdk.giveFeedback(agentId, 85);
  // After:
  const handle = await sdk.giveFeedback(agentId, 85);
  const { result: feedback } = await handle.waitMined();
  console.log(handle.hash); // signature
  ```
- **`giveFeedback` 7th parameter (`satiOptions`) removed.** Pass `outcome` and `taskRef` via the `feedbackFile` parameter instead:
  ```typescript
  // Before:
  await sdk.giveFeedback(agentId, 85, "tag1", "tag2", endpoint, feedbackFile, { outcome, taskRef });
  // After:
  await sdk.giveFeedback(agentId, 85, "tag1", "tag2", endpoint, { ...feedbackFile, outcome, taskRef });
  ```
- **`prepareFeedback` 6th parameter (`satiOptions`) removed.** Pass `outcome` and `taskRef` via the `opts` parameter instead.
- **`SatiFeedbackOptions` type removed.** Fields moved into `feedbackFile`/`opts`.
- **`agent.registerIPFS()` / `agent.registerHTTP()`** now return `SolanaTransactionHandle<RegistrationFile>`. Access `agentId` via `agent.agentId` after registration.
- All `throw new Error(...)` replaced with typed error classes (see Added section).

### Added

- `SolanaTransactionHandle<T>` - agent0-sdk `TransactionHandle` pattern for Solana (`.hash`, `.waitMined()`, `.waitConfirmed()`)
- Typed error classes: `SatiError`, `AgentNotFoundError`, `ReadOnlyError`, `SignerRequiredError`, `SchemaNotDeployedError`, `InvalidAgentIdError`, `UnsupportedOperationError`
- `FeedbackCache` - TTL cache for feedback queries, reducing redundant RPC calls
- `agent.updateIPFS()` - re-upload current registration file to IPFS and update on-chain URI
- `agent.updateHTTP(uri)` - update on-chain URI to a new HTTP endpoint
- `revokeFeedback(feedback)` overload - pass a `Feedback` object directly for stable addressing (index-based overload deprecated)
- `SatiSearchOptions.limit` and `SatiSearchOptions.offset` for agent pagination
- Server-side memcmp filtering for `searchFeedback` (schema + agentMint) via Photon RPC
- Client-side filtering for `counterparty` and `outcome` in attestation queries
- Lazy feedback stats in `searchAgents` - cheap filters applied first, feedback stats fetched only for surviving agents
- JSDoc documenting timestamp imprecision on `createdAt` fields

### Fixed

- `searchAgents` no longer fetches all 1000 agents before filtering - supports pagination and applies cheap filters before expensive feedback stats

## [0.1.1] - 2026-02-11

### Fixed

- Client-side reviewer and multi-agent filtering in `searchFeedback` - underlying RPC only filters by schema and agent mint, so reviewer/agents filters were silently ignored
- Safe JSON parsing for on-chain attestation content - malformed data no longer crashes entire queries
- Replace `as KeyPairSigner` with `as TransactionSigner` in browser wallet paths - semantically correct minimal interface
- For `getTransferInstruction` authority, pass `Address` directly instead of casting (accepts `Address | TransactionSigner`)
- Registration race condition in sender path - retry loop (3 attempts, 1.5s delay) handles concurrent PDA collisions
- Post-registration `memberNumber` bug - use value from successful attempt instead of re-fetching (which could race)

### Added

- `revokeFeedbackByAddress(compressedAddress)` - stable address-based revoke alternative to index-based `revokeFeedback`
- `SatiWarning` type and `onWarning` callback in `SatiSDKConfig` for non-fatal warning reporting (RPC failures, signature lookups)
- `_parseContentJson` internal helper for safe attestation content parsing

## [0.1.0] - 2026-02-11

### Added

- `SatiSDK` class with agent0-sdk compatible interface backed by SATI's Solana infrastructure
- `SatiAgent` class with fluent builders for endpoints, metadata, trust models, and on-chain registration (IPFS and HTTP)
- CAIP-2 agent IDs (`solana:<chainRef>:<mintAddress>`) for cross-chain compatibility
- Agent search with 20+ filters (name, capabilities, endpoints, trust models, feedback stats)
- Feedback creation via `giveFeedback()` (server-side) and `prepareFeedback()`/`submitPreparedFeedback()` (browser wallet flow)
- `SatiFeedbackOptions` for governance use cases: typed `outcome` (Negative/Neutral/Positive) and deterministic `taskRef` parameters
- Feedback search, revocation, and reputation summary
- Validation attestation search via `searchValidations()`
- Config accessors for schema addresses and lookup tables
- Data format converters between SATI and agent0: `toAgentSummary`, `toAgent0RegistrationFile`, `fromAgent0RegistrationFile`, `toAgent0Endpoints`, `fromAgent0Endpoints`, `toFeedback`
- Endpoint capability auto-fetching for MCP and A2A (tools, prompts, resources, skills)
- OASF skill and domain management
- Transaction sender support for browser wallet integration
- Re-exports of agent0-sdk types and SATI constants for consumer convenience

[0.3.1]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-agent0-sdk@0.3.0...@cascade-fyi/sati-agent0-sdk@0.3.1
[0.3.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-agent0-sdk@0.2.0...@cascade-fyi/sati-agent0-sdk@0.3.0
[0.2.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-agent0-sdk@0.1.1...@cascade-fyi/sati-agent0-sdk@0.2.0
[0.1.1]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-agent0-sdk@0.1.0...@cascade-fyi/sati-agent0-sdk@0.1.1
[0.1.0]: https://github.com/cascade-protocol/sati/releases/tag/@cascade-fyi/sati-agent0-sdk@0.1.0
