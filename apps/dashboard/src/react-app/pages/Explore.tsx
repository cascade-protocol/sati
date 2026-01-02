/**
 * Explore - Browse All Agents and Feedbacks
 *
 * Paginated view of all agents and feedbacks registered in the SATI registry.
 */

import { useState } from "react";
import { Link } from "react-router";
import { Bot, ChevronLeft, ChevronRight, MessageSquare, Loader2, ExternalLink, Plus, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentTable } from "@/components/AgentTable";
import { FeedbackDetailModal } from "@/components/FeedbackDetailModal";
import { useExploreAgents, useAllFeedbacks, useCurrentSlot, type OutcomeFilter } from "@/hooks/use-sati";
import { formatSlotTime, truncateAddress, parseFeedback } from "@/lib/sati";
import { getSolscanUrl } from "@/lib/network";
import type { FeedbackData } from "@cascade-fyi/sati-sdk";

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

// Feedbacks per page
const FEEDBACKS_PER_PAGE = 20;

export function Explore() {
  const { exploreAgents, exploreLoading, exploreHasMore, explorePage, setExplorePage, totalAgents } =
    useExploreAgents();

  // Feedback filtering state - passed to hook for TanStack Query select
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [feedbackPage, setFeedbackPage] = useState(0);

  // Hook handles filtering via TanStack Query select (automatic memoization)
  const { feedbacks, feedbacksCount, isLoading: feedbacksLoading } = useAllFeedbacks({ outcomeFilter });
  const { currentSlot } = useCurrentSlot();

  // Paginate feedbacks (already filtered by hook)
  const paginatedFeedbacks = feedbacks.slice(
    feedbackPage * FEEDBACKS_PER_PAGE,
    (feedbackPage + 1) * FEEDBACKS_PER_PAGE,
  );
  const feedbackHasMore = (feedbackPage + 1) * FEEDBACKS_PER_PAGE < feedbacks.length;
  const totalFeedbackPages = Math.ceil(feedbacks.length / FEEDBACKS_PER_PAGE);

  // Reset page when filter changes
  const handleFilterChange = (filter: OutcomeFilter) => {
    setOutcomeFilter(filter);
    setFeedbackPage(0);
  };

  // Compute feedback counts per agent (tokenAccount = agent mint)
  // Note: Uses unfiltered feedbacks for accurate counts
  const feedbackCounts: Record<string, number> = {};
  for (const f of feedbacks) {
    const mint = f.attestation.tokenAccount;
    feedbackCounts[mint] = (feedbackCounts[mint] || 0) + 1;
  }

  return (
    <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
      <div className="space-y-6">
        {/* Hero */}
        <div className="text-center py-8 space-y-4">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">SATI Registry</h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Discover and interact with AI agents on Solana. Browse registered agents and their reputation.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button asChild>
              <Link to="/profile">
                <Plus className="h-4 w-4 mr-2" />
                Register Agent
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href="https://github.com/cascade-protocol/sati" target="_blank" rel="noopener noreferrer">
                Learn More
              </a>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
              <Bot className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalAgents.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Registered in SATI registry</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Feedbacks</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{feedbacksCount.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Attestations on-chain</p>
            </CardContent>
          </Card>
        </div>

        {/* Agents Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>All Agents</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">Page {explorePage + 1}</div>
          </CardHeader>
          <CardContent className="space-y-4">
            <AgentTable
              agents={exploreAgents}
              isLoading={exploreLoading}
              emptyMessage="No agents registered yet."
              feedbackCounts={feedbackCounts}
            />

            {/* Pagination */}
            <div className="flex items-center justify-between pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExplorePage(Math.max(0, explorePage - 1))}
                disabled={explorePage === 0 || exploreLoading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {explorePage + 1}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExplorePage(explorePage + 1)}
                disabled={!exploreHasMore || exploreLoading}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Feedbacks Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>All Feedbacks</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filter:</span>
              <select
                value={outcomeFilter}
                onChange={(e) => handleFilterChange(e.target.value as OutcomeFilter)}
                className={`text-sm border rounded-md px-2 py-1 bg-background ${
                  outcomeFilter !== "all" ? "border-primary ring-1 ring-primary/20" : ""
                }`}
              >
                <option value="all">All Outcomes</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
              </select>
              {outcomeFilter !== "all" && (
                <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">Filtered</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {feedbacksLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : feedbacks.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                {outcomeFilter === "all" ? "No feedbacks yet." : "No feedbacks match the selected filter."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Agent</th>
                      <th className="pb-3 pr-4 font-medium">Counterparty</th>
                      <th className="pb-3 pr-4 font-medium">Outcome</th>
                      <th className="pb-3 pr-4 font-medium">Tags</th>
                      <th className="pb-3 pr-4 font-medium text-right">Time</th>
                      <th className="pb-3 font-medium text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedFeedbacks.map((feedback) => {
                      // Use proper type from SDK
                      const data = feedback.data as FeedbackData;
                      const { text: outcomeText, color: outcomeColor } = formatOutcome(data.outcome);
                      const slotCreated = feedback.raw.slotCreated;
                      // Parse JSON content for tags/score/message
                      const content = parseFeedback(data);
                      // Use full attestation address as key to avoid collisions
                      const key = Array.from(feedback.address)
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join("");
                      return (
                        <tr key={key} className="border-b">
                          <td className="py-4 pr-4">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={getSolscanUrl(data.tokenAccount, "account")}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-sm font-mono hover:text-primary transition-colors"
                                >
                                  {truncateAddress(data.tokenAccount)}
                                  <ExternalLink className="h-3 w-3 opacity-50" />
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>
                                <span className="font-mono text-xs">{data.tokenAccount}</span>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="py-4 pr-4">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={getSolscanUrl(data.counterparty, "account")}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-sm font-mono hover:text-primary transition-colors"
                                >
                                  {truncateAddress(data.counterparty)}
                                  <ExternalLink className="h-3 w-3 opacity-50" />
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>
                                <span className="font-mono text-xs">{data.counterparty}</span>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="py-4 pr-4">
                            <span className={outcomeColor}>{outcomeText}</span>
                          </td>
                          <td className="py-4 pr-4">
                            {content?.tags && content.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {content.tags.slice(0, 3).map((tag) => (
                                  <span
                                    key={tag}
                                    className="px-2 py-0.5 text-xs bg-muted rounded-full text-muted-foreground"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {content.tags.length > 3 && (
                                  <span className="text-xs text-muted-foreground">+{content.tags.length - 3}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-4 pr-4 text-right text-sm text-muted-foreground">
                            {formatSlotTime(slotCreated, currentSlot)}
                          </td>
                          <td className="py-4 text-right">
                            <FeedbackDetailModal feedback={feedback} currentSlot={currentSlot}>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </FeedbackDetailModal>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Feedbacks Pagination */}
            {feedbacks.length > FEEDBACKS_PER_PAGE && (
              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFeedbackPage(Math.max(0, feedbackPage - 1))}
                  disabled={feedbackPage === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {feedbackPage + 1} of {totalFeedbackPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFeedbackPage(feedbackPage + 1)}
                  disabled={!feedbackHasMore}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
