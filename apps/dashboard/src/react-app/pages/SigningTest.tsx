/**
 * OCMSF Signing Test Page
 *
 * Tests different message formats with Phantom wallet to see which ones
 * are accepted or rejected. This helps us understand Phantom's limitations
 * for implementing off-chain attestation signatures.
 */

import { useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { type OffchainMessageV1, compileOffchainMessageV1Envelope, address } from "@solana/kit";
import { Wallet, Play, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Test result type
interface TestResult {
  name: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
  signature?: string;
}

// Helper to convert bytes to hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Test case definitions
const TEST_CASES = [
  {
    id: "utf8-short",
    name: "UTF-8 String (short)",
    description: "Simple UTF-8 message under 100 chars",
    buildMessage: () => {
      const text = `SATI Feedback Test\nOutcome: Positive\nHash: 0x${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
      return new TextEncoder().encode(text);
    },
  },
  {
    id: "utf8-medium",
    name: "UTF-8 String (medium ~500 chars)",
    description: "UTF-8 message around 500 characters",
    buildMessage: (walletAddress: string) => {
      const hash = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const text = `SATI Feedback Attestation v1
================================
Agent: TestAgent123456789
Token Account: ${walletAddress}
Outcome: Positive
Task Reference: ${hash}
Schema: FeedbackPublic
Data Hash: 0x${hash}

By signing this message, I confirm this feedback attestation.
Timestamp: ${new Date().toISOString()}
================================`;
      return new TextEncoder().encode(text);
    },
  },
  {
    id: "utf8-long",
    name: "UTF-8 String (long ~1100 chars)",
    description: "UTF-8 message over 1000 chars (may fail)",
    buildMessage: () => {
      const text = "A".repeat(1100);
      return new TextEncoder().encode(text);
    },
  },
  {
    id: "raw-32-bytes",
    name: "Raw 32-byte hash",
    description: "Binary data (likely blocked by Phantom)",
    buildMessage: () => {
      return crypto.getRandomValues(new Uint8Array(32));
    },
  },
  {
    id: "ocmsf-v1",
    name: "OCMSF v1 (Solana Off-Chain Message)",
    description: "Full OCMSF v1 envelope with \\xff prefix",
    buildMessage: (walletAddress: string) => {
      const hash = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const message: OffchainMessageV1 = {
        version: 1,
        requiredSignatories: [{ address: address(walletAddress) }],
        content: `SATI Feedback Test\nOutcome: Positive\nHash: 0x${hash}`,
      };
      const envelope = compileOffchainMessageV1Envelope(message);
      return envelope.content;
    },
  },
  {
    id: "ocmsf-v1-long",
    name: "OCMSF v1 (longer content)",
    description: "OCMSF v1 with ~500 char content",
    buildMessage: (walletAddress: string) => {
      const hash = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const message: OffchainMessageV1 = {
        version: 1,
        requiredSignatories: [{ address: address(walletAddress) }],
        content: `SATI Feedback Attestation
Agent: TestAgent
Token: ${walletAddress}
Outcome: Positive
Hash: 0x${hash}
Timestamp: ${new Date().toISOString()}
${"=".repeat(100)}`,
      };
      const envelope = compileOffchainMessageV1Envelope(message);
      return envelope.content;
    },
  },
  {
    id: "xff-prefix-only",
    name: "0xFF prefix + UTF-8",
    description: "Just the 0xFF byte followed by UTF-8 text",
    buildMessage: () => {
      const text = new TextEncoder().encode("solana offchain test message");
      const result = new Uint8Array(1 + text.length);
      result[0] = 0xff;
      result.set(text, 1);
      return result;
    },
  },
  {
    id: "ocmsf-v0",
    name: "OCMSF v0 (with applicationDomain)",
    description: "v0 format - also starts with \\xff",
    buildMessage: () => {
      // v0 preamble: signing_domain(16) + version(1) + app_domain(32) + format(1) + signer_count(1) + signers(32*n) + msg_len(2) + message
      const signingDomain = new Uint8Array([0xff, ...new TextEncoder().encode("solana offchain")]);
      const version = new Uint8Array([0]); // v0
      const appDomain = new Uint8Array(32); // zeros for app domain
      const format = new Uint8Array([1]); // UTF-8 limited
      const signerCount = new Uint8Array([1]);
      // Decode wallet address to bytes (base58 to bytes)
      const signerBytes = new Uint8Array(32);
      const content = new TextEncoder().encode(
        `SATI Test Hash: 0x${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`,
      );
      const msgLen = new Uint8Array(2);
      msgLen[0] = content.length & 0xff;
      msgLen[1] = (content.length >> 8) & 0xff;

      const total = 16 + 1 + 32 + 1 + 1 + 32 + 2 + content.length;
      const result = new Uint8Array(total);
      let offset = 0;
      result.set(signingDomain, offset);
      offset += 16;
      result.set(version, offset);
      offset += 1;
      result.set(appDomain, offset);
      offset += 32;
      result.set(format, offset);
      offset += 1;
      result.set(signerCount, offset);
      offset += 1;
      result.set(signerBytes, offset);
      offset += 32;
      result.set(msgLen, offset);
      offset += 2;
      result.set(content, offset);
      return result;
    },
  },
  {
    id: "utf8-with-hash-inline",
    name: "UTF-8 with hash as hex string",
    description: "Pure UTF-8 with embedded hash - workaround approach",
    buildMessage: (walletAddress: string) => {
      const hash = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const text = `SATI:feedback:v1
Schema: FeedbackPublic
Agent: ${walletAddress}
Outcome: Positive
Hash: 0x${hash}
Timestamp: ${new Date().toISOString()}`;
      return new TextEncoder().encode(text);
    },
  },
  {
    id: "siws-style-caip10",
    name: "SIWS-style with CAIP-10 (recommended)",
    description: "Sign-In-With-Solana inspired format with CAIP-10 agent ID",
    buildMessage: (walletAddress: string) => {
      const hash = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      // CAIP-2 chain reference for Solana mainnet (first 32 chars of genesis hash)
      const chainRef = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
      // Use a mock agent mint address for testing
      const agentMint = "7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv";
      const text = `sati.fyi wants you to attest with your Solana account:
${walletAddress}

Attestation: Feedback
Agent: solana:${chainRef}:${agentMint}
Outcome: Positive
Hash: 0x${hash}`;
      return new TextEncoder().encode(text);
    },
  },
  {
    id: "utf8-structured",
    name: "UTF-8 structured (JSON-like)",
    description: "Structured message without binary prefix",
    buildMessage: (walletAddress: string) => {
      const hash = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const text = JSON.stringify(
        {
          domain: "SATI",
          version: "1",
          action: "feedback",
          agent: walletAddress,
          outcome: "Positive",
          hash: `0x${hash}`,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      );
      return new TextEncoder().encode(text);
    },
  },
  {
    id: "utf8-base64-hash",
    name: "UTF-8 with base64 hash",
    description: "Hash encoded as base64 in text",
    buildMessage: (walletAddress: string) => {
      const hashBytes = crypto.getRandomValues(new Uint8Array(32));
      const hashBase64 = btoa(String.fromCharCode(...hashBytes));
      const text = `SATI Feedback Attestation
Agent: ${walletAddress.slice(0, 8)}...
Outcome: Positive
Hash: ${hashBase64}`;
      return new TextEncoder().encode(text);
    },
  },
  {
    id: "very-long-2000",
    name: "UTF-8 very long (2000 chars)",
    description: "Testing upper limit",
    buildMessage: () => {
      return new TextEncoder().encode("B".repeat(2000));
    },
  },
  {
    id: "high-byte-in-middle",
    name: "UTF-8 with 0xFF in middle",
    description: "Valid UTF-8 prefix, 0xFF byte in middle",
    buildMessage: () => {
      const prefix = new TextEncoder().encode("SATI Message: ");
      const suffix = new TextEncoder().encode(" end");
      const result = new Uint8Array(prefix.length + 1 + suffix.length);
      result.set(prefix, 0);
      result[prefix.length] = 0xff; // High byte in middle
      result.set(suffix, prefix.length + 1);
      return result;
    },
  },
];

export function SigningTest() {
  const { connected, wallet } = useWalletConnection();
  const [results, setResults] = useState<TestResult[]>(
    TEST_CASES.map((tc) => ({ name: tc.name, status: "pending" as const })),
  );
  const [isRunning, setIsRunning] = useState(false);

  const runTest = async (index: number) => {
    if (!wallet?.account.address) return;

    const testCase = TEST_CASES[index];
    setResults((prev) => prev.map((r, i) => (i === index ? { ...r, status: "running" } : r)));

    try {
      const messageBytes = testCase.buildMessage(wallet.account.address);

      console.log(`[Test ${testCase.id}] Message bytes:`, messageBytes);
      console.log(`[Test ${testCase.id}] Message length:`, messageBytes.length);
      console.log(`[Test ${testCase.id}] First bytes:`, Array.from(messageBytes.slice(0, 20)));

      // Access Phantom directly via window
      const phantom = (
        window as unknown as {
          phantom?: { solana?: { signMessage: (msg: Uint8Array) => Promise<{ signature: Uint8Array }> } };
        }
      ).phantom;

      if (!phantom?.solana?.signMessage) {
        throw new Error("Phantom wallet not found or signMessage not available");
      }

      // Cast to Uint8Array for Phantom (OffchainMessageBytes is ReadonlyUint8Array)
      const result = await phantom.solana.signMessage(new Uint8Array(messageBytes));
      const signatureHex = bytesToHex(result.signature);

      console.log(`[Test ${testCase.id}] SUCCESS:`, `${signatureHex.slice(0, 32)}...`);

      setResults((prev) =>
        prev.map((r, i) =>
          i === index ? { ...r, status: "success", signature: `${signatureHex.slice(0, 32)}...` } : r,
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Test ${testCase.id}] FAILED:`, errorMessage);

      setResults((prev) => prev.map((r, i) => (i === index ? { ...r, status: "error", error: errorMessage } : r)));
    }
  };

  const runAllTests = async () => {
    if (!wallet?.account.address) return;
    setIsRunning(true);

    // Reset all results
    setResults(TEST_CASES.map((tc) => ({ name: tc.name, status: "pending" as const })));

    // Run tests sequentially with delay
    for (let i = 0; i < TEST_CASES.length; i++) {
      await runTest(i);
      // Small delay between tests
      await new Promise((r) => setTimeout(r, 500));
    }

    setIsRunning(false);
  };

  if (!connected) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 md:py-8 max-w-4xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">OCMSF Signing Test</h1>
            <p className="text-sm text-muted-foreground mt-1">Test different message formats with Phantom wallet</p>
          </div>

          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Connect Phantom wallet to test different message signing formats.
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">OCMSF Signing Test</h1>
            <p className="text-sm text-muted-foreground mt-1">Test different message formats with Phantom wallet</p>
          </div>
          <Button onClick={runAllTests} disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run All Tests
              </>
            )}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
            <CardDescription>
              Each test will prompt Phantom to sign a message. Watch for errors or rejections.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {TEST_CASES.map((testCase, index) => {
                const result = results[index];
                return (
                  <div key={testCase.id} className="flex items-start justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {result.status === "pending" && <div className="h-5 w-5 rounded-full border-2 border-muted" />}
                        {result.status === "running" && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
                        {result.status === "success" && <CheckCircle className="h-5 w-5 text-green-500" />}
                        {result.status === "error" && <XCircle className="h-5 w-5 text-red-500" />}
                        <span className="font-medium">{testCase.name}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 ml-7">{testCase.description}</p>
                      {result.status === "success" && result.signature && (
                        <p className="text-xs text-green-600 mt-1 ml-7 font-mono">Sig: {result.signature}</p>
                      )}
                      {result.status === "error" && result.error && (
                        <p className="text-xs text-red-600 mt-1 ml-7">{result.error}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runTest(index)}
                      disabled={isRunning || result.status === "running"}
                    >
                      Test
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What We're Testing</CardTitle>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert">
            <ul className="text-sm space-y-2 text-muted-foreground">
              <li>
                <strong>UTF-8 strings:</strong> Standard text messages of varying lengths
              </li>
              <li>
                <strong>SIWS-style:</strong> Sign-In-With-Solana inspired format with CAIP-10 agent identifiers
                (recommended)
              </li>
              <li>
                <strong>Raw bytes:</strong> Binary data (32-byte hash) - likely blocked
              </li>
              <li>
                <strong>OCMSF v1:</strong> Solana Off-Chain Message Format with <code className="text-xs">\xff</code>{" "}
                prefix - blocked by Phantom
              </li>
              <li>
                <strong>Character limits:</strong> Testing around the ~1000 char limit
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
