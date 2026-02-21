# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2026-02-21

### Added

- **`TransactionConfig` interface** - new optional `transactionConfig` field on `SATIClientOptions` to configure `priorityFeeMicroLamports`, `computeUnitLimit`, and `maxRetries`
- **Priority fee support** - all transactions now include a compute unit price instruction; defaults to 50,000 microlamports on mainnet, 0 on devnet/localnet
- **Automatic retry on blockhash expiry** - `buildAndSendTransaction` retries with a fresh blockhash up to `maxRetries` times (default: 2) when a transaction fails due to blockhash expiration

### Changed

- **Blockhash fetched at `confirmed` commitment** - reduces stale blockhash errors on congested networks
- **Consolidated transaction sending** - removed internal `sendSingleTransaction`; all paths go through `buildAndSendTransaction` with consistent compute budget and retry logic
- **Compute budget uses `updateOrAppend*` helpers** - prevents duplicate compute budget instructions when building complex transactions

## [0.11.0] - 2026-02-20

### Changed

- **Migrated to Light Protocol V2 batched trees** - all compressed attestation operations now use V2 state and address trees with lower rollover fees
- Updated deployed configs for all networks (localnet, devnet, mainnet) with new lookup tables and reputation score schema addresses
- Requires `@cascade-fyi/compression-kit` >= 0.3.0

## [0.10.1] - 2026-02-17

### Fixed

- **`listAllAgents` input validation** - offset and limit are now clamped to non-negative integers, preventing `BigInt` errors on fractional inputs and out-of-range member numbers on negative offsets
- **`searchValidations` duplicate slot fetch** - eliminated redundant `getSlot` RPC call; now fetches slot once with graceful failure handling (consistent with `listValidations`)
- **`isSatiAgentRegistry` false positives** - now verifies the registry address matches the SATI program ID, not just the Solana chain prefix

## [0.10.0] - 2026-02-17

### Breaking Changes

- **`Endpoint` renamed to `ServiceDefinition`** - deprecated `Endpoint` re-export kept for backward compatibility
- **`setEndpoint`/`removeEndpoint` renamed** to `setService`/`removeService` on `AgentBuilder`
- **`listAllAgents` return type changed** from `AgentIdentity[]` to `{ agents: AgentIdentity[]; totalAgents: bigint }` - callers must destructure
- **`listAllAgents` offset changed** from 1-based `bigint` to 0-based `number` for simpler pagination
- **`AgentSearchOptions.offset` changed** from `bigint` to `number`

### Added

- **ERC-8004 validation and parsing** - exported Zod schemas (`RegistrationFileSchema`, `ServiceDefinitionSchema`, etc.), `validateRegistrationFile()`, `parseRegistrationFile()`, `normalizeRegistrationFile()`
- **CAIP validation helpers** - `isValidAgentRegistry()`, `isSatiAgentRegistry()`
- **`buildSatiRegistrationEntry()`** - network-aware helper with devnet support
- **`ERC8004_TYPE`, `VALID_TRUST_MODELS`, `SATI_CHAIN_IDS` constants**
- **Strict mode for `fetchRegistrationFile()`** - validates against ERC-8004 schema when `strict: true`
- **Approximate `createdAt` timestamps** on `ParsedAttestation`, `ParsedFeedbackAttestation`, and `ParsedValidationAttestation` - derived from slot numbers, no more manual slot-to-time conversion needed
- **`listAllAgents` order parameter** - `"newest"` (default) or `"oldest"` sort order
- **`buildFeedbackContent()` helper** - builds typed ERC-8004 feedback content bytes from friendly params
- **`hexToBytes()` / `bytesToHex()` utilities** - hex conversion exported from SDK
- **Typed getters** `reputationScoreSchema` and `credential` on the `Sati` class
- **`reviewer`, `feedbackURI`, `feedbackHash` fields** added to `FeedbackContent` type

### Fixed

- **`listFeedbacks` / `listValidations`** now automatically fetch current slot and compute `createdAt` timestamps

## [0.9.0] - 2026-02-12

### Breaking Changes

- **`MAX_SINGLE_SIGNATURE_CONTENT_SIZE` replaced** with two mode-specific constants:
  - `MAX_COUNTERPARTY_SIGNED_CONTENT_SIZE` (100 bytes) - CounterpartySigned mode has SIWS content duplication
  - `MAX_AGENT_OWNER_SIGNED_CONTENT_SIZE` (240 bytes) - AgentOwnerSigned mode has no SIWS duplication
- `getMaxContentSize()` and `validateContentSize()` now return correct per-mode limits

### Fixed

- **`getAgentOwner` returns stale/empty data after registration or transfer** - added retry with exponential backoff to handle SPL token index lag on RPC node pools

## [0.8.0] - 2026-02-12

