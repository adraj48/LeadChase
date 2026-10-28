import { describe, expect, it, vi } from "vitest";
import { LeadCache, Prefetcher, isAbortError, type Timers } from "@/lib/lead-cache";

type D = { v: string };

// A fetcher whose responses the test resolves by hand, in any order.
function manualFetcher() {
  const calls: { id: string; signal: AbortSignal; resolve: (d: D) => void; reject: (e: unknown) => void }[] = [];
  const fetcher = (id: string, signal: AbortSignal) =>
    new Promise<D>((resolve, reject) => {
      calls.push({ id, signal, resolve, reject });
      signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  return { calls, fetcher };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("LeadCache", () => {
  it("stores a loaded value and serves it synchronously afterwards", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const p = c.load("a");
    await flush();
    calls[0].resolve({ v: "1" });
    expect(await p).toEqual({ v: "1" });
    expect(c.get("a")).toEqual({ v: "1" });
    expect(c.isFresh("a")).toBe(true);
  });

  it("dedupes concurrent loads into one request", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const p1 = c.load("a");
    const p2 = c.load("a");
    await flush();
    expect(calls).toHaveLength(1);
    calls[0].resolve({ v: "1" });
    expect(await p1).toEqual({ v: "1" });
    expect(await p2).toEqual({ v: "1" });
  });

  it("aborts the shared request only when every caller has aborted", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const a1 = new AbortController();
    const a2 = new AbortController();
    const p1 = c.load("a", { signal: a1.signal });
    const p2 = c.load("a", { signal: a2.signal });
    await flush();
    a1.abort();
    await expect(p1).rejects.toSatisfy(isAbortError);
    expect(calls[0].signal.aborted).toBe(false);
    a2.abort();
    await expect(p2).rejects.toSatisfy(isAbortError);
    expect(calls[0].signal.aborted).toBe(true);
    expect(c.isLoading("a")).toBe(false);
  });

  it("a late joiner keeps the request alive after the first caller leaves", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const pre = new AbortController();
    const p1 = c.load("a", { signal: pre.signal }); // e.g. hover prefetch
    const p2 = c.load("a"); // the click
    await flush();
    pre.abort(); // pointer leaves
    await expect(p1).rejects.toSatisfy(isAbortError);
    calls[0].resolve({ v: "1" });
    expect(await p2).toEqual({ v: "1" });
  });

  it("rejects immediately for an already-aborted signal without fetching", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const a = new AbortController();
    a.abort();
    await expect(c.load("a", { signal: a.signal })).rejects.toSatisfy(isAbortError);
    await flush();
    expect(calls).toHaveLength(0);
  });

  it("ignores an out-of-order response that is older than the stored one", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const old = c.load("a");
    const fresh = c.load("a", { force: true });
    await flush();
    expect(calls).toHaveLength(2);
    calls[1].resolve({ v: "new" });
    expect(await fresh).toEqual({ v: "new" });
    calls[0].resolve({ v: "old" });
    // The slow caller is handed the newest known state, and the cache keeps it.
    expect(await old).toEqual({ v: "new" });
    expect(c.get("a")).toEqual({ v: "new" });
  });

  it("a local mutation wins over a request that was in flight when it happened", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const p = c.load("a");
    await flush();
    c.set("a", { v: "mutated" });
    calls[0].resolve({ v: "server-before-mutation" });
    expect(await p).toEqual({ v: "mutated" });
    expect(c.get("a")).toEqual({ v: "mutated" });
  });

  it("does not cache failures and lets the next load retry", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const p = c.load("a");
    await flush();
    calls[0].reject(new Error("boom"));
    await expect(p).rejects.toThrow("boom");
    expect(c.get("a")).toBeUndefined();
    const p2 = c.load("a");
    await flush();
    expect(calls).toHaveLength(2);
    calls[1].resolve({ v: "ok" });
    expect(await p2).toEqual({ v: "ok" });
  });

  it("goes stale after freshMs and expires after ttlMs", () => {
    const k = clock();
    const c = new LeadCache<D>({ fetcher: vi.fn(), now: k.now, freshMs: 100, ttlMs: 1_000 });
    c.set("a", { v: "1" });
    expect(c.isFresh("a")).toBe(true);
    k.advance(101);
    expect(c.isFresh("a")).toBe(false);
    expect(c.get("a")).toEqual({ v: "1" }); // stale but still served (SWR)
    k.advance(1_000);
    expect(c.get("a")).toBeUndefined();
  });

  it("markStale keeps the data but forces revalidation; invalidate drops it", () => {
    const c = new LeadCache<D>({ fetcher: vi.fn() });
    c.set("a", { v: "1" });
    c.markStale("a");
    expect(c.isFresh("a")).toBe(false);
    expect(c.get("a")).toEqual({ v: "1" });
    c.invalidate("a");
    expect(c.get("a")).toBeUndefined();
  });

  it("patch updates cached data and is a no-op when nothing is cached", () => {
    const c = new LeadCache<D>({ fetcher: vi.fn() });
    c.patch("a", () => ({ v: "x" }));
    expect(c.get("a")).toBeUndefined();
    c.set("a", { v: "1" });
    c.patch("a", (d) => ({ v: d.v + "!" }));
    expect(c.get("a")).toEqual({ v: "1!" });
  });

  it("evicts the oldest entries beyond maxSize", () => {
    const c = new LeadCache<D>({ fetcher: vi.fn(), maxSize: 2 });
    c.set("a", { v: "a" });
    c.set("b", { v: "b" });
    c.set("a", { v: "a2" }); // rewrite moves a to the newest position
    c.set("c", { v: "c" });
    expect(c.size).toBe(2);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toEqual({ v: "a2" });
    expect(c.get("c")).toEqual({ v: "c" });
  });
});

