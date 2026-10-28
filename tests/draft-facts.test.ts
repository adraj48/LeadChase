import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  detectLanguage,
  extractFacts,
  knownAndUnknown,
  languageOfText,
} from "@/lib/draft-facts";

const TODAY = "2026-10-29";
const lead = { lastContactDate: "2026-10-27" };
type M = { from: "rep" | "buyer"; text: string; at: string };
const at = (day: number, time = "10:00") => `2026-10-${String(day).padStart(2, "0")}T${time}:00+05:30`;
const rep = (day: number, text: string): M => ({ from: "rep", text, at: at(day) });
const buyer = (day: number, text: string): M => ({ from: "buyer", text, at: at(day) });

describe("language", () => {
  it("english, hinglish and devanagari", () => {
    expect(languageOfText("Please send the quote for 2 machines")).toBe("english");
    expect(languageOfText("Quote mila. Delivery kitne din mein hogi?")).toBe("hinglish");
    expect(languageOfText("मुझे कोटेशन चाहिए")).toBe("hindi-devanagari");
    expect(languageOfText("1234 5678")).toBe("unknown");
  });
  it("a short Hinglish message counts", () => {
    expect(languageOfText("Rate kitna hai?")).toBe("hinglish");
  });
  it("uses the buyer's last message first, then the buyer's recent messages", () => {
    const msgs = [buyer(25, "Need sealing machine for masala pouches. Price?"), buyer(26, "Koi demo video hai?")];
    expect(detectLanguage(msgs)).toBe("hinglish");
    expect(detectLanguage([buyer(25, "Please send quote"), buyer(26, "Thanks, ok")])).toBe("english");
  });
  it("falls back to the rep's language, then unknown", () => {
    expect(detectLanguage([rep(25, "Namaste ji, quote bhej diya hai, dekhiye")])).toBe("hinglish");
    expect(detectLanguage([])).toBe("unknown");
  });
});

describe("extractFacts: prices, quantities, products, dates", () => {
  const msgs = [
    rep(25, "Sir, 2 pouch machine ka quote Rs 64,500 each, total Rs 1.29 lakh. Date coder option available."),
    buyer(26, "Ok. Delivery after 15 Nov chalega. Need 4-head carton sealer also, 500 pcs per hour."),
  ];
  const f = extractFacts(lead, msgs, TODAY);
  it("prices carry the message index and sender", () => {
    expect(f.prices.map((p) => [p.text, p.from, p.messageIndex])).toEqual([
      ["Rs 64,500", "rep", 1],
      ["Rs 1.29 lakh", "rep", 1],
    ]);
  });
  it("quantities", () => {
    expect(f.quantities.map((q) => q.text)).toEqual(expect.arrayContaining(["2 pouch", "4-head", "500 pcs"]));
  });
  it("products come from the fixed list", () => {
    expect(f.productsMentioned).toEqual(expect.arrayContaining(["pouch machine", "carton sealer", "date coder"]));
    expect(f.productsMentioned).not.toContain("strapping");
  });
  it("dates and relative timeframes", () => {
    expect(f.datesMentioned.map((d) => d.text)).toContain("15 Nov");
    const g = extractFacts(lead, [buyer(26, "Call me after 10 days or kal subah")], TODAY);
    expect(g.datesMentioned.map((d) => d.text)).toEqual(expect.arrayContaining(["after 10 days", "kal"]));
    // A relative timeframe is resolved from the day the message was written.
    expect(g.datesMentioned.find((d) => d.text === "after 10 days")?.resolved).toBe("2026-11-05");
    expect(extractFacts(lead, [buyer(28, "Will call tomorrow")], TODAY).datesMentioned[0].resolved).toBe("2026-10-29");
  });
  it("'kal' is tomorrow in a plan and yesterday in a past-tense sentence", () => {
    const k = (text: string) => extractFacts(lead, [buyer(28, text)], TODAY).datesMentioned.find((d) => d.text.toLowerCase() === "kal")?.resolved;
    expect(k("Ok, kal baat karte hain")).toBe("2026-10-29");
    expect(k("Kal aapne quote bheja tha")).toBe("2026-10-27");
  });
  it("a name like Hamari is not read as the month Mar", () => {
    const g = extractFacts(lead, [rep(25, "Hamari 4 head machine")], TODAY);
    expect(g.datesMentioned).toEqual([]);
  });
  it("a bare number is a price only next to a price word", () => {
    expect(extractFacts(lead, [rep(25, "Rate is 38000 per machine")], TODAY).prices.map((p) => p.text)).toEqual(["38000"]);
    expect(extractFacts(lead, [rep(25, "We need 3000 pouches daily")], TODAY).prices).toEqual([]);
  });
});