### Breaking Changes

- **Feedback content fields renamed for ERC-8004 alignment**: `score` -> `value`, `tags` -> `tag1`/`tag2`, added `valueDecimals`
  - `GiveFeedbackParams`: `score?` -> `value?`, `tags?` -> `tag1?`/`tag2?`, added `valueDecimals?`
  - `ParsedFeedback`: `score?` -> `value?`, `tags` -> `tag1?`/`tag2?`, added `valueDecimals?`
  - `FeedbackSearchOptions`: `minScore`/`maxScore` -> `minValue`/`maxValue`, `tags?` -> `tag1?`/`tag2?`
  - `ReputationSummary`: `averageScore` -> `averageValue`
  - `FeedbackContent`: `score?` -> `value?`, `tags?` -> `tag1?`/`tag2?`, added `valueDecimals?`
- **`getReputationSummary` signature changed**: `(agentMint, tags?)` -> `(agentMint, tag1?, tag2?)`
- **Registration file fields renamed**: `endpoints` -> `services`, `x402support` -> `x402Support`

## [0.7.0] - 2026-02-12

### Added

- **Convenience methods on `Sati` class** - high-level API for feedback, search, and reputation without needing sati-agent0-sdk:
  - `giveFeedback(params)` - submit feedback with a single call (schema auto-resolution, content building, signing)
  - `prepareFeedback(params)` / `submitPreparedFeedback(params)` - browser wallet flow (user signs SIWS message, server submits)
  - `revokeFeedback(params)` - close a compressed feedback attestation
  - `searchFeedback(options?)` - query and filter feedbacks with parsed content, timestamps, and optional tx signatures
  - `getReputationSummary(agentMint, tags?)` - aggregate feedback scores with optional tag filtering
  - `searchAgents(options?)` - list agents with name/owner/active/endpoint filters and optional feedback stats
  - `searchValidations(agentMint)` - query validation attestations with parsed timestamps
  - `createAgentBuilder(name, description, image)` - factory for `SatiAgentBuilder`
- **`SatiAgentBuilder` class** - fluent builder for agent registration using native Solana types:
  - `setMCP(url, version?, meta?)` / `setA2A(url, version?, meta?)` - configure protocol endpoints with explicit capability metadata
  - `setWallet(address)` / `setActive(active)` / `setX402Support(x402)` / `setSupportedTrust(trusts)`
  - `register(opts)` / `registerWithUri(opts)` - on-chain registration with pluggable `MetadataUploader`
  - `update(opts)` / `updateUri(opts)` - update existing agent metadata
- **`FeedbackCache`** - TTL cache for feedback queries, reducing redundant RPC calls (moved from sati-agent0-sdk)
- **Config accessors** on `Sati` class: `deployedConfig`, `feedbackPublicSchema`, `feedbackSchema`, `validationSchema`, `lookupTable`
- **New types**: `GiveFeedbackParams`, `GiveFeedbackResult`, `PreparedFeedbackData`, `FeedbackSearchOptions`, `ParsedFeedback`, `ReputationSummary`, `AgentSearchOptions`, `AgentSearchResult`, `ParsedValidation`, `SatiWarning`
- `signer` and `onWarning` options in `SATIClientOptions`
- `buildRegistrationFile()` accepts optional `endpoints` parameter for pre-built endpoint arrays

### Changed

- sati-sdk is now the primary full-featured SDK (was low-level only); sati-agent0-sdk becomes a thin type-conversion wrapper

## [0.6.0] - 2026-02-12

### Added

- `createSatiUploader()` - zero-config hosted metadata uploader via sati.cascade.fyi (no Pinata JWT needed)
- Default Photon RPC proxy URLs (`sati.cascade.fyi/api/photon/{network}`) - SDK now works without a Helius API key for Light Protocol queries

### Changed

- Photon URL fallback changed from `rpcUrl` to hosted proxy - users only need `network` for a working setup
- `createSatiUploader` exported from main entry alongside `createPinataUploader`

## [0.5.0] - 2026-02-12

### Added

- `createPinataUploader(jwt)` and `MetadataUploader` interface exported from main entry - pluggable IPFS upload for agent registration
- `uploadRegistrationFile(params, uploader)` convenience method on `Sati` class
- Registration `Endpoint` type extended with optional fields: `mcpTools`, `mcpPrompts`, `mcpResources`, `a2aSkills`, `skills`, `domains`
- Gateway verification after Pinata uploads - catches silent upload failures with 5s timeout (non-fatal for timeouts/rate limits)

### Changed

- **BREAKING**: Pinata uploader migrated from v1 (`pinJSONToIPFS`) to v3 Files API (`uploads.pinata.cloud/v3/files`) - returns CIDv1 (`bafkrei...`) instead of CIDv0 (`Qm...`). Both formats are valid IPFS URIs.
- Compressed attestation queries now use server-side memcmp filtering via Photon RPC for `sasSchema` and `agentMint` (significant performance improvement for large datasets)
- Client-side filtering retained for `counterparty` and `outcome` fields only

