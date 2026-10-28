// Tiny circuit breaker for Gemini calls. After a 429 (quota or rate limit) or a 5xx,
// further calls are skipped for a cool-down so they go straight to the rule-based
// fallback instead of spending a failing round trip each time. State is per server
// instance (module level); the clock is injectable so tests need no real timers.

export const BREAKER_COOLDOWN_MS = 60_000;

let openUntil = 0;

/** True when Gemini should not be called right now. */
export function geminiBlocked(now: number = Date.now()): boolean {
  return now < openUntil;
}

/** Records an upstream HTTP status; 429 and 5xx open the breaker for the cool-down. */
export function noteGeminiStatus(status: number, now: number = Date.now()): void {
  if (status === 429 || (status >= 500 && status <= 599)) openUntil = now + BREAKER_COOLDOWN_MS;
}

/** Test helper. */
export function resetGeminiBreaker(): void {
  openUntil = 0;
}
