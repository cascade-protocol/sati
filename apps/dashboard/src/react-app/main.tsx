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
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
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

// Cache duration: 5 minutes
const CACHE_TIME = 5 * 60 * 1000;

// TanStack Query client for data fetching and caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes - data considered fresh
      gcTime: CACHE_TIME, // 5 minutes - keep in memory/storage
      refetchOnWindowFocus: false,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    },
  },
});

// Custom deserializer that restores BigInt values from JSON strings.
// The BigInt.toJSON polyfill serializes bigints as strings (e.g. "5"),
// so we restore known bigint fields on deserialization.
function deserializeCache(cached: string) {
  return JSON.parse(cached, (key, value) => {
    if ((key === "memberNumber" || key === "totalAgents") && typeof value === "string" && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    return value;
  });
}

// localStorage persister for cross-reload cache
// Only persist agent lists - feedback/attestation data contains Uint8Array which
// doesn't survive JSON round-trip
const persister = createAsyncStoragePersister({
  storage: window.localStorage,
  key: "sati-query-cache",
  deserialize: deserializeCache,
});

const PERSISTABLE_KEYS = ["agents"];
function shouldPersistQuery(query: { queryKey: readonly unknown[] }) {
  return query.queryKey.some((k) => typeof k === "string" && PERSISTABLE_KEYS.includes(k));
}

// biome-ignore lint/style/noNonNullAssertion: Vite guarantees root element exists
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SolanaProvider client={solanaClient}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: CACHE_TIME,
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
        }}
      >
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </SolanaProvider>
  </StrictMode>,
);
