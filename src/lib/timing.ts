import { AsyncLocalStorage } from "node:async_hooks";

// Per-request diagnostics for the API routes (server only). Two pieces:
//  - a Supabase request counter, scoped to one API request with AsyncLocalStorage and
//    incremented by tracedFetch for every HTTP call the server client makes;
//  - a stage timer that logs one line in development only, never in production, and
//    never anything but stage names, millisecond counts and the request count.
const scope = new AsyncLocalStorage<{ trips: number }>();

/** Runs `fn` with a fresh Supabase request counter (see countRoundTrip). */
export function withTripCounter<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ trips: 0 }, fn);
}

/** Called by tracedFetch for each outgoing Supabase request. */
export function countRoundTrip(): void {
  const s = scope.getStore();
  if (s) s.trips++;
}

/** Supabase requests made so far in the current scope (undefined outside one). */
export function tripCount(): number | undefined {
  return scope.getStore()?.trips;
}

export function stageTimer(label: string) {
  const start = performance.now();
  let last = start;
  const stages: Record<string, number> = {};
  return {
    mark(stage: string): void {
      const now = performance.now();
      stages[stage] = Math.round(now - last);
      last = now;
    },
    done(): Record<string, number> {
      const total = Math.round(performance.now() - start);
      const out: Record<string, number> = { ...stages, total };
      const trips = tripCount();
      if (process.env.NODE_ENV === "development") {
        const parts = Object.entries(out).map(([k, v]) => `${k}=${v}ms`);
        if (trips !== undefined) parts.push(`supabase_requests=${trips}`);
        console.info(`[timing] ${label} ${parts.join(" ")}`);
      }
      return out;
    },
  };
}
