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
import { x402Client, wrapFetchWithPayment, type SelectPaymentRequirements } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ExactSvmSchemeV1 } from "@x402/svm/exact/v1/client";
import { getChain, type SolanaChain } from "./network";

// CAIP-2 network identifiers used by x402 (based on genesis hash)
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/**
 * Maps our app's chain identifier to x402's CAIP-2 network identifier.
 */
function chainToCaip2(chain: SolanaChain): string {
  switch (chain) {
    case "solana:mainnet":
      return SOLANA_MAINNET_CAIP2;
    default:
      // devnet, testnet, localnet all use devnet CAIP-2
      return SOLANA_DEVNET_CAIP2;
  }
}

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
 * Uses the app's current chain to select the correct payment option
 * when multiple networks are offered by the server.
 *
 * @param session - The connected wallet session
 * @param rpcUrl - The RPC endpoint from the app's cluster configuration
 * @returns Configured x402Client ready for payments
 */
export function createPaymentClient(session: WalletSession, rpcUrl: string): x402Client {
  const signer = sessionToTransactionSigner(session);

  // Get the current chain and map to CAIP-2 format for x402
  const currentChain = getChain();
  const targetNetwork = chainToCaip2(currentChain);

  // Custom selector that picks the payment option matching the user's current network
  // Falls back to first option if no match (shouldn't happen with proper server config)
  const networkSelector: SelectPaymentRequirements = (_version, accepts) => {
    const matching = accepts.find((a) => a.network === targetNetwork);
    return matching ?? accepts[0];
  };

  const client = new x402Client(networkSelector);

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

/**
 * Creates a payment-enabled fetch function.
 *
 * @param session - The connected wallet session
 * @param rpcUrl - The RPC endpoint from the app's cluster configuration
 * @returns A fetch function that automatically handles x402 payment responses
 */
export function createPaymentFetch(
  session: WalletSession,
  rpcUrl: string,
): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
  const client = createPaymentClient(session, rpcUrl);
  return wrapFetchWithPayment(fetch, client);
}
