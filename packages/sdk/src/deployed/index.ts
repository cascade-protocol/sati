/**
 * Deployed SAS Configuration Loader
 *
 * Loads pre-deployed credential and schema addresses for each network.
 * This makes the SDK the source of truth - users just specify network
 * and schemas are automatically available.
 */

import type { SATISASConfig } from "../types";

// Static imports for bundler compatibility (no require())
import devnetJson from "./devnet.json";
import mainnetJson from "./mainnet.json";

// Extract config (handles placeholder files with null config)
type DeployedJson = {
  network: string;
  authority: string | null;
  deployedAt: string | null;
  config: SATISASConfig | null;
};

const devnetConfig: SATISASConfig | null = (devnetJson as DeployedJson).config;
const mainnetConfig: SATISASConfig | null = (mainnetJson as DeployedJson)
  .config;

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
