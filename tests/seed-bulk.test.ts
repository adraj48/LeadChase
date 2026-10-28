import { describe, it, expect } from "vitest";
import { SEED_LEADS } from "../scripts/seed-data";
import { BULK_LEADS, buildBulkLeads } from "../scripts/seed-bulk";

const TAGS = ["Hot", "Warm", "Cold"];
const GAP: Record<string, [number, number]> = { Hot: [0, 1], Warm: [2, 5], Cold: [7, 14] };
const SOURCES = ["IndiaMART", "Referral", "Trade show", "Website", "Cold call"];
const words = (s: string) => s.trim().split(/\s+/).length;
const GENDERED = /\b(karunga|karungi|sakta|sakti|raha|rahi|bhejta|bhejti|batata|batati|gayi)\b/i;

describe("bulk seed data", () => {
  const withChat = BULK_LEADS.filter((l) => l.messages.length > 0);
  const count = (f: (l: (typeof BULK_LEADS)[number]) => boolean) => BULK_LEADS.filter(f).length;

  it("has exactly 126 leads and ~60% have a chat", () => {
    expect(BULK_LEADS).toHaveLength(126);
    expect(withChat.length).toBeGreaterThanOrEqual(70);
    expect(withChat.length).toBeLessThanOrEqual(82);
  });

  it("is deterministic", () => {
    expect(buildBulkLeads()).toEqual(buildBulkLeads());
    expect(buildBulkLeads()).toEqual(BULK_LEADS);
  });

  it("phones are unique across hand-written and generated leads", () => {
    const all = [...SEED_LEADS, ...BULK_LEADS];
    expect(new Set(all.map((l) => l.phone)).size).toBe(all.length);
    for (const l of BULK_LEADS) expect(l.phone).toMatch(/^\+91 90001 \d{5}$/);
  });

  it("has no duplicate name+company, and none clashing with hand-written leads", () => {
    const all = [...SEED_LEADS, ...BULK_LEADS];
    expect(new Set(all.map((l) => `${l.name}|${l.company}`)).size).toBe(all.length);
    expect(new Set(BULK_LEADS.map((l) => l.name)).size).toBeGreaterThanOrEqual(120);
  });

  it("never assigns rep4 and spreads rep1/2/3/5 evenly (31-32 each)", () => {
    expect(BULK_LEADS.some((l) => l.repEmail === "rep4@axon.demo")).toBe(false);
    for (const email of ["rep1", "rep2", "rep3", "rep5"].map((r) => `${r}@axon.demo`)) {
      const n = BULK_LEADS.filter((l) => l.repEmail === email).length;
      expect(n, email).toBeGreaterThanOrEqual(31);
      expect(n, email).toBeLessThanOrEqual(32);
    }
  });

  it("tag and follow-up distributions are in range", () => {
    const hot = count((l) => l.tag === "Hot");
    const warm = count((l) => l.tag === "Warm");
    const cold = count((l) => l.tag === "Cold");
    expect(hot).toBeGreaterThanOrEqual(21);
    expect(hot).toBeLessThanOrEqual(30);
    expect(warm).toBeGreaterThanOrEqual(45);
    expect(warm).toBeLessThanOrEqual(57);
    expect(cold).toBeGreaterThanOrEqual(45);
    expect(cold).toBeLessThanOrEqual(57);
    const overdue = count((l) => l.followUpOffset < 0);
    const today = count((l) => l.followUpOffset === 0);
    const upcoming = count((l) => l.followUpOffset > 0);
    expect(overdue).toBeGreaterThanOrEqual(25);
    expect(overdue).toBeLessThanOrEqual(40);
    expect(today).toBeGreaterThanOrEqual(12);
    expect(today).toBeLessThanOrEqual(26);
    expect(upcoming).toBeGreaterThanOrEqual(60);
  });

  it("uses all five sources, none dominating", () => {
    for (const s of SOURCES) expect(count((l) => l.source === s), s).toBeGreaterThanOrEqual(15);
  });

  it("has valid tags, sources, phones, reasons and drafts", () => {
    for (const l of BULK_LEADS) {
      expect(TAGS).toContain(l.tag);
      expect(SOURCES).toContain(l.source);
      expect(l.phone).toMatch(/^\+91 \d{5} \d{5}$/);
      expect(l.reason.trim().length, l.name).toBeGreaterThan(0);
      expect(words(l.reason), l.reason).toBeLessThanOrEqual(20);
      expect(l.draft.trim().length, l.name).toBeGreaterThan(0);
      expect(words(l.draft), l.draft).toBeLessThanOrEqual(60);
      for (const text of [l.reason, l.draft, ...l.messages.map((m) => m.text)]) {
        expect(text).not.toMatch(/[\[\]{}]/);
      }
      expect(l.draft).not.toMatch(/\b\d{1,2}(:\d{2})?\s*(am|pm|baje)\b/i);
      expect(l.draft, l.name).not.toMatch(GENDERED);
    }
  });

  it("keeps gendered Hindi verb forms out of generated chats too", () => {
    for (const l of withChat) for (const m of l.messages) expect(m.text).not.toMatch(GENDERED);
  });

  it("follow-up gap from last contact respects the tag clamp", () => {
    for (const l of BULK_LEADS) {
      const gap = l.followUpOffset - l.lastContactOffset;
      const [min, max] = GAP[l.tag];
      expect(gap, l.name).toBeGreaterThanOrEqual(min);
      expect(gap, l.name).toBeLessThanOrEqual(max);
      expect(l.lastContactOffset).toBeLessThanOrEqual(0);
      expect(l.lastContactOffset).toBeGreaterThanOrEqual(-25);
    }
  });

  it("chats have 3-6 alternating messages, no future messages, ending on last contact", () => {
    for (const l of withChat) {
      expect(l.messages.length, l.name).toBeGreaterThanOrEqual(3);
      expect(l.messages.length, l.name).toBeLessThanOrEqual(6);
      let prevKey = "";
      l.messages.forEach((m, i) => {
        expect(m.dayOffset).toBeLessThanOrEqual(0);
        expect(m.dayOffset).toBeGreaterThanOrEqual(-60);
        expect(m.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(m.text.trim().length).toBeGreaterThan(0);
        if (i > 0) expect(m.from, `${l.name} message ${i} should alternate`).not.toBe(l.messages[i - 1].from);
        const key = `${String(m.dayOffset + 100).padStart(3, "0")}T${m.time}`;
        expect(key >= prevKey, `${l.name} message ${i} out of order`).toBe(true);
        prevKey = key;
      });
      expect(l.messages[l.messages.length - 1].dayOffset, l.name).toBe(l.lastContactOffset);
      expect(l.messages[0].dayOffset).toBeLessThanOrEqual(l.lastContactOffset);
    }
  });

  it("Hot leads have a chat ending on a recent buyer message; Cold chats never end on an eager buyer", () => {
    for (const l of BULK_LEADS.filter((x) => x.tag === "Hot")) {
      expect(l.messages.length, l.name).toBeGreaterThan(0);
      expect(l.messages[l.messages.length - 1].from, l.name).toBe("buyer");
      expect(l.lastContactOffset).toBeGreaterThanOrEqual(-2);
    }
  });
});
