import { Hono } from "hono";
import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  lamports,
  address,
  isAddress,
  createSolanaRpcSubscriptions,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import bs58 from "bs58";

type SignedBlockhashTransaction = Awaited<ReturnType<typeof signTransactionMessageWithSigners>> & {
  lifetimeConstraint: { lastValidBlockHeight: bigint; blockhash: string };
};

const FAUCET_AMOUNT_SOL = 0.01;
const FAUCET_AMOUNT_LAMPORTS = BigInt(FAUCET_AMOUNT_SOL * 1_000_000_000);
const RATE_LIMIT_SECONDS = 24 * 60 * 60;
const IP_RATE_LIMIT_SECONDS = 60 * 60;
const IP_MAX_REQUESTS = 5;

interface FaucetEnv {
  faucetKeypair: string;
  heliusApiKey: string;
  kv: KVNamespace;
}

export function createFaucetApi(env: FaucetEnv) {
  const app = new Hono();

  // POST /api/faucet - Fund a devnet wallet
  app.post("/api/faucet", async (c) => {
    // Parse request
    let body: { address?: string; network?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "Invalid request body" }, 400);
    }

    // Validate network
    if (body.network !== "devnet") {
      return c.json({ success: false, error: "Only devnet is supported" }, 400);
    }

    // Validate address
    if (!body.address || !isAddress(body.address)) {
      return c.json({ success: false, error: "Invalid Solana address" }, 400);
    }

    const recipient = body.address;

    // Rate limit: per address (24h)
    const addrKey = `addr:${recipient}`;
    const lastRequest = await env.kv.get(addrKey);
    if (lastRequest) {
      const elapsed = Date.now() - Number(lastRequest);
      const remaining = RATE_LIMIT_SECONDS * 1000 - elapsed;
      if (remaining > 0) {
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.ceil((remaining % (60 * 60 * 1000)) / (60 * 1000));
        return c.json({ success: false, error: `Rate limit exceeded. Try again in ${hours}h ${minutes}m.` }, 429);
      }
    }

    // Rate limit: per IP (5 requests per hour)
    const clientIp = c.req.header("cf-connecting-ip") || "unknown";
    const ipKey = `ip:${clientIp}`;
    const ipCount = await env.kv.get(ipKey);
    if (ipCount && Number(ipCount) >= IP_MAX_REQUESTS) {
      return c.json({ success: false, error: "Too many requests from this IP. Try again later." }, 429);
    }

    // Send SOL
    try {
      const faucetBytes = bs58.decode(env.faucetKeypair);
      const faucetSigner = await createKeyPairSignerFromBytes(faucetBytes);

      const rpcUrl = `https://devnet.helius-rpc.com/?api-key=${env.heliusApiKey}`;
      const wsUrl = `wss://devnet.helius-rpc.com/?api-key=${env.heliusApiKey}`;
      const rpc = createSolanaRpc(rpcUrl);
      const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      const transferIx = getTransferSolInstruction({
        source: faucetSigner,
        destination: address(recipient),
        amount: lamports(FAUCET_AMOUNT_LAMPORTS),
      });

      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(faucetSigner.address, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstruction(transferIx, m),
      );

      const signedTx = await signTransactionMessageWithSigners(message);
      const signature = getSignatureFromTransaction(signedTx);

      const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
      await sendAndConfirm(signedTx as SignedBlockhashTransaction, { commitment: "confirmed" });

      // Record rate limit entries
      await env.kv.put(addrKey, String(Date.now()), { expirationTtl: RATE_LIMIT_SECONDS });
      const newIpCount = (Number(ipCount) || 0) + 1;
      await env.kv.put(ipKey, String(newIpCount), { expirationTtl: IP_RATE_LIMIT_SECONDS });

      return c.json({
        success: true,
        signature,
        amount: FAUCET_AMOUNT_SOL,
        network: "devnet",
        message: "Funded successfully",
      });
    } catch (error) {
      console.error("[faucet] Transfer failed:", error);
      return c.json({ success: false, error: error instanceof Error ? error.message : "Transaction failed" }, 500);
    }
  });

  // GET /api/faucet/status - Check faucet wallet balance
  app.get("/api/faucet/status", async (c) => {
    try {
      const faucetBytes = bs58.decode(env.faucetKeypair);
      const faucetSigner = await createKeyPairSignerFromBytes(faucetBytes);

      const rpcUrl = `https://devnet.helius-rpc.com/?api-key=${env.heliusApiKey}`;
      const rpc = createSolanaRpc(rpcUrl);

      const { value: balanceLamports } = await rpc.getBalance(faucetSigner.address).send();

      return c.json({
        success: true,
        address: faucetSigner.address,
        balance: Number(balanceLamports) / 1_000_000_000,
        network: "devnet",
      });
    } catch (error) {
      console.error("[faucet/status] Failed:", error);
      return c.json({ success: false, error: error instanceof Error ? error.message : "Failed to get status" }, 500);
    }
  });

  return app;
}
