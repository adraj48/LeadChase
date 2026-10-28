import { describe, it, expect } from "vitest";
import { formatChatTime, formatDateLabel, canSend, canSave, sentToast, analysisNote, telHref, headingText } from "@/lib/detail-view";

describe("formatChatTime", () => {
  it("formats afternoon IST", () => {
    expect(formatChatTime("2026-10-28T10:12:00Z")).toBe("28 Oct, 3:42 pm");
  });
  it("crosses the IST date boundary", () => {
    expect(formatChatTime("2026-10-28T20:00:00Z")).toBe("29 Oct, 1:30 am");
  });
});

describe("formatDateLabel", () => {
  it("formats YYYY-MM-DD", () => {
    expect(formatDateLabel("2026-10-29")).toBe("29 Oct 2026");
    expect(formatDateLabel("2027-01-05")).toBe("5 Jan 2027");
  });
});

describe("canSend / canSave", () => {
  it("canSend rules", () => {
    expect(canSend("hi", false)).toBe(true);
    expect(canSend("hi", true)).toBe(false);
    expect(canSend("   ", false)).toBe(false);
    expect(canSend("a".repeat(1000), false)).toBe(true);
    expect(canSend("a".repeat(1001), false)).toBe(false);
  });
  it("canSave rules", () => {
    expect(canSave("new", "old", false)).toBe(true);
    expect(canSave("same", "same", false)).toBe(false);
    expect(canSave("new", "old", true)).toBe(false);
    expect(canSave(" ", "old", false)).toBe(false);
    expect(canSave("a".repeat(1001), "old", false)).toBe(false);
  });
});

describe("sentToast", () => {
  const T = "2026-10-28";
  it("future date", () => expect(sentToast("2026-10-31", T)).toBe("Sent. Next follow-up: 31 Oct 2026"));
  it("today", () => expect(sentToast(T, T)).toBe("Sent. Next follow-up: today"));
  it("tomorrow", () => expect(sentToast("2026-10-29", T)).toBe("Sent. Next follow-up: tomorrow"));
});

describe("analysisNote", () => {
  it("only fallback has a note", () => {
    expect(analysisNote("fallback")).toBe("AI unavailable — rule-based suggestion");
    expect(analysisNote("llm")).toBeNull();
    expect(analysisNote("seed")).toBeNull();
  });
});

describe("telHref", () => {
  it("keeps an existing country code", () => {
    expect(telHref("+91 98265 41872")).toBe("tel:+919826541872");
    expect(telHref("+44 20 7946 0958")).toBe("tel:+442079460958");
  });
  it("defaults to +91", () => expect(telHref("98265 41872")).toBe("tel:+919826541872"));
  it("strips extra whitespace", () => expect(telHref("  98265 \t 41872 ")).toBe("tel:+919826541872"));
});

describe("headingText", () => {
  it("maps each state to heading text", () => {
    expect(headingText("loading", "")).toBe("Loading lead…");
    expect(headingText("error", "")).toBe("Couldn't load this lead");
    expect(headingText("loaded", "Ravi Kumar")).toBe("Ravi Kumar");
  });
});

import { canAddMessage, updatedNote } from "@/lib/detail-view";

describe("canAddMessage", () => {
  it("rules", () => {
    expect(canAddMessage("hi", false)).toBe(true);
    expect(canAddMessage("hi", true)).toBe(false);
    expect(canAddMessage("  \n ", false)).toBe(false);
    expect(canAddMessage("a".repeat(1000), false)).toBe(true);
    expect(canAddMessage("a".repeat(1001), false)).toBe(false);
  });
});

describe("updatedNote", () => {
  it("uses today / tomorrow / date wording", () => {
    expect(updatedNote({ tag: "Hot", followUpDate: "2026-10-28" }, "2026-10-28")).toBe("Updated: Hot · follow-up today");
    expect(updatedNote({ tag: "Hot", followUpDate: "2026-10-29" }, "2026-10-28")).toBe("Updated: Hot · follow-up tomorrow");
    expect(updatedNote({ tag: "Warm", followUpDate: "2026-11-03" }, "2026-10-28")).toBe("Updated: Warm · follow-up 3 Nov 2026");
  });
});

import { revalidatedDraft, sameRow } from "@/lib/detail-view";

describe("revalidatedDraft", () => {
  it("replaces a clean box with the incoming draft", () => {
    expect(revalidatedDraft({ text: "a", saved: "a", agentBusy: false }, "b")).toEqual({ text: "b", saved: "b" });
  });
  it("keeps unsaved edits", () => {
    expect(revalidatedDraft({ text: "typed", saved: "a", agentBusy: false }, "b")).toBeNull();
  });
  it("never touches the box while the agent writes into it", () => {
    expect(revalidatedDraft({ text: "a", saved: "a", agentBusy: true }, "b")).toBeNull();
  });
  it("is a no-op when nothing changed", () => {
    expect(revalidatedDraft({ text: "a", saved: "a", agentBusy: false }, "a")).toBeNull();
  });
});

describe("sameRow", () => {
  const base = {
    tag: "Hot" as const,
    reason: "r",
    followUpDate: "2026-10-29",
    draft: "d",
    analysisStatus: "ready" as const,
    analysisStartedAt: null,
    lastContactDate: "2026-10-28",
    name: "n",
    company: "c",
    phone: "p",
  };
  it("detects equal and changed rows", () => {
    expect(sameRow(base, { ...base })).toBe(true);
    expect(sameRow(base, { ...base, analysisStartedAt: undefined as unknown as null })).toBe(true);
    expect(sameRow(base, { ...base, tag: "Cold" })).toBe(false);
    expect(sameRow(base, { ...base, draft: "x" })).toBe(false);
  });
});
