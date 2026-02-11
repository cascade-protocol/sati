/**
 * Credit Page - On-Chain Credit Scoring for Agent Economy
 *
 * Demonstrates credit scoring using SATI's attestation infrastructure:
 * 1. Select an agent from the registry
 * 2. View its attestation history (feedbacks + validations)
 * 3. Compute a credit score and publish as ReputationScoreV3
 * 4. See lending terms derived from the score
 */

import { useState } from "react";
import {
  CreditCard,
  Loader2,
  ChevronDown,
  ExternalLink,
  Shield,
  BarChart3,
  Landmark,
  Activity,
  Check,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getChain, getSolscanUrl } from "@/lib/network";
import type { AgentIdentity } from "@/lib/sati";
import { useExploreAgents } from "@/hooks/use-sati";
import {
  useAgentCreditScore,
  useAgentAttestationStats,
  useComputeCreditScore,
  type ComputeCreditScoreResult,
} from "@/hooks/use-credit";
import { TIER_LABELS, TIER_COLORS, TIER_BG_COLORS, type CreditTier } from "@/lib/credit-engine";

// =============================================================================
// Sub-components
// =============================================================================

function HowItWorks() {
  const [open, setOpen] = useState(false);

  const steps = [
    {
      icon: <Shield className="h-5 w-5" />,
      title: "Agent Identity",
      description: "Each agent has an on-chain Token-2022 NFT identity with verifiable metadata.",
    },
    {
      icon: <Activity className="h-5 w-5" />,
      title: "Attestation History",
      description: "Feedbacks and validations are stored as compressed attestations with blind signatures.",
    },
    {
      icon: <BarChart3 className="h-5 w-5" />,
      title: "Oracle Scoring",
      description: "A reputation oracle reads attestation data and computes a weighted credit score.",
    },
    {
      icon: <Landmark className="h-5 w-5" />,
      title: "Lending Decision",
      description: "The score maps to a risk tier that determines collateral ratio, max borrow, and APR.",
    },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
          How It Works
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-3">
          <CardContent className="pt-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => (
                <div key={step.title} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {step.icon}
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                  </div>
                  <h4 className="font-medium">{step.title}</h4>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ScoreGauge({ score, tier }: { score: number; tier: CreditTier }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={cn("flex h-28 w-28 items-center justify-center rounded-full border-4", TIER_BG_COLORS[tier])}>
        <span className={cn("text-4xl font-bold", TIER_COLORS[tier])}>{score}</span>
      </div>
      <Badge variant="outline" className={cn("text-sm", TIER_COLORS[tier])}>
        {TIER_LABELS[tier]}
      </Badge>
    </div>
  );
}

function AttestationStats({
  feedbackCount,
  validationCount,
  positiveRate,
  validationPassRate,
}: {
  feedbackCount: number;
  validationCount: number;
  positiveRate: number;
  validationPassRate: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div className="space-y-1">
        <p className="text-muted-foreground">Feedbacks</p>
        <p className="text-2xl font-bold">{feedbackCount}</p>
        <p className="text-xs text-muted-foreground">
          {feedbackCount > 0 ? `${Math.round(positiveRate * 100)}% positive` : "No data"}
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-muted-foreground">Validations</p>
        <p className="text-2xl font-bold">{validationCount}</p>
        <p className="text-xs text-muted-foreground">
          {validationCount > 0 ? `${Math.round(validationPassRate * 100)}% passed` : "No data"}
        </p>
      </div>
    </div>
  );
}

function LendingTerms({ decision }: { decision: ComputeCreditScoreResult["lendingDecision"] }) {
  if (!decision.approved) {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-red-500 shrink-0" />
            <div>
              <h4 className="font-semibold text-red-500">Lending Denied</h4>
              <p className="text-sm text-muted-foreground">{decision.reason}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-green-500/20 bg-green-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Landmark className="h-5 w-5 text-green-500" />
          Lending Terms
        </CardTitle>
        <CardDescription>{decision.reason}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Collateral</p>
            <p className="text-xl font-bold">{decision.collateralRatio}x</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Max Borrow</p>
            <p className="text-xl font-bold">${decision.maxBorrowUsd.toLocaleString()}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">APR</p>
            <p className="text-xl font-bold">{decision.aprPercent}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBreakdown({ breakdown }: { breakdown: ComputeCreditScoreResult["creditScore"]["breakdown"] }) {
  const items = [
    { label: "Positive Feedback Rate", value: breakdown.positiveRateScore, max: 35 },
    { label: "Validation Pass Rate", value: breakdown.validationPassRateScore, max: 20 },
    { label: "Activity Volume", value: breakdown.activityVolumeScore, max: 15 },
    { label: "Recency", value: breakdown.recencyScore, max: 10 },
    { label: "Baseline", value: breakdown.baselineScore, max: 20 },
  ];

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground w-full justify-between">
          Score Methodology
          <ChevronDown className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-3">
        {items.map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-mono">
                {item.value}/{item.max}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(item.value / item.max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// Agent Detail Panel
// =============================================================================

function AgentCreditPanel({ agentMint }: { agentMint: string }) {
  const { data: existingScore, isLoading: scoreLoading } = useAgentCreditScore(agentMint);
  const { data: stats, isLoading: statsLoading } = useAgentAttestationStats(agentMint);
  const computeMutation = useComputeCreditScore();
  const [result, setResult] = useState<ComputeCreditScoreResult | null>(null);

  const chain = getChain();

  const handleCompute = async () => {
    try {
      const data = await computeMutation.mutateAsync(agentMint);
      setResult(data);
    } catch {
      // Error handled by mutation's onError
    }
  };

  const isLoading = scoreLoading || statsLoading;
  const displayResult = result;

  return (
    <div className="space-y-6">
      {/* Attestation Stats */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Attestation History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading attestation data...</span>
            </div>
          ) : stats ? (
            <AttestationStats
              feedbackCount={stats.feedbackCount}
              validationCount={stats.validationCount}
              positiveRate={stats.positiveRate}
              validationPassRate={stats.validationPassRate}
            />
          ) : (
            <p className="text-sm text-muted-foreground py-4">No attestation data found.</p>
          )}
        </CardContent>
      </Card>

      {/* Existing on-chain score */}
      {existingScore && !displayResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Existing On-Chain Score</CardTitle>
            <CardDescription>Published by {existingScore.methodology} oracle</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <ScoreGauge score={existingScore.score} tier={existingScore.tier as CreditTier} />
            <div className="text-sm space-y-1 text-muted-foreground">
              <p>
                Based on {existingScore.feedbackCount} feedbacks, {existingScore.validationCount} validations
              </p>
              <p>{Math.round(existingScore.positiveRate * 100)}% positive rate</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compute button */}
      {!displayResult && (
        <Button
          onClick={handleCompute}
          disabled={computeMutation.isPending || isLoading}
          className="w-full gap-2"
          size="lg"
        >
          {computeMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Computing & Publishing...
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4" />
              Compute Credit Score
            </>
          )}
        </Button>
      )}

      {/* Result */}
      {displayResult && (
        <div className="space-y-6">
          {/* Score */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Credit Score
                </CardTitle>
                {displayResult.attestation.signature && (
                  <a
                    href={getSolscanUrl(displayResult.attestation.signature, "tx", chain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    View on Solscan
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
              <ScoreGauge score={displayResult.creditScore.score} tier={displayResult.creditScore.tier} />
              <AttestationStats
                feedbackCount={displayResult.creditScore.feedbackCount}
                validationCount={displayResult.creditScore.validationCount}
                positiveRate={displayResult.creditScore.positiveRate}
                validationPassRate={displayResult.creditScore.validationPassRate}
              />
              <div className="w-full border-t pt-4">
                <ScoreBreakdown breakdown={displayResult.creditScore.breakdown} />
              </div>
            </CardContent>
          </Card>

          {/* Lending Decision */}
          <LendingTerms decision={displayResult.lendingDecision} />

          {/* On-chain proof */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="h-4 w-4 text-green-500" />
            Score published on-chain as ReputationScoreV3 attestation
          </div>

          {/* Compute again */}
          <Button
            onClick={() => {
              setResult(null);
            }}
            variant="outline"
            className="w-full"
          >
            Recompute Score
          </Button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function Credit() {
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const { exploreAgents: agents, exploreLoading: agentsLoading } = useExploreAgents();

  return (
    <main className="flex-1 container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <CreditCard className="h-7 w-7" />
          Credit Scoring
        </h1>
        <p className="text-muted-foreground">
          On-chain credit scores for the agent economy. Select an agent to compute a score from its attestation history
          and see lending terms.
        </p>
        <HowItWorks />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Agent List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold">Registered Agents</h2>
          {agentsLoading ? (
            <div className="flex items-center gap-2 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading agents...</span>
            </div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8">No agents registered yet.</p>
          ) : (
            <div className="space-y-2">
              {agents.map((agent: AgentIdentity) => (
                <Card
                  key={agent.mint}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-accent/50",
                    selectedMint === agent.mint && "border-primary bg-accent/30",
                  )}
                  onClick={() => setSelectedMint(agent.mint)}
                >
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{agent.name || "Unnamed Agent"}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {agent.mint.slice(0, 8)}...{agent.mint.slice(-4)}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      #{agent.memberNumber?.toString() ?? "?"}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-3">
          {selectedMint ? (
            <AgentCreditPanel key={selectedMint} agentMint={selectedMint} />
          ) : (
            <Card className="h-64 flex items-center justify-center">
              <div className="text-center text-muted-foreground space-y-2">
                <CreditCard className="h-12 w-12 mx-auto opacity-30" />
                <p>Select an agent to view credit details</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
