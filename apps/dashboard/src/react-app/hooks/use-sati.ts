/**
 * SATI Registry hooks.
 *
 * useSati() - Main hook for dashboard state and actions
 * useAgentDetails(mint) - Hook for single agent details page
 *
 * Uses TanStack Query with:
 * - Shared registry stats cache
 * - Parallel transaction fetching via useQueries
 * - Appropriate stale times
 */

import { useCallback, useState } from "react";
import { useSolanaClient, useWalletSession } from "@solana/react-hooks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  generateKeyPairSigner,
  type Address,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { getUpdateTokenMetadataFieldInstruction } from "@solana-program/token-2022";
import {
  getRegisterAgentInstructionAsync,
  findRegistryConfigPda,
  fetchRegistryConfig,
  findAssociatedTokenAddress,
} from "@cascade-fyi/sati-sdk";
import { getSatiClient, listAgentsByOwner, listAllAgents, type AgentIdentity } from "@/lib/sati";

const QUERY_KEY = ["sati"];
const PAGE_SIZE = 20;

export interface RegisterAgentParams {
  name: string;
  symbol?: string;
  uri: string;
  additionalMetadata?: Array<{ key: string; value: string }>;
  nonTransferable?: boolean;
}

export interface UseSatiReturn {
  // User's agents
  myAgents: AgentIdentity[];
  myAgentsLoading: boolean;

  // Registry stats
  totalAgents: bigint;

  // Explore (paginated all agents)
  exploreAgents: AgentIdentity[];
  exploreLoading: boolean;
  explorePage: number;
  exploreHasMore: boolean;
  setExplorePage: (page: number) => void;

  // Actions
  registerAgent: (params: RegisterAgentParams) => Promise<{ mint: Address; signature: string }>;
  isPending: boolean;

  // Refresh
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching agent metadata from URI
 */
export function useAgentMetadata(uri: string | undefined) {
  const { data: metadata, isLoading } = useQuery({
    queryKey: [...QUERY_KEY, "metadata", uri],
    queryFn: async () => {
      if (!uri) return null;
      const { fetchAgentMetadata } = await import("@/lib/sati");
      return fetchAgentMetadata(uri);
    },
    enabled: !!uri,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return { metadata: metadata ?? null, isLoading };
}

/**
 * Hook for single agent details page
 */
export function useAgentDetails(mint: Address | string | undefined) {
  const {
    data: agent,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...QUERY_KEY, "agent", mint],
    queryFn: async () => {
      if (!mint) return null;
      const sati = getSatiClient();
      return sati.loadAgent(mint as Address);
    },
    enabled: !!mint,
    staleTime: 30_000,
  });

  return {
    agent: agent ?? null,
    isLoading,
    error: error as Error | null,
    refetch: async () => { await refetch(); },
  };
}

/**
 * Main SATI hook for dashboard
 */
export function useSati(): UseSatiReturn {
  const queryClient = useQueryClient();
  const solanaClient = useSolanaClient();
  const session = useWalletSession();
  const walletAddress = session?.account.address;

  const [explorePage, setExplorePage] = useState(0);

  // Fetch user's agents efficiently using getTokenAccountsByOwner
  const {
    data: myAgentsData,
    isLoading: myAgentsLoading,
  } = useQuery({
    queryKey: [...QUERY_KEY, "my-agents", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return { agents: [], totalAgents: 0n };

      const rpc = solanaClient.runtime.rpc as Rpc<SolanaRpcApi>;
      // listAgentsByOwner returns both agents and totalAgents (no extra RPC call)
      return listAgentsByOwner(rpc, walletAddress);
    },
    enabled: !!walletAddress,
    staleTime: 30_000,
  });

  // Fetch explore page agents
  const {
    data: exploreData,
    isLoading: exploreLoading,
  } = useQuery({
    queryKey: [...QUERY_KEY, "explore", explorePage],
    queryFn: async () => {
      const rpc = solanaClient.runtime.rpc as Rpc<SolanaRpcApi>;
      return listAllAgents(rpc, { offset: explorePage * PAGE_SIZE, limit: PAGE_SIZE });
    },
    staleTime: 30_000,
  });

  // Register agent mutation
  const registerMutation = useMutation({
    mutationFn: async (params: RegisterAgentParams) => {
      if (!session) throw new Error("Wallet not connected");

      const toastId = toast.loading("Registering agent...");

      try {
        const agentMint = await generateKeyPairSigner();
        const rpc = solanaClient.runtime.rpc as Rpc<SolanaRpcApi>;

        const [registryConfigAddress] = await findRegistryConfigPda();
        const registryConfig = await fetchRegistryConfig(rpc, registryConfigAddress);
        const groupMint = registryConfig.data.groupMint;

        const ownerAddress = session.account.address;
        const [agentTokenAccount] = await findAssociatedTokenAddress(
          agentMint.address,
          ownerAddress,
        );

        const instruction = await getRegisterAgentInstructionAsync({
          payer: { address: ownerAddress } as KeyPairSigner,
          owner: ownerAddress,
          groupMint,
          agentMint,
          agentTokenAccount,
          name: params.name,
          symbol: params.symbol ?? "SATI",
          uri: params.uri,
          additionalMetadata: params.additionalMetadata ?? null,
          nonTransferable: params.nonTransferable ?? false,
        });

        const signature = await solanaClient.helpers.transaction.prepareAndSend({
          authority: session,
          instructions: [instruction],
          commitment: "confirmed",
        });

        toast.success("Agent registered!", { id: toastId });
        return { mint: agentMint.address, signature: signature.toString() };
      } catch (error) {
        toast.dismiss(toastId);
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error(`Failed: ${message}`);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  return {
    myAgents: myAgentsData?.agents ?? [],
    myAgentsLoading,
    totalAgents: myAgentsData?.totalAgents ?? 0n,

    exploreAgents: exploreData?.agents ?? [],
    exploreLoading,
    explorePage,
    exploreHasMore: (exploreData?.agents?.length ?? 0) === PAGE_SIZE,
    setExplorePage,

    registerAgent: useCallback(
      (params: RegisterAgentParams) => registerMutation.mutateAsync(params),
      [registerMutation],
    ),
    isPending: registerMutation.isPending,

    refresh,
  };
}

/**
 * Hook for updating agent metadata URI
 * Requires connected wallet to be the update authority
 */
export function useUpdateAgentMetadata() {
  const queryClient = useQueryClient();
  const solanaClient = useSolanaClient();
  const session = useWalletSession();

  const mutation = useMutation({
    mutationFn: async ({ mint, newUri }: { mint: Address; newUri: string }) => {
      if (!session) throw new Error("Wallet not connected");

      const toastId = toast.loading("Updating metadata...");

      try {
        const instruction = getUpdateTokenMetadataFieldInstruction({
          metadata: mint,
          updateAuthority: { address: session.account.address } as KeyPairSigner,
          field: { __kind: "Uri" },
          value: newUri,
        });

        const signature = await solanaClient.helpers.transaction.prepareAndSend({
          authority: session,
          instructions: [instruction],
          commitment: "confirmed",
        });

        toast.success("Metadata updated!", { id: toastId });
        return { signature: signature.toString() };
      } catch (error) {
        toast.dismiss(toastId);
        const message = error instanceof Error ? error.message : "Unknown error";

        // Check for authority error
        if (message.includes("custom program error") || message.includes("0x35c2b5c0")) {
          toast.error("You are not the update authority for this agent");
        } else {
          toast.error(`Failed: ${message}`);
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    updateMetadata: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
