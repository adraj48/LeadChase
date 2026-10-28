import { describe, it, expect } from "vitest";
import { todayIST, addDays, diffDays, daysOverdue } from "@/lib/dates";
import { bucketOf, sortByUrgency } from "@/lib/urgency";
import type { Tag } from "@/lib/types";

describe("dates", () => {
  it("todayIST uses Asia/Kolkata", () => {
    expect(todayIST(new Date("2026-10-28T20:00:00Z"))).toBe("2026-10-29");
    expect(todayIST(new Date("2026-10-28T10:00:00Z"))).toBe("2026-10-28");
  });
  it("addDays adds days", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
  it("addDays handles year rollover and negative n", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("diffDays returns whole days", () => {
    expect(diffDays("2026-11-02", "2026-10-30")).toBe(3);
  });
  it("daysOverdue is positive, zero, or negative", () => {
    expect(daysOverdue("2026-10-25", "2026-10-28")).toBe(3);
    expect(daysOverdue("2026-10-28", "2026-10-28")).toBe(0);
    expect(daysOverdue("2026-10-30", "2026-10-28")).toBe(-2);
  });
});

describe("bucketOf", () => {
  const today = "2026-10-28";
  it("maps past, equal, future", () => {
    expect(bucketOf({ followUpDate: "2026-10-27" }, today)).toBe("overdue");
    expect(bucketOf({ followUpDate: "2026-10-28" }, today)).toBe("today");
    expect(bucketOf({ followUpDate: "2026-10-29" }, today)).toBe("upcoming");
  });
});

describe("sortByUrgency", () => {
  const today = "2026-10-28";
  const l = (id: string, followUpDate: string, tag: Tag) => ({ id, followUpDate, tag });

  it("orders overdue, today, upcoming with tag tie-breaks", () => {
    const input = [
      l("up-cold", "2026-10-30", "Cold"),
      l("up-hot-late", "2026-11-05", "Hot"),
      l("today-cold", "2026-10-28", "Cold"),
      l("up-hot", "2026-10-30", "Hot"),
      l("od-warm-1", "2026-10-27", "Warm"),
      l("today-hot", "2026-10-28", "Hot"),
      l("od-hot-1", "2026-10-27", "Hot"),
      l("od-cold-5", "2026-10-23", "Cold"),
      l("today-warm", "2026-10-28", "Warm"),
    ];
    expect(sortByUrgency(input, today).map((x) => x.id)).toEqual([
      "od-cold-5",
      "od-hot-1",
      "od-warm-1",
      "today-hot",
      "today-warm",
      "today-cold",
      "up-hot",
      "up-cold",
      "up-hot-late",
    ]);
  });

  it("does not mutate input", () => {
    const input = [l("b", "2026-10-30", "Cold"), l("a", "2026-10-25", "Hot")];
    const copy = [...input];
    const out = sortByUrgency(input, today);
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
  });
});
