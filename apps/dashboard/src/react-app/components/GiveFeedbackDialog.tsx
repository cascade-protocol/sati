/**
 * GiveFeedbackDialog - FeedbackPublic submission (server-paid)
 *
 * Flow:
 * 1. User selects outcome (Positive/Neutral/Negative)
 * 2. User signs SIWS message with wallet (free - just a signature)
 * 3. Server builds tx, pays gas, and submits
 * 4. Done! User doesn't need SOL.
 */

import { useState, type ReactNode } from "react";
import { useWalletSession } from "@solana/react-hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import {
  type Outcome,
  loadDeployedConfig,
  MAX_SINGLE_SIGNATURE_CONTENT_SIZE,
  buildCounterpartyMessage,
  serializeFeedback,
  type FeedbackData,
} from "@cascade-fyi/sati-sdk";
import { getNetwork } from "@/lib/network";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Loader2, X } from "lucide-react";

// Get deployed FeedbackPublic schema address (SingleSigner mode - no counterparty sig needed)
const deployedConfig = loadDeployedConfig(getNetwork());
const FEEDBACK_SCHEMA_ADDRESS = deployedConfig?.schemas?.feedbackPublic as Address | undefined;

interface GiveFeedbackDialogProps {
  /** Agent mint address (used as tokenAccount in attestations) */
  agentMint: Address;
  /** Agent name for display */
  agentName: string;
  /** Trigger element */
  children: ReactNode;
  /** Callback on successful submission */
  onSuccess?: () => void;
}

// API request/response types for CounterpartySigned mode
interface SubmitFeedbackRequest {
  sasSchema: string;
  taskRef: string;
  tokenAccount: string;
  dataHash: string;
  outcome: number;
  counterparty: string;
  agentSignature: string; // User's SIWS signature (hex)
  agentAddress: string; // User's wallet address
  counterpartyMessage: string; // SIWS message bytes (hex) - triggers server-paid mode
  content?: string;
  contentType?: number;
}

interface SubmitFeedbackResponse {
  success: boolean;
  attestationAddress?: string;
  signature?: string;
  error?: string;
}

