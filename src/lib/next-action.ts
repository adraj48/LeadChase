import type { FactSheet, Timeline } from "@/lib/draft-facts";

// The next best follow-up is decided here, by plain rules, and only carried out by
// the model. Pure and unit-tested. First matching rule wins.

export interface NextAction {
  goal: string;
  why: string;
  avoid: string[];
}

const ALWAYS_AVOID = ["inventing any fact, price, date or offer", "stock phrases"];

export function deriveNextAction(facts: FactSheet, timeline: Timeline, source = ""): NextAction {
  const avoid = (...more: string[]): string[] => [...more, ...ALWAYS_AVOID];
  const silentDays = timeline.daysSinceRepWrote;

  if (facts.buyerDecision === "declined") {
    return {
      goal: "Close politely in one short message that respects the buyer's decision. No push, no new pitch.",
      why: "the buyer declined or said they no longer need it",
      avoid: avoid("asking them to reconsider", "discounts or new offers", "asking questions"),
    };
  }
  if (facts.buyerDecision === "later") {
    return {
      goal: "Acknowledge the date or period the buyer gave and say you will get in touch then. If the buyer also asked for something specific, acknowledge that too. Offer nothing else.",
      why: "the buyer asked to be contacted later or said they will come back",
      avoid: avoid("pushing for a decision now", "new offers", "long messages"),
    };
  }
  if (facts.buyerDecision === "new") {
    return {
      goal: `Send a short first touch that mentions only where the lead came from${source ? ` (${source})` : ""} and the product interest, then ask one easy question.`,
      why: "there is no chat yet",
      avoid: avoid("claims about the company", "prices", "long introductions"),
    };
  }
  if (facts.whoSpokeLast === "buyer" && facts.openBuyerQuestions.length > 0) {
    return {
      goal: "Answer or acknowledge the buyer's exact open question first, using only known facts. If the chat does not contain the answer, say you will confirm and revert. Then one next step.",
      why: `the buyer asked something the rep has not replied to yet ("${facts.openBuyerQuestions[facts.openBuyerQuestions.length - 1].text}")`,
      avoid: avoid("guessing the answer", "changing the subject", "a timeframe the rep has not already used"),
    };
  }
  if (facts.dueToday && facts.whoSpokeLast === "buyer") {
    return {
      goal: "The buyer proposed talking on a day that is today. Say you are ready to talk today and ask what time suits them. If they said they needed something first (for example showing it to a partner), refer to that.",
      why: "the day the buyer proposed has arrived",
      avoid: avoid("offering other things", "long messages"),
    };
  }
  if (facts.buyerDecision === "ready-to-order") {
    return {
      goal: "Move to the single next practical step the chat supports (for example the payment or order details already discussed). Nothing new.",
      why: "the buyer sounds ready to order",
      avoid: avoid("re-selling", "new options", "extra questions"),
    };
  }
  if (facts.buyerDecision === "negotiating") {
    return {
      goal: "Acknowledge the buyer's exact number or concern in their own words and ask ONE clarifying question. Do not offer any concession.",
      why: "the buyer is pushing back on price or comparing options",
      avoid: avoid("discounts", "special price", "defending the price at length"),
    };
  }
  if (facts.buyerDecision === "silent" && timeline.unansweredFollowUps >= 2) {
    return {
      goal: "Keep it very short and give an easy out, for example ask whether they would like you to follow up later.",
      why: `the rep has written ${timeline.unansweredFollowUps} times since the buyer last replied`,
      avoid: avoid("another pitch", "pressure", "repeating earlier messages"),
    };
  }
  if (facts.buyerDecision === "silent" && timeline.quoteMoments.some((q) => q.from === "rep")) {
    return {
      goal: "One specific, low-pressure nudge about the quote the rep sent. Mention the exact quote (amount and product) and ask one easy question.",
      why: `the rep sent a quote and the buyer has been silent${silentDays !== null ? ` for ${silentDays} day(s)` : ""}`,
      avoid: avoid("just checking in", "discounts", "guilt"),
    };
  }
  if (facts.buyerDecision === "silent") {
    return {
      goal: "A short, specific restart that refers to the last thing discussed and asks one easy question.",
      why: "the buyer has not replied to the rep's last message",
      avoid: avoid("generic check-ins", "repeating the last message"),
    };
  }
  return {
    goal: "Acknowledge the buyer's last message and propose ONE next step that the chat already supports (a call, or sending details already discussed).",
    why: "the buyer is engaged and the next step is open",
    avoid: avoid("new offers", "more than one question"),
  };
}

export function renderNextAction(a: NextAction): string {
  return `NEXT BEST ACTION: ${a.goal} (why: ${a.why}). Avoid: ${a.avoid.join("; ")}.\nFollow this unless it conflicts with the facts.`;
}
