/**
 * Dashboard - My Agents
 *
 * Shows the current user's registered agents and allows registration of new agents.
 */

import { useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { Bot, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentTable } from "@/components/AgentTable";
import { RegisterAgentDialog } from "@/components/RegisterAgentDialog";
import { useSati } from "@/hooks/use-sati";

export function Dashboard() {
  const { connected } = useWalletConnection();
  const { myAgents, myAgentsLoading, totalAgents } = useSati();
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);

  // Not connected state
  if (!connected) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              My Agents
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Register and manage your AI agents on SATI
            </p>
          </div>

          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Connect Your Wallet
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Connect your Solana wallet to view and manage your registered
                agents.
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
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              My Agents
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {totalAgents > 0n
                ? `${totalAgents.toLocaleString()} agents in registry`
                : "Register your first agent"}
            </p>
          </div>
          <Button onClick={() => setRegisterDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Register Agent
          </Button>
        </div>

        {/* Stats Card */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Your Agents</CardTitle>
              <Bot className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{myAgents.length}</div>
              <p className="text-xs text-muted-foreground">
                Registered in your wallet
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Registry</CardTitle>
              <Bot className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalAgents.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                Agents in SATI registry
              </p>
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
      </div>

      <RegisterAgentDialog
        open={registerDialogOpen}
        onOpenChange={setRegisterDialogOpen}
      />
    </main>
  );
}