// Hex helper
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function GiveFeedbackDialog({ agentMint, agentName, children, onSuccess }: GiveFeedbackDialogProps) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string>("2"); // Default to Positive
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [message, setMessage] = useState("");
  const [score, setScore] = useState<number | undefined>(undefined);
  const [showScore, setShowScore] = useState(false);
  const queryClient = useQueryClient();
  const session = useWalletSession();

  // Add a tag from input
  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < 5) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  // Remove a tag
  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  // Handle tag input keydown
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
  };

  // Build JSON content from form state and calculate size
  const buildContent = (): { json: string | undefined; size: number } => {
    const content: { tags?: string[]; score?: number; m?: string } = {};
    if (tags.length > 0) content.tags = tags;
    if (score !== undefined) content.score = score;
    if (message.trim()) content.m = message.trim();
    if (Object.keys(content).length === 0) return { json: undefined, size: 0 };
    const json = JSON.stringify(content);
    return { json, size: new TextEncoder().encode(json).length };
  };

  // Calculate current content size for validation feedback
  const { size: contentSize } = buildContent();
  const contentExceedsLimit = contentSize > MAX_SINGLE_SIGNATURE_CONTENT_SIZE;
  const contentNearLimit = contentSize > MAX_SINGLE_SIGNATURE_CONTENT_SIZE * 0.8;

  const feedbackMutation = useMutation({
    mutationFn: async (selectedOutcome: Outcome) => {
      if (!session) throw new Error("Wallet not connected");
      if (!FEEDBACK_SCHEMA_ADDRESS) throw new Error("Feedback schema not configured");

      const toastId = toast.loading("Preparing feedback...");

      try {
        // 1. Generate random taskRef; dataHash is zeros for CounterpartySigned
        const taskRef = crypto.getRandomValues(new Uint8Array(32));
        const dataHash = new Uint8Array(32); // zeros - CounterpartySigned doesn't need blind commitment

        // Build JSON content from form state
        const { json: contentJson } = buildContent();
        const contentBytes = contentJson ? new TextEncoder().encode(contentJson) : new Uint8Array(0);

        // 2. Build feedback data for SIWS message
        const feedbackData: FeedbackData = {
          taskRef,
          tokenAccount: agentMint,
          counterparty: session.account.address as Address,
          dataHash,
          outcome: selectedOutcome,
          contentType: contentJson ? 1 : 0, // 1 = JSON
          content: contentBytes,
        };

        // 3. Build SIWS message for user to sign
        const serializedData = serializeFeedback(feedbackData);
        const siwsMessage = buildCounterpartyMessage({
          schemaName: "FeedbackPublicV1",
          data: serializedData,
        });

        // 4. User signs SIWS message with wallet (FREE - just a signature)
        toast.loading("Sign feedback consent...", { id: toastId });

        // Access Phantom wallet for signMessage
        const phantom = (
          window as unknown as {
            phantom?: { solana?: { signMessage: (msg: Uint8Array) => Promise<{ signature: Uint8Array }> } };
          }
        ).phantom;

        if (!phantom?.solana?.signMessage) {
          throw new Error("Wallet does not support message signing. Please use Phantom.");
        }

        console.log("[Feedback] Requesting SIWS signature...");
        const { signature } = await phantom.solana.signMessage(new Uint8Array(siwsMessage.messageBytes));
        console.log("[Feedback] SIWS message signed");

        // 5. Send to server for submission (server pays gas)
        toast.loading("Submitting feedback...", { id: toastId });

        const request: SubmitFeedbackRequest = {
          sasSchema: FEEDBACK_SCHEMA_ADDRESS,
          taskRef: bytesToHex(taskRef),
          tokenAccount: agentMint,
          dataHash: bytesToHex(dataHash),
          outcome: selectedOutcome,
          counterparty: session.account.address,
          agentSignature: bytesToHex(signature), // User's SIWS signature
          agentAddress: session.account.address, // User's wallet address
          counterpartyMessage: bytesToHex(new Uint8Array(siwsMessage.messageBytes)), // Triggers server-paid mode
          ...(contentJson && { content: contentJson, contentType: 1 }),
        };

        const response = await fetch("/api/build-feedback-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to submit feedback");
        }

        const result: SubmitFeedbackResponse = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Submission failed");
        }

        console.log("[Feedback] Submitted:", result.attestationAddress);
        toast.success("Feedback submitted!", { id: toastId });

        return {
          address: result.attestationAddress as Address,
          signature: result.signature,
        };
      } catch (error) {
        toast.dismiss(toastId);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        toast.error(`Failed: ${errorMessage}`);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sati", "feedbacks"] });
      setOpen(false);
      // Reset form state
      setTags([]);
      setTagInput("");
      setMessage("");
      setScore(undefined);
      setShowScore(false);
      setOutcome("2");
      onSuccess?.();
    },
  });

  const handleSubmit = () => {
    // Prevent double submission
    if (feedbackMutation.isPending) return;

    const outcomeValue = parseInt(outcome, 10) as Outcome;
    feedbackMutation.mutate(outcomeValue);
  };

  const isDisabled = !session || feedbackMutation.isPending || contentExceedsLimit;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Give Feedback</DialogTitle>
          <DialogDescription>
            Submit feedback for <span className="font-medium">{agentName}</span>. You'll sign a message to confirm your
            feedback.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {/* Outcome */}
          <div>
            <Label className="mb-3 block text-sm font-medium">How was your experience?</Label>
            <RadioGroup value={outcome} onValueChange={setOutcome} className="flex flex-col gap-3">
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="2" id="positive" />
                <Label htmlFor="positive" className="flex items-center gap-2">
                  <span className="text-green-500">Positive</span>
                  <span className="text-muted-foreground text-sm">- Agent was helpful</span>
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="1" id="neutral" />
                <Label htmlFor="neutral" className="flex items-center gap-2">
                  <span className="text-yellow-500">Neutral</span>
                  <span className="text-muted-foreground text-sm">- Neither good nor bad</span>
                </Label>
              </div>
              <div className="flex items-center space-x-3">
                <RadioGroupItem value="0" id="negative" />
                <Label htmlFor="negative" className="flex items-center gap-2">
                  <span className="text-red-500">Negative</span>
                  <span className="text-muted-foreground text-sm">- Had issues</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Tags */}
          <div>
            <Label className="mb-2 block text-sm font-medium">Tags (optional)</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-muted rounded-full">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add a tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                maxLength={32}
                disabled={tags.length >= 5}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTag}
                disabled={!tagInput.trim() || tags.length >= 5}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {tags.length}/5 tags{tagInput.length > 0 && ` • ${tagInput.length}/32 chars`}. Press Enter or comma to
              add.
            </p>
          </div>

          {/* Message */}
          <div>
            <Label className="mb-2 block text-sm font-medium">Message (optional)</Label>
            <Textarea
              placeholder="Share more details about your experience..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={150}
              rows={3}
            />
            <p className="text-xs text-muted-foreground mt-1">{message.length}/150 characters</p>
          </div>

          {/* Score */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Score (optional)</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowScore(!showScore);
                  if (!showScore) setScore(50);
                  else setScore(undefined);
                }}
              >
                {showScore ? "Remove score" : "Add score"}
              </button>
            </div>
            {showScore && (
              <div className="space-y-2">
                <Slider value={[score ?? 50]} onValueChange={([val]) => setScore(val)} min={0} max={100} step={1} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0 (Poor)</span>
                  <span className="font-medium text-foreground">{score ?? 50}/100</span>
                  <span>100 (Excellent)</span>
                </div>
              </div>
            )}
          </div>

          {/* Content size indicator - always show to set expectations */}
          <div
            className={`text-xs ${
              contentExceedsLimit ? "text-destructive" : contentNearLimit ? "text-yellow-500" : "text-muted-foreground"
            }`}
          >
            Content size: {contentSize}/{MAX_SINGLE_SIGNATURE_CONTENT_SIZE} bytes
            {contentExceedsLimit && " — Too large, reduce tags or message"}
            {!contentExceedsLimit && contentSize === 0 && (
              <span className="block mt-1">
                Tags + message must fit within {MAX_SINGLE_SIGNATURE_CONTENT_SIZE} bytes total
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isDisabled}>
            {feedbackMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Submit Feedback"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
