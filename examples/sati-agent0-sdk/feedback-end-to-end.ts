/**
 * Feedback End-to-End Example
 *
 * This example submits multiple feedback transactions with:
 * - Different values (scores)
 * - Different tag pairs (tag1/tag2)
 * - Distinct endpoints per feedback (used as a stable "run id" marker)
 *
 * Then it:
 * - Uses searchFeedback() to retrieve a subset by tag
 * - Uses getReputationSummary() to compute an aggregated average
 * - Compares expected vs actual averages
 *
 * Note: On SATI (Solana), compressed accounts are queryable immediately
 * after confirmation. No subgraph polling is needed.
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet (pays for transactions)
 * - AGENT_ID: existing agent ID in CAIP-2 format (solana:<chainRef>:<mint>)
 */

import { loadSigner, RPC_URL, AGENT_ID, NETWORK } from "../shared/_env.js";
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";

type FeedbackPlanItem = {
  value: string; // keep as string to avoid JS float surprises
  tag1: string;
  tag2: string;
};

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

  // Unique marker for this run, embedded in the on-chain `endpoint` field
  const runId = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const endpointBase = `https://example.com/agent0/feedback?run=${encodeURIComponent(runId)}`;

  // Plan: submit many feedbacks, then retrieve subset where tag2 === 'latency'
  const planned: FeedbackPlanItem[] = [
    { value: "91.5", tag1: "quality", tag2: "latency" },
    { value: "88.125", tag1: "quality", tag2: "latency" },
    { value: "76.3333", tag1: "quality", tag2: "latency" },
    { value: "99.99", tag1: "quality", tag2: "accuracy" },
    { value: "84.25", tag1: "quality", tag2: "helpfulness" },
    { value: "73.75", tag1: "quality", tag2: "documentation" },
    { value: "67.5", tag1: "quality", tag2: "ux" },
    { value: "92.01", tag1: "quality", tag2: "reliability" },
    { value: "80.8", tag1: "quality", tag2: "latency" },
    { value: "55.05", tag1: "quality", tag2: "latency" },
  ];

  console.log(`Submitting ${planned.length} feedback txs to agent ${AGENT_ID}...`);
  console.log(`Run marker: ${runId}`);

  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    const endpoint = `${endpointBase}&i=${i}&t=${encodeURIComponent(item.tag2)}`;

    const handle = await sdk.giveFeedback(AGENT_ID, item.value, item.tag1, item.tag2, endpoint);
    const { result: feedback } = await handle.waitMined();

    console.log(
      `- submitted ${i + 1}/${planned.length}:` +
        ` value=${feedback.value} tags=${feedback.tags.join(",")}` +
        ` endpoint=${feedback.endpoint ?? ""}` +
        ` sig=${handle.hash.slice(0, 16)}...`,
    );
  }

  // Search for subset by tag (no polling needed on SATI)
  console.log('\nSearching for subset: tag="latency" for this reviewer + agent...');
  const latencyResults = await sdk.searchFeedback(
    { agentId: AGENT_ID, reviewers: [signer.address], tags: ["latency"] },
    { minValue: 0, maxValue: 100 },
  );
  console.log(`Found ${latencyResults.length} feedback entries with tag "latency"`);
  for (const fb of latencyResults) {
    console.log(`- value=${fb.value} tags=${fb.tags.join(",")} endpoint=${fb.endpoint ?? ""}`);
  }

  // Get reputation summary for the tag pair
  console.log('\nGetting reputation summary for tag pair ("quality", "latency")...');
  const summary = await sdk.getReputationSummary(AGENT_ID, "quality", "latency");
  console.log(`Summary: count=${summary.count} averageValue=${summary.averageValue}`);

  // Compute expected average for this run (quality+latency subset only)
  const expectedLatencyValues = planned
    .filter((p) => p.tag1 === "quality" && p.tag2 === "latency")
    .map((p) => Number(p.value));
  const expectedAvg = expectedLatencyValues.reduce((sum, v) => sum + v, 0) / Math.max(1, expectedLatencyValues.length);
  const expectedAvgRounded = Math.round(expectedAvg * 100) / 100;
  console.log(
    `Expected (this run): count=${expectedLatencyValues.length}` +
      ` averageValue=${expectedAvgRounded} (unrounded=${expectedAvg})`,
  );

  // Note: actual average may differ from expected if the agent already had
  // prior feedback. The comparison is informational, not an assertion.
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
