/**
 * Light Protocol constants using Solana Kit patterns.
 *
 * Uses:
 * - Address type (branded string) instead of PublicKey
 * - Native bigint instead of BN.js
 */

import { address, type Address, getProgramDerivedAddress } from "@solana/kit";
import { type TreeInfo, TreeType } from "./state/types.js";

// =============================================================================
// Protocol Version
// =============================================================================

export enum VERSION {
  V1 = "V1",
  V2 = "V2",
}

/**
 * Feature flags for protocol versioning.
 * @internal
 */
export const featureFlags = {
  version: VERSION.V1 as VERSION,
  isV2: () => featureFlags.version === VERSION.V2,
};

/**
 * Returns versioned endpoint name.
 * @example versionedEndpoint('getCompressedAccount') -> 'getCompressedAccountV2' (if V2)
 */
export const versionedEndpoint = (base: string): string => (featureFlags.isV2() ? `${base}V2` : base);

// =============================================================================
// BN254 Field Constants
// =============================================================================

/**
 * BN254 prime field size.
 * All hashes must be less than this value for ZK circuit compatibility.
 */
export const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Highest address plus one (used for address validation).
 */
export const HIGHEST_ADDRESS_PLUS_ONE = 452312848583266388373324160190187140051835877600158453279131187530910662655n;

// =============================================================================
// Program IDs
// =============================================================================

/** Light System Program ID */
export const LIGHT_SYSTEM_PROGRAM = address("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");

/** Account Compression Program ID */
export const ACCOUNT_COMPRESSION_PROGRAM = address("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq");

