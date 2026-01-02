/**
 * GiveFeedbackDialog - x402 payment-gated feedback submission
 *
 * Flow:
 * 1. User selects outcome (Positive/Neutral/Negative)
 * 2. On submit, calls /api/echo with x402 payment (auto-handled by wrapFetchWithPayment)
 * 3. Echo returns agent's blind signature
 * 4. User signs the feedbackHash
 * 5. Build transaction server-side (Light Protocol needs Node.js)
 * 6. Sign and submit transaction from browser wallet
 */

import { useState, type ReactNode } from "react";
import { useClusterState, useSolanaClient, useWalletSession } from "@solana/react-hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { wrapFetchWithPayment } from "@x402/fetch";
import { type Outcome, loadDeployedConfig, MAX_SINGLE_SIGNATURE_CONTENT_SIZE } from "@cascade-fyi/sati-sdk";
import { createPaymentClient } from "@/lib/x402";
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

// Echo request/response types
interface EchoRequest {
  sasSchema: string;
  taskRef: string;
  tokenAccount: string;
  dataHash: string;
}

interface EchoResponse {
  success: boolean;
  data: {
    agentAddress: string;
    interactionHash: string;
    signature: string;
    signatureBase58: string;
  };
}

interface BuildFeedbackTxRequest {
  sasSchema: string;
  taskRef: string;
  tokenAccount: string;
  dataHash: string;
  outcome: number;
  counterparty: string;
  agentSignature: string;
  agentAddress: string;
  counterpartySignature?: string; // Optional for SingleSigner schemas
  content?: string; // JSON string with tags/score/message
  contentType?: number; // ContentType enum (1 = JSON)
}

interface BuildFeedbackTxResponse {
  success: boolean;
  data: {
    attestationAddress: string;
    messageBytes: string; // base64-encoded transaction message
    signers: string[];
    blockhash: string;
    lastValidBlockHeight: string;
  };
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
  const cluster = useClusterState();
  const solanaClient = useSolanaClient();

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

      const toastId = toast.loading("Processing payment...");

      try {
        // tokenAccount IS the agent mint address (not ATA) - named for SAS wire format compatibility
        const tokenAccount = agentMint;

        // 1. Generate random taskRef; dataHash is zeros for SingleSigner (no blind commitment)
        const taskRef = crypto.getRandomValues(new Uint8Array(32));
        const dataHash = new Uint8Array(32); // zeros - SingleSigner doesn't need blind commitment

        // 3. Build echo request
        const echoRequest: EchoRequest = {
          sasSchema: FEEDBACK_SCHEMA_ADDRESS,
          taskRef: bytesToHex(taskRef),
          tokenAccount: tokenAccount,
          dataHash: bytesToHex(dataHash),
        };

        // 4. Create payment client and wrap fetch for automatic 402 handling
        toast.loading("Creating payment...", { id: toastId });
        console.log("[x402] Using RPC endpoint:", cluster.endpoint);
        const paymentClient = createPaymentClient(session, cluster.endpoint);
        const fetchWithPayment = wrapFetchWithPayment(fetch, paymentClient);

        // 5. Make request - payment is handled automatically on 402
        toast.loading("Submitting payment...", { id: toastId });
        const echoResponse = await fetchWithPayment("/api/echo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(echoRequest),
        });

        if (!echoResponse.ok) {
          const error = await echoResponse.json();
          throw new Error(error.error || "Echo request failed");
        }

        const echo: EchoResponse = await echoResponse.json();
        if (!echo.success) {
          throw new Error("Echo returned unsuccessful response");
        }

        // 6. Build transaction server-side (Light Protocol needs Node.js)
        // FeedbackPublic uses SingleSigner mode - only agent signature required
        toast.loading("Building transaction...", { id: toastId });

        // Build JSON content from form state
        const { json: contentJson } = buildContent();

        const buildRequest: BuildFeedbackTxRequest = {
          sasSchema: FEEDBACK_SCHEMA_ADDRESS,
          taskRef: bytesToHex(taskRef),
          tokenAccount: tokenAccount,
          dataHash: bytesToHex(dataHash),
          outcome: selectedOutcome,
          counterparty: session.account.address,
          agentSignature: echo.data.signature,
          agentAddress: echo.data.agentAddress,
          ...(contentJson && { content: contentJson, contentType: 1 }), // 1 = JSON
        };

