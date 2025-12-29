/**
 * Agent card component for displaying a single agent summary
 */

import { useNavigate } from "react-router";
import { Bot, Copy, ExternalLink } from "lucide-react";
import type { AgentIdentity } from "@cascade-fyi/sati-sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { truncateAddress, formatMemberNumber, getSolscanUrl } from "@/lib/sati";

interface AgentCardProps {
  agent: AgentIdentity;
}

export function AgentCard({ agent }: AgentCardProps) {
  const navigate = useNavigate();
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{agent.name}</CardTitle>
            </div>
          </div>
          <span className="text-sm text-muted-foreground">
            {formatMemberNumber(agent.memberNumber)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Mint</span>
          <div className="flex items-center gap-2">
            <code>{truncateAddress(agent.mint)}</code>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copyToClipboard(agent.mint)}
                  >
                    <Copy className={`h-3 w-3 ${isCopied ? "text-green-500" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isCopied ? "Copied!" : "Copy mint address"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => window.open(getSolscanUrl(agent.mint), "_blank")}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>View on Solscan</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {agent.nonTransferable && (
          <div className="flex items-center gap-2">
            <span className="text-xs bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded">
              Non-transferable
            </span>
          </div>
        )}

        <Button
          className="w-full"
          variant="outline"
          onClick={() => navigate(`/agent/${agent.mint}`)}
        >
          View Details
        </Button>
      </CardContent>
    </Card>
  );
}
