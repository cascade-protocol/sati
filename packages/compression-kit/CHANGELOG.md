# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-02-12

### Fixed

- `MemcmpFilter` now works with Photon RPC - filters are transformed to the correct wire format (`{ memcmp: { offset, bytes } }` with base58-encoded bytes)
- `getCompressedAccountsByOwner` properly passes memcmp filters to Photon for server-side filtering (previously filters were passed through raw and ignored)

### Changed

- Removed unused `encoding` field from `MemcmpFilter` interface (was documented as "not yet supported")
- Updated `MemcmpFilter.bytes` type docs to reflect actual usage (base58 string or Uint8Array)

## [0.2.0] - 2025-01-04

### Added

- **Web Crypto Utilities**
  - `importEd25519PublicKey()` - Import Ed25519 public keys using Web Crypto API for signature verification

- **RPC Types**
  - `MemcmpFilter` - Interface for memory comparison filtering in Photon RPC queries

### Changed

- Upgraded TypeScript target to ES2022 with ES2023 lib for better performance
- Added DOM type definitions for Web Crypto API compatibility
- Improved npm package metadata and publishing configuration

## [0.1.0] - 2024-12-29

### Added

- Initial release of `@cascade-fyi/compression-kit`
- **Photon RPC Client**
  - `createPhotonRpc()` - Create RPC client for Light Protocol indexer
  - `getCompressedAccount()` - Fetch compressed account by hash
  - `getCompressedAccountsByOwner()` - Fetch all compressed accounts for owner
  - `getCompressedTokenAccountsByOwner()` - Fetch token accounts
  - `getCompressedTokenBalancesByOwner()` - Fetch token balances
  - `getValidityProof()` - Get validity proofs for accounts/addresses
  - `getMultipleCompressedAccounts()` - Batch fetch accounts
  - `getCompressionSignaturesForOwner()` - Get transaction signatures
  - `getLatestCompressionSignatures()` - Get recent signatures
  - `getIndexerHealth()` / `getIndexerSlot()` - Health checks

- **Address Derivation**
  - `deriveAddressSeed()` / `deriveAddress()` - V1 address derivation
  - `deriveAddressSeedV2()` / `deriveAddressV2()` - V2 address derivation
  - `packNewAddressParams()` - Pack address params for instructions
  - `addressToBytes()` / `bytesToAddress()` - Address conversions

- **BN254 Field Operations**
  - `createBN254()` - Create field element from bigint
  - `bn254FromBytes()` / `bn254ToBytes()` - Byte conversions
  - `bn254Add()` / `bn254Sub()` / `bn254Mul()` - Field arithmetic
  - `isSmallerThanFieldSize()` - Field size validation
  - `encodeBN254toBase58()` / `encodeBN254toHex()` - Encoding utilities

- **Instruction Building**
  - `PackedAccounts` - Helper class for building instruction accounts
  - `getLightSystemAccountMetas()` - Get Light system account metas (V1)
  - `getLightSystemAccountMetasV2()` - Get Light system account metas (V2)
  - `createSystemAccountConfig()` - Create system account configuration
  - `getCpiSignerPda()` - Derive CPI signer PDA

- **Conversion Utilities**
  - `hashToBn254FieldSizeBe()` - Hash to BN254 field
  - `hexToBytes()` / `bytesToHex()` - Hex conversions
  - `mergeBytes()` / `padBytes()` - Byte manipulation
  - `bytesEqual()` - Byte comparison

- **Constants**
  - Program IDs: `LIGHT_SYSTEM_PROGRAM`, `ACCOUNT_COMPRESSION_PROGRAM`, `COMPRESSED_TOKEN_PROGRAM`
  - Tree addresses for mainnet and devnet
  - Fee constants and configuration values

- **Error Handling**
  - Typed error codes for different domains (RPC, Proof, BN254, etc.)
  - Error factory functions for consistent error creation

### Notes

- This package is a Solana Kit native implementation of Light Protocol's `@lightprotocol/stateless.js`
- Uses native `bigint` instead of BN.js for better performance
- Uses `Address` type from `@solana/kit` instead of `PublicKey`
- Compatible with edge runtimes (Cloudflare Workers, Deno, browsers)

[0.2.1]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/compression-kit@0.2.0...@cascade-fyi/compression-kit@0.2.1
[0.2.0]: https://github.com/cascade-protocol/sati/compare/@cascade-fyi/compression-kit@0.1.0...@cascade-fyi/compression-kit@0.2.0
[0.1.0]: https://github.com/cascade-protocol/sati/releases/tag/@cascade-fyi/compression-kit@0.1.0
