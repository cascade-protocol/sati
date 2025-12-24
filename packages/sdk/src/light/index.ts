/**
 * Light Protocol / Photon Integration Entry Point
 *
 * Import from "@cascade-fyi/sati-sdk/light" when you need
 * compressed attestation functionality. This avoids bundling
 * Node.js dependencies in browser-only applications.
 *
 * @example
 * ```typescript
 * import { createLightClient, LightClient } from "@cascade-fyi/sati-sdk/light";
 *
 * const light = createLightClient("https://devnet.helius-rpc.com?api-key=KEY");
 * const feedbacks = await light.listFeedbacks(tokenAccount);
 * ```
 */

// Re-export everything from the main light module
export * from "../light";
