// BigInt JSON serialization polyfill - required for @solana/kit RPC calls
// biome-ignore lint/suspicious/noExplicitAny: polyfill for JSON.stringify
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import {
  createClient,
  autoDiscover,
  phantom,
  solflare,
  backpack,
  resolveCluster,
  type ClusterMoniker,
} from "@solana/client";
import { SolanaProvider } from "@solana/react-hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { NETWORK_STORAGE_KEY } from "@/lib/constants";
import "./index.css";

function getSavedNetwork(): ClusterMoniker {
  const saved = localStorage.getItem(NETWORK_STORAGE_KEY);
  if (saved === "localnet" || saved === "devnet" || saved === "mainnet") {
    return saved;
  }
  return "devnet"; // Default to devnet
}

// Get initial cluster config from saved preference or env vars
function getInitialCluster() {
  const network = getSavedNetwork();

  // Allow env var overrides for each network
  if (network === "mainnet" && import.meta.env.VITE_MAINNET_RPC) {
    return {
      endpoint: import.meta.env.VITE_MAINNET_RPC,
      websocketEndpoint: import.meta.env.VITE_MAINNET_WS,
    };
  }
  if (network === "devnet" && import.meta.env.VITE_DEVNET_RPC) {
    return {
      endpoint: import.meta.env.VITE_DEVNET_RPC,
      websocketEndpoint: import.meta.env.VITE_DEVNET_WS,
    };
  }

  // Use built-in cluster resolution
  return resolveCluster({ moniker: network });
}

const initialCluster = getInitialCluster();

// Solana client configuration
const solanaClient = createClient({
  commitment: "confirmed",
  endpoint: initialCluster.endpoint,
  websocketEndpoint: initialCluster.websocketEndpoint,
  walletConnectors: [
    ...phantom(),
    ...solflare(),
    ...backpack(),
    ...autoDiscover(),
  ],
});

// TanStack Query client (required by wagmi)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
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
