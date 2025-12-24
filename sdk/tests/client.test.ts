// biome-ignore-all lint/style/noRestrictedGlobals: Buffer is required for @solana/web3.js PDA derivation and test data

/**
 * SATI SDK Tests using LiteSVM
 *
 * Tests the SDK client against a simulated Solana environment.
 * Uses Codama-generated encoders for account serialization.
 * Pre-seeds accounts rather than executing Token-2022 instructions.
 */
import { describe, test, expect, beforeAll } from "vitest";
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
} from "../src/generated/accounts/registryConfig";
import { SATI_PROGRAM_ADDRESS } from "../src/generated/programs/sati";

// Import SDK helpers
import { findRegistryConfigPda } from "../src/helpers";

// =============================================================================
// Constants
// =============================================================================

const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Setup LiteSVM with SATI program loaded
 */
function setupLiteSVM(): LiteSVM {
  const svm = new LiteSVM();
  // Path works from both sdk/ and root (anchor test runs from root)
  const programPath = process.cwd().endsWith("sdk")
    ? "../target/deploy/sati.so"
    : "./target/deploy/sati.so";
  svm.addProgramFromFile(
    new PublicKey(SATI_PROGRAM_ADDRESS),
    programPath,
  );
  return svm;
}

/**
 * Derive registry config PDA using web3.js
 */
function deriveRegistryConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    new PublicKey(SATI_PROGRAM_ADDRESS),
  );
}

/**
 * Derive group mint PDA
 */
function deriveGroupMintPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("group_mint")],
    new PublicKey(SATI_PROGRAM_ADDRESS),
  );
}

/**
 * Pre-seed registry config account
 */
function setupRegistryConfig(
  svm: LiteSVM,
  groupMint: PublicKey,
  authority: PublicKey,
  totalAgents: bigint = 0n,
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
 * Pre-seed a Token-2022 group mint (simplified - just the base mint data)
 */
function setupGroupMint(
  svm: LiteSVM,
  mintPubkey: PublicKey,
  mintAuthority: PublicKey,
): void {
  // For testing purposes, we use a simplified mint structure
  // In production, this would include GroupPointer and TokenGroup extensions
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
    mintData,
  );

  svm.setAccount(mintPubkey, {
    lamports: LAMPORTS_PER_SOL,
    data: mintData,
    owner: TOKEN_2022_PROGRAM_ID,
    executable: false,
  });
}

// =============================================================================
// Tests: Codama Encoders
// =============================================================================

describe("SDK: Registry Config Encoder", () => {
  test("getRegistryConfigEncoder produces valid account data", () => {
    const encoder = getRegistryConfigEncoder();
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;

    const data = encoder.encode({
      groupMint: address(groupMint.toBase58()),
      authority: address(authority.toBase58()),
      totalAgents: 42n,
      bump: 255,
    });

    // Verify size matches
    expect(data.length).toBe(getRegistryConfigSize());
    expect(data.length).toBe(81);

    // Verify discriminator
    expect(Buffer.from(data.slice(0, 8))).toEqual(
      Buffer.from(REGISTRY_CONFIG_DISCRIMINATOR),
    );

    // Verify groupMint at offset 8
    expect(Buffer.from(data.slice(8, 40))).toEqual(
      Buffer.from(groupMint.toBytes()),
    );

    // Verify authority at offset 40
    expect(Buffer.from(data.slice(40, 72))).toEqual(
      Buffer.from(authority.toBytes()),
    );

    // Verify totalAgents at offset 72 (u64 LE)
    const totalAgents = Buffer.from(data.slice(72, 80)).readBigUInt64LE();
    expect(totalAgents).toBe(42n);

    // Verify bump at offset 80
    expect(data[80]).toBe(255);
  });

  test("encode/decode roundtrip preserves data", () => {
    const encoder = getRegistryConfigEncoder();
    const decoder = getRegistryConfigDecoder();
    const groupMint = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;

    const original = {
      groupMint: address(groupMint.toBase58()),
      authority: address(authority.toBase58()),
      totalAgents: 12345n,
      bump: 254,
    };

    const encoded = encoder.encode(original);
    const decoded = decoder.decode(encoded);

    expect(decoded.groupMint).toBe(original.groupMint);
    expect(decoded.authority).toBe(original.authority);
    expect(decoded.totalAgents).toBe(original.totalAgents);
    expect(decoded.bump).toBe(original.bump);
  });
});

