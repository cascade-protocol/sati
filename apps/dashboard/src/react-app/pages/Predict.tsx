/**
 * Predict Page - SATI Demo with Kalshi AI Predictions
 *
 * Educational demonstration of the full SATI attestation workflow:
 * 1. x402 micropayment to prediction agent
 * 2. AI generates market prediction
 * 3. ValidationV1 gates the prediction (confidence threshold)
 * 4. User can rate the prediction via verified feedback
 */

import { useState } from "react";
import { Link } from "react-router";
import type { Address } from "@solana/kit";
import { useWalletConnection, useWalletSession } from "@solana/react-hooks";
import {
  Brain,
  Loader2,
  Wallet,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  ExternalLink,
  MessageSquare,
  ChevronDown,
  HelpCircle,
  Coins,
  Shield,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VerifiedFeedbackDialog } from "@/components/VerifiedFeedbackDialog";
import { AgentAvatar } from "@/components/AgentAvatar";
import { createPaymentFetch } from "@/lib/x402";
import { getChain, getNetwork, getRpcUrl, getSolscanUrl } from "@/lib/network";
import { formatSlotTime } from "@/lib/sati";
import { useAgentValidations, useCurrentSlot } from "@/hooks/use-sati";
import { PREDICTION_AGENT_MINT_DEVNET, PREDICTION_AGENT_MINT_MAINNET } from "../../env";

// =============================================================================
// Helpers
// =============================================================================

function getPredictionAgentMint(): string {
  const network = getNetwork();
  return network === "mainnet" ? (PREDICTION_AGENT_MINT_MAINNET ?? "") : PREDICTION_AGENT_MINT_DEVNET;
}

// =============================================================================
// Types
// =============================================================================

interface MarketData {
  ticker: string;
  title: string;
  subtitle?: string;
  yesPrice: number;
  noPrice: number;
  closeTime: string;
}

interface PredictionData {
  outcome: "yes" | "no";
  confidence: number;
  reasoning: string;
}

interface ValidationData {
  outcome: "Pass" | "Fail";
  threshold: number;
  attestationAddress: string;
  signature: string;
}

interface PredictResponse {
  success: boolean;
  data?: {
    market: MarketData;
    prediction: PredictionData;
    validation: ValidationData;
    taskRef: string;
    dataHash: string;
    agentSignature: string;
    agentOwner: string;
    agentMint: string;
  };
  error?: string;
}

// =============================================================================
// Helper Components
// =============================================================================

