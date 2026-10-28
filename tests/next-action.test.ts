import { describe, expect, it } from "vitest";
import { buildTimeline, extractFacts } from "@/lib/draft-facts";
import { deriveNextAction, renderNextAction } from "@/lib/next-action";

const TODAY = "2026-10-29";
const lead = { lastContactDate: "2026-10-27" };
type M = { from: "rep" | "buyer"; text: string; at: string };
const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00+05:30`;
const rep = (day: number, text: string): M => ({ from: "rep", text, at: at(day) });
const buyer = (day: number, text: string): M => ({ from: "buyer", text, at: at(day) });
const next = (...m: M[]) => {
  const f = extractFacts(lead, m, TODAY);
  return deriveNextAction(f, buildTimeline(lead, m, TODAY, f), "IndiaMART");
};

describe("deriveNextAction", () => {
  it("declined: close politely, no push", () => {
    const a = next(rep(25, "Quote sent"), buyer(26, "Not interested anymore"));
    expect(a.goal).toMatch(/Close politely/);
    expect(a.avoid.join(" ")).toMatch(/reconsider/);
  });
  it("later: acknowledge the date, offer nothing else", () => {
    const a = next(rep(25, "Shall we close?"), buyer(26, "Call me after 10 days"));
    expect(a.goal).toMatch(/Acknowledge the date or period/);
    expect(a.goal).toMatch(/Offer nothing else/);
  });
  it("buyer with an unanswered question: answer that question first, else confirm and revert", () => {
    const a = next(rep(25, "Quote sent"), buyer(26, "Price theek hai. Delivery kitne din mein hogi?"));
    expect(a.goal).toMatch(/exact open question/);
    expect(a.goal).toMatch(/confirm and revert/);
    expect(a.why).toContain("Delivery kitne din mein hogi?");
  });
  it("the day the buyer proposed is today: say you are ready and ask for a time", () => {
    const a = next(rep(27, "Quote sent"), buyer(28, "Ok, kal baat karte hain. Partner ko dikhana hai."));
    expect(a.goal).toMatch(/proposed talking on a day that is today/);
    // Same message, but the day it pointed to has long passed: no special rule.
    const old = next(rep(20, "Quote sent"), buyer(21, "Ok, kal baat karte hain. Partner ko dikhana hai."));
    expect(old.goal).not.toMatch(/proposed talking/);
  });
  it("ready to order: single practical next step", () => {
    const a = next(rep(25, "Final Rs 36,000"), buyer(26, "Go ahead, we will proceed with the order"));
    expect(a.goal).toMatch(/single next practical step/);
  });
  it("negotiating: acknowledge the number, one clarifying question, no concession", () => {
    const a = next(rep(25, "Rs 11,000 each"), buyer(26, "That is costly, a competitor is cheaper"));
    expect(a.goal).toMatch(/ONE clarifying question/);
    expect(a.goal).toMatch(/Do not offer any concession/);
  });
  it("quote sent and buyer silent: one specific nudge about the exact quote", () => {
    const a = next(rep(20, "Quote Rs 24,000 for the carton sealer"));
    expect(a.goal).toMatch(/exact quote/);
    expect(a.why).toMatch(/silent/);
  });
  it("two or more unanswered follow-ups: very short, with an easy out", () => {
    const a = next(rep(20, "Quote Rs 24,000"), rep(24, "Any update?"), rep(27, "Following up"));
    expect(a.goal).toMatch(/very short/);
    expect(a.goal).toMatch(/follow up later/);
  });
  it("silent without a quote: short restart", () => {
    const a = next(rep(25, "Namaste, aapne enquiry daali thi"));
    expect(a.goal).toMatch(/restart/);
  });
  it("new lead without a chat: first touch with the source", () => {
    const a = next();
    expect(a.goal).toMatch(/first touch/);
    expect(a.goal).toContain("IndiaMART");
  });
  it("engaged buyer: one next step the chat supports", () => {
    const a = next(rep(25, "Hi"), buyer(26, "Tell me about the 4-head machine"));
    expect(a.goal).toMatch(/ONE next step/);
  });
  it("every action avoids inventing facts and renders for the prompt", () => {
    const a = next(rep(25, "Hi"), buyer(26, "Tell me more"));
    expect(a.avoid.join(" ")).toMatch(/inventing/);
    const r = renderNextAction(a);
    expect(r).toMatch(/^NEXT BEST ACTION: /);
    expect(r).toContain("(why: ");
    expect(r).toContain("Avoid: ");
  });
});
