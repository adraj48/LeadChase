import { describe, expect, it } from "vitest";
import {
  ALL_REPS,
  DEFAULT_LEADS_URL,
  VIEWING_KEY,
  isViewing,
  pickDefaultRepId,
  leadsUrl,
  parseReps,
  readViewing,
  repName,
  resolveViewing,
  writeViewing,
} from "@/lib/rep-selection";
import { realtimeFilter } from "@/lib/use-leads-realtime";

const SNEHA = "11111111-1111-4111-8111-111111111111";
const ARJUN = "22222222-2222-4222-8222-222222222222";
const reps = [
  { id: ARJUN, name: "Arjun Mehta" },
  { id: SNEHA, name: "Sneha Iyer" },
];

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
};

describe("readViewing / writeViewing", () => {
  it("round-trips a rep id and 'all'", () => {
    const s = memStorage();
    writeViewing(s, SNEHA);
    expect(readViewing(s)).toBe(SNEHA);
    writeViewing(s, ALL_REPS);
    expect(s.m.get(VIEWING_KEY)).toBe("all");
    expect(readViewing(s)).toBe(ALL_REPS);
  });

  it("ignores junk values", () => {
    expect(readViewing(memStorage({ [VIEWING_KEY]: "<script>" }))).toBeNull();
    expect(readViewing(memStorage())).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    expect(readViewing(throwing)).toBeNull();
    expect(() => writeViewing(throwing, SNEHA)).not.toThrow();
    expect(readViewing(null)).toBeNull();
    expect(() => writeViewing(undefined, SNEHA)).not.toThrow();
  });
});

describe("resolveViewing", () => {
  it("defaults to Sneha Iyer by name", () => {
    expect(resolveViewing(reps, null)).toBe(SNEHA);
  });
  it("keeps a stored rep that still exists, and a stored 'all'", () => {
    expect(resolveViewing(reps, ARJUN)).toBe(ARJUN);
    expect(resolveViewing(reps, ALL_REPS)).toBe(ALL_REPS);
  });
  it("falls back when the stored rep is gone", () => {
    expect(resolveViewing(reps, "33333333-3333-4333-8333-333333333333")).toBe(SNEHA);
  });
  it("falls back to the first rep without Sneha, and to 'all' with no reps", () => {
    expect(resolveViewing([reps[0]], null)).toBe(ARJUN);
    expect(resolveViewing([], null)).toBe(ALL_REPS);
  });
});

describe("helpers", () => {
  it("builds the leads URL", () => {
    expect(leadsUrl(ALL_REPS)).toBe("/api/leads?rep=all");
    expect(leadsUrl(SNEHA)).toBe(`/api/leads?rep=${SNEHA}`);
  });
  it("parses and sorts the reps body defensively", () => {
    expect(parseReps({ reps: [{ id: SNEHA, name: "Sneha Iyer" }, { id: ARJUN, name: "Arjun Mehta", extra: 1 }, { id: 3 }] })).toEqual(reps);
    expect(parseReps(null)).toEqual([]);
    expect(parseReps({ reps: "nope" })).toEqual([]);
  });
  it("looks up a rep name", () => {
    expect(repName(reps, SNEHA)).toBe("Sneha Iyer");
    expect(repName(reps, "x")).toBeNull();
  });
  it("filters Realtime by rep only when one rep is viewed", () => {
    expect(realtimeFilter(SNEHA)).toBe(`rep_id=eq.${SNEHA}`);
    expect(realtimeFilter(ALL_REPS)).toBeUndefined();
    expect(realtimeFilter(null)).toBeUndefined();
  });
});

describe("pickDefaultRepId / default list", () => {
  it("prefers Sneha Iyer case-insensitively", () => {
    expect(pickDefaultRepId(reps)).toBe(SNEHA);
    expect(pickDefaultRepId([{ id: ARJUN, name: "a" }, { id: SNEHA, name: " SNEHA iyer " }])).toBe(SNEHA);
  });
  it("without a Sneha it is the first rep by name, and 'all' with no reps", () => {
    expect(pickDefaultRepId([{ id: SNEHA, name: "Zed" }, { id: ARJUN, name: "Arjun" }])).toBe(ARJUN);
    expect(pickDefaultRepId([])).toBe(ALL_REPS);
  });
  it("agrees with resolveViewing when nothing is stored", () => {
    expect(resolveViewing(reps, null)).toBe(pickDefaultRepId(reps));
    expect(resolveViewing([], null)).toBe(pickDefaultRepId([]));
  });
  it("isViewing accepts all or a uuid only", () => {
    expect(isViewing("all")).toBe(true);
    expect(isViewing(SNEHA)).toBe(true);
    expect(isViewing("default")).toBe(false);
    expect(isViewing(5)).toBe(false);
  });
  it("the default list url", () => {
    expect(DEFAULT_LEADS_URL).toBe("/api/leads?rep=default");
  });
});
