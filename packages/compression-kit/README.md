# @cascade-fyi/compression-kit

Solana Kit native implementation of Light Protocol compression. Works in any runtime (browsers, Cloudflare Workers, Deno, Node.js).

> **Status:** Beta

## Features

- **Edge/browser compatible** - No Node.js dependencies, works everywhere
- **Native bigint** - Uses native bigint instead of BN.js for better performance
- **Solana Kit types** - Uses `Address` type from `@solana/kit` instead of `PublicKey`
- **Full Photon RPC** - Complete implementation of Light Protocol's Photon indexer API
- **Lightweight** - Minimal dependencies (~25KB gzip)

## Install

```bash
npm install @cascade-fyi/compression-kit
```

```bash
pnpm add @cascade-fyi/compression-kit
```

```bash
yarn add @cascade-fyi/compression-kit
```

## Quickstart

```typescript
import { createPhotonRpc, deriveAddress, deriveAddressSeed } from '@cascade-fyi/compression-kit';
import { address } from '@solana/kit';

// 1. Create RPC client
const rpc = createPhotonRpc('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');

// 2. Query compressed accounts
const ownerAddress = address('YOUR_WALLET_ADDRESS');
const accounts = await rpc.getCompressedAccountsByOwner(ownerAddress);

// 3. Derive a compressed account address
const programId = address('YOUR_PROGRAM_ID');
const seed = deriveAddressSeed([new TextEncoder().encode('my-seed')], programId);
const compressedAddress = deriveAddress(seed);
```

## Common Flows

### Query Compressed Accounts

```typescript
import { createPhotonRpc } from '@cascade-fyi/compression-kit';

const rpc = createPhotonRpc('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');

// Get all compressed accounts for an owner
const accounts = await rpc.getCompressedAccountsByOwner(ownerAddress);

// Get compressed token accounts
const tokenAccounts = await rpc.getCompressedTokenAccountsByOwner(ownerAddress, {
  mint: mintAddress,
});

// Get a specific compressed account by hash
const account = await rpc.getCompressedAccount(accountHash);
```

### Derive Addresses (V1 & V2)

```typescript
import {
  deriveAddressSeed,
  deriveAddress,
  deriveAddressSeedV2,
  deriveAddressV2,
  getDefaultAddressTreeInfo,
} from '@cascade-fyi/compression-kit';

// V1 Address derivation (mainnet)
const seedV1 = deriveAddressSeed([Buffer.from('my-seed')], programId);
const addressV1 = deriveAddress(seedV1);

// V2 Address derivation (devnet, more efficient)
const seedV2 = deriveAddressSeedV2([Buffer.from('my-seed')]);
const treeInfo = getDefaultAddressTreeInfo();
const addressV2 = deriveAddressV2(seedV2, treeInfo.tree, programId);
```

### Get Validity Proofs

```typescript
import { createPhotonRpc } from '@cascade-fyi/compression-kit';

const rpc = createPhotonRpc('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');

// Get proof for existing accounts (update/close operations)
const proof = await rpc.getValidityProof({
  hashes: [{ hash: accountHash, tree: treeAddress, queue: queueAddress }],
});

// Get proof for new addresses (create operations)
const newAddressProof = await rpc.getValidityProof({
  newAddresses: [{ address: newAddress, tree: addressTree, queue: addressQueue }],
});
```

### Build Instruction Accounts

```typescript
import {
  PackedAccounts,
  createSystemAccountConfig,
  getLightSystemAccountMetas,
} from '@cascade-fyi/compression-kit';

// Create packed accounts helper
const packedAccounts = new PackedAccounts();

// Add Light system accounts
const systemConfig = createSystemAccountConfig(programId);
packedAccounts.addSystemAccounts(getLightSystemAccountMetas(systemConfig));

// Add tree accounts and get indices
const treeIndex = packedAccounts.insertOrGet(treeAddress);

// Convert to account metas for instruction
const { remainingAccounts } = packedAccounts.toAccountMetas();
```

### BN254 Field Operations

```typescript
import {
  createBN254,
  bn254FromBytes,
  bn254ToBytes,
  bn254Add,
  isSmallerThanFieldSize,
} from '@cascade-fyi/compression-kit';

// Create field element from bigint
const element = createBN254(123456789n);

// Convert from/to bytes
const bytes = bn254ToBytes(element);
const restored = bn254FromBytes(bytes);

// Field arithmetic
const sum = bn254Add(element1, element2);

// Validate field size
if (isSmallerThanFieldSize(someBytes)) {
  // Safe to use as BN254
}
```

## Configuration

### RPC Endpoints

| Network | Endpoint |
|---------|----------|
| Mainnet | `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` |
| Devnet | `https://devnet.helius-rpc.com/?api-key=YOUR_KEY` |
| Localnet | `http://localhost:8784` |

### Default Tree Addresses

The package exports default tree addresses for mainnet and devnet:

```typescript
import {
  MERKLE_TREE_PUBKEY,      // V1 State tree (mainnet)
  NULLIFIER_QUEUE_PUBKEY,  // V1 Nullifier queue (mainnet)
  ADDRESS_TREE,            // V1 Address tree
  BATCH_MERKLE_TREE_1,     // V2 Batch tree (devnet)
  defaultTestStateTreeAccounts, // Local testing
} from '@cascade-fyi/compression-kit';
```

## API Reference

### RPC Methods

| Method | Description |
|--------|-------------|
| `getCompressedAccount(hash)` | Get compressed account by hash |
| `getCompressedAccountsByOwner(owner)` | Get all compressed accounts for owner |
| `getCompressedTokenAccountsByOwner(owner, config?)` | Get token accounts for owner |
| `getCompressedTokenBalancesByOwner(owner)` | Get token balances for owner |
| `getValidityProof(params)` | Get validity proof for accounts/addresses |
| `getMultipleCompressedAccounts(hashes)` | Batch fetch multiple accounts |
| `getCompressionSignaturesForOwner(owner)` | Get compression transaction signatures |
| `getLatestCompressionSignatures()` | Get recent compression signatures |
| `getIndexerHealth()` | Check indexer health status |
| `getIndexerSlot()` | Get current indexer slot |

### Types

| Type | Description |
|------|-------------|
| `CompressedAccount` | Compressed account data structure |
| `TreeInfo` | Merkle tree metadata |
| `ValidityProof` | ZK validity proof |
| `BN254` | BN254 field element (branded bigint) |
| `PackedAccounts` | Helper for building instruction accounts |

### Constants

| Constant | Description |
|----------|-------------|
| `LIGHT_SYSTEM_PROGRAM` | Light system program ID |
| `ACCOUNT_COMPRESSION_PROGRAM` | Account compression program ID |
| `COMPRESSED_TOKEN_PROGRAM` | Compressed token program ID |
| `FIELD_SIZE` | BN254 field size |

## Requirements

- Node.js >= 20.18.0
- TypeScript >= 5.0 (for type definitions)

## Related Packages

- [`@solana/kit`](https://www.npmjs.com/package/@solana/kit) - Solana Kit for modern Solana development
- [`@lightprotocol/stateless.js`](https://www.npmjs.com/package/@lightprotocol/stateless.js) - Original Light Protocol JS SDK

## License

Apache-2.0
