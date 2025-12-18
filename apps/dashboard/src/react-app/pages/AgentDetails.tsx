/**
 * Agent Details Page
 *
 * Displays full details for a single agent.
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
import { useAgentDetails, useAgentMetadata } from "@/hooks/use-sati";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { formatMemberNumber, getSolscanUrl } from "@/lib/sati";

export function AgentDetails() {
  const { mint } = useParams<{ mint: string }>();
  const navigate = useNavigate();
  const { agent, isLoading, error, refetch } = useAgentDetails(mint);
  const { metadata } = useAgentMetadata(agent?.uri);

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
              <span className="text-muted-foreground">{agent.symbol}</span>
              <span className="text-muted-foreground">·</span>
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
            <Button
              variant="outline"
              onClick={() => window.open(getSolscanUrl(agent.mint, "token"), "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View on Solscan
            </Button>
            {agent.uri && (
              <Button
                variant="outline"
                onClick={() => window.open(agent.uri, "_blank")}
              >
                <LinkIcon className="h-4 w-4 mr-2" />
                View Metadata
              </Button>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => window.open(getSolscanUrl(value, solscanType), "_blank")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
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
