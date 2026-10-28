// Sliding-window limiter kept in process memory. Best-effort only: each server
// instance counts separately and a restart resets it. It exists to stop a stuck
// click loop or a script from burning model quota, not to be a security boundary.
export interface RateLimiter {
  /** Records a hit worth `cost` units for `key`; false when it would exceed the limit. */
  take(key: string, now?: number, cost?: number): boolean;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { at: number; cost: number }[]>();
  return {
    take(key, now = Date.now(), cost = 1) {
      const recent = (hits.get(key) ?? []).filter((h) => now - h.at < windowMs);
      const used = recent.reduce((n, h) => n + h.cost, 0);
      if (used + cost > limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push({ at: now, cost });
      hits.set(key, recent);
      // Drop idle keys now and then so the map cannot grow without bound.
      if (hits.size > 1000) {
        for (const [k, v] of hits) if (v.every((h) => now - h.at >= windowMs)) hits.delete(k);
      }
      return true;
    },
  };
}
