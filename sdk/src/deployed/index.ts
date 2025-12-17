/**
 * Deployed SAS Configuration Loader
 *
 * Loads pre-deployed credential and schema addresses for each network.
 * This makes the SDK the source of truth - users just specify network
 * and schemas are automatically available.
 */

import type { SATISASConfig } from "../types";

// Import deployed configs (null if not yet deployed)
// These files are created/updated by the deployment script
let devnetConfig: SATISASConfig | null = null;
let mainnetConfig: SATISASConfig | null = null;

// Try to load devnet config
try {
  // Dynamic import would be cleaner but we need synchronous loading
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  devnetConfig = require("./devnet.json") as SATISASConfig;
} catch {
  // Config not deployed yet
}

// Try to load mainnet config
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mainnetConfig = require("./mainnet.json") as SATISASConfig;
} catch {
  // Config not deployed yet
}

const configs: Record<string, SATISASConfig | null> = {
  devnet: devnetConfig,
  mainnet: mainnetConfig,
  localnet: null, // Users must deploy locally
};

/**
 * Load deployed SAS configuration for a network
 *
 * @param network - Network identifier ("devnet", "mainnet", "localnet")
 * @returns SAS config if deployed, null otherwise
 */
export function loadDeployedConfig(network: string): SATISASConfig | null {
  return configs[network] ?? null;
}

/**
 * Check if a network has deployed SAS configuration
 *
 * @param network - Network identifier
 * @returns true if config exists for network
 */
export function hasDeployedConfig(network: string): boolean {
  return configs[network] !== null;
}

/**
 * Get list of networks with deployed configurations
 *
 * @returns Array of network names with deployed configs
 */
export function getDeployedNetworks(): string[] {
  return Object.entries(configs)
    .filter(([_, config]) => config !== null)
    .map(([network]) => network);
}
