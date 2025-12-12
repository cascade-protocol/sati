/**
 * SATI Example: Request Validation
 *
 * Demonstrates how to request and respond to work validation using the SATI SDK.
 * This implements the validation flow:
 * 1. Agent owner requests validation (ValidationRequest attestation)
 * 2. Validator responds with result (ValidationResponse attestation)
 *
 * NOTE: Validation methods require the SAS (Solana Attestation Service) SDK
 * which is not yet published. This example shows the intended API.
 */

import { address } from "@solana/kit";
import {
  SATI,
  VALIDATION_REQUEST_SCHEMA,
  VALIDATION_RESPONSE_SCHEMA,
  SCHEMA_NAMES,
} from "@sati/sdk";

async function main() {
  console.log("SATI Validation Example\n");

  // Initialize SATI client
  const sati = new SATI({ network: "devnet" });

  // Example addresses
  const agentMint = address("AgentMint11111111111111111111111111111111111");
  const validatorPubkey = address("Validator1111111111111111111111111111111111");

  // ============================================================
  // Step 1: Agent requests validation
  // ============================================================
  console.log("Step 1: Request Validation");
  console.log("==========================");
  console.log(`Schema: ${SCHEMA_NAMES.VALIDATION_REQUEST}`);
  console.log(`Layout: [${VALIDATION_REQUEST_SCHEMA.layout.join(", ")}]`);
  console.log();

  console.log("SATI API (requires sas-lib):");
  console.log("```typescript");
  console.log("// Agent owner requests validation");
  console.log("const request = await sati.requestValidation({");
  console.log("  agentMint: agentMint,");
  console.log("  validator: validatorPubkey,");
  console.log('  methodId: "tee", // "tee", "zkml", or "restake"');
  console.log('  requestUri: "ipfs://QmWorkOutput",');
  console.log("  requestHash: sha256(workOutput),");
  console.log("});");
  console.log("console.log(`Request: ${request.attestation}`);");
  console.log("```\n");

  // ============================================================
  // Step 2: Validator responds
  // ============================================================
  console.log("Step 2: Validator Responds");
  console.log("==========================");
  console.log(`Schema: ${SCHEMA_NAMES.VALIDATION_RESPONSE}`);
  console.log(`Layout: [${VALIDATION_RESPONSE_SCHEMA.layout.join(", ")}]`);
  console.log();

  console.log("SATI API (requires sas-lib):");
  console.log("```typescript");
  console.log("// Validator responds with validation result");
  console.log("const response = await sati.respondToValidation({");
  console.log("  requestAttestation: requestAttestation,");
  console.log("  response: 100, // 0=fail, 100=pass");
  console.log('  responseUri: "ipfs://QmValidationEvidence",');
  console.log("  responseHash: sha256(evidence),");
  console.log('  tag: "verified",');
  console.log("});");
  console.log("console.log(`Response: ${response.attestation}`);");
  console.log("```\n");

  // ============================================================
  // Step 3: Check validation status
  // ============================================================
  console.log("Step 3: Check Status");
  console.log("====================");
  console.log("SATI API (requires sas-lib):");
  console.log("```typescript");
  console.log("const status = await sati.getValidationStatus(requestAttestation);");
  console.log("if (status) {");
  console.log("  console.log(`Completed: ${status.completed}`);");
  console.log("  console.log(`Response: ${status.response}`);");
  console.log("  console.log(`Validator: ${status.validator}`);");
  console.log("}");
  console.log("```\n");

  // ============================================================
  // Validation Methods
  // ============================================================
  console.log("Supported Validation Methods:");
  console.log("=============================");
  console.log("- tee: TEE-based attestation (Intel TDX, AMD SEV, Phala, AWS Nitro)");
  console.log("- zkml: Zero-knowledge machine learning proof");
  console.log("- restake: Restaking-based economic validation");
  console.log();

  // ============================================================
  // Demonstrate actual API call (will throw helpful error)
  // ============================================================
  console.log("Attempting actual API call...\n");

  try {
    await sati.requestValidation({
      agentMint,
      validator: validatorPubkey,
      methodId: "tee",
      requestUri: "ipfs://QmTestRequest",
    });
  } catch (error) {
    if (error instanceof Error) {
      console.log(`Expected error: ${error.message}\n`);
    }
  }

  console.log("For working attestations, see:");
  console.log("https://github.com/solana-foundation/solana-attestation-service");
}

main().catch(console.error);
