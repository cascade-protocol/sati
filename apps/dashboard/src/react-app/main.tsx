// BigInt JSON serialization polyfill - required for @solana/kit RPC calls
// biome-ignore lint/suspicious/noExplicitAny: polyfill for JSON.stringify
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createDefaultClient } from "@solana/client";
import { SolanaProvider } from "@solana/react-hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { getChain, chainToNetwork, getRpcUrl, getWsUrl } from "./lib/network";
import "./index.css";

// Read chain once at startup (before React mounts)
// Uses Wallet Standard chain identifiers (solana:devnet, solana:mainnet)
const currentChain = getChain();
const currentNetwork = chainToNetwork(currentChain);

// Solana client configuration - uses selected chain
const solanaClient = createDefaultClient({
  cluster: currentNetwork,
  rpc: getRpcUrl(currentChain),
  websocket: getWsUrl(currentChain),
  commitment: "confirmed",
});

// TanStack Query client for data fetching and caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    },
  },
});

// biome-ignore lint/style/noNonNullAssertion: Vite guarantees root element exists
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SolanaProvider client={solanaClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SolanaProvider>
  </StrictMode>,
);
