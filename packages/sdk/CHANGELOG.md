# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/cascade-protocol/sati/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cascade-protocol/sati/releases/tag/v0.2.0
