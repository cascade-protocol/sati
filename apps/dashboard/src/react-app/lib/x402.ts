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
import { x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ExactSvmSchemeV1 } from "@x402/svm/exact/v1/client";

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
      transactions: readonly (Transaction & TransactionWithinSizeLimit & TransactionWithLifetime)[],
    ): Promise<readonly SignatureDictionary[]> {
      const signatures: SignatureDictionary[] = [];

      for (const transaction of transactions) {
        const signed = await signTransaction(transaction as never);
        const signature = signed.signatures[signerAddress];

        if (!signature) {
          throw new Error("Wallet did not return a signature for the connected account");
        }

        signatures.push(
          Object.freeze({
            [signerAddress]: signature,
          }) as SignatureDictionary,
        );
      }

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
export function createPaymentClient(session: WalletSession, rpcUrl: string): x402Client {
  const signer = sessionToTransactionSigner(session);
  const client = new x402Client();

  // Create schemes with the app's RPC URL
  const schemeConfig = { rpcUrl };

  // Register V2 scheme (wildcard for all Solana networks)
  client.register("solana:*", new ExactSvmScheme(signer as never, schemeConfig));

  // Register V1 schemes for backwards compatibility
  for (const network of V1_NETWORKS) {
    client.registerV1(network, new ExactSvmSchemeV1(signer as never, schemeConfig));
  }

  return client;
}
