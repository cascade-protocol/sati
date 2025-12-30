/**
 * Network configuration utilities
 *
 * Uses Wallet Standard chain identifiers (solana:devnet, solana:mainnet)
 * for proper wallet integration and network mismatch detection.
 */

/**
 * Wallet Standard chain identifiers
 * @see https://github.com/anza-xyz/wallet-standard
 */
export type SolanaChain = "solana:mainnet" | "solana:devnet" | "solana:testnet" | "solana:localnet";

/**
 * SDK-compatible network type (used internally with SATI SDK)
 */
export type Network = "devnet" | "mainnet";

const STORAGE_KEY = "sati-network";
const DEFAULT_CHAIN: SolanaChain = "solana:devnet";

/**
 * Map from Wallet Standard chain to SDK network type
 */
export function chainToNetwork(chain: SolanaChain): Network {
  if (chain === "solana:mainnet") return "mainnet";
  return "devnet"; // devnet, testnet, and localnet all use devnet config
}

/**
 * Map from SDK network to Wallet Standard chain
 */
export function networkToChain(network: Network): SolanaChain {
  return network === "mainnet" ? "solana:mainnet" : "solana:devnet";
}

/**
 * Get the current chain from localStorage (or default)
 * Called once at app startup before React mounts
 */
export function getChain(): SolanaChain {
  if (typeof window === "undefined") return DEFAULT_CHAIN;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (
    stored === "solana:mainnet" ||
    stored === "solana:devnet" ||
    stored === "solana:testnet" ||
    stored === "solana:localnet"
  ) {
    return stored;
  }
  // Migrate legacy values
  if (stored === "mainnet") return "solana:mainnet";
  if (stored === "devnet") return "solana:devnet";
  return DEFAULT_CHAIN;
}

/**
 * Get the current network (SDK-compatible format)
 * @deprecated Use getChain() for new code
 */
export function getNetwork(): Network {
  return chainToNetwork(getChain());
}

/**
 * Set chain and reload the page
 * This ensures all singletons (SATI SDK, Helius, etc.) reinitialize correctly
 */
export function setChain(chain: SolanaChain): void {
  localStorage.setItem(STORAGE_KEY, chain);
  window.location.reload();
}

/**
 * Set network and reload the page
 * @deprecated Use setChain() for new code
 */
export function setNetwork(network: Network): void {
  setChain(networkToChain(network));
}

/**
 * Get RPC URL for the given chain
 */
export function getRpcUrl(chainOrNetwork: SolanaChain | Network): string {
  const chain = chainOrNetwork.startsWith("solana:") ? chainOrNetwork : networkToChain(chainOrNetwork as Network);

  if (chain === "solana:mainnet") {
    return import.meta.env.VITE_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
  }
  if (chain === "solana:localnet") {
    return "http://127.0.0.1:8899";
  }
  // devnet and testnet use devnet RPC
  return import.meta.env.VITE_DEVNET_RPC ?? "https://api.devnet.solana.com";
}

/**
 * Get WebSocket URL for the given chain
 */
export function getWsUrl(chainOrNetwork: SolanaChain | Network): string {
  const chain = chainOrNetwork.startsWith("solana:") ? chainOrNetwork : networkToChain(chainOrNetwork as Network);

  if (chain === "solana:mainnet") {
    return import.meta.env.VITE_MAINNET_WS ?? "wss://api.mainnet-beta.solana.com";
  }
  if (chain === "solana:localnet") {
    return "ws://127.0.0.1:8900";
  }
  // devnet and testnet use devnet WS
  return import.meta.env.VITE_DEVNET_WS ?? "wss://api.devnet.solana.com";
}

/**
 * Get Solscan URL for an address
 */
export function getSolscanUrl(
  address: string,
  type: "account" | "token" | "tx" = "account",
  chainOrNetwork: SolanaChain | Network = getChain(),
): string {
  const chain = chainOrNetwork.startsWith("solana:") ? chainOrNetwork : networkToChain(chainOrNetwork as Network);
  const base = `https://solscan.io/${type}/${address}`;
  if (chain === "solana:devnet") return `${base}?cluster=devnet`;
  if (chain === "solana:testnet") return `${base}?cluster=testnet`;
  return base; // mainnet
}

/**
 * Get display name for a chain
 */
export function getChainDisplayName(chain: SolanaChain): string {
  switch (chain) {
    case "solana:mainnet":
      return "Mainnet";
    case "solana:devnet":
      return "Devnet";
    case "solana:testnet":
      return "Testnet";
    case "solana:localnet":
      return "Localnet";
  }
}

/**
 * Check if app is on mainnet (shows extra warnings for mainnet operations)
 */
export function isMainnet(chain: SolanaChain = getChain()): boolean {
  return chain === "solana:mainnet";
}
