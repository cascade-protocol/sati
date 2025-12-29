/**
 * x402 Payment Client Setup
 *
 * Provides utilities for creating x402 payment clients with wallet integration.
 * Uses the app's configured RPC endpoint for consistency.
 */

import type { WalletSession } from "@solana/client";
import type {
  Address,
  SignatureDictionary,
  Transaction,
  TransactionSigner,
  TransactionWithLifetime,
  TransactionWithinSizeLimit,
} from "@solana/kit";
import { x402Client, type PaymentRequired } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ExactSvmSchemeV1 } from "@x402/svm/exact/v1/client";

// Debug: log all x402-related requests and responses
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const [url, init] = args;
  const urlStr =
    typeof url === "string" ? url : url instanceof URL ? url.toString() : "";

  // Log outgoing payment headers
  if (init?.headers) {
    const headers = init.headers as Record<string, string>;
    if (headers["X-PAYMENT"] || headers["x-payment"]) {
      console.log("[x402] Sending payment header with request to:", urlStr);
      console.log(
        "[x402] Payment header:",
        headers["X-PAYMENT"] || headers["x-payment"],
      );
    }
  }

  const response = await originalFetch(...args);

  if (response.status === 402) {
    const paymentHeader = response.headers.get("payment-required");
    if (paymentHeader) {
      try {
        const decoded = JSON.parse(atob(paymentHeader)) as PaymentRequired;
        console.log("[x402] Payment requirements from server:", decoded);
        console.log("[x402] Network:", decoded.accepts?.[0]?.network);
        console.log("[x402] Asset:", decoded.accepts?.[0]?.asset);
        console.log("[x402] FeePayer:", decoded.accepts?.[0]?.extra?.feePayer);
      } catch {
        console.log("[x402] Raw payment header:", paymentHeader);
      }
    }
  }

  // Log non-2xx responses
  if (!response.ok && response.status !== 402) {
    console.log(
      "[x402] Request failed:",
      urlStr,
      response.status,
      response.statusText,
    );
    try {
      const clone = response.clone();
      const text = await clone.text();
      console.log("[x402] Response body:", text);
    } catch {}
  }

  return response;
};

/**
 * Creates a TransactionSigner from a WalletSession.
 */
function sessionToTransactionSigner(session: WalletSession): TransactionSigner {
  if (!session.signTransaction) {
    throw new Error("Wallet does not support transaction signing");
  }

  const signerAddress = session.account.address as Address;
  const signTransaction = session.signTransaction.bind(session);

  return {
    address: signerAddress,
    async signTransactions(
      transactions: readonly (Transaction &
        TransactionWithinSizeLimit &
        TransactionWithLifetime)[],
    ): Promise<readonly SignatureDictionary[]> {
      console.log(
        "[x402] signTransactions called with",
        transactions.length,
        "transaction(s)",
      );
      const signatures: SignatureDictionary[] = [];

      for (const transaction of transactions) {
        console.log("[x402] Requesting wallet signature...");
        const signed = await signTransaction(transaction as never);
        console.log("[x402] Wallet returned signed transaction");
        const signature = signed.signatures[signerAddress];

        if (!signature) {
          throw new Error(
            "Wallet did not return a signature for the connected account",
          );
        }

        console.log("[x402] Signature obtained for", signerAddress);
        signatures.push(
          Object.freeze({
            [signerAddress]: signature,
          }) as SignatureDictionary,
        );
      }

      console.log(
        "[x402] All signatures collected, returning",
        signatures.length,
      );
      return Object.freeze(signatures);
    },
  };
}

// V1 network identifiers
const V1_NETWORKS = ["solana", "solana-devnet", "solana-testnet"] as const;

/**
 * Creates an x402 client configured for SVM payments.
 *
 * @param session - The connected wallet session
 * @param rpcUrl - The RPC endpoint from the app's cluster configuration
 * @returns Configured x402Client ready for payments
 */
export function createPaymentClient(
  session: WalletSession,
  rpcUrl: string,
): x402Client {
  const signer = sessionToTransactionSigner(session);
  const client = new x402Client();

  // Create schemes with the app's RPC URL
  const schemeConfig = { rpcUrl };

  // Register V2 scheme (wildcard for all Solana networks)
  client.register(
    "solana:*",
    new ExactSvmScheme(signer as never, schemeConfig),
  );

  // Register V1 schemes for backwards compatibility
  for (const network of V1_NETWORKS) {
    client.registerV1(
      network,
      new ExactSvmSchemeV1(signer as never, schemeConfig),
    );
  }

  return client;
}