/** Noop Program ID (for logging) */
export const NOOP_PROGRAM = address("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

/** Compressed Token Program ID */
export const COMPRESSED_TOKEN_PROGRAM = address("cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m");

/** Registered Program PDA (constant) */
export const REGISTERED_PROGRAM_PDA = address("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh");

// =============================================================================
// Instruction Discriminators
// =============================================================================

export const INVOKE_DISCRIMINATOR = new Uint8Array([26, 16, 169, 7, 21, 202, 242, 25]);

export const INVOKE_CPI_DISCRIMINATOR = new Uint8Array([49, 212, 191, 129, 39, 194, 43, 196]);

export const INVOKE_CPI_WITH_READ_ONLY_DISCRIMINATOR = new Uint8Array([86, 47, 163, 166, 21, 223, 92, 8]);

export const INVOKE_CPI_WITH_ACCOUNT_INFO_DISCRIMINATOR = new Uint8Array([228, 34, 128, 84, 47, 139, 86, 240]);

export const INSERT_INTO_QUEUES_DISCRIMINATOR = new Uint8Array([180, 143, 159, 153, 35, 46, 248, 163]);

export const COMPUTE_BUDGET_PATTERN = new Uint8Array([2, 64, 66, 15, 0]);

// =============================================================================
// State Tree Lookup Tables
// =============================================================================

/** Mainnet state tree lookup table */
export const STATE_TREE_LOOKUP_TABLE_MAINNET = address("7i86eQs3GSqHjN47WdWLTCGMW6gde1q96G2EVnUyK2st");

/** Mainnet nullified state tree lookup table */
export const NULLIFIED_STATE_TREE_LOOKUP_TABLE_MAINNET = address("H9QD4u1fG7KmkAzn2tDXhheushxFe1EcrjGGyEFXeMqT");

/** Devnet state tree lookup table */
export const STATE_TREE_LOOKUP_TABLE_DEVNET = address("Dk9mNkbiZXJZ4By8DfSP6HEE4ojZzRvucwpawLeuwq8q");

/** Devnet nullified state tree lookup table */
export const NULLIFIED_STATE_TREE_LOOKUP_TABLE_DEVNET = address("AXbHzp1NgjLvpfnD6JRTTovXZ7APUCdtWZFCRr5tCxse");

export interface StateTreeLUTPair {
  stateTreeLookupTable: Address;
  nullifyLookupTable: Address;
}

/**
 * Returns default state tree lookup tables for each network.
 */
export function defaultStateTreeLookupTables(): {
  mainnet: StateTreeLUTPair[];
  devnet: StateTreeLUTPair[];
} {
  return {
    mainnet: [
      {
        stateTreeLookupTable: STATE_TREE_LOOKUP_TABLE_MAINNET,
        nullifyLookupTable: NULLIFIED_STATE_TREE_LOOKUP_TABLE_MAINNET,
      },
    ],
    devnet: [
      {
        stateTreeLookupTable: STATE_TREE_LOOKUP_TABLE_DEVNET,
        nullifyLookupTable: NULLIFIED_STATE_TREE_LOOKUP_TABLE_DEVNET,
      },
    ],
  };
}

// =============================================================================
// Test Tree Accounts (Localnet)
// =============================================================================

// V1 State Trees
export const MERKLE_TREE_PUBKEY = address("smt1NamzXdq4AMqS2fS2F1i5KTYPZRhoHgWx38d8WsT");
export const NULLIFIER_QUEUE_PUBKEY = address("nfq1NvQDJ2GEgnS8zt9prAe8rjjpAW1zFkrvZoBR148");
export const CPI_CONTEXT_PUBKEY = address("cpi1uHzrEhBG733DoEJNgHCyRS3XmmyVNZx5fonubE4");

export const MERKLE_TREE_2_PUBKEY = address("smt2rJAFdyJJupwMKAqTNAJwvjhmiZ4JYGZmbVRw1Ho");
export const NULLIFIER_QUEUE_2_PUBKEY = address("nfq2hgS7NYemXsFaFUCe3EMXSDSfnZnAe27jC6aPP1X");
export const CPI_CONTEXT_2_PUBKEY = address("cpi2cdhkH5roePvcudTgUL8ppEBfTay1desGh8G8QxK");

// V1 Address Trees
export const ADDRESS_TREE = address("amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2");
export const ADDRESS_QUEUE = address("aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F");

// V2 Batch State Trees
export const BATCH_MERKLE_TREE_1 = address("bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU");
export const BATCH_QUEUE_1 = address("oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto");
export const BATCH_CPI_CONTEXT_1 = address("cpi15BoVPKgEPw5o8wc2T816GE7b378nMXnhH3Xbq4y");

export const BATCH_MERKLE_TREE_2 = address("bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi");
export const BATCH_QUEUE_2 = address("oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg");
export const BATCH_CPI_CONTEXT_2 = address("cpi2yGapXUR3As5SjnHBAVvmApNiLsbeZpF3euWnW6B");

// V2 Address Trees
export const BATCH_ADDRESS_TREE = address("amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx");
export const TEST_BATCH_ADDRESS_TREE = address("EzKE84aVTkCUhDHLELqyJaq1Y7UVVmqxXqZjVHwHY3rK");

// =============================================================================
// Tree Configuration
// =============================================================================

export const DEFAULT_MERKLE_TREE_HEIGHT = 26;
export const DEFAULT_MERKLE_TREE_ROOTS = 2800;

/** Threshold for UTXO merging (per asset) */
export const UTXO_MERGE_THRESHOLD = 20;
export const UTXO_MERGE_MAXIMUM = 10;

/** Tree rollover threshold (95% capacity) */
export const TRANSACTION_MERKLE_TREE_ROLLOVER_THRESHOLD = BigInt(Math.floor(2 ** DEFAULT_MERKLE_TREE_HEIGHT * 0.95));

// =============================================================================
// Fees
// =============================================================================

/** Fee per output compressed account (for tree rollover) */
export const STATE_MERKLE_TREE_ROLLOVER_FEE = featureFlags.isV2() ? 1n : 300n;

/** Fee per new address (for address tree rollover) */
export const ADDRESS_QUEUE_ROLLOVER_FEE = 392n;

/** Network fee for nullifying compressed accounts */
export const STATE_MERKLE_TREE_NETWORK_FEE = 5000n;

/** V1 network fee per new address */
export const ADDRESS_TREE_NETWORK_FEE_V1 = 5000n;

/** V2 network fee per new address */
export const ADDRESS_TREE_NETWORK_FEE_V2 = 10000n;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Derives the account compression authority PDA.
 */
export async function getAccountCompressionAuthority(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: LIGHT_SYSTEM_PROGRAM,
    seeds: [new TextEncoder().encode("cpi_authority")],
  });
  return pda;
}

