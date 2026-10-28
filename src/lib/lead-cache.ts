// In-memory, stale-while-revalidate cache for lead detail payloads (lead + chat),
// plus a small hover/focus prefetcher. Pure TypeScript: no React, no DOM, the
// fetcher, clock and timers are injected so every rule here is unit-tested.
//
// Rules
// - get(id) returns what is cached (even if stale) so the UI can paint instantly;
//   isFresh(id) says whether a background revalidation is worth doing.
// - load(id) dedupes: concurrent callers share one request. Each caller may pass its
//   own AbortSignal; the shared request is aborted only when every caller has gone.
// - Ordering: every request and every local write takes a ticket from one counter.
//   A response is stored only if its ticket is newer than the stored data's, so a
//   slow response can never overwrite a newer response or a local mutation.
// - Entries expire after ttlMs (no longer served) and the oldest are evicted beyond
//   maxSize.

export interface CacheEntry<T> {
  data: T;
  at: number; // when the data was stored (ms)
  seq: number; // ordering ticket of the data
  stale: boolean; // marked stale by an external change (e.g. a Realtime push)
}

export interface LeadCacheOptions<T> {
  fetcher: (id: string, signal: AbortSignal) => Promise<T>;
  now?: () => number;
  /** Data younger than this is fresh: no revalidation needed. */
  freshMs?: number;
  /** Data older than this is dropped (never shown). */
  ttlMs?: number;
  maxSize?: number;
}

interface InFlight<T> {
  promise: Promise<T>;
  ctrl: AbortController;
  consumers: number;
  seq: number;
}

export const FRESH_MS = 15_000;
export const TTL_MS = 5 * 60_000;
export const MAX_ENTRIES = 40;

export function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export class LeadCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, InFlight<T>>();
  private seq = 0;
  private readonly fetcher: LeadCacheOptions<T>["fetcher"];
  private readonly now: () => number;
  private readonly freshMs: number;
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(o: LeadCacheOptions<T>) {
    this.fetcher = o.fetcher;
    this.now = o.now ?? (() => Date.now());
    this.freshMs = o.freshMs ?? FRESH_MS;
    this.ttlMs = o.ttlMs ?? TTL_MS;
    this.maxSize = o.maxSize ?? MAX_ENTRIES;
  }

  /** Cached data if present and not expired (it may be stale: check isFresh). */
  get(id: string): T | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      this.entries.delete(id);
      return undefined;
    }
    return e.data;
  }

  isFresh(id: string): boolean {
    const e = this.entries.get(id);
    return !!e && !e.stale && this.now() - e.at <= this.freshMs;
  }

  isLoading(id: string): boolean {
    return this.inflight.has(id);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Store data from a local mutation (always newer than anything in flight). */
  set(id: string, data: T): void {
    this.store(id, data, ++this.seq);
  }

  /** Update cached data in place (no-op when nothing is cached). */
  patch(id: string, fn: (data: T) => T): void {
    const cur = this.get(id);
    if (cur !== undefined) this.store(id, fn(cur), ++this.seq);
  }

  /** Keep showing the data but revalidate on next use. */
  markStale(id: string): void {
    const e = this.entries.get(id);
    if (e) e.stale = true;
  }

  invalidate(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Fetch (or join the in-flight fetch for) a lead. `force` starts a new request even
   * when one is already in flight (used by polling, which must see the newest state).
   */
  load(id: string, opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<T> {
    const { signal } = opts;
    if (signal?.aborted) return Promise.reject(abortError());
    let f = this.inflight.get(id);
    if (!f || opts.force) f = this.start(id);
    const flight = f;
    flight.consumers += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      flight.consumers -= 1;
      if (flight.consumers <= 0 && this.inflight.get(id) === flight) {
        this.inflight.delete(id);
        flight.ctrl.abort();
      } else if (flight.consumers <= 0) {
        flight.ctrl.abort(); // a forced request replaced it and nobody waits on it
      }
    };
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        release();
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      flight.promise.then(
        (v) => {
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) return;
          released = true;
          resolve(v);
        },
        (e) => {
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) return;
          released = true;
          reject(e);
        },
      );
    });
  }

  private start(id: string): InFlight<T> {
    const ctrl = new AbortController();
    const seq = ++this.seq;
    const flight: InFlight<T> = {
      ctrl,
      seq,
      consumers: 0,
      promise: Promise.resolve()
        .then(() => this.fetcher(id, ctrl.signal))
        .then((data) => {
          if (this.inflight.get(id) === flight) this.inflight.delete(id);
          const cur = this.entries.get(id);
          // Out-of-order or superseded by a local write: keep the newer data and
          // hand callers the newest known state.
          if (cur && cur.seq > seq) return cur.data;
          this.store(id, data, seq);
          return data;
        })
        .catch((e) => {
          if (this.inflight.get(id) === flight) this.inflight.delete(id);
          throw e;
        }),
    };
    // Unobserved rejections (every consumer aborted) must not surface as errors.
    flight.promise.catch(() => {});
    this.inflight.set(id, flight);
    return flight;
  }

  private store(id: string, data: T, seq: number): void {
    this.entries.delete(id); // re-insert so Map order is least-recently-written first
    this.entries.set(id, { data, at: this.now(), seq, stale: false });
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}

