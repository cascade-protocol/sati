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
  Link as LinkIcon,
  Pencil,
  MessageSquare,
  MessageCirclePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentAvatar } from "@/components/AgentAvatar";
import { EditMetadataDialog } from "@/components/EditMetadataDialog";
import { GiveFeedbackDialog } from "@/components/GiveFeedbackDialog";
import { useQuery } from "@tanstack/react-query";
import {
  useAgentDetails,
  useAgentMetadata,
  useAgentFeedbacks,
} from "@/hooks/use-sati";

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
import { formatMemberNumber, getSolscanUrl, truncateAddress } from "@/lib/sati";

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

export function AgentDetails() {
  const { mint } = useParams<{ mint: string }>();
  const navigate = useNavigate();
  const { agent, isLoading, error, refetch } = useAgentDetails(mint);
  const { metadata } = useAgentMetadata(agent?.uri);
  const { feedbacks, isLoading: feedbacksLoading } = useAgentFeedbacks(
    agent?.mint,
    agent?.owner,
  );
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
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {agent.name}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-muted-foreground">
                {formatMemberNumber(agent.memberNumber)}
              </span>
              {agent.nonTransferable && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-xs bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded">
                    Non-transferable
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Identity Details */}
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailRow label="Mint Address" value={agent.mint} copyable solscanType="token" />
            <Separator />
            <DetailRow label="Owner" value={agent.owner} copyable solscanType="account" />
            {agent.uri && (
              <>
                <Separator />
                <DetailRow
                  label="Metadata URI"
                  value={agent.uri}
                  copyable
                  isLink
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Additional Metadata */}
        {Object.keys(agent.additionalMetadata).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Additional Metadata</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(agent.additionalMetadata).map(
                  ([key, value], index) => (
                    <div key={key}>
                      {index > 0 && <Separator className="mb-4" />}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          {key}
                        </span>
                        <span className="text-sm font-mono break-all">
                          {value}
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
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
              <GiveFeedbackDialog
                agentMint={agent.mint}
                agentOwner={agent.owner}
                agentName={agent.name}
                onSuccess={refetch}
              >
                <Button variant="secondary">
                  <MessageCirclePlus className="h-4 w-4 mr-2" />
                  Give Feedback
                </Button>
              </GiveFeedbackDialog>
            )}
            <Button variant="outline" asChild>
              <a
                href={getSolscanUrl(agent.mint, "token")}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View on Solscan
              </a>
            </Button>
            {agent.uri && (
              <Button variant="outline" asChild>
                <a
                  href={agent.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <LinkIcon className="h-4 w-4 mr-2" />
                  View Metadata
                </a>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Feedbacks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Feedbacks ({feedbacks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                      <th className="pb-3 font-medium text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbacks.map((feedback, idx) => {
                      const { text: outcomeText, color: outcomeColor } = formatOutcome(feedback.feedback.outcome);
                      return (
                        <tr key={idx} className="border-b">
                          <td className="py-4 pr-4">
                            <code className="text-sm">{truncateAddress(feedback.feedback.counterparty)}</code>
                          </td>
                          <td className="py-4 pr-4">
                            <span className={outcomeColor}>{outcomeText}</span>
                          </td>
                          <td className="py-4 text-right">
                            <span className="text-muted-foreground">{outcomeText}</span>
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
          <code className="text-sm break-all select-all flex-1 bg-muted px-2 py-1 rounded">
            {value}
          </code>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {copyable && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => copyToClipboard(value)}
                  >
                    <Copy
                      className={`h-4 w-4 ${isCopied ? "text-green-500" : ""}`}
                    />
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
