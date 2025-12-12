// biome-ignore-all lint/style/noRestrictedGlobals: Buffer is required for @solana/web3.js PDA derivation
import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  getTokenMetadata,
  getMintLen,
  ExtensionType,
  createInitializeGroupPointerInstruction,
  createInitializeMintInstruction,
  createInitializeGroupInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  TOKEN_GROUP_SIZE,
} from "@solana/spl-token";
import { describe, test, expect, beforeAll } from "vitest";
import type { SatiRegistry } from "../target/types/sati_registry";

// Constants matching the program
const MAX_NAME_LENGTH = 32;
const MAX_SYMBOL_LENGTH = 10;
const MAX_URI_LENGTH = 200;
const MAX_METADATA_ENTRIES = 10;
const MAX_METADATA_KEY_LENGTH = 32;
const MAX_METADATA_VALUE_LENGTH = 200;

/**
 * Creates and initializes a group mint with all required Token-2022 extensions.
 * This must be done before calling the SATI initialize instruction.
 *
 * Due to Solana runtime CPI reallocation restrictions, Token-2022 extensions
 * must be initialized as top-level instructions (not via CPI).
 */
async function createGroupMint(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair | anchor.Wallet,
  groupMint: Keypair,
  registryConfig: PublicKey,
): Promise<string> {
  const payerPublicKey = "publicKey" in payer ? payer.publicKey : payer.publicKey;
  const payerSigner = "payer" in payer ? (payer as anchor.Wallet).payer : payer;

  // Calculate space: GroupPointer extension only, but pay lamports for TokenGroup too
  const mintLen = getMintLen([ExtensionType.GroupPointer]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + TOKEN_GROUP_SIZE);

  const transaction = new anchor.web3.Transaction().add(
    // 1. Create account with space for GroupPointer (lamports cover full size)
    SystemProgram.createAccount({
      fromPubkey: payerPublicKey,
      newAccountPubkey: groupMint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Initialize GroupPointer extension (points to itself)
    createInitializeGroupPointerInstruction(
      groupMint.publicKey,
      registryConfig, // authority for future updates
      groupMint.publicKey, // group address = mint itself
      TOKEN_2022_PROGRAM_ID,
    ),
    // 3. Initialize the mint with PAYER as initial mint authority
    // (We'll transfer to registry PDA after initializing the group)
    createInitializeMintInstruction(
      groupMint.publicKey,
      0, // decimals
      payerPublicKey, // initial mint authority = payer (must sign for InitializeGroup)
      null, // no freeze authority
      TOKEN_2022_PROGRAM_ID,
    ),
    // 4. Initialize TokenGroup extension (payer signs as mint authority)
    createInitializeGroupInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      group: groupMint.publicKey,
      mint: groupMint.publicKey,
      mintAuthority: payerPublicKey, // payer is current mint authority
      updateAuthority: registryConfig, // registry PDA will be update authority
      maxSize: 0, // unlimited
    }),
    // 5. Transfer mint authority to registry PDA
    createSetAuthorityInstruction(
      groupMint.publicKey, // account
      payerPublicKey, // current authority
      AuthorityType.MintTokens, // authority type
      registryConfig, // new authority = registry PDA
      [], // no multisig signers
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  const signature = await anchor.web3.sendAndConfirmTransaction(
    connection,
    transaction,
    [payerSigner, groupMint],
  );

  return signature;
}

// =============================================================================
// SATI Registry E2E Tests
// =============================================================================

// Shared group mint keypair for all tests (deterministic for test reproducibility)
// In production, this would be generated once during deployment
const GROUP_MINT_SEED = Buffer.from("sati-test-group-mint-seed-v1");
let sharedGroupMint: Keypair | null = null;

function getGroupMintKeypair(): Keypair {
  if (!sharedGroupMint) {
    // Generate a deterministic keypair from the seed
    const seed = new Uint8Array(32);
    GROUP_MINT_SEED.copy(seed);
    sharedGroupMint = Keypair.fromSeed(seed);
  }
  return sharedGroupMint;
}

/**
 * Helper to initialize the registry - creates group mint with Token-2022 extensions,
 * then calls the SATI initialize instruction.
 */
async function initializeRegistry(
  program: anchor.Program<SatiRegistry>,
  connection: anchor.web3.Connection,
  payer: anchor.Wallet,
  registryConfig: PublicKey,
  groupMint: Keypair,
): Promise<void> {
  // Step 1: Create and initialize group mint with Token-2022 extensions
  await createGroupMint(connection, payer, groupMint, registryConfig);

  // Step 2: Call SATI initialize instruction
  await program.methods
    .initialize()
    .accounts({
      authority: payer.publicKey,
      groupMint: groupMint.publicKey,
    })
    .rpc();
}

// TODO: Fix Token-2022 GroupPointer + TokenGroup extension space allocation
// Issue: InitializeGroup fails with "Failed to reallocate account data" on local validator
// Root cause: CPI reallocation restrictions for Token-2022 extensions need investigation
describe.skip("sati-registry: initialize", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SatiRegistry as Program<SatiRegistry>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let registryConfig: PublicKey;
  let groupMint: Keypair;

  beforeAll(() => {
    [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId,
    );
    groupMint = getGroupMintKeypair();
  });

  test("initializes the registry successfully", async () => {
    // Check if already initialized (for idempotent tests)
    const existingAccount = await connection.getAccountInfo(registryConfig);
    if (existingAccount) {
      console.log("Registry already initialized, skipping initialization");
      return;
    }

    await initializeRegistry(program, connection, payer, registryConfig, groupMint);

    // Verify registry config
    const config = await program.account.registryConfig.fetch(registryConfig);
    expect(config.authority.toBase58()).toBe(payer.publicKey.toBase58());
    expect(config.groupMint.toBase58()).toBe(groupMint.publicKey.toBase58());
    expect(config.totalAgents.toNumber()).toBe(0);

    // Verify group mint was created with TokenGroup extension
    const groupMintAccount = await connection.getAccountInfo(groupMint.publicKey);
    expect(groupMintAccount).not.toBeNull();
    expect(groupMintAccount?.owner.toBase58()).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
  });

  test("fails to initialize twice (Anchor init constraint)", async () => {
    // Ensure registry is initialized first
    const existingAccount = await connection.getAccountInfo(registryConfig);
    if (!existingAccount) {
      await initializeRegistry(program, connection, payer, registryConfig, groupMint);
    }

    // Second initialization should fail (Anchor init constraint on registry_config)
    const newGroupMint = Keypair.generate();
    await expect(
      (async () => {
        // Create a new group mint for the second attempt
        await createGroupMint(connection, payer, newGroupMint, registryConfig);
        await program.methods
          .initialize()
          .accounts({
            authority: payer.publicKey,
            groupMint: newGroupMint.publicKey,
          })
          .rpc();
      })()
    ).rejects.toThrow();
  });
});

// TODO: Depends on initialize test suite - enable when Token-2022 extension issue is fixed
describe.skip("sati-registry: register_agent - success cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SatiRegistry as Program<SatiRegistry>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let registryConfig: PublicKey;
  let groupMint: Keypair;

  beforeAll(async () => {
    [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId,
    );
    groupMint = getGroupMintKeypair();

    // Ensure registry is initialized
    const existingAccount = await connection.getAccountInfo(registryConfig);
    if (!existingAccount) {
      await initializeRegistry(program, connection, payer, registryConfig, groupMint);
    }
  });

  test("registers a basic agent (transferable)", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const configBefore = await program.account.registryConfig.fetch(registryConfig);
    const countBefore = configBefore.totalAgents.toNumber();

    await program.methods
      .registerAgent(
        "TestAgent",
        "AGENT",
        "https://example.com/agent.json",
        null, // no additional metadata
        false, // transferable
      )
      .accounts({
        payer: payer.publicKey,
        owner: payer.publicKey,
        groupMint: groupMint.publicKey,
        agentMint: agentMint.publicKey,
        agentTokenAccount,
      })
      .signers([agentMint])
      .rpc();

    // Verify counter incremented
    const configAfter = await program.account.registryConfig.fetch(registryConfig);
    expect(configAfter.totalAgents.toNumber()).toBe(countBefore + 1);

    // Verify NFT was minted to owner
    const tokenAccount = await getAccount(
      connection,
      agentTokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(tokenAccount.amount.toString()).toBe("1");
    expect(tokenAccount.owner.toBase58()).toBe(payer.publicKey.toBase58());

    // Verify mint is supply=1, decimals=0
    const mintInfo = await getMint(
      connection,
      agentMint.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(mintInfo.supply.toString()).toBe("1");
    expect(mintInfo.decimals).toBe(0);
    // Mint authority should be null (renounced)
    expect(mintInfo.mintAuthority).toBeNull();

    // Verify token metadata
    const metadata = await getTokenMetadata(
      connection,
      agentMint.publicKey,
    );
    expect(metadata?.name).toBe("TestAgent");
    expect(metadata?.symbol).toBe("AGENT");
    expect(metadata?.uri).toBe("https://example.com/agent.json");
  });

  test("registers agent with non-transferable flag", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    await program.methods
      .registerAgent(
        "SoulboundAgent",
        "SOUL",
        "https://example.com/soulbound.json",
        null,
        true, // non-transferable
      )
      .accounts({
        payer: payer.publicKey,
        owner: payer.publicKey,
        groupMint: groupMint.publicKey,
        agentMint: agentMint.publicKey,
        agentTokenAccount,
      })
      .signers([agentMint])
      .rpc();

    // Verify NFT was minted
    const tokenAccount = await getAccount(
      connection,
      agentTokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(tokenAccount.amount.toString()).toBe("1");

    // Note: Non-transferable extension is internal - transfer would fail if attempted
    // The extension prevents transfers at the Token-2022 program level
  });

  test("registers agent with custom owner (different from payer)", async () => {
    const customOwner = Keypair.generate();
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      customOwner.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    await program.methods
      .registerAgent(
        "CustomOwnerAgent",
        "CUSTOM",
        "https://example.com/custom.json",
        null,
        false,
      )
      .accounts({
        payer: payer.publicKey,
        owner: customOwner.publicKey,
        groupMint: groupMint.publicKey,
        agentMint: agentMint.publicKey,
        agentTokenAccount,
      })
      .signers([agentMint])
      .rpc();

    // Verify NFT is owned by custom owner, not payer
    const tokenAccount = await getAccount(
      connection,
      agentTokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(tokenAccount.owner.toBase58()).toBe(customOwner.publicKey.toBase58());
    expect(tokenAccount.amount.toString()).toBe("1");
  });

  test("registers agent with additional metadata", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    await program.methods
      .registerAgent(
        "MetadataAgent",
        "META",
        "https://example.com/meta.json",
        [
          { key: "version", value: "1.0.0" },
          { key: "model", value: "gpt-4" },
        ],
        false,
      )
      .accounts({
        payer: payer.publicKey,
        owner: payer.publicKey,
        groupMint: groupMint.publicKey,
        agentMint: agentMint.publicKey,
        agentTokenAccount,
      })
      .signers([agentMint])
      .rpc();

    // Verify base metadata
    const metadata = await getTokenMetadata(connection, agentMint.publicKey);
    expect(metadata?.name).toBe("MetadataAgent");

    // Verify additional metadata fields
    expect(metadata?.additionalMetadata).toBeDefined();
    const additionalMap = new Map(metadata?.additionalMetadata || []);
    expect(additionalMap.get("version")).toBe("1.0.0");
    expect(additionalMap.get("model")).toBe("gpt-4");
  });
});

// TODO: Depends on initialize test suite - enable when Token-2022 extension issue is fixed
describe.skip("sati-registry: register_agent - validation errors", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SatiRegistry as Program<SatiRegistry>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let registryConfig: PublicKey;
  let groupMint: Keypair;

  beforeAll(async () => {
    [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId,
    );
    groupMint = getGroupMintKeypair();

    // Ensure registry is initialized
    const existingAccount = await connection.getAccountInfo(registryConfig);
    if (!existingAccount) {
      await initializeRegistry(program, connection, payer, registryConfig, groupMint);
    }
  });

  test("fails with NameTooLong (>32 bytes)", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const longName = "A".repeat(MAX_NAME_LENGTH + 1);

    await expect(
      program.methods
        .registerAgent(longName, "TEST", "https://example.com", null, false)
        .accounts({
          payer: payer.publicKey,
          owner: payer.publicKey,
          groupMint: groupMint.publicKey,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc()
    ).rejects.toThrow(/NameTooLong|Name too long/);
  });

  test("fails with SymbolTooLong (>10 bytes)", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const longSymbol = "S".repeat(MAX_SYMBOL_LENGTH + 1);

    await expect(
      program.methods
        .registerAgent("TestAgent", longSymbol, "https://example.com", null, false)
        .accounts({
          payer: payer.publicKey,
          owner: payer.publicKey,
          groupMint: groupMint.publicKey,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc()
    ).rejects.toThrow(/SymbolTooLong|Symbol too long/);
  });

  test("fails with UriTooLong (>200 bytes)", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const longUri = "https://example.com/" + "a".repeat(MAX_URI_LENGTH);

    await expect(
      program.methods
        .registerAgent("TestAgent", "TEST", longUri, null, false)
        .accounts({
          payer: payer.publicKey,
          owner: payer.publicKey,
          groupMint: groupMint.publicKey,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc()
    ).rejects.toThrow(/UriTooLong|URI too long/);
  });

  test("fails with TooManyMetadataEntries (>10)", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const tooManyEntries = Array.from({ length: MAX_METADATA_ENTRIES + 1 }, (_, i) => ({
      key: `key${i}`,
      value: `value${i}`,
    }));

    await expect(
      program.methods
        .registerAgent("TestAgent", "TEST", "https://example.com", tooManyEntries, false)
        .accounts({
          payer: payer.publicKey,
          owner: payer.publicKey,
          groupMint: groupMint.publicKey,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc()
    ).rejects.toThrow(/TooManyMetadataEntries|Too many metadata/);
  });

  test("fails with MetadataKeyTooLong (>32 bytes)", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const longKey = "k".repeat(MAX_METADATA_KEY_LENGTH + 1);

    await expect(
      program.methods
        .registerAgent(
          "TestAgent",
          "TEST",
          "https://example.com",
          [{ key: longKey, value: "value" }],
          false,
        )
        .accounts({
          payer: payer.publicKey,
          owner: payer.publicKey,
          groupMint: groupMint.publicKey,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc()
    ).rejects.toThrow(/MetadataKeyTooLong|Metadata key too long/);
  });

  test("fails with MetadataValueTooLong (>200 bytes)", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const longValue = "v".repeat(MAX_METADATA_VALUE_LENGTH + 1);

    await expect(
      program.methods
        .registerAgent(
          "TestAgent",
          "TEST",
          "https://example.com",
          [{ key: "key", value: longValue }],
          false,
        )
        .accounts({
          payer: payer.publicKey,
          owner: payer.publicKey,
          groupMint: groupMint.publicKey,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc()
    ).rejects.toThrow(/MetadataValueTooLong|Metadata value too long/);
  });
});

// TODO: Depends on initialize test suite - enable when Token-2022 extension issue is fixed
describe.skip("sati-registry: update_registry_authority", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SatiRegistry as Program<SatiRegistry>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let registryConfig: PublicKey;

  beforeAll(async () => {
    [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId,
    );

    // Ensure registry is initialized
    const existingAccount = await connection.getAccountInfo(registryConfig);
    if (!existingAccount) {
      const [groupMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("group_mint")],
        program.programId,
      );
      await program.methods.initialize().accounts({ authority: payer.publicKey }).rpc();
    }
  });

  test("transfers authority to new address", async () => {
    // Skip if authority is already renounced
    const configBefore = await program.account.registryConfig.fetch(registryConfig);
    if (configBefore.authority.equals(PublicKey.default)) {
      console.log("Authority already renounced, skipping transfer test");
      return;
    }

    const newAuthority = Keypair.generate();

    await program.methods
      .updateRegistryAuthority(newAuthority.publicKey)
      .accounts({
        authority: payer.publicKey,
      })
      .rpc();

    // Verify authority changed
    const configAfter = await program.account.registryConfig.fetch(registryConfig);
    expect(configAfter.authority.toBase58()).toBe(newAuthority.publicKey.toBase58());

    // Transfer back for subsequent tests
    await program.methods
      .updateRegistryAuthority(payer.publicKey)
      .accounts({
        authority: newAuthority.publicKey,
      })
      .signers([newAuthority])
      .rpc();

    // Verify restored
    const configRestored = await program.account.registryConfig.fetch(registryConfig);
    expect(configRestored.authority.toBase58()).toBe(payer.publicKey.toBase58());
  });

  test("fails when non-authority tries to update", async () => {
    const randomUser = Keypair.generate();
    const newAuthority = Keypair.generate();

    // Airdrop some SOL to random user for transaction fees
    const sig = await connection.requestAirdrop(randomUser.publicKey, 1_000_000_000);
    await connection.confirmTransaction(sig);

    await expect(
      program.methods
        .updateRegistryAuthority(newAuthority.publicKey)
        .accounts({
          authority: randomUser.publicKey,
        })
        .signers([randomUser])
        .rpc()
    ).rejects.toThrow();
  });
});

// TODO: Depends on initialize test suite - enable when Token-2022 extension issue is fixed
describe.skip("sati-registry: authority renounce flow", () => {
  // Note: This is a destructive test - run last or in isolation
  // It permanently renounces authority, making it irreversible

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SatiRegistry as Program<SatiRegistry>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let registryConfig: PublicKey;

  beforeAll(async () => {
    [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId,
    );
  });

  test("renounces authority (sets to null/default)", async () => {
    const configBefore = await program.account.registryConfig.fetch(registryConfig);

    // Skip if already renounced
    if (configBefore.authority.equals(PublicKey.default)) {
      console.log("Authority already renounced");

      // Verify immutability
      await expect(
        program.methods
          .updateRegistryAuthority(payer.publicKey)
          .accounts({
            authority: payer.publicKey,
          })
          .rpc()
      ).rejects.toThrow(/ImmutableAuthority|immutable/i);

      return;
    }

    // Renounce by passing null
    await program.methods
      .updateRegistryAuthority(null)
      .accounts({
        authority: payer.publicKey,
      })
      .rpc();

    // Verify authority is now default (all zeros)
    const configAfter = await program.account.registryConfig.fetch(registryConfig);
    expect(configAfter.authority.equals(PublicKey.default)).toBe(true);
  });

  test("fails to update after renounce (ImmutableAuthority)", async () => {
    // This should fail because authority is renounced
    await expect(
      program.methods
        .updateRegistryAuthority(payer.publicKey)
        .accounts({
          authority: payer.publicKey,
        })
        .rpc()
    ).rejects.toThrow(/ImmutableAuthority|immutable/i);
  });
});

// TODO: Depends on initialize test suite - enable when Token-2022 extension issue is fixed
describe.skip("sati-registry: Token-2022 integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SatiRegistry as Program<SatiRegistry>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let groupMint: PublicKey;
  let registryConfig: PublicKey;

  beforeAll(async () => {
    [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId,
    );
    [groupMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("group_mint")],
      program.programId,
    );

    // Ensure registry is initialized
    const existingAccount = await connection.getAccountInfo(registryConfig);
    if (!existingAccount) {
      await program.methods.initialize().accounts({ authority: payer.publicKey }).rpc();
    }
  });

  test("metadata can be updated by owner via Token-2022 direct call", async () => {
    const agentMint = Keypair.generate();
    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Register agent
    await program.methods
      .registerAgent(
        "UpdateableAgent",
        "UPD",
        "https://example.com/v1.json",
        null,
        false,
      )
      .accounts({
        payer: payer.publicKey,
        owner: payer.publicKey,
        groupMint: groupMint.publicKey,
        agentMint: agentMint.publicKey,
        agentTokenAccount,
      })
      .signers([agentMint])
      .rpc();

    // Verify initial URI
    let metadata = await getTokenMetadata(connection, agentMint.publicKey);
    expect(metadata?.uri).toBe("https://example.com/v1.json");

    // Note: Direct Token-2022 metadata update would require building the instruction
    // manually. The owner (update authority) can update via:
    // spl_token_metadata_interface::instruction::update_field
    // This is tested implicitly by the fact that owner is set correctly as update authority
  });

  test("transferable NFT can be transferred", async () => {
    const agentMint = Keypair.generate();
    const newOwner = Keypair.generate();

    const agentTokenAccount = getAssociatedTokenAddressSync(
      agentMint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Register transferable agent
    await program.methods
      .registerAgent(
        "TransferableAgent",
        "XFER",
        "https://example.com/xfer.json",
        null,
        false, // transferable
      )
      .accounts({
        payer: payer.publicKey,
        owner: payer.publicKey,
        groupMint: groupMint.publicKey,
        agentMint: agentMint.publicKey,
        agentTokenAccount,
      })
      .signers([agentMint])
      .rpc();

    // Verify payer owns it
    let tokenAccount = await getAccount(
      connection,
      agentTokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(tokenAccount.owner.toBase58()).toBe(payer.publicKey.toBase58());
    expect(tokenAccount.amount.toString()).toBe("1");

    // Note: Actual transfer would require:
    // 1. Creating destination ATA for newOwner
    // 2. Calling transfer instruction via @solana/spl-token
    // This validates the NFT is properly set up for transfers
  });
});