### Dependencies

- Requires `@cascade-fyi/compression-kit` >= 0.2.1 (memcmp filter support)

## [0.4.2] - 2026-02-10

### Fixed

- Close attestation off-by-one error: program was reading `agent_mint`/`counterparty` at offsets 32/64 instead of 33/65, skipping the `layout_version` byte - caused every close/update attempt to fail with `AgentMintAccountMismatch`
- Missing SAS CPI accounts (`sasEventAuthority`, `systemProgram`) in `closeRegularAttestation` instruction - previously caused runtime panics
- Wired `sasEventAuthority` into `closeRegularAttestation()` and `updateReputationScore()` SDK methods

### Added

- `deriveSasEventAuthorityPda()` helper for SAS event authority PDA derivation

## [0.4.1] - 2026-02-09

### Fixed

- Fixed `workspace:*` dependency for `@cascade-fyi/compression-kit` not being resolved in published npm package, breaking installs for npm/yarn users

## [0.4.0] - 2026-02-06

### Added

- `updateReputationScore` method for updating existing reputation scores
- `validateReputationScoreContent` helper function
- `SAS_DATA_LEN_OFFSET` constant for cleaner SAS account parsing
- Content validation in `createReputationScore` and `updateReputationScore`
- Bounds check on content length in `deserializeReputationScore`
- Known Issues documentation section

### Fixed

- **BREAKING**: Migrated reputation scores to ReputationScoreV3 with VecU8 content layout, fixing variable-length JSON content support
- Fixed SAS credential authorized signers: `satiPda` is now correctly added as an authorized signer, enabling `createReputationScore` to succeed
- Fixed `fetchMaybeSchema` truthiness check that caused false negatives
- Fixed `deriveReputationAttestationPda` to use correct nonce format
- Deploy script is now fully idempotent for authorized signer management

### Changed

- `updateReputationScore` defaults to `ContentType.None` (was `ContentType.JSON`)
- Replaced magic number 97 with named `SAS_DATA_LEN_OFFSET` constant

## [0.3.0] - 2025-01-27

### Added

- End-to-end content encryption using X25519-XChaCha20-Poly1305
- Validation attestation type with `createValidation` method
- EVM address linking with validation and error handling
- FeedbackPublic with SingleSigner mode for x402 payments
- Network switching support with portable Light client
- Schema config registration in deployment script (`registerSchemaConfig`)
- `listAgentsByOwner` method for querying agents by owner
- Off-chain message signing with SIWS-inspired format

### Changed

- **BREAKING**: Renamed `token_account` to `agent_mint` across all methods
- **BREAKING**: Migrated to universal base layout for attestations
- **BREAKING**: Instruction renames for v1.0 program compatibility
- Migrated cryptographic operations to Web Crypto API
- Extracted compression utilities to `@cascade-fyi/compression-kit` package
- Improved Cloudflare Workers compatibility by removing sas-lib from main bundle

### Fixed

- ALT (Address Lookup Table) creation is now idempotent
- Dynamic SAS imports for better browser/worker bundling
- TypeScript configuration and type checks for tests

## [0.2.0] - 2024-12-17

### Added

- Initial public release
- Agent registration with Token-2022 metadata
- Feedback attestations with dual-signature model
- Compressed attestation storage via Light Protocol
- Basic querying via Photon RPC

[0.12.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.11.0...@cascade-fyi/sati-sdk@0.12.0
[0.11.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.10.1...@cascade-fyi/sati-sdk@0.11.0
[0.10.1]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.10.0...@cascade-fyi/sati-sdk@0.10.1
[0.10.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.9.0...@cascade-fyi/sati-sdk@0.10.0
[0.9.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.8.0...@cascade-fyi/sati-sdk@0.9.0
[0.8.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.7.0...@cascade-fyi/sati-sdk@0.8.0
[0.7.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.6.0...@cascade-fyi/sati-sdk@0.7.0
[0.6.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.5.0...@cascade-fyi/sati-sdk@0.6.0
[0.5.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.4.2...@cascade-fyi/sati-sdk@0.5.0
[0.4.2]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.4.1...@cascade-fyi/sati-sdk@0.4.2
[0.4.1]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.4.0...@cascade-fyi/sati-sdk@0.4.1
[0.4.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.3.0...@cascade-fyi/sati-sdk@0.4.0
[0.3.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.2.0...@cascade-fyi/sati-sdk@0.3.0
[0.2.0]: https://github.com/cascade-protocol/sati/releases/tag/@cascade-fyi/sati-sdk@0.2.0
