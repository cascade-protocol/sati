/**
 * My Profile - My Agents & Feedbacks
 *
 * Shows the current user's registered agents, submitted feedbacks, and allows registration of new agents.
 */

import { useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { Bot, Plus, Wallet, MessageSquare, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentTable } from "@/components/AgentTable";
import { RegisterAgentDialog } from "@/components/RegisterAgentDialog";
import { useSati, useMyFeedbacks, useCurrentSlot } from "@/hooks/use-sati";
import { formatSlotTime, truncateAddress } from "@/lib/sati";
import { getSolscanUrl } from "@/lib/network";

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

export function Dashboard() {
  const { connected } = useWalletConnection();
  const { myAgents, myAgentsLoading, totalAgents } = useSati();
  const { myFeedbacks, isLoading: feedbacksLoading } = useMyFeedbacks();
  const { currentSlot } = useCurrentSlot();
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);

  // Not connected state
  if (!connected) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">My Profile</h1>
            <p className="text-sm text-muted-foreground mt-1">Your registered agents and submitted feedbacks</p>
          </div>

          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Connect your Solana wallet to view and manage your registered agents.
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">My Profile</h1>
            <p className="text-sm text-muted-foreground mt-1">Your registered agents and submitted feedbacks</p>
          </div>
          <Button onClick={() => setRegisterDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Register Agent
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Your Agents</CardTitle>
              <Bot className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{myAgents.length}</div>
              <p className="text-xs text-muted-foreground">Registered in your wallet</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Your Feedbacks</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{myFeedbacks.length}</div>
              <p className="text-xs text-muted-foreground">Feedbacks you've submitted</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Registry</CardTitle>
              <Bot className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalAgents.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Agents in SATI registry</p>
            </CardContent>
          </Card>
        </div>

        {/* Agents Table */}
        <Card>
          <CardHeader>
            <CardTitle>Your Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <AgentTable
              agents={myAgents}
              isLoading={myAgentsLoading}
              emptyMessage="You haven't registered any agents yet. Click 'Register Agent' to get started."
            />
          </CardContent>
        </Card>

        {/* My Feedbacks Table */}
        <Card>
          <CardHeader>
            <CardTitle>Your Feedbacks</CardTitle>
          </CardHeader>
          <CardContent>
            {feedbacksLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : myFeedbacks.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                You haven't submitted any feedbacks yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Agent</th>
                      <th className="pb-3 pr-4 font-medium">Outcome</th>
                      <th className="pb-3 font-medium text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myFeedbacks.map((feedback) => {
                      // tokenAccount is the agent's mint address (named for SAS wire format compatibility)
                      const data = feedback.data as { outcome: number; tokenAccount: string };
                      const { text: outcomeText, color: outcomeColor } = formatOutcome(data.outcome);
                      const slotCreated = feedback.raw.slotCreated;
                      // Use attestation address bytes as unique key
                      const key = Array.from(feedback.address)
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join("")
                        .slice(0, 16);
                      return (
                        <tr key={key} className="border-b">
                          <td className="py-4 pr-4">
                            <a
                              href={getSolscanUrl(data.tokenAccount, "account")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-mono hover:text-primary transition-colors"
                            >
                              {truncateAddress(data.tokenAccount)}
                              <ExternalLink className="h-3 w-3 opacity-50" />
                            </a>
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
      </div>

      <RegisterAgentDialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen} />
    </main>
  );
}
