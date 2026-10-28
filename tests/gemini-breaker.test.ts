import { beforeEach, describe, expect, it } from "vitest";
import { BREAKER_COOLDOWN_MS, geminiBlocked, noteGeminiStatus, resetGeminiBreaker } from "@/lib/gemini-breaker";

beforeEach(resetGeminiBreaker);

describe("gemini breaker", () => {
  it("starts closed", () => {
    expect(geminiBlocked(1_000)).toBe(false);
  });
  it("opens for the cool-down after a 429, then closes", () => {
    noteGeminiStatus(429, 1_000);
    expect(geminiBlocked(1_001)).toBe(true);
    expect(geminiBlocked(1_000 + BREAKER_COOLDOWN_MS - 1)).toBe(true);
    expect(geminiBlocked(1_000 + BREAKER_COOLDOWN_MS)).toBe(false);
  });
  it("opens on 5xx but not on other statuses", () => {
    noteGeminiStatus(503, 0);
    expect(geminiBlocked(1)).toBe(true);
    resetGeminiBreaker();
    for (const s of [200, 400, 401, 404]) noteGeminiStatus(s, 0);
    expect(geminiBlocked(1)).toBe(false);
  });
});