function Step({
  number,
  title,
  description,
  status,
}: {
  number: number;
  title: string;
  description: string;
  status: "pending" | "active" | "complete";
}) {
  return (
    <div className="flex items-start gap-4">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors",
          status === "complete" && "bg-green-500 text-white",
          status === "active" && "bg-primary text-primary-foreground",
          status === "pending" && "bg-muted text-muted-foreground",
        )}
      >
        {status === "complete" ? <Check className="h-4 w-4" /> : number}
      </div>
      <div className="min-w-0">
        <p className={cn("font-medium", status === "pending" && "text-muted-foreground")}>{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function MarketCard({ market }: { market: MarketData }) {
  const formatTime = (closeTime: string) => {
    const date = new Date(closeTime);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Kalshi Market
          </Badge>
        </div>
        <CardTitle className="text-lg">{market.title}</CardTitle>
        {market.subtitle && <CardDescription>{market.subtitle}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">YES Price:</span>
            <span className="ml-2 font-mono text-green-500">${market.yesPrice.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">NO Price:</span>
            <span className="ml-2 font-mono text-red-500">${market.noPrice.toFixed(2)}</span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Closes: {formatTime(market.closeTime)} | Ticker: {market.ticker}
        </div>
      </CardContent>
    </Card>
  );
}

function PredictionCard({ prediction }: { prediction: PredictionData }) {
  const isYes = prediction.outcome === "yes";

  return (
    <Card className={isYes ? "border-green-500/50" : "border-red-500/50"}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {isYes ? (
              <TrendingUp className="h-5 w-5 text-green-500" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-500" />
            )}
            AI Prediction
          </CardTitle>
          <Badge variant={isYes ? "default" : "destructive"} className="text-lg px-3 py-1">
            {prediction.outcome.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Confidence:</span>
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${isYes ? "bg-green-500" : "bg-red-500"}`}
              style={{ width: `${prediction.confidence}%` }}
            />
          </div>
          <span className="font-mono text-sm">{prediction.confidence}%</span>
        </div>
        <p className="text-sm text-muted-foreground">{prediction.reasoning}</p>
      </CardContent>
    </Card>
  );
}

function ValidationBadge({ validation, prediction }: { validation: ValidationData; prediction: PredictionData }) {
  const isPassed = validation.outcome === "Pass";
  const chain = getChain();
  // Link to the transaction, not the compressed account (which Solscan can't display)
  const txUrl = getSolscanUrl(validation.signature, "tx", chain);

  return (
    <Card className={isPassed ? "border-green-500/50 bg-green-500/5" : "border-yellow-500/50 bg-yellow-500/5"}>
      <CardContent className="py-4 space-y-4">
        {/* Main status */}
        <div className="flex items-center gap-3">
          {isPassed ? (
            <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
          ) : (
            <XCircle className="h-8 w-8 text-yellow-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold">{isPassed ? "High-Confidence Prediction" : "Low-Confidence Prediction"}</h4>
            <p className="text-sm text-muted-foreground">
              Agent reported {prediction.confidence}% confidence (threshold: {validation.threshold}%)
            </p>
          </div>
        </div>

        {/* Explanation of what this means */}
        <div className="bg-muted/50 rounded-md p-3 text-sm space-y-2">
          {isPassed ? (
            <>
              <p>
                <strong className="text-green-500">✓ Quality threshold met.</strong> The agent was confident enough in
                its analysis to stake its reputation on this prediction.
              </p>
              <p className="text-muted-foreground text-xs">
                This doesn't guarantee correctness — just that the agent believes this prediction is worth tracking.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong className="text-yellow-500">◐ Below quality threshold.</strong> The agent was uncertain about
                this market — which is actually honest behavior.
              </p>
              <p className="text-muted-foreground text-xs">
                The prediction may still be correct. Low confidence means the agent acknowledges high uncertainty in
                this particular market.
              </p>
            </>
          )}
        </div>

        {/* On-chain proof */}
        <div className="pt-2 border-t flex items-center justify-between text-xs">
          <span className="text-muted-foreground">On-chain record:</span>
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:underline text-muted-foreground hover:text-foreground"
          >
            View transaction <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
        <HelpCircle className="h-4 w-4" />
        <span>How does this work?</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <Card className="bg-muted/30">
          <CardContent className="py-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 shrink-0">
                <Coins className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium">1. You pay $0.001</p>
                <p className="text-sm text-muted-foreground">Via x402 micropayment to the prediction agent</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 shrink-0">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium">2. AI analyzes a live market</p>
                <p className="text-sm text-muted-foreground">Fetches real data from Kalshi prediction markets</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 shrink-0">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium">3. Confidence recorded on-chain</p>
                <p className="text-sm text-muted-foreground">
                  The agent's confidence level is permanently recorded on Solana (threshold: 60%)
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 shrink-0">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium">4. You can rate the prediction</p>
                <p className="text-sm text-muted-foreground">Your feedback builds the agent's verifiable reputation</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AgentCard() {
  const agentMint = getPredictionAgentMint();
  const { stats, isLoading } = useAgentValidations(agentMint);

  return (
    <Card className="bg-muted/30">
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <AgentAvatar name="Kalshi Prediction Agent" size="md" />
            <div className="min-w-0">
              <p className="font-semibold truncate">Kalshi Prediction Agent</p>
              <Link to={`/agent/${agentMint}`} className="text-sm text-muted-foreground hover:underline">
                View full profile &rarr;
              </Link>
            </div>
          </div>
          <div className="flex gap-4 text-center shrink-0">
            <div>
              <p className="text-lg font-bold">{isLoading ? "-" : stats.total}</p>
              <p className="text-xs text-muted-foreground">Predictions</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-500">{isLoading ? "-" : `${stats.passRate}%`}</p>
              <p className="text-xs text-muted-foreground">Pass Rate</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentPredictions() {
  const agentMint = getPredictionAgentMint();
  const { validations, isLoading } = useAgentValidations(agentMint);
  const { currentSlot } = useCurrentSlot();

  if (isLoading) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent Predictions</CardTitle>
          <Link to={`/agent/${agentMint}`} className="text-sm text-muted-foreground hover:underline">
            View all &rarr;
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {validations.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No predictions yet. Be the first!</p>
        ) : (
          <div className="space-y-2">
            {validations.slice(0, 3).map((v) => {
              const isPassed = v.data.outcome === 2;
              // Convert address Uint8Array to hex string for key
              const key = Array.from(v.address)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              return (
                <div key={key} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    {isPassed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-yellow-500" />
                    )}
                    <span className="text-sm">{isPassed ? "Passed" : "Did Not Pass"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatSlotTime(v.raw.slotCreated, currentSlot)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WhatHappened({ isPassed, confidence }: { isPassed: boolean; confidence: number }) {
  return (
    <Card className="bg-muted/30 border-dashed">
      <CardContent className="py-4 space-y-3">
        <p className="text-sm">
          <strong className="text-foreground">What just happened:</strong>
        </p>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>You paid $0.001 to the prediction agent via x402</li>
          <li>The agent analyzed a live Kalshi prediction market</li>
          <li>
            It reported {confidence}% confidence —{" "}
            {isPassed ? (
              <span className="text-green-500">above the 60% quality threshold</span>
            ) : (
              <span className="text-yellow-500">below the 60% quality threshold</span>
            )}
          </li>
          <li>This outcome is now permanently recorded on Solana</li>
        </ol>
        <p className="text-sm text-muted-foreground border-t pt-3">
          <strong className="text-foreground">Why this matters:</strong> Over time, anyone can verify this agent's track
          record — how often it's confident, how accurate those confident predictions are. Rate it below to add your
          feedback to its on-chain reputation.
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function Predict() {
  const { connected } = useWalletConnection();
  const session = useWalletSession();
  const [state, setState] = useState<"idle" | "paying" | "predicting" | "complete" | "error">("idle");
  const [result, setResult] = useState<PredictResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);

  // Get RPC URL for user's selected network (x402 payment + attestations)
  const chain = getChain();
  const rpcUrl = getRpcUrl(chain);

  // Mainnet-only check
  const network = getNetwork();
  const isMainnet = network === "mainnet";

  if (!isMainnet) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-2xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Mainnet Only</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              The Kalshi Prediction demo is only available on mainnet. Switch to mainnet using the network selector in
              the header.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const handlePredict = async () => {
    if (!session) return;

    setState("paying");
    setError(null);

    try {
      // Create payment-enabled fetch using user's network
      const paymentFetch = createPaymentFetch(session, rpcUrl);

      setState("predicting");

      // Call the predict endpoint (x402 handles payment)
      // Network passed as query param since body may be consumed by x402 middleware
      const network = getNetwork();
      const response = await paymentFetch(`/api/predict?network=${network}`, {
        method: "POST",
      });

      const data: PredictResponse = await response.json();

      if (!data.success || !data.data) {
        throw new Error(data.error || "Failed to generate prediction");
      }

      setResult(data.data);
      setState("complete");
    } catch (err) {
      console.error("Prediction failed:", err);
      setError(err instanceof Error ? err.message : "Failed to generate prediction");
      setState("error");
    }
  };

  // Not connected state
  if (!connected) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-2xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">See SATI in Action</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Watch an AI agent make predictions with verifiable reputation tracking
            </p>
          </div>

          <HowItWorks />
          <AgentCard />

          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Connect your Solana wallet to generate AI predictions. Each prediction costs $0.001 via x402.
              </p>
            </CardContent>
          </Card>

          <RecentPredictions />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-2xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">See SATI in Action</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Watch an AI agent make predictions with verifiable reputation tracking
          </p>
        </div>

        {/* How It Works - only show in idle state */}
        {state === "idle" && (
          <>
            <HowItWorks />
            <AgentCard />
          </>
        )}

        {/* Predict Button (idle state) */}
        {state === "idle" && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Brain className="h-16 w-16 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Ready to Predict</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-6">
                Click below to fetch a live prediction market and get an AI-powered prediction with on-chain validation.
              </p>
              <Button onClick={handlePredict} size="lg">
                <Brain className="h-5 w-5 mr-2" />
                Generate Prediction ($0.001)
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading states with progress steps */}
        {(state === "paying" || state === "predicting") && (
          <Card>
            <CardContent className="py-8">
              <div className="space-y-6">
                <Step
                  number={1}
                  title="Processing Payment"
                  description="Confirming $0.001 via x402 micropayment"
                  status={state === "paying" ? "active" : "complete"}
                />
                <Step
                  number={2}
                  title="Fetching Market Data"
                  description="Getting live prediction market from Kalshi"
                  status={state === "predicting" ? "active" : "pending"}
                />
                <Step
                  number={3}
                  title="AI Analysis"
                  description="Claude analyzing market conditions"
                  status="pending"
                />
                <Step
                  number={4}
                  title="Recording Validation"
                  description="Creating permanent on-chain record"
                  status="pending"
                />
              </div>
              <div className="mt-6 flex justify-center">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error state */}
        {state === "error" && (
          <Card className="border-destructive">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <XCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold mb-2">Prediction Failed</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => setState("idle")} variant="outline">
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {state === "complete" && result && (
          <div className="space-y-4">
            <MarketCard market={result.market} />
            <PredictionCard prediction={result.prediction} />
            <ValidationBadge validation={result.validation} prediction={result.prediction} />

            <WhatHappened isPassed={result.validation.outcome === "Pass"} confidence={result.prediction.confidence} />

            <div className="space-y-2">
              <div className="flex gap-4">
                <Button onClick={() => setFeedbackDialogOpen(true)} className="flex-1">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Rate This Prediction
                </Button>
                <Button onClick={() => setState("idle")} variant="outline" className="flex-1">
                  <Brain className="h-4 w-4 mr-2" />
                  New Prediction
                </Button>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Submit verified feedback ($0.001) to contribute to this agent's on-chain reputation
              </p>
            </div>

            {/* Feedback Dialog */}
            <VerifiedFeedbackDialog
              open={feedbackDialogOpen}
              onOpenChange={setFeedbackDialogOpen}
              agentMint={result.agentMint as Address}
              agentName="Kalshi Prediction Agent"
              prefilledData={{
                taskRef: result.taskRef,
                dataHash: result.dataHash,
                agentSignature: result.agentSignature,
                agentOwner: result.agentOwner,
              }}
            />
          </div>
        )}

        {/* Recent Predictions - show in idle state */}
        {state === "idle" && <RecentPredictions />}
      </div>
    </main>
  );
}
