/**
 * SATI Registry hooks.
 *
 * Hooks are split by concern:
 * - useMyAgents() - User's registered agents (Dashboard)
 * - useExploreAgents() - Paginated all agents (Explore page)
 * - useRegisterAgent() - Agent registration mutation
 * - useAgentDetails(mint) - Single agent details
 * - useSati() - Facade combining myAgents + registerAgent (for Dashboard)
 *
 * Uses TanStack Query with:
 * - Targeted query invalidation
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
import {
  getSatiClient,
  listAgentsByOwner,
  listAllAgents,
  type AgentIdentity,
} from "@/lib/sati";

const QUERY_KEY = ["sati"];
const AGENTS_KEY = [...QUERY_KEY, "agents"];
const PAGE_SIZE = 20;

export interface RegisterAgentParams {
  name: string;
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
  registerAgent: (
    params: RegisterAgentParams,
  ) => Promise<{ mint: Address; signature: string }>;
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
    queryKey: [...AGENTS_KEY, "detail", mint],
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
    refetch: async () => {
      await refetch();
    },
  };
}

/**
 * Hook for user's registered agents (Dashboard page)
 */
export function useMyAgents() {
  const session = useWalletSession();
  const walletAddress = session?.account.address;

  const { data: myAgentsData, isLoading: myAgentsLoading } = useQuery({
    queryKey: [...AGENTS_KEY, "my", walletAddress],
    queryFn: async () => {
      if (!walletAddress) return { agents: [], totalAgents: 0n };
      return listAgentsByOwner(walletAddress);
    },
    enabled: !!walletAddress,
    staleTime: 30_000,
  });

  return {
    myAgents: myAgentsData?.agents ?? [],
    myAgentsLoading,
    totalAgents: myAgentsData?.totalAgents ?? 0n,
  };
}

/**
 * Hook for paginated all agents (Explore page)
 * Only fetches when this hook is used, not when useSati is used on Dashboard
 */
export function useExploreAgents() {
  const [explorePage, setExplorePage] = useState(0);

  const { data: exploreData, isLoading: exploreLoading } = useQuery({
    queryKey: [...AGENTS_KEY, "explore", explorePage],
    queryFn: () =>
      listAllAgents({
        offset: explorePage * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    staleTime: 30_000,
  });

  return {
    exploreAgents: exploreData?.agents ?? [],
    exploreLoading,
    explorePage,
    exploreHasMore: (exploreData?.agents?.length ?? 0) === PAGE_SIZE,
    setExplorePage,
    totalAgents: exploreData?.totalAgents ?? 0n,
  };
}

/**
 * Hook for agent registration mutation
 */
export function useRegisterAgent() {
  const queryClient = useQueryClient();
  const solanaClient = useSolanaClient();
  const session = useWalletSession();

  const registerMutation = useMutation({
    mutationFn: async (params: RegisterAgentParams) => {
      if (!session) throw new Error("Wallet not connected");

      const toastId = toast.loading("Registering agent...");

      try {
        const agentMint = await generateKeyPairSigner();
        const rpc = solanaClient.runtime.rpc as Rpc<SolanaRpcApi>;

        const [registryConfigAddress] = await findRegistryConfigPda();
        const registryConfig = await fetchRegistryConfig(
          rpc,
          registryConfigAddress,
        );
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
          symbol: "", // Empty - vestigial field from fungible tokens
          uri: params.uri,
          additionalMetadata: params.additionalMetadata ?? null,
          nonTransferable: params.nonTransferable ?? false,
        });

        const signature = await solanaClient.helpers.transaction.prepareAndSend(
          {
            authority: session,
            instructions: [instruction],
            commitment: "confirmed",
          },
        );

        toast.success("Agent registered!", { id: toastId });
        return { mint: agentMint.address, signature: signature.toString() };
      } catch (error) {
        toast.dismiss(toastId);
        const message =
          error instanceof Error ? error.message : "Unknown error";
        toast.error(`Failed: ${message}`);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
    },
  });

  return {
    registerAgent: registerMutation.mutateAsync,
    isPending: registerMutation.isPending,
  };
}

/**
 * Main SATI hook for dashboard (facade for backwards compatibility)
 * Combines myAgents + registerAgent. Does NOT fetch explore data.
 */
export function useSati(): UseSatiReturn {
  const queryClient = useQueryClient();
  const { myAgents, myAgentsLoading, totalAgents } = useMyAgents();
  const { registerAgent, isPending } = useRegisterAgent();

  // Note: Explore data is NOT fetched here to avoid unnecessary RPC calls.
  // Use useExploreAgents() directly on the Explore page.
  const [explorePage, setExplorePage] = useState(0);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
  }, [queryClient]);

  return {
    myAgents,
    myAgentsLoading,
    totalAgents,

    // Explore data - not fetched, use useExploreAgents() on Explore page
    exploreAgents: [],
    exploreLoading: false,
    explorePage,
    exploreHasMore: false,
    setExplorePage,

    registerAgent,
    isPending,

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
          updateAuthority: {
            address: session.account.address,
          } as KeyPairSigner,
          field: { __kind: "Uri" },
          value: newUri,
        });

        const signature = await solanaClient.helpers.transaction.prepareAndSend(
          {
            authority: session,
            instructions: [instruction],
            commitment: "confirmed",
          },
        );

        toast.success("Metadata updated!", { id: toastId });
        return { signature: signature.toString() };
      } catch (error) {
        toast.dismiss(toastId);
        const message =
          error instanceof Error ? error.message : "Unknown error";

        // Check for authority error
        if (
          message.includes("custom program error") ||
          message.includes("0x35c2b5c0")
        ) {
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
