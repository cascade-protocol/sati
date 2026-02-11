/**
 * Credit scoring hooks.
 *
 * - useAgentCreditScore(agentMint) - Reads existing on-chain ReputationScoreV3
 * - useComputeCreditScore() - Mutation to compute + publish credit score via worker
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import { listAgentReputationScores, parseReputationScoreContent, type ReputationScoreData } from "@/lib/sati";
import { listAgentFeedbacks, listAgentValidations } from "@/lib/sati";
import { getNetwork } from "@/lib/network";
import type { CreditScore, LendingDecision } from "@/lib/credit-engine";

const CREDIT_KEY = ["sati", "credit"];

export interface ParsedCreditScore {
  raw: ReputationScoreData;
  score: number;
  tier: string;
  methodology: string;
  feedbackCount: number;
  validationCount: number;
  positiveRate: number;
  validationPassRate: number;
}

/**
 * Fetch existing on-chain credit score for an agent
 */
export function useAgentCreditScore(agentMint: string | undefined) {
  return useQuery({
    queryKey: [...CREDIT_KEY, "score", agentMint],
    queryFn: async (): Promise<ParsedCreditScore | null> => {
      if (!agentMint) return null;

      const scores = await listAgentReputationScores(agentMint as Address);
      if (scores.length === 0) return null;

      // Take the most recent score (last in array)
      const latest = scores[scores.length - 1];
      const parsed = parseReputationScoreContent(latest.content, latest.contentType);

      return {
        raw: latest,
        score: parsed?.score ?? 0,
        tier: ((parsed as Record<string, unknown>)?.t as string) ?? "unknown",
        methodology: ((parsed as Record<string, unknown>)?.m as string) ?? "unknown",
        feedbackCount: ((parsed as Record<string, unknown>)?.fc as number) ?? 0,
        validationCount: ((parsed as Record<string, unknown>)?.vc as number) ?? 0,
        positiveRate: (((parsed as Record<string, unknown>)?.pr as number) ?? 0) / 100,
        validationPassRate: (((parsed as Record<string, unknown>)?.vr as number) ?? 0) / 100,
      };
    },
    enabled: !!agentMint,
    staleTime: 30_000,
  });
}

/**
 * Fetch attestation stats for an agent (for display before computing score)
 */
export function useAgentAttestationStats(agentMint: string | undefined) {
  return useQuery({
    queryKey: [...CREDIT_KEY, "stats", agentMint],
    queryFn: async () => {
      if (!agentMint) return null;

      const [feedbacks, validations] = await Promise.all([
        listAgentFeedbacks(agentMint as Address),
        listAgentValidations(agentMint as Address),
      ]);

      const positiveFeedbacks = feedbacks.filter((f) => f.data.outcome === 2).length;
      const passedValidations = validations.filter((v) => v.data.outcome === 2).length;

      return {
        feedbackCount: feedbacks.length,
        validationCount: validations.length,
        positiveRate: feedbacks.length > 0 ? positiveFeedbacks / feedbacks.length : 0,
        validationPassRate: validations.length > 0 ? passedValidations / validations.length : 0,
      };
    },
    enabled: !!agentMint,
    staleTime: 30_000,
  });
}

export interface ComputeCreditScoreResult {
  creditScore: CreditScore;
  lendingDecision: LendingDecision;
  attestation: {
    address: string;
    signature: string;
  };
}

/**
 * Mutation to compute credit score and publish on-chain
 */
export function useComputeCreditScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentMint: string): Promise<ComputeCreditScoreResult> => {
      const network = getNetwork();

      const response = await fetch("/api/credit-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentMint, network }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error((error as { error: string }).error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      if (!(result as { success: boolean }).success) {
        throw new Error((result as { error: string }).error || "Failed to compute credit score");
      }

      return (result as { data: ComputeCreditScoreResult }).data;
    },
    onSuccess: (_data, agentMint) => {
      // Invalidate the on-chain score query so it refetches
      queryClient.invalidateQueries({ queryKey: [...CREDIT_KEY, "score", agentMint] });
      queryClient.invalidateQueries({ queryKey: [...CREDIT_KEY, "stats", agentMint] });
      toast.success("Credit score published on-chain");
    },
    onError: (error) => {
      toast.error(`Failed to compute credit score: ${error.message}`);
    },
  });
}
