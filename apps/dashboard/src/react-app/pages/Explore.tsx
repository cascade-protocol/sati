/**
 * Explore - Browse All Agents and Feedbacks
 *
 * Paginated view of all agents and feedbacks registered in the SATI registry.
 */

import { Bot, ChevronLeft, ChevronRight, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentTable } from "@/components/AgentTable";
import { useExploreAgents, useAllFeedbacks } from "@/hooks/use-sati";
import { truncateAddress } from "@/lib/sati";

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

export function Explore() {
  const {
    exploreAgents,
    exploreLoading,
    exploreHasMore,
    explorePage,
    setExplorePage,
    totalAgents,
  } = useExploreAgents();

  const { feedbacks, feedbacksCount, isLoading: feedbacksLoading } = useAllFeedbacks();

  return (
    <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Explore
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse all agents and feedbacks registered in the SATI registry
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
              <Bot className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalAgents.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                Registered in SATI registry
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Feedbacks</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {feedbacksCount.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                Attestations on-chain
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Agents Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>All Agents</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Page {explorePage + 1}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <AgentTable
              agents={exploreAgents}
              isLoading={exploreLoading}
              emptyMessage="No agents registered yet."
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
              <span className="text-sm text-muted-foreground">
                Page {explorePage + 1}
              </span>
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
          <CardHeader>
            <CardTitle>Recent Feedbacks</CardTitle>
          </CardHeader>
          <CardContent>
            {feedbacksLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : feedbacks.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                No feedbacks yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Agent</th>
                      <th className="pb-3 pr-4 font-medium">Counterparty</th>
                      <th className="pb-3 pr-4 font-medium">Outcome</th>
                      <th className="pb-3 font-medium text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbacks.slice(0, 20).map((feedback, idx) => {
                      const { text: outcomeText, color: outcomeColor } = formatOutcome(feedback.feedback.outcome);
                      return (
                        <tr key={idx} className="border-b">
                          <td className="py-4 pr-4">
                            <code className="text-sm">{truncateAddress(feedback.feedback.tokenAccount)}</code>
                          </td>
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
