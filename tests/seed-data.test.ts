import { describe, it, expect } from "vitest";
import { SEED_REPS, SEED_LEADS } from "../scripts/seed-data";

const TAGS = ["Hot", "Warm", "Cold"];
const GAP: Record<string, [number, number]> = { Hot: [0, 1], Warm: [2, 5], Cold: [7, 14] };
const SOURCES = ["IndiaMART", "Referral", "Trade show", "Website", "Cold call"];
const words = (s: string) => s.trim().split(/\s+/).length;

describe("seed data", () => {
  const reps = SEED_REPS.filter((r) => r.role === "rep");
  const owners = SEED_REPS.filter((r) => r.role === "owner");
  const withChat = SEED_LEADS.filter((l) => l.messages.length > 0);

  it("has 5 reps, 1 owner, >=20 leads, >=10 chats", () => {
    expect(reps).toHaveLength(5);
    expect(owners).toHaveLength(1);
    expect(SEED_LEADS.length).toBeGreaterThanOrEqual(20);
    expect(withChat.length).toBeGreaterThanOrEqual(10);
  });

  it("uses axon.demo emails and unique reps", () => {
    for (const r of SEED_REPS) expect(r.email).toMatch(/^[a-z0-9]+@axon\.demo$/);
    expect(new Set(SEED_REPS.map((r) => r.email)).size).toBe(SEED_REPS.length);
  });

  it("covers the required distribution", () => {
    expect(SEED_LEADS.filter((l) => l.followUpOffset < 0).length).toBeGreaterThanOrEqual(5);
    expect(SEED_LEADS.filter((l) => l.followUpOffset === 0).length).toBeGreaterThanOrEqual(4);
    expect(SEED_LEADS.filter((l) => l.tag === "Hot").length).toBeGreaterThanOrEqual(6);
    expect(SEED_LEADS.filter((l) => l.tag === "Cold").length).toBeGreaterThanOrEqual(6);
    expect(SEED_LEADS.filter((l) => l.tag === "Warm").length).toBeGreaterThan(0);
  });

  it("every lead is owned by a known rep (not the owner), reps get 4-5 each", () => {
    const repEmails = new Set(reps.map((r) => r.email));
    for (const l of SEED_LEADS) expect(repEmails.has(l.repEmail)).toBe(true);
    for (const r of reps) {
      const n = SEED_LEADS.filter((l) => l.repEmail === r.email).length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it("has unique phone numbers (the seed script keys leads by phone)", () => {
    expect(new Set(SEED_LEADS.map((l) => l.phone)).size).toBe(SEED_LEADS.length);
  });

  it("has valid tags, sources, phones, reasons and drafts", () => {
    for (const l of SEED_LEADS) {
      expect(TAGS).toContain(l.tag);
      expect(SOURCES).toContain(l.source);
      expect(l.phone).toMatch(/^\+91 \d{5} \d{5}$/);
      expect(l.reason.trim().length).toBeGreaterThan(0);
      expect(words(l.reason)).toBeLessThanOrEqual(20);
      expect(l.draft.trim().length).toBeGreaterThan(0);
      expect(words(l.draft)).toBeLessThanOrEqual(60);
      expect(l.draft).not.toMatch(/[\[\]{}]/);
    }
  });

  it("follow-up gap from last contact respects the tag clamp", () => {
    for (const l of SEED_LEADS) {
      const gap = l.followUpOffset - l.lastContactOffset;
      const [min, max] = GAP[l.tag];
      expect(gap, l.name).toBeGreaterThanOrEqual(min);
      expect(gap, l.name).toBeLessThanOrEqual(max);
      expect(l.lastContactOffset).toBeLessThanOrEqual(0);
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
        expect(m.time).toMatch(/^\d{2}:\d{2}$/);
        expect(m.text.trim().length).toBeGreaterThan(0);
        const key = `${String(m.dayOffset + 100).padStart(3, "0")}T${m.time}`;
        expect(key >= prevKey, `${l.name} message ${i} out of order`).toBe(true);
        prevKey = key;
      });
      const last = l.messages[l.messages.length - 1];
      expect(last.dayOffset, l.name).toBe(l.lastContactOffset);
      // the first message of a chat must come before (or on) last contact
      expect(l.messages[0].dayOffset).toBeLessThanOrEqual(l.lastContactOffset);
    }
  });

  it("includes a silent Hot lead and an explicit not-this-year lead", () => {
    const silent = SEED_LEADS.find((l) => l.tag === "Hot" && l.lastContactOffset <= -7);
    expect(silent).toBeDefined();
    expect(SEED_LEADS.some((l) => l.messages.some((m) => /not this year/i.test(m.text)))).toBe(true);
  });
});