// Fake timers that the test fires by hand.
function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const t: Timers = {
    setTimeout: (fn) => {
      const h = next++;
      pending.set(h, fn);
      return h;
    },
    clearTimeout: (h) => {
      pending.delete(h as number);
    },
  };
  const fireAll = () => {
    const fns = [...pending.values()];
    pending.clear();
    fns.forEach((f) => f());
  };
  return { t, pending, fireAll };
}

describe("Prefetcher", () => {
  it("fetches after the debounce delay, not before", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const ft = fakeTimers();
    const p = new Prefetcher(c, { timers: ft.t });
    p.intent("a");
    await flush();
    expect(calls).toHaveLength(0);
    ft.fireAll();
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("cancel before the delay means no request", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const ft = fakeTimers();
    const p = new Prefetcher(c, { timers: ft.t });
    p.intent("a");
    p.cancel("a");
    ft.fireAll();
    await flush();
    expect(calls).toHaveLength(0);
  });

  it("cancel after the request started aborts it", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const ft = fakeTimers();
    const p = new Prefetcher(c, { timers: ft.t });
    p.intent("a");
    ft.fireAll();
    await flush();
    p.cancel("a");
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(p.inFlight).toBe(0);
  });

  it("skips leads that are fresh in the cache or already loading", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    c.set("fresh", { v: "1" });
    void c.load("loading").catch(() => {});
    await flush();
    const ft = fakeTimers();
    const p = new Prefetcher(c, { timers: ft.t });
    p.intent("fresh");
    p.intent("loading");
    expect(ft.pending.size).toBe(0);
    p.now(["fresh", "loading"]);
    await flush();
    expect(calls).toHaveLength(1); // only the original load
  });

  it("runs at most maxInFlight at once and drains the queue as they finish", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const p = new Prefetcher(c, { maxInFlight: 2, timers: fakeTimers().t });
    p.now(["a", "b", "c"]);
    await flush();
    expect(calls.map((x) => x.id)).toEqual(["a", "b"]);
    expect(p.queued).toBe(1);
    calls[0].resolve({ v: "a" });
    await flush();
    await flush();
    expect(calls.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("a prefetch cancelled after a click joined it does not abort the click's request", async () => {
    const { calls, fetcher } = manualFetcher();
    const c = new LeadCache<D>({ fetcher });
    const ft = fakeTimers();
    const p = new Prefetcher(c, { timers: ft.t });
    p.intent("a");
    ft.fireAll();
    await flush();
    const click = c.load("a");
    p.cancel("a");
    await flush();
    expect(calls[0].signal.aborted).toBe(false);
    calls[0].resolve({ v: "1" });
    expect(await click).toEqual({ v: "1" });
  });
});
