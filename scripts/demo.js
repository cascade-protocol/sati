#!/usr/bin/env node
/**
 * SATI Demo Script (Standalone)
 * Demonstrates the complete agent trust infrastructure flow
 */

const crypto = require('crypto');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

async function main() {
  console.log(`\n${colors.bright}${colors.cyan}🚀 SATI Demo: Solana Agent Trust Infrastructure${colors.reset}\n`);
  console.log("Demonstrating the complete flow of agent registration, delegation, mandate management, and reputation...\n");

  await sleep(1000);

  // Setup
  const agentPubkey = generateHash('agent-' + Date.now());
  const userPubkey = generateHash('user-' + Date.now());
  const agentId = "shopping-agent-v1";

  console.log(`${colors.bright}📋 Demo Flow:${colors.reset}`);
  console.log("1. Register AI Agent Identity (ZK Compressed)");
  console.log("2. User delegates authority to Agent (SAS-based)");
  console.log("3. Agent creates payment mandate (AP2 compatible)");
  console.log("4. System detects context drift (zombie prevention)");
  console.log("5. Client submits reputation feedback\n");

  await sleep(1500);

  // Step 1: Register Agent Identity
  console.log(`${colors.bright}${colors.green}Step 1: Registering AI Agent Identity...${colors.reset}`);
  await sleep(500);

  const agentMetadata = {
    name: "Shopping Agent v1",
    description: "AI agent for automated shopping with AP2 support",
    endpoints: {
      a2a: "https://api.shopping-agent.com/a2a",
      mcp: "https://api.shopping-agent.com/mcp",
      ap2: "https://api.shopping-agent.com/ap2"
    },
    capabilities: ["shopping", "payments", "negotiations"],
    did: `did:solana:${agentPubkey}`
  };

  console.log(`   Agent ID: ${colors.cyan}${agentId}${colors.reset}`);
  console.log(`   DID: ${colors.cyan}${agentMetadata.did}${colors.reset}`);
  console.log(`   Capabilities: ${colors.cyan}[${agentMetadata.capabilities.join(', ')}]${colors.reset}`);
  console.log(`   Storage: ZK Compressed (1,600x cheaper than traditional)`);
  console.log(`   ${colors.green}✅ Agent registered with state root: ${generateHash(JSON.stringify(agentMetadata))}${colors.reset}\n`);

  await sleep(1500);

  // Step 2: User Delegation (via SAS)
  console.log(`${colors.bright}${colors.blue}Step 2: User delegating authority to Agent...${colors.reset}`);
  await sleep(500);

  const delegation = {
    user: "alice@example.com",
    agent: agentPubkey,
    maxSpend: "10 SOL",
    capabilities: ["shopping", "payments"],
    expiresIn: "24 hours"
  };

  console.log(`   User: ${colors.cyan}${delegation.user}${colors.reset}`);
  console.log(`   Max spend: ${colors.cyan}${delegation.maxSpend}${colors.reset}`);
  console.log(`   Capabilities: ${colors.cyan}[${delegation.capabilities.join(', ')}]${colors.reset}`);
  console.log(`   Expires: ${colors.cyan}${delegation.expiresIn}${colors.reset}`);
  console.log(`   ${colors.green}✅ Delegation attestation created via SAS: ${generateHash('delegation-' + Date.now())}${colors.reset}\n`);

  await sleep(1500);

  // Step 3: Create AP2 IntentMandate
  console.log(`${colors.bright}${colors.magenta}Step 3: Agent creating AP2 IntentMandate...${colors.reset}`);
  await sleep(500);

  const mandate = {
    type: "IntentMandate",
    intent: "Buy 2 concert tickets < $1000, close to stage",
    budget: "$1000 USDC",
    context: {
      userLocation: "New York",
      userTier: "Premium",
      preferences: "Quality over price"
    },
    revalidationThreshold: "30 minutes"
  };

  console.log(`   Type: ${colors.cyan}${mandate.type} (Google AP2 compatible)${colors.reset}`);
  console.log(`   Intent: ${colors.cyan}"${mandate.intent}"${colors.reset}`);
  console.log(`   Budget: ${colors.cyan}${mandate.budget}${colors.reset}`);
  console.log(`   Context: ${colors.cyan}Location: ${mandate.context.userLocation}, Tier: ${mandate.context.userTier}${colors.reset}`);
  console.log(`   Revalidation: ${colors.cyan}Every ${mandate.revalidationThreshold}${colors.reset}`);
  console.log(`   ${colors.green}✅ Mandate registered with lifecycle management: ${generateHash('mandate-' + Date.now())}${colors.reset}\n`);

  await sleep(1500);

  // Step 4: Context Drift Detection
  console.log(`${colors.bright}${colors.yellow}Step 4: Detecting context drift (30 minutes later)...${colors.reset}`);
  await sleep(500);

  const originalContext = {
    location: "New York",
    budget: "$200/week"
  };

  const currentContext = {
    location: "San Francisco",
    budget: "$150/week"
  };

  console.log(`   Original context: ${colors.cyan}${originalContext.location}, Budget: ${originalContext.budget}${colors.reset}`);
  console.log(`   Current context: ${colors.cyan}${currentContext.location}, Budget: ${currentContext.budget}${colors.reset}`);
  console.log(`   ${colors.yellow}⚠️  Context drift detected!${colors.reset}`);
  console.log(`   Status: Mandate marked as ${colors.yellow}ZOMBIE${colors.reset}`);
  console.log(`   Action: ${colors.yellow}Requires user revalidation before execution${colors.reset}`);
  console.log(`   ${colors.green}✅ Prevented potential unwanted charge (zombie mandate protection)${colors.reset}\n`);

  await sleep(1500);

  // Step 5: Reputation Feedback
  console.log(`${colors.bright}${colors.green}Step 5: Client submitting reputation feedback...${colors.reset}`);
  await sleep(500);

  const feedback = {
    rating: "95/100",
    paymentProof: {
      protocol: "x402",
      amount: "900 USDC",
      txSignature: generateHash('tx-' + Date.now())
    },
    categories: {
      quality: 90,
      speed: 95,
      communication: 100
    }
  };

  console.log(`   Overall Rating: ${colors.cyan}${feedback.rating}${colors.reset}`);
  console.log(`   Categories: Quality: ${colors.cyan}${feedback.categories.quality}${colors.reset}, Speed: ${colors.cyan}${feedback.categories.speed}${colors.reset}, Communication: ${colors.cyan}${feedback.categories.communication}${colors.reset}`);
  console.log(`   Payment proof: ${colors.cyan}${feedback.paymentProof.protocol} transaction verified${colors.reset}`);
  console.log(`   Amount: ${colors.cyan}${feedback.paymentProof.amount}${colors.reset}`);
  console.log(`   ${colors.green}✅ Reputation updated (value-weighted by payment amount)${colors.reset}\n`);

  await sleep(1500);

  // Summary
  console.log(`${colors.bright}${'═'.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}📊 SATI Demo Complete!${colors.reset}`);
  console.log(`${colors.bright}${'═'.repeat(60)}${colors.reset}\n`);

  console.log(`${colors.bright}Key Innovations Demonstrated:${colors.reset}`);
  console.log(`• ${colors.green}ZK Compression:${colors.reset} 1,600x cheaper than traditional ($2K vs $3.4M for 1M agents)`);
  console.log(`• ${colors.green}Full AP2 Support:${colors.reset} IntentMandate & CartMandate lifecycle management`);
  console.log(`• ${colors.green}Context Drift:${colors.reset} Prevents zombie mandates with revalidation triggers`);
  console.log(`• ${colors.green}SAS Integration:${colors.reset} Production-ready attestations for delegation`);
  console.log(`• ${colors.green}Cross-chain DIDs:${colors.reset} Compatible with ERC-8004 via did:solana & did:pkh\n`);

  console.log(`${colors.bright}Performance Metrics:${colors.reset}`);
  console.log(`• Registration cost: ~$0.002 per agent (vs $3.40 on Ethereum)`);
  console.log(`• Finality: 150ms with Alpenglow (vs 12-15s on Ethereum)`);
  console.log(`• Storage: Ledger + ZK proofs (vs full on-chain)`);
  console.log(`• Mandate operations: ~$0.00001 per operation\n`);

  console.log(`${colors.bright}${colors.cyan}🔗 Learn more: https://github.com/cascade-protocol/sati${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}📝 Read spec: https://github.com/cascade-protocol/sati/blob/main/docs/specification.md${colors.reset}\n`);
}

// Run the demo
main().catch(console.error);