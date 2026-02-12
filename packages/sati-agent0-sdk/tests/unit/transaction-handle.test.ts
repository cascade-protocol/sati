import { describe, it, expect } from "vitest";
import { SolanaTransactionHandle } from "../../src/transaction-handle.js";

describe("SolanaTransactionHandle", () => {
  it("should set hash from signature", () => {
    const handle = new SolanaTransactionHandle("5abc123", { value: 42 });
    expect(handle.hash).toBe("5abc123");
  });

  it("waitMined should return receipt and result", async () => {
    const result = { value: 85, tags: ["quality"] };
    const handle = new SolanaTransactionHandle("sig123", result);

    const { receipt, result: r } = await handle.waitMined();
    expect(receipt.signature).toBe("sig123");
    expect(r).toBe(result);
    expect(r.value).toBe(85);
  });

  it("waitConfirmed should alias waitMined", async () => {
    const handle = new SolanaTransactionHandle("sig456", "done");

    const mined = await handle.waitMined();
    const confirmed = await handle.waitConfirmed();
    expect(mined).toEqual(confirmed);
  });

  it("should resolve immediately (no delay)", async () => {
    const handle = new SolanaTransactionHandle("sig789", null);
    const start = Date.now();
    await handle.waitMined();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
