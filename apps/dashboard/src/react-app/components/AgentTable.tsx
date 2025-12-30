/**
 * Agent table component for displaying a list of agents
 */

import { useNavigate } from "react-router";
import { Copy, ExternalLink, Loader2, MessageSquare } from "lucide-react";
import type { AgentIdentity } from "@cascade-fyi/sati-sdk";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { truncateAddress, formatMemberNumber, getSolscanUrl } from "@/lib/sati";

interface AgentTableProps {
  agents: AgentIdentity[];
  isLoading?: boolean;
  emptyMessage?: string;
  /** Map of agent mint address to feedback count */
  feedbackCounts?: Record<string, number>;
}

export function AgentTable({ agents, isLoading, emptyMessage = "No agents found", feedbackCounts }: AgentTableProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (agents.length === 0) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b text-left text-sm text-muted-foreground">
            <th className="pb-3 pr-4 font-medium">Agent</th>
            <th className="pb-3 pr-4 font-medium">Mint</th>
            <th className="pb-3 pr-4 font-medium">Owner</th>
            <th className="pb-3 pr-4 font-medium text-center">Feedbacks</th>
            <th className="pb-3 font-medium text-right">Member #</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <AgentRow
              key={agent.mint}
              agent={agent}
              feedbackCount={feedbackCounts?.[agent.mint]}
              onClick={() => navigate(`/agent/${agent.mint}`)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface AgentRowProps {
  agent: AgentIdentity;
  feedbackCount?: number;
  onClick: () => void;
}

function AgentRow({ agent, feedbackCount, onClick }: AgentRowProps) {
  const { copyToClipboard, isCopied: mintCopied } = useCopyToClipboard();
  const { copyToClipboard: copyOwner, isCopied: ownerCopied } = useCopyToClipboard();

  return (
    <tr className="border-b cursor-pointer hover:bg-muted/50 transition-colors" onClick={onClick}>
      <td className="py-4 pr-4">
        <div className="flex items-center gap-3">
          <AgentAvatar name={agent.name} size="sm" />
          <div className="font-medium">{agent.name}</div>
        </div>
      </td>
      <td className="py-4 pr-4">
        <div className="flex items-center gap-2">
          <code className="text-sm">{truncateAddress(agent.mint)}</code>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(agent.mint);
                  }}
                >
                  <Copy className={`h-3 w-3 ${mintCopied ? "text-green-500" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{mintCopied ? "Copied!" : "Copy mint address"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <a
            href={getSolscanUrl(agent.mint, "token")}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </td>
      <td className="py-4 pr-4">
        <div className="flex items-center gap-2">
          <code className="text-sm">{truncateAddress(agent.owner)}</code>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyOwner(agent.owner);
                  }}
                >
                  <Copy className={`h-3 w-3 ${ownerCopied ? "text-green-500" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{ownerCopied ? "Copied!" : "Copy owner address"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </td>
      <td className="py-4 pr-4 text-center">
        <div className="flex items-center justify-center gap-1">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{feedbackCount ?? 0}</span>
        </div>
      </td>
      <td className="py-4 text-right">
        <span className="text-muted-foreground">{formatMemberNumber(agent.memberNumber)}</span>
      </td>
    </tr>
  );
}
