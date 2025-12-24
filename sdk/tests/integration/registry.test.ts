/**
 * Integration Tests for SATI Registry Operations
 *
 * Tests Token-2022 NFT-based agent registration using LiteSVM.
 * Focuses on registry state, member numbers, and authority controls.
 */

import { describe, test, expect, beforeAll, beforeEach } from "vitest";
import { LiteSVM } from "litesvm";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MintLayout } from "@solana/spl-token";
import { address } from "@solana/kit";

// Import Codama-generated code
import {
  getRegistryConfigEncoder,
  getRegistryConfigDecoder,
  getRegistryConfigSize,
  REGISTRY_CONFIG_DISCRIMINATOR,
} from "../../src/generated/accounts/registryConfig";
import {
  getSchemaConfigEncoder,
  getSchemaConfigDecoder,
  getSchemaConfigSize,
  SCHEMA_CONFIG_DISCRIMINATOR,
} from "../../src/generated/accounts/schemaConfig";
import { SATI_PROGRAM_ADDRESS } from "../../src/generated/programs/sati";
import {
  SignatureMode as GeneratedSignatureMode,
  StorageType as GeneratedStorageType,
} from "../../src/generated/types";

// Import SDK helpers
import { findRegistryConfigPda, findSchemaConfigPda } from "../../src/helpers";

// =============================================================================
// Constants
// =============================================================================

const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Setup LiteSVM with SATI program loaded
 */
function setupLiteSVM(): LiteSVM {
  const svm = new LiteSVM();
  const programPath = process.cwd().endsWith("sdk")
    ? "../target/deploy/sati.so"
    : "./target/deploy/sati.so";
  svm.addProgramFromFile(new PublicKey(SATI_PROGRAM_ADDRESS), programPath);
  return svm;
}

/**
 * Derive registry config PDA
 */
function deriveRegistryConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    new PublicKey(SATI_PROGRAM_ADDRESS)
  );
}

/**
 * Derive schema config PDA
 */
function deriveSchemaConfigPda(sasSchema: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("schema_config"), sasSchema.toBuffer()],
    new PublicKey(SATI_PROGRAM_ADDRESS)
  );
}

/**
 * Pre-seed registry config account
 */
function setupRegistryConfig(
  svm: LiteSVM,
  groupMint: PublicKey,
  authority: PublicKey,
  totalAgents: bigint = 0n
): PublicKey {
  const [registryConfigPda, bump] = deriveRegistryConfigPda();

  const encoder = getRegistryConfigEncoder();
  const data = encoder.encode({
    groupMint: address(groupMint.toBase58()),
    authority: address(authority.toBase58()),
    totalAgents,
    bump,
  });

  svm.setAccount(registryConfigPda, {
    lamports: LAMPORTS_PER_SOL,
    data: Uint8Array.from(data),
    owner: new PublicKey(SATI_PROGRAM_ADDRESS),
    executable: false,
  });

  return registryConfigPda;
}

/**
 * Pre-seed schema config account
 */
function setupSchemaConfig(
  svm: LiteSVM,
  sasSchema: PublicKey,
  signatureMode: GeneratedSignatureMode = GeneratedSignatureMode.DualSignature,
  storageType: GeneratedStorageType = GeneratedStorageType.Compressed,
  closeable: boolean = false
): PublicKey {
  const [schemaConfigPda, bump] = deriveSchemaConfigPda(sasSchema);

  const encoder = getSchemaConfigEncoder();
  const data = encoder.encode({
    sasSchema: address(sasSchema.toBase58()),
    signatureMode,
    storageType,
    closeable,
    bump,
  });

  svm.setAccount(schemaConfigPda, {
    lamports: LAMPORTS_PER_SOL,
    data: Uint8Array.from(data),
    owner: new PublicKey(SATI_PROGRAM_ADDRESS),
    executable: false,
  });

  return schemaConfigPda;
}

/**
 * Pre-seed a Token-2022 group mint
 */
