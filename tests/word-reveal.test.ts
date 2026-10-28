import { describe, expect, it } from "vitest";
import { WORD_DELAY_FAST_MS, WORD_DELAY_MS, countWords, takeWord, wordDelayMs } from "@/lib/word-reveal";
import { createRateLimiter } from "@/lib/rate-limit";

describe("takeWord", () => {
  it("returns a whole word with its trailing space", () => {
    expect(takeWord("Hello there ji", false)).toEqual({ word: "Hello ", rest: "there ji" });
  });
  it("holds back a word that may still be growing", () => {
    expect(takeWord("Hel", false)).toBeNull();
    expect(takeWord("", false)).toBeNull();
  });
  it("flushes the last piece when the stream has ended", () => {
    expect(takeWord("ji", true)).toEqual({ word: "ji", rest: "" });
    expect(takeWord("", true)).toBeNull();
  });
  it("walking the buffer reproduces the text exactly", () => {
    const text = "Ji,  delivery ki date\nconfirm karke bata dete hain.";
    let buf = text;
    let out = "";
    for (let w = takeWord(buf, true); w; w = takeWord(buf, true)) {
      out += w.word;
      buf = w.rest;
    }
    expect(out).toBe(text);
  });
});

describe("pacing", () => {
  it("about 30 ms a word, faster with a backlog or once the stream has ended", () => {
    expect(countWords("a bb  ccc\nd")).toBe(4);
    expect(wordDelayMs(3, false)).toBe(WORD_DELAY_MS);
    expect(wordDelayMs(21, false)).toBe(WORD_DELAY_FAST_MS);
    expect(wordDelayMs(0, true)).toBe(WORD_DELAY_FAST_MS);
    expect(WORD_DELAY_MS).toBeGreaterThanOrEqual(25);
    expect(WORD_DELAY_MS).toBeLessThanOrEqual(40);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window, then refuses until entries age out", () => {
    const l = createRateLimiter(3, 1000);
    expect([l.take("u", 0), l.take("u", 100), l.take("u", 200), l.take("u", 300)]).toEqual([true, true, true, false]);
    expect(l.take("u", 999)).toBe(false);
    expect(l.take("u", 1001)).toBe(true); // the first hit has aged out
  });
  it("counts per key and supports weighted hits", () => {
    const l = createRateLimiter(3, 1000);
    expect(l.take("a", 0, 2)).toBe(true);
    expect(l.take("a", 1, 2)).toBe(false);
    expect(l.take("a", 2, 1)).toBe(true);
    expect(l.take("b", 3, 3)).toBe(true);
  });
});
