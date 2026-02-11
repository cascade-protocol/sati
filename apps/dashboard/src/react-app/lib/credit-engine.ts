/**
 * Credit scoring engine for agent economy.
 *
 * Computes credit scores from on-chain attestation data (feedbacks + validations)
 * and maps scores to lending decisions with collateral requirements.
 */

import { Outcome } from "@cascade-fyi/sati-sdk";
import type { ParsedAttestation, ParsedValidationAttestation } from "@cascade-fyi/sati-sdk";

// ============================================================================
// Types
// ============================================================================

export interface CreditScore {
  score: number; // 0-100
  tier: CreditTier;
  breakdown: ScoreBreakdown;
  feedbackCount: number;
  validationCount: number;
  positiveRate: number; // 0-1
  validationPassRate: number; // 0-1
}

export type CreditTier = "prime" | "near-prime" | "subprime" | "unscoreable";

export interface ScoreBreakdown {
  positiveRateScore: number; // 0-35
  validationPassRateScore: number; // 0-20
  activityVolumeScore: number; // 0-15
  recencyScore: number; // 0-10
  baselineScore: number; // 0-20
}

export interface LendingDecision {
  approved: boolean;
  tier: CreditTier;
  collateralRatio: number; // multiplier (1.0 = no extra collateral)
  maxBorrowUsd: number;
  aprPercent: number;
  reason: string;
}

// ============================================================================
// Scoring
// ============================================================================

const WEIGHTS = {
  positiveRate: 35,
  validationPassRate: 20,
  activityVolume: 15,
  recency: 10,
  baseline: 20,
} as const;

// Minimum feedbacks required for a meaningful score
const MIN_FEEDBACKS_FOR_SCORE = 3;

// Activity volume caps (feedbacks + validations) - score maxes out at this count
const ACTIVITY_CAP = 50;

export function computeCreditScore(
  feedbacks: ParsedAttestation[],
  validations: ParsedValidationAttestation[],
): CreditScore {
  const feedbackCount = feedbacks.length;
  const validationCount = validations.length;
  const totalActivity = feedbackCount + validationCount;

  // Positive feedback rate
  const positiveFeedbacks = feedbacks.filter((f) => f.data.outcome === Outcome.Positive).length;
  const positiveRate = feedbackCount > 0 ? positiveFeedbacks / feedbackCount : 0;

  // Validation pass rate
  const passedValidations = validations.filter((v) => v.data.outcome === Outcome.Positive).length;
  const validationPassRate = validationCount > 0 ? passedValidations / validationCount : 0;

  // Activity volume (normalized to 0-1, capped at ACTIVITY_CAP)
  const activityRatio = Math.min(totalActivity / ACTIVITY_CAP, 1);

  // Recency: fraction of feedbacks in recent slots (rough proxy - check if most are recent)
  // Without absolute timestamps, use position in array as proxy (newer = later index from Photon)
  const recentCount = feedbackCount > 0 ? Math.min(feedbackCount, 10) : 0;
  const recencyRatio = feedbackCount > 0 ? recentCount / Math.max(feedbackCount, 10) : 0;

  // Compute weighted scores
  const positiveRateScore = positiveRate * WEIGHTS.positiveRate;
  const validationPassRateScore = validationPassRate * WEIGHTS.validationPassRate;
  const activityVolumeScore = activityRatio * WEIGHTS.activityVolume;
  const recencyScore = recencyRatio * WEIGHTS.recency;
  const baselineScore =
    feedbackCount >= MIN_FEEDBACKS_FOR_SCORE
      ? WEIGHTS.baseline
      : (feedbackCount / MIN_FEEDBACKS_FOR_SCORE) * WEIGHTS.baseline;

  const rawScore = positiveRateScore + validationPassRateScore + activityVolumeScore + recencyScore + baselineScore;
  const score = Math.round(Math.min(100, Math.max(0, rawScore)));

  return {
    score,
    tier: getTier(score, feedbackCount),
    breakdown: {
      positiveRateScore: Math.round(positiveRateScore * 10) / 10,
      validationPassRateScore: Math.round(validationPassRateScore * 10) / 10,
      activityVolumeScore: Math.round(activityVolumeScore * 10) / 10,
      recencyScore: Math.round(recencyScore * 10) / 10,
      baselineScore: Math.round(baselineScore * 10) / 10,
    },
    feedbackCount,
    validationCount,
    positiveRate,
    validationPassRate,
  };
}

function getTier(score: number, feedbackCount: number): CreditTier {
  if (feedbackCount < MIN_FEEDBACKS_FOR_SCORE) return "unscoreable";
  if (score >= 80) return "prime";
  if (score >= 60) return "near-prime";
  if (score >= 40) return "subprime";
  return "unscoreable";
}

// ============================================================================
// Lending Decision
// ============================================================================

const TIER_CONFIG: Record<CreditTier, { collateralRatio: number; maxBorrowUsd: number; aprPercent: number }> = {
  prime: { collateralRatio: 1.0, maxBorrowUsd: 50_000, aprPercent: 5 },
  "near-prime": { collateralRatio: 1.25, maxBorrowUsd: 25_000, aprPercent: 8 },
  subprime: { collateralRatio: 2.0, maxBorrowUsd: 5_000, aprPercent: 15 },
  unscoreable: { collateralRatio: 0, maxBorrowUsd: 0, aprPercent: 0 },
};

export function computeLendingDecision(creditScore: CreditScore): LendingDecision {
  const { tier } = creditScore;
  const config = TIER_CONFIG[tier];

  if (tier === "unscoreable") {
    return {
      approved: false,
      tier,
      collateralRatio: 0,
      maxBorrowUsd: 0,
      aprPercent: 0,
      reason:
        creditScore.feedbackCount < MIN_FEEDBACKS_FOR_SCORE
          ? `Insufficient history (${creditScore.feedbackCount}/${MIN_FEEDBACKS_FOR_SCORE} feedbacks required)`
          : `Score too low (${creditScore.score}/100)`,
    };
  }

  return {
    approved: true,
    tier,
    collateralRatio: config.collateralRatio,
    maxBorrowUsd: config.maxBorrowUsd,
    aprPercent: config.aprPercent,
    reason: `${tier.replace("-", " ")} tier - ${creditScore.score}/100`,
  };
}

// Display helpers

export const TIER_LABELS: Record<CreditTier, string> = {
  prime: "Prime",
  "near-prime": "Near Prime",
  subprime: "Subprime",
  unscoreable: "Unscoreable",
};

export const TIER_COLORS: Record<CreditTier, string> = {
  prime: "text-green-500",
  "near-prime": "text-yellow-500",
  subprime: "text-orange-500",
  unscoreable: "text-muted-foreground",
};

export const TIER_BG_COLORS: Record<CreditTier, string> = {
  prime: "bg-green-500/10 border-green-500/20",
  "near-prime": "bg-yellow-500/10 border-yellow-500/20",
  subprime: "bg-orange-500/10 border-orange-500/20",
  unscoreable: "bg-muted/50 border-muted",
};
