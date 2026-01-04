export type Network = "devnet" | "mainnet";

export const parse = (env: Record<string, unknown>) => {
  const key = (env.VITE_HELIUS_API_KEY as string) ?? "";

  return {
    VITE_HELIUS_API_KEY: env.VITE_HELIUS_API_KEY as string | undefined,
    SATI_AGENT_SIGNER_KEY: env.SATI_AGENT_SIGNER_KEY as string | undefined,
    DEMO_AGENT_MINT_DEVNET: env.DEMO_AGENT_MINT_DEVNET as string | undefined,
    DEMO_AGENT_MINT_MAINNET: env.DEMO_AGENT_MINT_MAINNET as string | undefined,
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