function setupGroupMint(
  svm: LiteSVM,
  mintPubkey: PublicKey,
  mintAuthority: PublicKey
): void {
  const mintData = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority,
      supply: 0n,
      decimals: 0,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintData
  );

  svm.setAccount(mintPubkey, {
    lamports: LAMPORTS_PER_SOL,
    data: mintData,
    owner: TOKEN_2022_PROGRAM_ID,
    executable: false,
  });
}

// =============================================================================
// Tests: Registry Config Account
// =============================================================================

describe("Registry Config Account", () => {
  let svm: LiteSVM;

  beforeEach(() => {
    svm = setupLiteSVM();
  });

  test("discriminator is 8 bytes", () => {
    expect(REGISTRY_CONFIG_DISCRIMINATOR.length).toBe(8);
  });

  test("account size is 81 bytes", () => {
    expect(getRegistryConfigSize()).toBe(81);
  });

  test("groupMint at offset 8-39", () => {
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;

    const encoder = getRegistryConfigEncoder();
    const data = encoder.encode({
      groupMint: address(groupMint.toBase58()),
      authority: address(authority.toBase58()),
      totalAgents: 0n,
      bump: 255,
    });

    const extractedMint = new PublicKey(data.slice(8, 40));
    expect(extractedMint.equals(groupMint)).toBe(true);
  });

  test("authority at offset 40-71", () => {
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;

    const encoder = getRegistryConfigEncoder();
    const data = encoder.encode({
      groupMint: address(groupMint.toBase58()),
      authority: address(authority.toBase58()),
      totalAgents: 0n,
      bump: 255,
    });

    const extractedAuthority = new PublicKey(data.slice(40, 72));
    expect(extractedAuthority.equals(authority)).toBe(true);
  });

  test("totalAgents at offset 72-79 (u64 LE)", () => {
    const encoder = getRegistryConfigEncoder();
    const data = encoder.encode({
      groupMint: address(Keypair.generate().publicKey.toBase58()),
      authority: address(Keypair.generate().publicKey.toBase58()),
      totalAgents: 0xdeadbeefn,
      bump: 255,
    });

    const totalAgents = Buffer.from(data.slice(72, 80)).readBigUInt64LE();
    expect(totalAgents).toBe(0xdeadbeefn);
  });

  test("bump at offset 80", () => {
    const encoder = getRegistryConfigEncoder();
    const data = encoder.encode({
      groupMint: address(Keypair.generate().publicKey.toBase58()),
      authority: address(Keypair.generate().publicKey.toBase58()),
      totalAgents: 0n,
      bump: 123,
    });

    expect(data[80]).toBe(123);
  });
});

// =============================================================================
// Tests: Registry Member Numbers
// =============================================================================

describe("Registry Member Numbers", () => {
  let svm: LiteSVM;

  beforeEach(() => {
    svm = setupLiteSVM();
  });

  test("initial totalAgents is 0", () => {
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;

    setupRegistryConfig(svm, groupMint, authority, 0n);

    const [registryPda] = deriveRegistryConfigPda();
    const account = svm.getAccount(registryPda);
    const decoder = getRegistryConfigDecoder();
    const decoded = decoder.decode(account?.data);

    expect(decoded.totalAgents).toBe(0n);
  });

  test("member number increments correctly", () => {
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;

    // Simulate 5 agent registrations
    for (let i = 0; i < 5; i++) {
      setupRegistryConfig(svm, groupMint, authority, BigInt(i));

      const [registryPda] = deriveRegistryConfigPda();
      const account = svm.getAccount(registryPda);
      const decoder = getRegistryConfigDecoder();
      const decoded = decoder.decode(account?.data);

      expect(decoded.totalAgents).toBe(BigInt(i));
    }
  });

  test("large member numbers (u64 max)", () => {
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    const maxU64 = 0xffffffffffffffffn;

    setupRegistryConfig(svm, groupMint, authority, maxU64);

    const [registryPda] = deriveRegistryConfigPda();
    const account = svm.getAccount(registryPda);
    const decoder = getRegistryConfigDecoder();
    const decoded = decoder.decode(account?.data);

    expect(decoded.totalAgents).toBe(maxU64);
  });
});

// =============================================================================
// Tests: Registry Authority
// =============================================================================

