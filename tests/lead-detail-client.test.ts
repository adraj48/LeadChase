import { describe, expect, it } from "vitest";
import { LeadFetchError, parseDetailBody, warmupIds } from "@/lib/lead-detail-client";

describe("parseDetailBody", () => {
  it("accepts { lead, messages }", () => {
    const body = { lead: { id: "a" }, messages: [] };
    expect(parseDetailBody(body)).toEqual(body);
  });
  it("rejects malformed bodies", () => {
    expect(() => parseDetailBody({ lead: { id: "a" } })).toThrow(LeadFetchError);
    expect(() => parseDetailBody(null)).toThrow("Unexpected response from server");
  });
});

describe("warmupIds", () => {
  const today = "2026-10-29";
  const l = (id: string, tag: "Hot" | "Warm" | "Cold", followUpDate: string) => ({ id, tag, followUpDate });
  it("takes overdue first, then Hot, capped at 3", () => {
    const leads = [l("o1", "Warm", "2026-10-20"), l("o2", "Cold", "2026-10-28"), l("w", "Warm", today), l("h1", "Hot", today), l("h2", "Hot", "2026-11-02")];
    expect(warmupIds(leads, today)).toEqual(["o1", "o2", "h1"]);
  });
  it("returns nothing for a calm list", () => {
    expect(warmupIds([l("w", "Warm", "2026-11-01")], today)).toEqual([]);
  });
});