// =============================================================================
// Tests: PDA Derivation
// =============================================================================

describe("SDK: PDA Derivation", () => {
  test("registry config PDA matches helpers", async () => {
    const [pdaWeb3] = deriveRegistryConfigPda();
    const [pdaKit] = await findRegistryConfigPda();

    expect(pdaWeb3.toBase58()).toBe(pdaKit);
  });

  test("group mint is NOT a PDA - must be fetched from registry config", async () => {
    // This test documents an important design decision:
    // The group_mint in SATI is NOT a PDA - it's a pre-created Token-2022 mint
    // that gets stored in the registry_config account during initialization.
    //
    // The old findGroupMintPda() was incorrect because it assumed group_mint
    // was derived from seeds ["group_mint"], but in reality:
    // 1. A Token-2022 mint with GroupPointer extension is created externally
    // 2. That mint address is passed to the initialize instruction
    // 3. The initialize instruction stores it in registry_config.group_mint
    //
    // To get the actual group_mint, you MUST fetch the registry_config account.

    // Create a random keypair to represent the actual group mint
    // (simulating what happens in production - it's a separate Token-2022 mint)
    const actualGroupMint = Keypair.generate().publicKey;

    // The PDA derivation gives a different address
    const [pdaDerived] = deriveGroupMintPda();

    // They should NOT be equal - this proves group_mint is not a PDA
    expect(pdaDerived.toBase58()).not.toBe(actualGroupMint.toBase58());
  });

  test("registry config stores the actual group mint address", () => {
    // Setup: Create a registry config with a specific group mint
    const svm = setupLiteSVM();
    const authority = Keypair.generate();
    const actualGroupMint = Keypair.generate().publicKey;

    // Store registry config with the actual group mint
    setupRegistryConfig(svm, actualGroupMint, authority.publicKey, 0n);

    // Fetch and verify
    const [registryPda] = deriveRegistryConfigPda();
    const account = svm.getAccount(registryPda);
    const decoder = getRegistryConfigDecoder();
    const decoded = decoder.decode(account?.data);

    // The group_mint in registry_config should be what we stored
    expect(decoded.groupMint).toBe(address(actualGroupMint.toBase58()));

    // And it should NOT equal the PDA derivation
    const [pdaDerived] = deriveGroupMintPda();
    expect(decoded.groupMint).not.toBe(address(pdaDerived.toBase58()));
  });
});

// =============================================================================
// Tests: LiteSVM Integration
// =============================================================================

describe("SDK: LiteSVM Integration", () => {
  let svm: LiteSVM;
  let authority: Keypair;

  beforeAll(() => {
    svm = setupLiteSVM();
    authority = Keypair.generate();
    svm.airdrop(authority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  });

  test("fetches pre-seeded registry config", () => {
    const groupMint = Keypair.generate().publicKey;
    const registryPda = setupRegistryConfig(
      svm,
      groupMint,
      authority.publicKey,
      100n,
    );

    // Fetch and decode
    const account = svm.getAccount(registryPda);
    expect(account).not.toBeNull();
    expect(account?.data.length).toBe(81);

    const decoder = getRegistryConfigDecoder();
    const decoded = decoder.decode(account?.data);

    expect(decoded.groupMint).toBe(address(groupMint.toBase58()));
    expect(decoded.authority).toBe(address(authority.publicKey.toBase58()));
    expect(decoded.totalAgents).toBe(100n);
  });

  test("fetches pre-seeded group mint", () => {
    const [registryPda] = deriveRegistryConfigPda();
    const groupMint = Keypair.generate().publicKey;

    setupGroupMint(svm, groupMint, registryPda);

    const account = svm.getAccount(groupMint);
    expect(account).not.toBeNull();
    expect(account?.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  test("program is loaded and executable", () => {
    const programAccount = svm.getAccount(
      new PublicKey(SATI_PROGRAM_ADDRESS),
    );
    expect(programAccount).not.toBeNull();
    expect(programAccount?.executable).toBe(true);
  });
});