describe("extractFacts: promises", () => {
  it("collects rep promises only", () => {
    const f = extractFacts(
      lead,
      [rep(25, "Quote bhej raha hoon"), buyer(26, "Will send details tomorrow"), rep(27, "I will check and confirm the date"), rep(28, "Thanks")],
      TODAY,
    );
    expect(f.promisesByRep.map((p) => p.messageIndex)).toEqual([1, 3]);
  });
});

describe("extractFacts: open buyer questions", () => {
  it("a question with no rep message after it is open", () => {
    const f = extractFacts(lead, [rep(25, "Quote sent"), buyer(26, "Delivery kitne din mein hogi? Also send the catalogue.")], TODAY);
    expect(f.openBuyerQuestions.map((q) => q.text)).toEqual(expect.arrayContaining(["Delivery kitne din mein hogi?"]));
    expect(f.openBuyerQuestions.every((q) => q.messageIndex === 2)).toBe(true);
  });
  it("a question the rep wrote after is answered", () => {
    const f = extractFacts(lead, [buyer(25, "How much for 2 machines?"), rep(26, "Rs 20,000 each")], TODAY);
    expect(f.openBuyerQuestions).toEqual([]);
  });
  it("a plain statement is not a question", () => {
    const f = extractFacts(lead, [rep(25, "Quote sent"), buyer(26, "Price theek lag raha hai.")], TODAY);
    expect(f.openBuyerQuestions).toEqual([]);
  });
  it("a request such as 'Price bhejiye' counts", () => {
    const f = extractFacts(lead, [buyer(26, "Catalogue mil gaya. Price bhejiye.")], TODAY);
    expect(f.openBuyerQuestions).toHaveLength(1);
  });
});

describe("extractFacts: buyerDecision", () => {
  const d = (...m: M[]) => extractFacts(lead, m, TODAY).buyerDecision;
  it("new when there is no chat", () => expect(d()).toBe("new"));
  it("silent when the buyer never wrote, or the rep spoke last", () => {
    expect(d(rep(25, "Hello ji"))).toBe("silent");
    expect(d(buyer(25, "Send quote"), rep(26, "Sent"))).toBe("silent");
  });
  it("declined", () => {
    expect(d(rep(25, "Quote sent"), buyer(26, "Humne dusre supplier se machine le li hai."))).toBe("declined");
    expect(d(rep(25, "Quote sent"), buyer(26, "We are not interested anymore"))).toBe("declined");
  });
  it("later", () => {
    expect(d(rep(25, "Shall we close?"), buyer(26, "Busy with audit. Call me after 10 days."))).toBe("later");
    expect(d(rep(25, "Hi"), buyer(26, "Maybe in 10 days or so"))).toBe("later");
    // "kal" is tomorrow only on the day it was said (TODAY is the 29th).
    expect(d(rep(28, "Hi"), buyer(29, "Ok done almost. Kal confirm karta hoon."))).toBe("later");
    expect(d(rep(25, "Hi"), buyer(26, "Ok done almost. Kal confirm karta hoon."))).toBe("ready-to-order");
  });
  it("ready-to-order", () => {
    expect(d(rep(25, "Final Rs 36,000"), buyer(26, "Go ahead. Send bank details for advance."))).toBe("ready-to-order");
  });
  it("negotiating", () => {
    expect(d(rep(25, "Rs 11,000 each"), buyer(26, "Rate zyada hai, can you give a discount?"))).toBe("negotiating");
  });
  it("interested otherwise", () => {
    expect(d(rep(25, "Hi"), buyer(26, "Tell me about the 4-head machine"))).toBe("interested");
  });
});

