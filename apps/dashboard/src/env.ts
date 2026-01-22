export type Network = "devnet" | "mainnet";

// Hardcoded demo agent mints (registered on each network)
export const DEMO_AGENT_MINT_DEVNET = "J7b9Ks4TNBDN1nMoPfSYnD39oCBL2hVSp1FAoiwdHyoC";
export const DEMO_AGENT_MINT_MAINNET: string | undefined = undefined; // Not yet registered

// Prediction agent (separate identity for Kalshi predictions)
// Same mint address on both networks for consistency
export const PREDICTION_AGENT_MINT_DEVNET = "2JoPSg3XkK77dyftS4L1A8GZvtKqiUrYtQtE6Xvagent";
export const PREDICTION_AGENT_MINT_MAINNET = "2JoPSg3XkK77dyftS4L1A8GZvtKqiUrYtQtE6Xvagent";

export const parse = (env: Record<string, unknown>) => {
  const key = (env.VITE_HELIUS_API_KEY as string) ?? "";

  return {
    VITE_HELIUS_API_KEY: env.VITE_HELIUS_API_KEY as string | undefined,
    SATI_AGENT_SIGNER_KEY: env.SATI_AGENT_SIGNER_KEY as string | undefined,
    SATI_DEMO_VALIDATOR_SIGNER_KEY: env.SATI_DEMO_VALIDATOR_SIGNER_KEY as string | undefined,
    KALSHI_API_KEY_ID: env.KALSHI_API_KEY_ID as string | undefined,
    KALSHI_API_KEY_RSA_SECRET: env.KALSHI_API_KEY_RSA_SECRET as string | undefined,
    // Anthropic API key for AI predictions
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY as string | undefined,
    DEMO_AGENT_MINT_DEVNET,
    DEMO_AGENT_MINT_MAINNET,
    PREDICTION_AGENT_MINT_DEVNET,
    PREDICTION_AGENT_MINT_MAINNET,
    RPC_URLS: {
      devnet: {
        rpc: `https://devnet.helius-rpc.com/?api-key=${key}`,
        ws: `wss://devnet.helius-rpc.com/?api-key=${key}`,
      },
      mainnet: {
        rpc: `https://mainnet.helius-rpc.com/?api-key=${key}`,
        ws: `wss://mainnet.helius-rpc.com/?api-key=${key}`,
      },
    },
  };
};

export type Env = ReturnType<typeof parse>;