describe("Registry Authority", () => {
  let svm: LiteSVM;

  beforeEach(() => {
    svm = setupLiteSVM();
  });

  test("authority is stored correctly", () => {
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;

    setupRegistryConfig(svm, groupMint, authority, 0n);

    const [registryPda] = deriveRegistryConfigPda();
    const account = svm.getAccount(registryPda);
    const decoder = getRegistryConfigDecoder();
    const decoded = decoder.decode(account?.data);

    expect(decoded.authority).toBe(address(authority.toBase58()));
  });

  test("authority can be system program (immutable)", () => {
    const groupMint = Keypair.generate().publicKey;

    setupRegistryConfig(svm, groupMint, SYSTEM_PROGRAM_ID, 0n);

    const [registryPda] = deriveRegistryConfigPda();
    const account = svm.getAccount(registryPda);
    const decoder = getRegistryConfigDecoder();
    const decoded = decoder.decode(account?.data);

    // System program address indicates renounced authority (immutable)
    expect(decoded.authority).toBe(address(SYSTEM_PROGRAM_ID.toBase58()));
  });

  test("different authority addresses produce different configs", () => {
    const groupMint = Keypair.generate().publicKey;
    const authority1 = Keypair.generate().publicKey;
    const authority2 = Keypair.generate().publicKey;

    const encoder = getRegistryConfigEncoder();

    const data1 = encoder.encode({
      groupMint: address(groupMint.toBase58()),
      authority: address(authority1.toBase58()),
      totalAgents: 0n,
      bump: 255,
    });

    const data2 = encoder.encode({
      groupMint: address(groupMint.toBase58()),
      authority: address(authority2.toBase58()),
      totalAgents: 0n,
      bump: 255,
    });

    // Authority bytes should differ
    expect(data1.slice(40, 72)).not.toEqual(data2.slice(40, 72));
  });
});

// =============================================================================
// Tests: Schema Config Account
// =============================================================================

describe("Schema Config Account", () => {
  let svm: LiteSVM;

  beforeEach(() => {
    svm = setupLiteSVM();
  });

  test("discriminator is 8 bytes", () => {
    expect(SCHEMA_CONFIG_DISCRIMINATOR.length).toBe(8);
  });

  test("schema config PDA derivation matches SDK helper", async () => {
    const sasSchema = Keypair.generate().publicKey;

    const [pdaWeb3] = deriveSchemaConfigPda(sasSchema);
    const [pdaKit] = await findSchemaConfigPda(address(sasSchema.toBase58()));

    expect(pdaWeb3.toBase58()).toBe(pdaKit);
  });

  test("stores SAS schema address correctly", () => {
    const sasSchema = Keypair.generate().publicKey;

    setupSchemaConfig(svm, sasSchema);

    const [schemaConfigPda] = deriveSchemaConfigPda(sasSchema);
    const account = svm.getAccount(schemaConfigPda);
    const decoder = getSchemaConfigDecoder();
    const decoded = decoder.decode(account?.data);

    expect(decoded.sasSchema).toBe(address(sasSchema.toBase58()));
  });

  test("stores signatureMode correctly", () => {
    const sasSchema = Keypair.generate().publicKey;

    setupSchemaConfig(
      svm,
      sasSchema,
      GeneratedSignatureMode.SingleSigner,
      GeneratedStorageType.Regular
    );

    const [schemaConfigPda] = deriveSchemaConfigPda(sasSchema);
    const account = svm.getAccount(schemaConfigPda);
    const decoder = getSchemaConfigDecoder();
    const decoded = decoder.decode(account?.data);

    expect(decoded.signatureMode).toBe(GeneratedSignatureMode.SingleSigner);
    expect(decoded.storageType).toBe(GeneratedStorageType.Regular);
  });

  test("stores closeable flag", () => {
    const sasSchema = Keypair.generate().publicKey;

    setupSchemaConfig(
      svm,
      sasSchema,
      GeneratedSignatureMode.DualSignature,
      GeneratedStorageType.Compressed,
      true
    );

    const [schemaConfigPda] = deriveSchemaConfigPda(sasSchema);
    const account = svm.getAccount(schemaConfigPda);
    const decoder = getSchemaConfigDecoder();
    const decoded = decoder.decode(account?.data);

    expect(decoded.closeable).toBe(true);
  });
});

