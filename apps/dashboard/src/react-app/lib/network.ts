/**
 * Network configuration utilities
 *
 * Simple module-level helpers for network switching.
 * No React context needed - just localStorage + page reload.
 */

export type Network = "devnet" | "mainnet";

const STORAGE_KEY = "sati-network";
const DEFAULT_NETWORK: Network = "devnet";

/**
 * Get the current network from localStorage (or default)
 * Called once at app startup before React mounts
 */
export function getNetwork(): Network {
  if (typeof window === "undefined") return DEFAULT_NETWORK;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "devnet" || stored === "mainnet") return stored;
  return DEFAULT_NETWORK;
}

/**
 * Set network and reload the page
 * This ensures all singletons (SATI SDK, Helius, etc.) reinitialize correctly
 */
export function setNetwork(network: Network): void {
  localStorage.setItem(STORAGE_KEY, network);
  window.location.reload();
}

/**
 * Get RPC URL for the current network
 */
export function getRpcUrl(network: Network): string {
  if (network === "mainnet") {
    return (
      import.meta.env.VITE_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com"
    );
  }
  return import.meta.env.VITE_DEVNET_RPC ?? "https://api.devnet.solana.com";
}

/**
 * Get WebSocket URL for the current network
 */
export function getWsUrl(network: Network): string {
  if (network === "mainnet") {
    return (
      import.meta.env.VITE_MAINNET_WS ?? "wss://api.mainnet-beta.solana.com"
    );
  }
  return import.meta.env.VITE_DEVNET_WS ?? "wss://api.devnet.solana.com";
}

/**
 * Get Solscan URL for an address
 */
export function getSolscanUrl(
  address: string,
  type: "account" | "token" | "tx" = "account",
  network: Network = getNetwork(),
): string {
  const base = `https://solscan.io/${type}/${address}`;
  return network === "devnet" ? `${base}?cluster=devnet` : base;
}
