/**
 * Feedback End-to-End (Endpoint Variants)
 *
 * Submits exactly two feedback txs with the same tag pair:
 * - one WITHOUT endpoint (omitted)
 * - one WITH a short endpoint domain (e.g. "nytimes.com")
 *
 * Then verifies via searchFeedback that the endpoint field is
 * preserved/omitted correctly.
 *
 * Note: On SATI (Solana), compressed accounts are queryable immediately
 * after confirmation. No subgraph polling is needed.
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet
 * - AGENT_ID: existing agent ID in CAIP-2 format (solana:<chainRef>:<mint>)
 */

import { loadSigner, RPC_URL, AGENT_ID, NETWORK } from "../shared/_env.js";
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";

async function main() {
  const signer = await loadSigner();

  if (!AGENT_ID || AGENT_ID.trim() === "") {
    throw new Error("AGENT_ID is required for this example. Run quick-start.ts first to get one.");
  }

  const sdk = new SatiAgent0({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer,
  });

  const tag1 = "quality";
  const tag2 = "latency";
  const valueNoEndpoint = "91.5";
  const valueWithEndpoint = "88.125";

  console.log(`Submitting 2 feedback txs to agent ${AGENT_ID}...`);

  // 1) No endpoint (omit the parameter)
  const handle1 = await sdk.giveFeedback(AGENT_ID, valueNoEndpoint, tag1, tag2);
  const { result: fb1 } = await handle1.waitMined();
  console.log(
    `- no-endpoint: value=${fb1.value} tags=${fb1.tags.join(",")}` +
      ` endpoint=${fb1.endpoint ?? ""} sig=${handle1.hash.slice(0, 16)}...`,
  );

  // 2) Very short endpoint domain
  const shortEndpoint = "nytimes.com";
  const handle2 = await sdk.giveFeedback(AGENT_ID, valueWithEndpoint, tag1, tag2, shortEndpoint);
  const { result: fb2 } = await handle2.waitMined();
  console.log(
    `- short-endpoint: value=${fb2.value} tags=${fb2.tags.join(",")}` +
      ` endpoint=${fb2.endpoint ?? ""} sig=${handle2.hash.slice(0, 16)}...`,
  );

  // Verify via searchFeedback (no polling needed on Solana)
  console.log("\nVerifying via searchFeedback...");
  const results = await sdk.searchFeedback({
    agentId: AGENT_ID,
    reviewers: [signer.address],
    tags: [tag2],
  });

  console.log(`Found ${results.length} feedback entries with tag "${tag2}"`);

  const hasNoEndpoint = results.some((f) => Number(f.value) === Number(valueNoEndpoint) && !f.endpoint);
  const hasShortEndpoint = results.some(
    (f) => Number(f.value) === Number(valueWithEndpoint) && f.endpoint === shortEndpoint,
  );

  console.log(`\nEndpoint behavior:`);
  console.log(`  No-endpoint preserved: ${hasNoEndpoint}`);
  console.log(`  Short-endpoint preserved: ${hasShortEndpoint}`);

  if (!hasNoEndpoint || !hasShortEndpoint) {
    throw new Error(
      "Did not observe expected endpoint behavior from searchFeedback. " +
        `hasNoEndpoint=${hasNoEndpoint} hasShortEndpoint=${hasShortEndpoint}`,
    );
  }

  console.log("\nOK: endpoint variants observed as expected.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