// ---- Prefetcher ------------------------------------------------------------------

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

export interface PrefetcherOptions {
  delayMs?: number;
  maxInFlight?: number;
  timers?: Timers;
}

export const PREFETCH_DELAY_MS = 80;
export const PREFETCH_MAX_IN_FLIGHT = 2;

/**
 * Hover/focus/touch intent prefetching on top of a LeadCache.
 * - intent(id): after delayMs, fetch unless fresh or already loading.
 * - cancel(id): drop the pending timer / queue slot and abort this prefetch's share
 *   of the request (a click that joined the same request keeps it alive).
 * - now(ids): queue immediate prefetches (idle-time warmup).
 * At most maxInFlight prefetches run at once; the rest wait in a FIFO queue.
 */
export class Prefetcher<T> {
  private timers = new Map<string, unknown>();
  private queue: string[] = [];
  private running = new Map<string, AbortController>();
  private readonly delayMs: number;
  private readonly maxInFlight: number;
  private readonly t: Timers;

  constructor(
    private cache: LeadCache<T>,
    o: PrefetcherOptions = {},
  ) {
    this.delayMs = o.delayMs ?? PREFETCH_DELAY_MS;
    this.maxInFlight = o.maxInFlight ?? PREFETCH_MAX_IN_FLIGHT;
    this.t = o.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  }

  private skip(id: string): boolean {
    return this.cache.isFresh(id) || this.cache.isLoading(id) || this.running.has(id);
  }

  intent(id: string): void {
    if (this.timers.has(id) || this.skip(id)) return;
    const h = this.t.setTimeout(() => {
      this.timers.delete(id);
      this.enqueue(id);
    }, this.delayMs);
    this.timers.set(id, h);
  }

  now(ids: string[]): void {
    for (const id of ids) this.enqueue(id);
  }

  cancel(id: string): void {
    const h = this.timers.get(id);
    if (h !== undefined) {
      this.t.clearTimeout(h);
      this.timers.delete(id);
    }
    this.queue = this.queue.filter((q) => q !== id);
    this.running.get(id)?.abort();
  }

  cancelAll(): void {
    for (const id of [...this.timers.keys(), ...this.queue, ...this.running.keys()]) this.cancel(id);
  }

  get inFlight(): number {
    return this.running.size;
  }

  get queued(): number {
    return this.queue.length;
  }

  private enqueue(id: string): void {
    if (this.skip(id) || this.queue.includes(id)) return;
    this.queue.push(id);
    this.drain();
  }

  private drain(): void {
    while (this.running.size < this.maxInFlight && this.queue.length) {
      const id = this.queue.shift()!;
      if (this.skip(id)) continue;
      const ctrl = new AbortController();
      this.running.set(id, ctrl);
      this.cache
        .load(id, { signal: ctrl.signal })
        .catch(() => {}) // prefetch failures are silent; the click path reports errors
        .finally(() => {
          if (this.running.get(id) === ctrl) this.running.delete(id);
          this.drain();
        });
    }
  }
}
