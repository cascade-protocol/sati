/**
 * VerifiedFeedbackDialog - DualSignature feedback demonstrating blind feedback model
 *
 * 2-Step Flow:
 * 1. INTERACT: User pays $0.01 USDC → Agent signs BLINDLY (doesn't know outcome)
 * 2. RATE & SUBMIT: User chooses outcome → Signs SIWS → Server submits transaction
 *
 * This demonstrates SATI's core innovation: unforgeable feedback where the agent
 * commits to the interaction BEFORE knowing what rating they'll receive.
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
import { getNetwork, getSolscanUrl, getRpcUrl } from "@/lib/network";
import { createPaymentFetch } from "@/lib/x402";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";

// Get deployed Feedback schema address (DualSignature mode)
const deployedConfig = loadDeployedConfig(getNetwork());
const FEEDBACK_SCHEMA_ADDRESS = deployedConfig?.schemas?.feedback as Address | undefined;

interface VerifiedFeedbackDialogProps {
  agentMint: Address;
  agentName: string;
  children: ReactNode;
  onSuccess?: () => void;
}

// API types
interface EchoRequest {
  sasSchema: string;
  taskRef: string;
  agentMint: string;
  dataHash: string;
}

interface EchoResponse {
  success: boolean;
  data?: {
    agentAddress: string;
    interactionHash: string;
    signature: string;
    signatureBase58: string;
  };
  error?: string;
}

interface SubmitFeedbackRequest {
  network: "devnet" | "mainnet";
  sasSchema: string;
  taskRef: string;
  agentMint: string;
  dataHash: string;
  outcome: number;
  counterparty: string;
  agentSignature: string;
  agentAddress: string;
  counterpartySignature: string;
  counterpartyMessage: string;
  content?: string;
  contentType?: number;
}

// Server submits tx and returns attestation + signature
interface SubmitFeedbackResponse {
  success: boolean;
  attestationAddress?: string;
  signature?: string;
  error?: string;
}

// Hex helpers
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
    throw new Error(`Invalid hex string: ${hex.slice(0, 20)}${hex.length > 20 ? "..." : ""}`);
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Agent signature data from Step 1
interface AgentSignatureData {
  taskRef: string; // hex
  dataHash: string; // hex
  signature: string; // hex
  agentAddress: string;
}

type Step = "interact" | "rate";

export function VerifiedFeedbackDialog({ agentMint, agentName, children, onSuccess }: VerifiedFeedbackDialogProps) {
  const [open, setOpen] = useState(false);

  // Step state
  const [step, setStep] = useState<Step>("interact");
  const [isInteracting, setIsInteracting] = useState(false);
  const [agentSignatureData, setAgentSignatureData] = useState<AgentSignatureData | null>(null);

  // Rating state (Step 2)
  const [outcome, setOutcome] = useState<string>("2"); // Default to Positive
  const [message, setMessage] = useState("");

  const queryClient = useQueryClient();
  const session = useWalletSession();

  // Reset state when dialog closes
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setStep("interact");
      setAgentSignatureData(null);
      setOutcome("2");
      setMessage("");
      setIsInteracting(false);
    }
  };

  // Content size validation
  const contentJson = message.trim() ? JSON.stringify({ m: message.trim() }) : undefined;
  const contentSize = contentJson ? new TextEncoder().encode(contentJson).length : 0;
  const contentExceedsLimit = contentSize > MAX_SINGLE_SIGNATURE_CONTENT_SIZE;

  // ==========================================================================
  // Step 1: Interact - Pay and get agent's blind signature
  // ==========================================================================
  const handleInteract = async () => {
    if (!session || !FEEDBACK_SCHEMA_ADDRESS) return;
    setIsInteracting(true);

    const toastId = toast.loading("Preparing interaction...");

    try {
      // Generate taskRef and dataHash for this interaction
      const timestamp = Date.now().toString();
      const encoder = new TextEncoder();

      const taskRefDigest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`task:${timestamp}:${session.account.address}:${agentMint}`),
      );
      const dataHashDigest = await crypto.subtle.digest("SHA-256", encoder.encode(`data:${timestamp}:echo-demo`));

      const taskRef = bytesToHex(new Uint8Array(taskRefDigest));
      const dataHash = bytesToHex(new Uint8Array(dataHashDigest));

      // Create x402 payment-enabled fetch
      toast.loading("Approve payment ($0.01 USDC)...", { id: toastId });
      const rpcUrl = getRpcUrl(getNetwork());
      const paymentFetch = createPaymentFetch(session, rpcUrl);

      // Call /api/echo with x402 payment - agent signs WITHOUT knowing outcome
      const echoRequest: EchoRequest = {
        sasSchema: FEEDBACK_SCHEMA_ADDRESS,
        taskRef,
        agentMint,
        dataHash,
      };

      const echoResponse = await paymentFetch("/api/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(echoRequest),
      });

      if (!echoResponse.ok) {
        const error = await echoResponse.json().catch(() => ({ error: "Echo request failed" }));
        throw new Error(error.error || `Payment failed: ${echoResponse.status}`);
      }

      const echoResult: EchoResponse = await echoResponse.json();
      if (!echoResult.success || !echoResult.data) {
        throw new Error(echoResult.error || "Failed to get agent signature");
      }

      // Store agent's blind signature
      setAgentSignatureData({
        taskRef,
        dataHash,
        signature: echoResult.data.signature,
        agentAddress: echoResult.data.agentAddress,
      });

      toast.success("Agent signed! Now choose your rating.", { id: toastId });
      setStep("rate");
    } catch (error) {
      toast.dismiss(toastId);
      toast.error(error instanceof Error ? error.message : "Failed to interact with agent");
    } finally {
      setIsInteracting(false);
    }
  };

  // ==========================================================================
  // Step 2: Rate & Submit - User signs SIWS, server submits transaction
  // ==========================================================================
  const submitMutation = useMutation({
    mutationFn: async (selectedOutcome: Outcome) => {
      if (!session || !agentSignatureData || !FEEDBACK_SCHEMA_ADDRESS) {
        throw new Error("Missing required data");
      }

      const toastId = toast.loading("Preparing feedback...");

      try {
        const taskRef = hexToBytes(agentSignatureData.taskRef);
        const dataHash = hexToBytes(agentSignatureData.dataHash);

        // Build content (just message)
        const contentBytes = contentJson ? new TextEncoder().encode(contentJson) : new Uint8Array(0);

        // Build feedback data for SIWS message
        const feedbackData: FeedbackData = {
          taskRef,
          agentMint,
          counterparty: session.account.address as Address,
          dataHash,
          outcome: selectedOutcome,
          contentType: contentJson ? 1 : 0,
          content: contentBytes,
        };

        // Build SIWS message for counterparty consent
        const serializedData = serializeFeedback(feedbackData);
        const siwsMessage = buildCounterpartyMessage({
          schemaName: "FeedbackV1",
          data: serializedData,
        });

        // Sign SIWS message with wallet
        toast.loading("Sign feedback consent...", { id: toastId });

        const phantom = (
          window as unknown as {
            phantom?: { solana?: { signMessage: (msg: Uint8Array) => Promise<{ signature: Uint8Array }> } };
          }
        ).phantom;

        if (!phantom?.solana?.signMessage) {
          throw new Error("Wallet does not support message signing. Please use Phantom.");
        }

        const { signature: counterpartySig } = await phantom.solana.signMessage(
          new Uint8Array(siwsMessage.messageBytes),
        );

        // Submit to server - server pays gas and submits transaction
        toast.loading("Submitting feedback...", { id: toastId });

        const submitRequest: SubmitFeedbackRequest = {
          network: getNetwork(),
          sasSchema: FEEDBACK_SCHEMA_ADDRESS,
          taskRef: agentSignatureData.taskRef,
          agentMint,
          dataHash: agentSignatureData.dataHash,
          outcome: selectedOutcome,
          counterparty: session.account.address,
          agentSignature: agentSignatureData.signature,
          agentAddress: agentSignatureData.agentAddress,
          counterpartySignature: bytesToHex(counterpartySig),
          counterpartyMessage: bytesToHex(new Uint8Array(siwsMessage.messageBytes)),
          ...(contentJson && { content: contentJson, contentType: 1 }),
        };

        const response = await fetch("/api/build-feedback-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submitRequest),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to submit feedback");
        }

        const result: SubmitFeedbackResponse = await response.json();
        if (!result.success || !result.attestationAddress || !result.signature) {
          throw new Error(result.error || "Submission failed");
        }

        // Success!
        const txUrl = getSolscanUrl(result.signature, "tx");
        toast.success(
          <span>
            Feedback submitted!{" "}
            <a href={txUrl} target="_blank" rel="noopener noreferrer" className="underline">
              View tx
            </a>
          </span>,
          { id: toastId, duration: 10000 },
        );

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
      // Poll for indexer to pick up new attestation
      let attempts = 0;
      const maxAttempts = 24;
      const pollInterval = setInterval(() => {
        attempts++;
        queryClient.invalidateQueries({ queryKey: ["sati", "feedbacks"] });
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
        }
      }, 5000);

      handleOpenChange(false);
      onSuccess?.();
    },
  });

  const handleSubmit = () => {
    if (submitMutation.isPending || contentExceedsLimit) return;
    submitMutation.mutate(parseInt(outcome, 10) as Outcome);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verified Feedback</DialogTitle>
          <DialogDescription>
            Submit verified feedback for <span className="font-medium">{agentName}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center gap-3 text-sm py-2">
          <div
            className={`flex items-center gap-1.5 ${step === "interact" ? "text-foreground font-medium" : "text-muted-foreground"}`}
          >
            <span
              className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${step === "interact" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              1
            </span>
            Interact
          </div>
          <span className="text-muted-foreground">→</span>
          <div
            className={`flex items-center gap-1.5 ${step === "rate" ? "text-foreground font-medium" : "text-muted-foreground"}`}
          >
            <span
              className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${step === "rate" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              2
            </span>
            Rate & Submit
          </div>
        </div>

        {/* Step 1: Interact */}
        {step === "interact" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Pay <span className="font-medium text-foreground">$0.01 USDC</span> to request a signature from the agent.
              The agent signs <span className="font-medium text-foreground">without knowing</span> what feedback you'll
              give.
            </p>

            <div className="p-3 rounded-lg bg-muted/50 border text-sm">
              <p className="font-medium mb-1">Why does this matter?</p>
              <p className="text-muted-foreground">
                Blind signatures prevent agents from selectively accepting only positive feedback. This creates
                authentic, unforgeable reputation data.
              </p>
            </div>

            <Button
              onClick={handleInteract}
              disabled={!session || isInteracting || !FEEDBACK_SCHEMA_ADDRESS}
              className="w-full"
              size="lg"
            >
              {isInteracting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Pay & Get Signature ($0.01)"
              )}
            </Button>

            {!session && <p className="text-xs text-center text-muted-foreground">Connect your wallet to continue</p>}
          </div>
        )}

        {/* Step 2: Rate & Submit */}
        {step === "rate" && agentSignatureData && (
          <div className="space-y-5 py-4">
            {/* Success indicator */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">Agent signed blindly</p>
                <p className="text-xs text-green-600/80 dark:text-green-400/80">
                  The agent committed to this interaction without knowing your rating
                </p>
              </div>
            </div>

            {/* Outcome selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">How was your experience?</Label>
              <RadioGroup value={outcome} onValueChange={setOutcome} className="flex flex-col gap-2">
                <label
                  htmlFor="positive"
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    outcome === "2" ? "border-green-500 bg-green-500/5" : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="2" id="positive" />
                  <span className="text-green-600 font-medium">Positive</span>
                </label>
                <label
                  htmlFor="neutral"
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    outcome === "1" ? "border-yellow-500 bg-yellow-500/5" : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="1" id="neutral" />
                  <span className="text-yellow-600 font-medium">Neutral</span>
                </label>
                <label
                  htmlFor="negative"
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    outcome === "0" ? "border-red-500 bg-red-500/5" : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="0" id="negative" />
                  <span className="text-red-600 font-medium">Negative</span>
                </label>
              </RadioGroup>
            </div>

            {/* Optional message */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Message (optional)</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Share more details about your experience..."
                maxLength={150}
                rows={2}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{message.length}/150</span>
                {contentExceedsLimit && <span className="text-destructive">Message too long</span>}
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitMutation.isPending || contentExceedsLimit}
              className="w-full"
              size="lg"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Sign & Submit Feedback"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
