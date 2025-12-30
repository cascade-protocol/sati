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
import { type Outcome, loadDeployedConfig } from "@cascade-fyi/sati-sdk";
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
import { Loader2 } from "lucide-react";

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
  const queryClient = useQueryClient();
  const session = useWalletSession();
  const cluster = useClusterState();
  const solanaClient = useSolanaClient();

  const feedbackMutation = useMutation({
    mutationFn: async (selectedOutcome: Outcome) => {
      if (!session) throw new Error("Wallet not connected");
      if (!FEEDBACK_SCHEMA_ADDRESS) throw new Error("Feedback schema not configured");

      const toastId = toast.loading("Processing payment...");

      try {
        // tokenAccount IS the agent mint address (not ATA) - named for SAS wire format compatibility
        const tokenAccount = agentMint;

        // 1. Generate random taskRef and dataHash
        const taskRef = crypto.getRandomValues(new Uint8Array(32));
        const dataHash = crypto.getRandomValues(new Uint8Array(32));

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

        const buildRequest: BuildFeedbackTxRequest = {
          sasSchema: FEEDBACK_SCHEMA_ADDRESS,
          taskRef: bytesToHex(taskRef),
          tokenAccount: tokenAccount,
          dataHash: bytesToHex(dataHash),
          outcome: selectedOutcome,
          counterparty: session.account.address,
          agentSignature: echo.data.signature,
          agentAddress: echo.data.agentAddress,
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
        const signaturesArray = Object.values(signedTx.signatures);
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
      onSuccess?.();
    },
  });

  const handleSubmit = () => {
    // Prevent double submission
    if (feedbackMutation.isPending) return;

    const outcomeValue = parseInt(outcome, 10) as Outcome;
    feedbackMutation.mutate(outcomeValue);
  };

  const isDisabled = !session || feedbackMutation.isPending;

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

        <div className="py-4">
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
