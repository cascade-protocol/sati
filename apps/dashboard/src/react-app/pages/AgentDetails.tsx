/**
 * Agent Details Page
 *
 * Displays full details for a single agent including feedbacks.
 */

import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  Bot,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  MessageSquare,
  MessageCirclePlus,
  ThumbsUp,
  ThumbsDown,
  MinusCircle,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentAvatar } from "@/components/AgentAvatar";
import { EditMetadataDialog } from "@/components/EditMetadataDialog";
import { GiveFeedbackDialog } from "@/components/GiveFeedbackDialog";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAgentDetails, useAgentMetadata, useAgentFeedbacks, useCurrentSlot } from "@/hooks/use-sati";

// Hook to check if agent is a demo agent (can receive feedback via echo service)
function useDemoAgents() {
  return useQuery({
    queryKey: ["demo-agents"],
    queryFn: async () => {
      const response = await fetch("/api/demo-agents");
      if (!response.ok) return { agents: [] };
      return response.json() as Promise<{
        agents: Array<{ mint: string; name: string; echoEnabled: boolean }>;
      }>;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { formatMemberNumber, formatSlotTime, getSolscanUrl, truncateAddress } from "@/lib/sati";

// Helper to format outcome
function formatOutcome(outcome: number): { text: string; color: string } {
  switch (outcome) {
    case 0:
      return { text: "Negative", color: "text-red-500" };
    case 1:
      return { text: "Neutral", color: "text-yellow-500" };
    case 2:
      return { text: "Positive", color: "text-green-500" };
    default:
      return { text: "Unknown", color: "text-muted-foreground" };
  }
}

// Compute feedback stats
interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
}

function computeFeedbackStats(feedbacks: Array<{ data: { outcome: number; counterparty: string } }>): FeedbackStats {
  const total = feedbacks.length;
  if (total === 0) {
    return {
      total: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      positivePercent: 0,
      negativePercent: 0,
      neutralPercent: 0,
    };
  }

  const positive = feedbacks.filter((f) => f.data.outcome === 2).length;
  const negative = feedbacks.filter((f) => f.data.outcome === 0).length;
  const neutral = feedbacks.filter((f) => f.data.outcome === 1).length;

  return {
    total,
    positive,
    negative,
    neutral,
    positivePercent: Math.round((positive / total) * 100),
    negativePercent: Math.round((negative / total) * 100),
    neutralPercent: Math.round((neutral / total) * 100),
  };
}

export function AgentDetails() {
  const { mint } = useParams<{ mint: string }>();
  const navigate = useNavigate();
  const { agent, isLoading, error, refetch } = useAgentDetails(mint);
  const { metadata } = useAgentMetadata(agent?.uri);
  // tokenAccount in feedbacks IS the agent mint (not ATA)
  const { feedbacks, isLoading: feedbacksLoading } = useAgentFeedbacks(agent?.mint);
  const { currentSlot } = useCurrentSlot();
  const { data: demoAgentsData } = useDemoAgents();

  // Check if this agent can receive feedback via echo service
  const canGiveFeedback = demoAgentsData?.agents?.some(
    (demoAgent) => demoAgent.mint === agent?.mint && demoAgent.echoEnabled,
  );

  if (isLoading) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </main>
    );
  }

  if (error || !agent) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
        <div className="space-y-6">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Bot className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Agent Not Found</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {error?.message || "The requested agent could not be found."}
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {/* Header */}
        <div className="flex items-start gap-4">
          <AgentAvatar name={agent.name} size="lg" />
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{agent.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-muted-foreground">{formatMemberNumber(agent.memberNumber)}</span>
              {agent.nonTransferable && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-xs bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded">Non-transferable</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="flex flex-wrap gap-2">
          <EditMetadataDialog
            mint={agent.mint}
            currentName={agent.name}
            currentDescription={metadata?.description}
            onSuccess={refetch}
          >
            <Button variant="default">
              <Pencil className="h-4 w-4 mr-2" />
              Edit Metadata
            </Button>
          </EditMetadataDialog>
          {canGiveFeedback && (
            <GiveFeedbackDialog agentMint={agent.mint} agentName={agent.name} onSuccess={refetch}>
              <Button variant="secondary">
                <MessageCirclePlus className="h-4 w-4 mr-2" />
                Give Feedback
              </Button>
            </GiveFeedbackDialog>
          )}
          <Button variant="outline" asChild>
            <a href={getSolscanUrl(agent.mint, "token")} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              View on Solscan
            </a>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success("Link copied to clipboard");
            }}
          >
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="feedbacks">Feedbacks ({feedbacks.length})</TabsTrigger>
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            {/* Stats */}
            {(() => {
              const stats = computeFeedbackStats(
                feedbacks.map((f) => ({
                  data: f.data as { outcome: number; counterparty: string },
                })),
              );
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-muted">
                          <MessageSquare className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold">{stats.total}</p>
                          <p className="text-sm text-muted-foreground">Total</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-500/10">
                          <ThumbsUp className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-green-500">{stats.positivePercent}%</p>
                          <p className="text-sm text-muted-foreground">Positive</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-yellow-500/10">
                          <MinusCircle className="h-5 w-5 text-yellow-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-yellow-500">{stats.neutralPercent}%</p>
                          <p className="text-sm text-muted-foreground">Neutral</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-500/10">
                          <ThumbsDown className="h-5 w-5 text-red-500" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-red-500">{stats.negativePercent}%</p>
                          <p className="text-sm text-muted-foreground">Negative</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}

            {/* Identity */}
            <Card>
              <CardHeader>
                <CardTitle>Identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailRow label="Mint Address" value={agent.mint} copyable solscanType="token" />
                <Separator />
                <DetailRow label="Owner" value={agent.owner} copyable solscanType="account" />
              </CardContent>
            </Card>

            {/* Recent Feedbacks */}
            {feedbacks.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Feedbacks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {feedbacks.slice(0, 5).map((feedback) => {
                      const data = feedback.data as { outcome: number; counterparty: string };
                      const { text: outcomeText, color: outcomeColor } = formatOutcome(data.outcome);
                      const slotCreated = feedback.raw.slotCreated;
                      const key = Array.from(feedback.address)
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join("")
                        .slice(0, 16);
                      return (
                        <div key={key} className="flex items-center justify-between py-2 border-b last:border-0">
                          <code className="text-sm">{truncateAddress(data.counterparty)}</code>
                          <div className="flex items-center gap-3">
                            <span className={outcomeColor}>{outcomeText}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatSlotTime(slotCreated, currentSlot)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Feedbacks Tab */}
          <TabsContent value="feedbacks">
            <Card>
              <CardContent className="pt-6">
                {feedbacksLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : feedbacks.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    No feedbacks for this agent yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b text-left text-sm text-muted-foreground">
                          <th className="pb-3 pr-4 font-medium">From</th>
                          <th className="pb-3 pr-4 font-medium">Outcome</th>
                          <th className="pb-3 font-medium text-right">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feedbacks.map((feedback) => {
                          const data = feedback.data as { outcome: number; counterparty: string };
                          const { text: outcomeText, color: outcomeColor } = formatOutcome(data.outcome);
                          const slotCreated = feedback.raw.slotCreated;
                          const key = Array.from(feedback.address)
                            .map((b) => b.toString(16).padStart(2, "0"))
                            .join("")
                            .slice(0, 16);
                          return (
                            <tr key={key} className="border-b">
                              <td className="py-4 pr-4">
                                <code className="text-sm">{truncateAddress(data.counterparty)}</code>
                              </td>
                              <td className="py-4 pr-4">
                                <span className={outcomeColor}>{outcomeText}</span>
                              </td>
                              <td className="py-4 text-right text-sm text-muted-foreground">
                                {formatSlotTime(slotCreated, currentSlot)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Metadata Tab */}
          <TabsContent value="metadata" className="space-y-4">
            {agent.uri ? (
              <>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Metadata URI</CardTitle>
                    <Button variant="outline" size="sm" asChild>
                      <a href={agent.uri} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View Raw
                      </a>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <code className="text-sm break-all">{agent.uri}</code>
                  </CardContent>
                </Card>

                {metadata && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Parsed Metadata</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-sm overflow-auto bg-muted p-4 rounded-lg">
                        {JSON.stringify(metadata, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {Object.keys(agent.additionalMetadata).length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>On-Chain Metadata</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {Object.entries(agent.additionalMetadata).map(([key, value], index) => (
                          <div key={key}>
                            {index > 0 && <Separator className="mb-4" />}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <span className="text-sm font-medium text-muted-foreground">{key}</span>
                              <span className="text-sm font-mono break-all">{value}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
                  No metadata URI configured for this agent.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  copyable?: boolean;
  isLink?: boolean;
  solscanType?: "account" | "token" | "tx";
}

function DetailRow({ label, value, copyable, isLink, solscanType = "account" }: DetailRowProps) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        {isLink ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-mono text-primary hover:underline break-all select-all flex-1"
          >
            {value}
          </a>
        ) : (
          <code className="text-sm break-all select-all flex-1 bg-muted px-2 py-1 rounded">{value}</code>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {copyable && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(value)}>
                    <Copy className={`h-4 w-4 ${isCopied ? "text-green-500" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isCopied ? "Copied!" : "Copy"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!isLink && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={getSolscanUrl(value, solscanType)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>View on Solscan</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}