/**
 * Returns static accounts needed for Light System Program calls.
 */
export async function defaultStaticAccounts(): Promise<Address[]> {
  const authority = await getAccountCompressionAuthority();
  return [REGISTERED_PROGRAM_PDA, NOOP_PROGRAM, ACCOUNT_COMPRESSION_PROGRAM, authority];
}

/**
 * Check if URL is localhost/localnet.
 * @internal
 */
export function isLocalTest(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

/**
 * Returns default test state tree accounts for localnet.
 */
export function defaultTestStateTreeAccounts(): {
  nullifierQueue: Address;
  merkleTree: Address;
  merkleTreeHeight: number;
  addressTree: Address;
  addressQueue: Address;
} {
  return {
    nullifierQueue: NULLIFIER_QUEUE_PUBKEY,
    merkleTree: MERKLE_TREE_PUBKEY,
    merkleTreeHeight: DEFAULT_MERKLE_TREE_HEIGHT,
    addressTree: ADDRESS_TREE,
    addressQueue: ADDRESS_QUEUE,
  };
}

/**
 * Returns active state tree infos for localnet testing.
 * @internal
 */
export function localTestActiveStateTreeInfos(): TreeInfo[] {
  const v1Trees: TreeInfo[] = [
    {
      tree: MERKLE_TREE_PUBKEY,
      queue: NULLIFIER_QUEUE_PUBKEY,
      cpiContext: CPI_CONTEXT_PUBKEY,
      treeType: TreeType.StateV1,
      nextTreeInfo: null,
    },
    {
      tree: MERKLE_TREE_2_PUBKEY,
      queue: NULLIFIER_QUEUE_2_PUBKEY,
      cpiContext: CPI_CONTEXT_2_PUBKEY,
      treeType: TreeType.StateV1,
      nextTreeInfo: null,
    },
  ];

  if (!featureFlags.isV2()) {
    return v1Trees;
  }

  // V2 includes batch trees
  return [
    ...v1Trees,
    {
      tree: BATCH_MERKLE_TREE_1,
      queue: BATCH_QUEUE_1,
      cpiContext: BATCH_CPI_CONTEXT_1,
      treeType: TreeType.StateV2,
      nextTreeInfo: null,
    },
    {
      tree: BATCH_MERKLE_TREE_2,
      queue: BATCH_QUEUE_2,
      cpiContext: BATCH_CPI_CONTEXT_2,
      treeType: TreeType.StateV2,
      nextTreeInfo: null,
    },
    {
      tree: BATCH_ADDRESS_TREE,
      queue: BATCH_ADDRESS_TREE, // V2 address queue is part of tree account
      treeType: TreeType.AddressV2,
      nextTreeInfo: null,
    },
  ];
}

/**
 * Returns default address tree info.
 */
export function getDefaultAddressTreeInfo(): TreeInfo {
  if (featureFlags.isV2()) {
    return {
      tree: BATCH_ADDRESS_TREE,
      queue: BATCH_ADDRESS_TREE,
      treeType: TreeType.AddressV2,
      nextTreeInfo: null,
    };
  }
  return {
    tree: ADDRESS_TREE,
    queue: ADDRESS_QUEUE,
    treeType: TreeType.AddressV1,
    nextTreeInfo: null,
  };
}
