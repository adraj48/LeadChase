import { describe, it, expect } from "vitest";
import { validateNewLead, validateText, validateMessage } from "@/lib/validate";

const today = "2026-10-28";
const good = {
  name: "  Ravi Shah ",
  company: " Shah Steel ",
  phone: " +91 98765 43210 ",
  source: "IndiaMART",
  lastContactDate: "2026-10-20",
};

describe("validateText", () => {
  it("rejects blank after trim", () => {
    expect(validateText({ text: "   " }, "text").ok).toBe(false);
  });
  it("rejects missing and non-string", () => {
    expect(validateText({}, "draft").ok).toBe(false);
    expect(validateText({ draft: 5 }, "draft").ok).toBe(false);
  });
  it("accepts 1000 chars, rejects 1001", () => {
    expect(validateText({ text: "a".repeat(1000) }, "text").ok).toBe(true);
    expect(validateText({ text: "a".repeat(1001) }, "text").ok).toBe(false);
  });
  it("trims value", () => {
    expect(validateText({ draft: "  hi " }, "draft")).toEqual({ ok: true, value: "hi" });
  });
  it("rejects non-object bodies", () => {
    for (const b of [null, undefined, "x", 5, [], [1]]) {
      expect(validateText(b, "text").ok).toBe(false);
    }
  });
});

describe("validateMessage", () => {
  it("rejects bad from", () => {
    expect(validateMessage({ from: "bot", text: "x" }).ok).toBe(false);
  });
  it("rejects blank text", () => {
    expect(validateMessage({ from: "rep", text: " " }).ok).toBe(false);
  });
  it("accepts valid", () => {
    expect(validateMessage({ from: "buyer", text: " hello " })).toEqual({
      ok: true,
      value: { from: "buyer", text: "hello" },
    });
  });
  it("rejects non-object", () => {
    expect(validateMessage(null).ok).toBe(false);
  });
});

describe("validateNewLead", () => {
  it("returns trimmed values for a valid lead", () => {
    const r = validateNewLead(good, today);
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Ravi Shah",
        company: "Shah Steel",
        phone: "+91 98765 43210",
        source: "IndiaMART",
        lastContactDate: "2026-10-20",
      },
    });
  });
  it("passes repId through when it is a string", () => {
    const r = validateNewLead({ ...good, repId: "abc" }, today);
    expect(r.ok && r.value.repId).toBe("abc");
  });
  it("rejects missing company", () => {
    expect(validateNewLead({ ...good, company: "  " }, today).ok).toBe(false);
    const { company: _c, ...rest } = good;
    void _c;
    expect(validateNewLead(rest, today).ok).toBe(false);
  });
  it("rejects bad phone", () => {
    expect(validateNewLead({ ...good, phone: "12ab" }, today).ok).toBe(false);
    expect(validateNewLead({ ...good, phone: "123" }, today).ok).toBe(false);
  });
  it("rejects future date", () => {
    expect(validateNewLead({ ...good, lastContactDate: "2026-10-29" }, today).ok).toBe(false);
  });
  it("accepts today", () => {
    expect(validateNewLead({ ...good, lastContactDate: today }, today).ok).toBe(true);
  });
  it("rejects invalid calendar date and bad format", () => {
    expect(validateNewLead({ ...good, lastContactDate: "2026-02-30" }, today).ok).toBe(false);
    expect(validateNewLead({ ...good, lastContactDate: "28/10/2026" }, today).ok).toBe(false);
  });
  it("rejects unknown source", () => {
    expect(validateNewLead({ ...good, source: "Billboard" }, today).ok).toBe(false);
  });
  it("accepts every known source", () => {
    for (const s of ["IndiaMART", "Referral", "Trade show", "Website", "Cold call"]) {
      expect(validateNewLead({ ...good, source: s }, today).ok).toBe(true);
    }
  });
  it("rejects over-long name/company", () => {
    expect(validateNewLead({ ...good, name: "a".repeat(121) }, today).ok).toBe(false);
    expect(validateNewLead({ ...good, company: "a".repeat(121) }, today).ok).toBe(false);
  });
  it("rejects non-object body", () => {
    expect(validateNewLead(null, today).ok).toBe(false);
    expect(validateNewLead("x", today).ok).toBe(false);
    expect(validateNewLead([], today).ok).toBe(false);
  });
});
