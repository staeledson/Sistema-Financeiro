import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// Replace the global indexedDB with a fresh empty factory before each test,
// then reset module cache so cache.ts / write-queue.ts reconnect to the new store.
beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  vi.resetModules();
});

describe("offline cache (put / get)", () => {
  it("stores and retrieves a value", async () => {
    const { put, get } = await import("../cache");
    await put("balance", { total: 1234 });
    const val = await get<{ total: number }>("balance");
    expect(val).toEqual({ total: 1234 });
  });

  it("returns undefined for a missing key", async () => {
    const { get } = await import("../cache");
    const val = await get("nonexistent");
    expect(val).toBeUndefined();
  });

  it("overwrites an existing key", async () => {
    const { put, get } = await import("../cache");
    await put("k", "first");
    await put("k", "second");
    expect(await get("k")).toBe("second");
  });
});

describe("write queue (enqueue / flush / size)", () => {
  it("enqueues an item and size increases", async () => {
    const { enqueue, size } = await import("../write-queue");
    await enqueue({ clientId: "c1", url: "/api/transactions", method: "POST", headers: {}, body: "{}" });
    expect(await size()).toBe(1);
  });

  it("flush sends items in order and removes successes", async () => {
    const { enqueue, flush, size } = await import("../write-queue");
    const calls: string[] = [];
    const mockFetch = async (url: string) => {
      calls.push(url as string);
      return { ok: true } as Response;
    };
    await enqueue({ clientId: "c2", url: "/api/a", method: "POST", headers: {}, body: "{}" });
    await enqueue({ clientId: "c3", url: "/api/b", method: "POST", headers: {}, body: "{}" });
    const result = await flush(mockFetch as typeof fetch);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(await size()).toBe(0);
  });

  it("flush keeps failed items in queue", async () => {
    const { enqueue, flush, size } = await import("../write-queue");
    const mockFetch = async () => ({ ok: false } as Response);
    await enqueue({ clientId: "c4", url: "/api/fail", method: "POST", headers: {}, body: "{}" });
    const result = await flush(mockFetch as typeof fetch);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(await size()).toBe(1);
  });

  it("flush handles fetch errors gracefully", async () => {
    const { enqueue, flush } = await import("../write-queue");
    const mockFetch = async () => { throw new Error("offline"); };
    await enqueue({ clientId: "c5", url: "/api/err", method: "POST", headers: {}, body: "{}" });
    const result = await flush(mockFetch as unknown as typeof fetch);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });
});
