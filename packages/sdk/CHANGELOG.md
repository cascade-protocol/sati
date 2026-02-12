# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.6.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.5.0...@cascade-fyi/sati-sdk@0.6.0
[0.5.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.4.2...@cascade-fyi/sati-sdk@0.5.0
[0.4.2]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.4.1...@cascade-fyi/sati-sdk@0.4.2
[0.4.1]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.4.0...@cascade-fyi/sati-sdk@0.4.1
[0.4.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.3.0...@cascade-fyi/sati-sdk@0.4.0
[0.3.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/sati-sdk@0.2.0...@cascade-fyi/sati-sdk@0.3.0
[0.2.0]: https://github.com/cascade-protocol/sati/releases/tag/@cascade-fyi/sati-sdk@0.2.0
