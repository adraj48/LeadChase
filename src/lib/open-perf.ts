// Development-only timing for opening a lead: click -> first paint of the detail pane,
// click -> chat ready. Uses the User Timing API (visible in the browser Performance
// panel and via performance.getEntriesByType("measure")) and logs one line per open.
// Every function is a no-op outside development.

const DEV = process.env.NODE_ENV === "development";

export type CacheHit = "hit" | "miss" | "inflight";

let current: { id: string; hit: CacheHit | null; paint: number | null; logged: boolean } | null = null;

function ok(): boolean {
  return DEV && typeof performance !== "undefined" && typeof performance.mark === "function";
}

function afterPaint(fn: () => void): void {
  // rAF runs before the frame is painted; the macrotask after it runs once it is.
  requestAnimationFrame(() => setTimeout(fn, 0));
}

export function markOpenClick(id: string): void {
  if (!ok()) return;
  current = { id, hit: null, paint: null, logged: false };
  performance.mark(`lead-open:click:${id}`);
}

export function markOpenCache(id: string, hit: CacheHit): void {
  if (ok() && current?.id === id && current.hit === null) current.hit = hit;
}

export function markFirstPaint(id: string): void {
  if (!ok() || current?.id !== id) return;
  afterPaint(() => {
    if (current?.id !== id || current.paint !== null) return;
    try {
      performance.mark(`lead-open:first-paint:${id}`);
      const m = performance.measure("lead-open:click->first-paint", `lead-open:click:${id}`, `lead-open:first-paint:${id}`);
      current.paint = m.duration;
    } catch {
      // marks cleared or missing: skip
    }
  });
}

export function markChatReady(id: string): void {
  if (!ok() || current?.id !== id || current.logged) return;
  afterPaint(() => {
    if (current?.id !== id || current.logged) return;
    current.logged = true;
    try {
      performance.mark(`lead-open:chat-ready:${id}`);
      const m = performance.measure("lead-open:click->chat-ready", `lead-open:click:${id}`, `lead-open:chat-ready:${id}`);
      const paint = current.paint === null ? "?" : `${Math.round(current.paint)}ms`;
      console.info(`[perf] lead open: first paint ${paint}, chat ready ${Math.round(m.duration)}ms (cache ${current.hit ?? "?"})`);
    } catch {
      // skip
    }
  });
}