describe("daysSinceLastMessage and who spoke last", () => {
  it("computes both", () => {
    const f = extractFacts(lead, [buyer(25, "Hi"), rep(27, "Hello")], TODAY);
    expect(f.whoSpokeLast).toBe("rep");
    expect(f.daysSinceLastMessage).toBe(2);
    expect(f.buyerLastMessage).toBe("Hi");
  });
  it("is null without a chat", () => {
    const f = extractFacts(lead, [], TODAY);
    expect(f.daysSinceLastMessage).toBeNull();
    expect(f.whoSpokeLast).toBeNull();
    expect(f.buyerLastMessage).toBeNull();
  });
});

describe("buildTimeline", () => {
  const msgs = [
    rep(20, "Quote Rs 38,000 for the sealer"),
    buyer(22, "Ok will see"),
    rep(25, "Any update?"),
    rep(27, "Following up again"),
  ];
  const f = extractFacts(lead, msgs, TODAY);
  const t = buildTimeline(lead, msgs, TODAY, f);
  it("dates and day counts", () => {
    expect(t.firstContact).toBe("2026-10-20");
    expect(t.lastBuyerDate).toBe("2026-10-22");
    expect(t.lastRepDate).toBe("2026-10-27");
    expect(t.daysSinceBuyerReplied).toBe(7);
    expect(t.daysSinceRepWrote).toBe(2);
  });
  it("quote moments", () => {
    expect(t.quoteMoments).toEqual([{ messageIndex: 1, date: "2026-10-20", from: "rep" }]);
  });
  it("unansweredFollowUps counts rep messages since the buyer last spoke", () => {
    expect(t.unansweredFollowUps).toBe(2);
    const b = buildTimeline(lead, [...msgs, buyer(28, "Yes")], TODAY, extractFacts(lead, [...msgs, buyer(28, "Yes")], TODAY));
    expect(b.unansweredFollowUps).toBe(0);
  });
  it("buyer who never replied: every rep message counts; no chat uses last contact", () => {
    const only = [rep(25, "Hello"), rep(26, "Hello again")];
    const tl = buildTimeline(lead, only, TODAY, extractFacts(lead, only, TODAY));
    expect(tl.unansweredFollowUps).toBe(2);
    expect(tl.daysSinceBuyerReplied).toBeNull();
    const empty = buildTimeline(lead, [], TODAY, extractFacts(lead, [], TODAY));
    expect(empty.firstContact).toBe("2026-10-27");
    expect(empty.unansweredFollowUps).toBe(0);
  });
});

describe("knownAndUnknown", () => {
  it("topics the chat never mentions are UNKNOWN", () => {
    const msgs = [rep(25, "Quote Rs 38,000, delivery 3 weeks, 50% advance"), buyer(26, "Ok")];
    const ku = knownAndUnknown(extractFacts(lead, msgs, TODAY), msgs);
    expect(ku.unknown).toEqual(expect.arrayContaining(["discount", "warranty", "installation", "stock"]));
    expect(ku.unknown).not.toContain("delivery time");
    expect(ku.unknown).not.toContain("payment terms");
    expect(ku.known.join(" ")).toContain("Rs 38,000");
  });
  it("an empty chat has everything unknown", () => {
    const ku = knownAndUnknown(extractFacts(lead, [], TODAY), []);
    expect(ku.unknown).toHaveLength(7);
    expect(ku.known).toEqual([]);
  });
});
