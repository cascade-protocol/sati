/**
 * Explore - Browse All Agents
 *
 * Paginated view of all agents registered in the SATI registry.
 */

import { Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentTable } from "@/components/AgentTable";
import { useExploreAgents } from "@/hooks/use-sati";

export function Explore() {
  const {
    exploreAgents,
    exploreLoading,
    exploreHasMore,
    explorePage,
    setExplorePage,
    totalAgents,
  } = useExploreAgents();

  return (
    <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Explore Agents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse all agents registered in the SATI registry
          </p>
        </div>

        {/* Stats */}
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
      </div>
    </main>
  );
}