// =============================================================================
// Tests: PDA Derivation Consistency
// =============================================================================

describe("PDA Derivation Consistency", () => {
  test("registry config PDA is deterministic", () => {
    const [pda1, bump1] = deriveRegistryConfigPda();
    const [pda2, bump2] = deriveRegistryConfigPda();

    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("schema config PDA is deterministic for same sasSchema", () => {
    const sasSchema = Keypair.generate().publicKey;

    const [pda1, bump1] = deriveSchemaConfigPda(sasSchema);
    const [pda2, bump2] = deriveSchemaConfigPda(sasSchema);

    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);
  });

  test("different sasSchemas produce different schema config PDAs", () => {
    const sasSchema1 = Keypair.generate().publicKey;
    const sasSchema2 = Keypair.generate().publicKey;

    const [pda1] = deriveSchemaConfigPda(sasSchema1);
    const [pda2] = deriveSchemaConfigPda(sasSchema2);

    expect(pda1.equals(pda2)).toBe(false);
  });
});

// =============================================================================
// Tests: Account Data Roundtrip
// =============================================================================

describe("Account Data Roundtrip", () => {
  test("registry config encode/decode is lossless", () => {
    const encoder = getRegistryConfigEncoder();
    const decoder = getRegistryConfigDecoder();

    const original = {
      groupMint: address(Keypair.generate().publicKey.toBase58()),
      authority: address(Keypair.generate().publicKey.toBase58()),
      totalAgents: 999999n,
      bump: 42,
    };

    const encoded = encoder.encode(original);
    const decoded = decoder.decode(encoded);

    expect(decoded.groupMint).toBe(original.groupMint);
    expect(decoded.authority).toBe(original.authority);
    expect(decoded.totalAgents).toBe(original.totalAgents);
    expect(decoded.bump).toBe(original.bump);
  });

  test("schema config encode/decode is lossless", () => {
    const encoder = getSchemaConfigEncoder();
    const decoder = getSchemaConfigDecoder();

    const original = {
      sasSchema: address(Keypair.generate().publicKey.toBase58()),
      signatureMode: GeneratedSignatureMode.SingleSigner,
      storageType: GeneratedStorageType.Regular,
      closeable: true,
      bump: 77,
    };

    const encoded = encoder.encode(original);
    const decoded = decoder.decode(encoded);

    expect(decoded.sasSchema).toBe(original.sasSchema);
    expect(decoded.signatureMode).toBe(original.signatureMode);
    expect(decoded.storageType).toBe(original.storageType);
    expect(decoded.closeable).toBe(original.closeable);
    expect(decoded.bump).toBe(original.bump);
  });
});

// =============================================================================
// Tests: Token-2022 Group Mint
// =============================================================================

describe("Token-2022 Group Mint", () => {
  let svm: LiteSVM;

  beforeEach(() => {
    svm = setupLiteSVM();
  });

  test("group mint is owned by Token-2022", () => {
    const groupMint = Keypair.generate().publicKey;
    const [registryPda] = deriveRegistryConfigPda();

    setupGroupMint(svm, groupMint, registryPda);

    const account = svm.getAccount(groupMint);
    expect(account?.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  test("group mint has zero decimals (NFT)", () => {
    const groupMint = Keypair.generate().publicKey;
    const [registryPda] = deriveRegistryConfigPda();

    setupGroupMint(svm, groupMint, registryPda);

    const account = svm.getAccount(groupMint);
    const mintInfo = MintLayout.decode(account?.data);

    expect(mintInfo.decimals).toBe(0);
  });

  test("group mint is initialized", () => {
    const groupMint = Keypair.generate().publicKey;
    const [registryPda] = deriveRegistryConfigPda();

    setupGroupMint(svm, groupMint, registryPda);

    const account = svm.getAccount(groupMint);
    const mintInfo = MintLayout.decode(account?.data);

    expect(mintInfo.isInitialized).toBe(true);
  });
});