        const buildResponse = await fetch("/api/build-feedback-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildRequest),
        });

        if (!buildResponse.ok) {
          const error = await buildResponse.json();
          throw new Error(error.error || "Failed to build transaction");
        }

        const buildResult: BuildFeedbackTxResponse = await buildResponse.json();
        if (!buildResult.success) {
          throw new Error("Build transaction returned unsuccessful response");
        }

        // 8. Sign and submit transaction with wallet
        toast.loading("Signing transaction...", { id: toastId });

        // Decode base64 transaction message to bytes
        const binaryString = atob(buildResult.data.messageBytes);
        const txMessageBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          txMessageBytes[i] = binaryString.charCodeAt(i);
        }

        console.log("[Feedback] Transaction details:", {
          messageLength: txMessageBytes.length,
          signers: buildResult.data.signers,
          blockhash: buildResult.data.blockhash,
          lastValidBlockHeight: buildResult.data.lastValidBlockHeight,
          attestationAddress: buildResult.data.attestationAddress,
        });

        // Construct a Transaction object for the wallet
        // The wallet session expects the @solana/kit Transaction type
        // Note: We don't freeze since JS doesn't allow freezing TypedArrays with elements
        const unsignedTransaction = {
          messageBytes: txMessageBytes as Uint8Array & {
            readonly __brand: unique symbol;
          },
          signatures: Object.fromEntries(buildResult.data.signers.map((signer) => [signer, null])),
          lifetimeConstraint: {
            blockhash: buildResult.data.blockhash as string & {
              readonly __brand: unique symbol;
            },
            lastValidBlockHeight: BigInt(buildResult.data.lastValidBlockHeight),
          },
        };

        // Sign the transaction with wallet
        toast.loading("Signing transaction...", { id: toastId });

        if (!session.signTransaction) {
          throw new Error("Wallet does not support transaction signing");
        }

        console.log("[Feedback] Requesting wallet signature...");
        const signedTransaction = await session.signTransaction(unsignedTransaction as never);
        console.log("[Feedback] Transaction signed");

        // Send via RPC directly (bypassing wallet adapter's sendTransaction)
        toast.loading("Submitting to network...", { id: toastId });

        const rpc = solanaClient.runtime.rpc as Rpc<SolanaRpcApi>;

        // Get the signed transaction bytes and encode as base64
        // The signedTransaction has messageBytes and signatures
        const signedTx = signedTransaction as unknown as {
          messageBytes: Uint8Array;
          signatures: Record<string, Uint8Array>;
        };

        // Combine message bytes with signature(s) into wire format
        // Solana wire format: [num_signatures, ...signatures, message_bytes]
        // IMPORTANT: Signatures must be in the exact order of signers in the transaction message
        const signaturesArray = buildResult.data.signers.map((signer) => signedTx.signatures[signer]);
        const numSigs = signaturesArray.length;
        const wireBytes = new Uint8Array(1 + numSigs * 64 + signedTx.messageBytes.length);
        wireBytes[0] = numSigs;
        for (let i = 0; i < numSigs; i++) {
          wireBytes.set(signaturesArray[i], 1 + i * 64);
        }
        wireBytes.set(signedTx.messageBytes, 1 + numSigs * 64);

        // Encode as base64 string for RPC
        const txBase64 = btoa(String.fromCharCode(...wireBytes));

        console.log("[Feedback] Sending via RPC...");
        const txSignature = await rpc
          .sendTransaction(txBase64 as never, {
            encoding: "base64",
            skipPreflight: false,
            preflightCommitment: "confirmed",
          })
          .send();
        console.log("[Feedback] Transaction sent:", txSignature);

        toast.success("Feedback submitted!", { id: toastId });
        return {
          address: buildResult.data.attestationAddress as Address,
          signature: txSignature.toString(),
        };
      } catch (error) {
        toast.dismiss(toastId);
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error(`Failed: ${message}`);
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
            Submit feedback for <span className="font-medium">{agentName}</span>. This requires a small x402 payment
            (0.01 USDC).
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
