import { describe, it, expect } from "vitest";
import { groupLeads, followUpLabel, tagCounts, summaryLine } from "@/lib/lead-view";
import type { Lead, Tag } from "@/lib/types";

const T = "2026-10-28";
function lead(id: string, followUpDate: string, tag: Tag = "Warm"): Lead {
  return {
    id, repId: "r", repName: "R", name: id, company: "C", phone: "1", source: "s",
    lastContactDate: "2026-10-01", tag, reason: "", followUpDate, draft: "", analysisSource: "seed",
  };
}

describe("groupLeads", () => {
  it("handles empty list", () => {
    expect(groupLeads([], T)).toEqual({ overdue: [], today: [], upcoming: [] });
  });
  it("splits by bucket and preserves order", () => {
    const g = groupLeads(
      [lead("a", "2026-10-30"), lead("b", "2026-10-20"), lead("c", T), lead("d", "2026-10-27"), lead("e", "2026-11-01")],
      T,
    );
    expect(g.overdue.map((l) => l.id)).toEqual(["b", "d"]);
    expect(g.today.map((l) => l.id)).toEqual(["c"]);
    expect(g.upcoming.map((l) => l.id)).toEqual(["a", "e"]);
  });
  it("all in one group", () => {
    const g = groupLeads([lead("a", T), lead("b", T)], T);
    expect(g.today).toHaveLength(2);
    expect(g.overdue).toHaveLength(0);
    expect(g.upcoming).toHaveLength(0);
  });
});

describe("followUpLabel", () => {
  it("overdue", () => {
    expect(followUpLabel("2026-10-27", T)).toEqual({ text: "Overdue 1d", tone: "overdue" });
    expect(followUpLabel("2026-10-25", T)).toEqual({ text: "Overdue 3d", tone: "overdue" });
  });
  it("today", () => {
    expect(followUpLabel(T, T)).toEqual({ text: "Today", tone: "today" });
  });
  it("upcoming", () => {
    expect(followUpLabel("2026-10-29", T)).toEqual({ text: "Tomorrow", tone: "upcoming" });
    expect(followUpLabel("2026-11-01", T)).toEqual({ text: "in 4d", tone: "upcoming" });
  });
});

describe("tagCounts", () => {
  it("counts zero for empty", () => {
    expect(tagCounts([])).toEqual({ Hot: 0, Warm: 0, Cold: 0 });
  });
  it("counts each tag", () => {
    expect(tagCounts([lead("a", T, "Hot"), lead("b", T, "Hot"), lead("c", T, "Cold")])).toEqual({ Hot: 2, Warm: 0, Cold: 1 });
  });
});

describe("summaryLine", () => {
  const mk = (o: number, t: number) => ({
    overdue: Array.from({ length: o }, (_, i) => lead(`o${i}`, "2026-10-20")),
    today: Array.from({ length: t }, (_, i) => lead(`t${i}`, T)),
    upcoming: [lead("u", "2026-11-05")],
  });
  it("both", () => expect(summaryLine(mk(3, 2))).toBe("3 overdue · 2 due today"));
  it("today only", () => expect(summaryLine(mk(0, 2))).toBe("2 due today"));
  it("overdue only", () => expect(summaryLine(mk(3, 0))).toBe("3 overdue"));
  it("nothing", () => expect(summaryLine(mk(0, 0))).toBe("Nothing due today"));
  it("empty groups", () => expect(summaryLine({ overdue: [], today: [], upcoming: [] })).toBe("Nothing due today"));
});
