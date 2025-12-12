/**
 * SATI Example: Smart Account Agent (Squads Integration)
 *
 * Demonstrates how to register an agent owned by a Squads smart account (multisig).
 * This is the recommended pattern for production deployments.
 *
 * Benefits:
 * - Multi-party control over agent identity
 * - Proposal-based transfers and updates
 * - No single point of failure
 */

import {
  createSolanaRpc,
  generateKeyPairSigner,
  address,
  lamports,
} from "@solana/kit";
import {
  SATI,
  getRegisterAgentInstructionAsync,
  findGroupMintPda,
  findAssociatedTokenAddress,
} from "@sati/sdk";

// Configuration
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const NETWORK = (process.env.NETWORK ?? "localnet") as
  | "mainnet"
  | "devnet"
  | "localnet";

async function main() {
  console.log("SATI Smart Account Agent Example\n");
  console.log(
    "This example demonstrates registering an agent owned by a Squads smart account.\n"
  );

  // Initialize SATI client
  const sati = new SATI({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  // Create payer (in production, this would be a Squads member)
  const payer = await generateKeyPairSigner();
  console.log(`Payer: ${payer.address}`);

  // Request airdrop for testing
  if (NETWORK !== "mainnet") {
    console.log("Requesting airdrop...");
    const rpc = createSolanaRpc(RPC_URL);
    await rpc.requestAirdrop(payer.address, lamports(1_000_000_000n)).send();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("Airdrop confirmed\n");
  }

  // ============================================================
  // Smart Account Setup (Squads)
  // ============================================================
  // In production, you would:
  // 1. Create a Squads smart account
  // 2. Use the smart account PDA as the agent owner
  // 3. Register agent via Squads proposal

  // Example Squads smart account PDA (replace with real one)
  const squadsSmartAccount = address(
    "SquadsSmartAccount111111111111111111111111"
  );
  console.log(`Squads Smart Account: ${squadsSmartAccount}`);
  console.log("(This would be your actual Squads multisig PDA)\n");

  // ============================================================
  // Option 1: Direct Registration with Smart Account Owner
  // ============================================================
  console.log("Option 1: Direct Registration with SATI SDK");
  console.log("==========================================");
  console.log("Register agent with smart account as owner using high-level API.\n");

  console.log("```typescript");
  console.log("const result = await sati.registerAgent({");
  console.log("  payer,");
  console.log('  name: "EnterpriseAgent",');
  console.log('  uri: "ipfs://QmEnterpriseAgentRegistration",');
  console.log("  owner: squadsSmartAccount, // Smart account owns the agent");
  console.log("  additionalMetadata: [");
  console.log("    { key: \"agentWallet\", value: `solana:${squadsSmartAccount}` },");
  console.log('    { key: "did", value: "did:web:enterprise.example.com" },');
  console.log("  ],");
  console.log("});");
  console.log("```\n");

  // ============================================================
  // Option 2: Build Instruction for Squads Proposal
  // ============================================================
  console.log("Option 2: Build Instruction for Squads Proposal");
  console.log("==============================================");
  console.log("For existing Squads accounts, build the instruction manually:\n");

  // Generate agent mint
  const agentMint = await generateKeyPairSigner();
  console.log(`Agent Mint: ${agentMint.address}`);

  // Derive PDAs using SDK helpers
  const [groupMint] = await findGroupMintPda();
  const [agentTokenAccount] = await findAssociatedTokenAddress(
    agentMint.address,
    squadsSmartAccount
  );

  // Build register agent instruction
  const registerAgentIx = await getRegisterAgentInstructionAsync({
    payer,
    owner: squadsSmartAccount,
    groupMint,
    agentMint,
    agentTokenAccount,
    name: "EnterpriseAgent",
    symbol: "SATI",
    uri: "ipfs://QmEnterpriseAgentRegistration",
    additionalMetadata: [
      { key: "agentWallet", value: `solana:${squadsSmartAccount}` },
      { key: "did", value: "did:web:enterprise.example.com" },
      {
        key: "a2a",
        value: "https://agent.enterprise.example/.well-known/agent-card.json",
      },
    ],
    nonTransferable: false,
  });

  console.log("Instruction built successfully.\n");
  console.log("Submit via Squads:");
  console.log("```typescript");
  console.log("import { Squads } from '@sqds/multisig';");
  console.log("");
  console.log("const multisig = Squads.endpoint(connection, squadsSmartAccount);");
  console.log("");
  console.log("// Create proposal with register agent instruction");
  console.log("const [proposal] = await multisig.proposalCreate({");
  console.log("  creator: memberPubkey,");
  console.log("  instructions: [registerAgentIx],");
  console.log("});");
  console.log("");
  console.log("// Members vote on proposal");
  console.log("await multisig.proposalApprove({");
  console.log("  member: memberKeypair,");
  console.log("  proposal: proposal,");
  console.log("});");
  console.log("");
  console.log("// Execute when threshold reached");
  console.log("await multisig.proposalExecute({ proposal });");
  console.log("```\n");

  // ============================================================
  // Transferring Agent via Squads
  // ============================================================
  console.log("Transferring Agent via Squads");
  console.log("============================");
  console.log("For agents owned by EOAs, use the SATI SDK directly:\n");
  console.log("```typescript");
  console.log("await sati.transferAgent({");
  console.log("  payer,");
  console.log("  owner, // Current owner keypair (must sign)");
  console.log("  mint: agentMint,");
  console.log("  newOwner: newOwnerAddress,");
  console.log("});");
  console.log("```\n");

  console.log("For smart account-owned agents, use Squads proposal:\n");
  console.log("```typescript");
  console.log("import { getTransferInstruction } from '@solana-program/token-2022';");
  console.log("");
  console.log("const transferIx = getTransferInstruction({");
  console.log("  source: currentOwnerAta,");
  console.log("  destination: newOwnerAta,");
  console.log("  authority: squadsSmartAccount,");
  console.log("  amount: 1n,");
  console.log("});");
  console.log("");
  console.log("// Submit via Squads proposal...");
  console.log("```\n");

  // ============================================================
  // Reading Agent Data
  // ============================================================
  console.log("Reading Agent Data");
  console.log("==================");
  console.log("Works regardless of ownership type:\n");
  console.log("```typescript");
  console.log("const agent = await sati.loadAgent(agentMint);");
  console.log("console.log(`Owner: ${agent.owner}`);");
  console.log("console.log(`Name: ${agent.name}`);");
  console.log("console.log(`Soulbound: ${agent.nonTransferable}`);");
  console.log("```\n");

  // ============================================================
  // Benefits Summary
  // ============================================================
  console.log("Why Use Smart Accounts?");
  console.log("=======================");
  console.log("1. Multi-party control - No single key can modify the agent");
  console.log(
    "2. Proposal workflow - Changes require approval from multiple parties"
  );
  console.log("3. Audit trail - All actions are recorded on-chain");
  console.log("4. Recovery options - Lost keys don't mean lost access");
  console.log("5. Enterprise ready - Meets compliance requirements");
}

main().catch(console.error);
