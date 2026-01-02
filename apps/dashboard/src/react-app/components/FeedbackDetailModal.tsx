/**
 * FeedbackDetailModal - View full attestation details
 *
 * Shows all attestation data including:
 * - Addresses (agent mint, counterparty, task_ref)
 * - Outcome
 * - Tags, score, message (from JSON content)
 * - On-chain data (slot, address)
 */

import type { ReactNode } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { formatSlotTime, parseFeedback, truncateAddress } from "@/lib/sati";
import { getSolscanUrl } from "@/lib/network";
import type { ParsedFeedback } from "@/lib/sati";

interface FeedbackDetailModalProps {
  /** The feedback attestation data */
  feedback: ParsedFeedback;
  /** Current slot for relative time display */
  currentSlot: bigint;
  /** Trigger element */
  children: ReactNode;
}

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

// Helper to convert bytes to hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function FeedbackDetailModal({ feedback, currentSlot, children }: FeedbackDetailModalProps) {
  const data = feedback.data as {
    outcome: number;
    tokenAccount: string;
    counterparty: string;
    taskRef: Uint8Array;
    dataHash: Uint8Array;
    content: Uint8Array;
    contentType: number;
  };

  const { text: outcomeText, color: outcomeColor } = formatOutcome(data.outcome);
  const content = parseFeedback(data);
  const slotCreated = feedback.raw.slotCreated;

  // Get attestation address as hex string
  const attestationAddress = bytesToHex(feedback.address);

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Feedback Details</DialogTitle>
          <DialogDescription>Attestation submitted {formatSlotTime(slotCreated, currentSlot)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Outcome */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Outcome</span>
            <span className={`text-lg font-semibold ${outcomeColor}`}>{outcomeText}</span>
          </div>

          <Separator />

          {/* Tags */}
          {content?.tags && content.tags.length > 0 && (
            <>
              <div>
                <span className="text-sm font-medium text-muted-foreground block mb-2">Tags</span>
                <div className="flex flex-wrap gap-2">
                  {content.tags.map((tag) => (
                    <span key={tag} className="px-3 py-1 text-sm bg-muted rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Score */}
          {content?.score !== undefined && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Score</span>
                <span className="text-lg font-semibold">{content.score}/100</span>
              </div>
              <Separator />
            </>
          )}

          {/* Message */}
          {content?.m && (
            <>
              <div>
                <span className="text-sm font-medium text-muted-foreground block mb-2">Message</span>
                <p className="text-sm bg-muted p-3 rounded-lg">{content.m}</p>
              </div>
              <Separator />
            </>
          )}

          {/* Addresses */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-muted-foreground block">On-Chain Data</span>

            <AddressRow label="Agent (Token)" value={data.tokenAccount} solscanType="token" />
            <AddressRow label="Counterparty" value={data.counterparty} solscanType="account" />
            {data.taskRef && <AddressRow label="Task Ref" value={bytesToHex(data.taskRef)} copyOnly />}
            {data.dataHash && <AddressRow label="Data Hash" value={bytesToHex(data.dataHash)} copyOnly />}
            <AddressRow label="Attestation" value={attestationAddress} copyOnly />

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Created at Slot</span>
              <span className="font-mono">{slotCreated.toString()}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface AddressRowProps {
  label: string;
  value: string;
  solscanType?: "account" | "token" | "tx";
  copyOnly?: boolean;
}

function AddressRow({ label, value, solscanType, copyOnly }: AddressRowProps) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{truncateAddress(value, 6, 6)}</code>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(value)}>
          {isCopied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        </Button>
        {!copyOnly && solscanType && (
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <a href={getSolscanUrl(value, solscanType)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
