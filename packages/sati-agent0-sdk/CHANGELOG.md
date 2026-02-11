# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-agent0-sdk@0.1.0...@cascade-fyi/sati-agent0-sdk@0.1.1
[0.1.0]: https://github.com/cascade-protocol/sati/releases/tag/@cascade-fyi/sati-agent0-sdk@0.1.0
