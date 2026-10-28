import { describe, expect, it } from "vitest";
import { findUngroundedFacts, needsRepair, type DraftCheckContext } from "@/lib/draft-check";
import { extractNumberTokens } from "@/lib/number-tokens";

const lead = { name: "Ravi Sharma", company: "Sharma Foods", source: "IndiaMART", reason: "Asked for quote", lastContactDate: "2026-10-27", followUpDate: "2026-10-30" };
const mk = (texts: [("rep" | "buyer"), string][], today = "2026-10-29"): DraftCheckContext => ({
  lead,
  todayIST: today,
  messages: texts.map(([from, text], i) => ({ from, text, at: `2026-10-2${i}T10:00:00+05:30` })),
});
const chat = mk([
  ["rep", "Quote: 2 machines at Rs 64,500 each, total Rs 1.29 lakh. 10% advance. Delivery 3 din."],
  ["buyer", "Ok. Can you do it by 15 Nov? 5% discount milega kya?"],
]);
const texts = (d: string, ctx = chat) => findUngroundedFacts(d, ctx).filter((p) => p.kind === "grounding").map((p) => p.text);

describe("number tokens", () => {
  it("reads money, units, percentages, dates and grouped digits", () => {
    const t = (s: string) => extractNumberTokens(s).map((x) => [x.kind, x.value ?? x.dateKey]);
    expect(t("Rs 64,500")).toEqual([["money", 64500]]);
    expect(t("Rs. 2.4 lakh")).toEqual([["money", 240000]]);
    expect(t("2.4L")).toEqual([["number", 240000]]);
    expect(t("₹1,00,000")).toEqual([["money", 100000]]);
    expect(t("64 500")).toEqual([["number", 64500]]);
    expect(t("5%")).toEqual([["percent", 5]]);
    expect(t("15 Nov")).toEqual([["date", "15-11"]]);
    expect(t("2026-11-15")).toEqual([["date", "15-11"]]);
    expect(t("3 din")).toEqual([["number", 3]]);
    expect(t("B2B and PM250x")).toEqual([]);
    expect(t("5-10 days")).toEqual([["number", 5], ["number", 10]]);
  });
});

describe("grounding: numbers, prices, dates", () => {
  it("flags an unknown price, percentage, duration and date", () => {
    expect(texts("Rs 70,000 per machine")).toEqual(["Mentions Rs 70,000, which isn't in this chat"]);
    expect(texts("We can do 8% off")).toEqual(["Mentions 8%, which isn't in this chat"]);
    expect(texts("Delivery in 10 days")).toEqual(["Mentions 10 days, which isn't in this chat"]);
    expect(texts("Can deliver by 20 Nov")).toEqual(["Mentions 20 Nov, which isn't in this chat"]);
  });
  it("passes grounded numbers in other formats", () => {
    expect(texts("Rs 64,500 each, as quoted")).toEqual([]);
    expect(texts("₹64500 per machine")).toEqual([]);
    expect(texts("INR 64,500")).toEqual([]);
    expect(texts("Total 129000")).toEqual([]);
    expect(texts("Rs 1.29 lakh in total")).toEqual([]);
    expect(texts("About 1.29L")).toEqual([]);
    expect(texts("3 din mein delivery")).toEqual([]);
    expect(texts("On 15 Nov then")).toEqual([]);
    expect(texts("About the 5% discount")).toEqual([]);
  });
  it("today's date and the lead's own dates are given facts", () => {
    expect(texts("Let's talk on 30 Oct")).toEqual([]); // follow-up date
    expect(texts("Since 27 Oct we have been in touch")).toEqual([]); // last contact
    expect(texts("Today, 29 Oct, I will call")).toEqual([]);
    expect(texts("It is 2 days since we spoke")).toEqual([]); // "2 days ago" is in the prompt
  });
  it("does not let the day numbers of dates ground other numbers", () => {
    expect(texts("Rs 29,000 only")).toEqual(["Mentions Rs 29,000, which isn't in this chat"]);
    expect(texts("In 29 days")).toEqual(["Mentions 29 days, which isn't in this chat"]);
  });
  it("reports each token once", () => {
    expect(texts("Rs 70,000... yes Rs 70,000")).toHaveLength(1);
  });
  it("an empty draft has no problems", () => {
    expect(findUngroundedFacts("  ", chat)).toEqual([]);
  });
});

describe("grounding: offers", () => {
  const quiet = mk([["rep", "Hi, this is Axon"], ["buyer", "Need a pouch machine"]]);
  it("flags offers the chat never mentions", () => {
    for (const w of ["demo", "video", "discount", "free", "sample", "visit", "warranty", "stock", "special price"]) {
      const out = findUngroundedFacts(`We have ${w} for you`, quiet).map((p) => p.text);
      expect(out.some((o) => o.includes(`"${w}`)), w).toBe(true);
    }
    expect(texts("Any discount is not possible")).toEqual([]); // the chat mentions discount
  });
  it("does not flag 'feel free to talk' style uses of free", () => {
    expect(findUngroundedFacts("I am free to talk at any time", quiet)).toEqual([]);
  });
  it("flags agreeing to something only the buyer mentioned", () => {
    const c = mk([["rep", "Quote Rs 5 lakh"], ["buyer", "Can we get a live demo before we decide?"]]);
    const out = findUngroundedFacts("Sure, we can definitely arrange a live demo.", c);
    expect(out.map((p) => p.text)).toEqual(["Promises a demo that nobody on the rep's side has offered in this chat"]);
    expect(findUngroundedFacts("I will check with the team about the demo and revert.", c)).toEqual([]);
    const offered = mk([["rep", "I can arrange a demo"], ["buyer", "Yes please do the demo"]]);
    expect(findUngroundedFacts("We can arrange the demo on a call.", offered)).toEqual([]);
  });
});

describe("claims and forms of address", () => {
  const quiet = mk([["rep", "Hello Pooja, Axon Packaging here"], ["buyer", "Maybe in 10 days. Send details on email."]]);
  it("flags claiming something was sent when the chat doesn't show it", () => {
    expect(texts("I have sent the details to your email.", quiet)).toEqual(["Says something was already sent or shared, but the chat doesn't show that"]);
    expect(texts("Details bhej diye hain, dekhiye. Quote bhej diya.", quiet)).toHaveLength(1);
    expect(texts("Have you looked at the details I sent?", quiet)).toHaveLength(1);
    expect(texts("I'll send the details to your email.", quiet)).toEqual([]);
    expect(texts("I have sent the details.", mk([["rep", "Sending the brochure"], ["buyer", "ok"]]))).toEqual([]);
  });
  it("flags sir, madam and regional greetings nobody used", () => {
    const lang = (d: string, c = quiet) => findUngroundedFacts(d, c).filter((p) => p.kind === "language").map((p) => p.text);
    expect(lang("Vanakkam Lakshmi sir, I'll send the quote")).toEqual([
      'Uses "Vanakkam", which nobody in this chat has used',
    ]);
    expect(lang("Hi sir, ok")).toEqual(['Uses "sir", which nobody in this chat has used']);
    expect(lang("Vanakkam sir", mk([["rep", "Vanakkam sir, Suresh sent me"], ["buyer", "Yes please"]]))).toEqual([]);
  });
});

describe("gendered verbs and channels", () => {
  const c = mk([["rep", "Hi"], ["buyer", "Rate kitna hai? Bhej dijiye."]]);
  const lang = (d: string) => findUngroundedFacts(d, c).filter((p) => p.kind === "language").map((p) => p.text);
  it("flags gendered first-person verbs and accepts neutral ones", () => {
    expect(lang("Main abhi bhej deta hoon")).toHaveLength(1);
    expect(lang("Aapko batati hoon")).toHaveLength(1);
    expect(lang("Main kal bhejunga")).toHaveLength(1);
    expect(lang("Main call karungi")).toHaveLength(1);
    expect(lang("Abhi bhej dete hain, ho jayega, bata dijiye")).toEqual([]);
  });
  it("flags pretending to attach or paste something", () => {
    expect(texts("Imran bhai, ye rahi bank details.", c)).toHaveLength(1);
    expect(texts("Please find the quote attached.", c)).toHaveLength(1);
    expect(texts("Bank details abhi bhej dete hain.", c)).toEqual([]);
  });
  it("flags email or courier when the chat never mentions them", () => {
    expect(texts("I will send the quote to your email.", c)).toEqual(['Offers or mentions "email", which isn\'t in this chat']);
    expect(texts("I will send the quote here.", c)).toEqual([]);
    expect(texts("Sending it on email", mk([["buyer", "Send details on email"]]))).toEqual([]);
  });
});

describe("placeholders", () => {
  it("flags [..] and {..}", () => {
    expect(texts("Hi [Name], quote is ready")).toEqual(["Contains a placeholder ([Name]) to fill in"]);
    expect(texts("Hi {name}")).toEqual(["Contains a placeholder ({name}) to fill in"]);
  });
});

describe("language", () => {
  const eng = mk([["rep", "Hello Ravi"], ["buyer", "Please send the quote for the sealer"]]);
  const hing = mk([["rep", "Namaste ji"], ["buyer", "Quote mila. Delivery kitne din mein hogi?"]]);
  const dev = mk([["buyer", "मुझे कोटेशन चाहिए"]]);
  const kinds = (d: string, c: DraftCheckContext) => findUngroundedFacts(d, c).filter((p) => p.kind === "language").map((p) => p.text);
  it("Devanagari when the buyer wrote Roman", () => {
    expect(kinds("आपका धन्यवाद", eng)).toEqual(["Uses Devanagari script, but the buyer wrote in Roman script"]);
    expect(kinds("आपका धन्यवाद", dev)).toEqual([]);
  });
  it("Roman reply to a Devanagari buyer", () => {
    expect(kinds("Dhanyavaad ji", dev)).toEqual(["Is written in Roman script, but the buyer wrote in Devanagari"]);
  });
  it("English draft to a Hinglish buyer and the reverse", () => {
    expect(kinds("Thanks for your message, I will confirm the delivery date and let you know.", hing)).toEqual([
      "Is written in English, but the buyer wrote in Hinglish",
    ]);
    expect(kinds("Ji, delivery ki date confirm karke bata dete hain.", hing)).toEqual([]);
    expect(kinds("Ji, delivery ki date confirm karke bata dete hain.", eng)).toEqual(["Is written in Hinglish, but the buyer wrote in English"]);
    expect(kinds("Sure, will do.", hing)).toEqual([]); // very short English is fine
  });
  it("no buyer message yet: judged by the rep's language; Devanagari out of nowhere still flagged", () => {
    const none = mk([]);
    expect(kinds("आपका धन्यवाद", none)).toEqual(["Uses Devanagari script, but nobody in this chat did"]);
  });
});

describe("style", () => {
  const style = (d: string, c = chat) => findUngroundedFacts(d, c).filter((p) => p.kind === "style").map((p) => p.text);
  it("flags every forbidden stock phrase", () => {
    expect(style("I hope this finds you well. Kindly confirm.")).toEqual([
      "Uses a stock phrase (I hope this finds you well)",
      "Uses a stock phrase (kindly)",
    ]);
    expect(style("Great!! Thanks!")).toContain("Uses a stock phrase (exclamation marks)");
  });
  it("flags more than 60 words and more than 700 characters", () => {
    const long = Array(70).fill("word").join(" ");
    expect(style(long)).toEqual(["Is 70 words long, over the 60-word limit"]);
    expect(style("x".repeat(701))).toEqual(["Is 701 characters long, which is too long for WhatsApp"]);
  });
  it("flags a long reply to a very short buyer message", () => {
    const c = mk([["rep", "Quote sent"], ["buyer", "Ok will check"]]);
    expect(style(Array(40).fill("word").join(" "), c)).toEqual(["Is 40 words long for a 3-word buyer message"]);
    expect(style(Array(20).fill("word").join(" "), c)).toEqual([]);
  });
});

describe("needsRepair", () => {
  it("only grounding and language problems trigger a rewrite", () => {
    expect(needsRepair([{ kind: "style", text: "x" }])).toBe(false);
    expect(needsRepair([{ kind: "style", text: "x" }, { kind: "grounding", text: "y" }])).toBe(true);
    expect(needsRepair([{ kind: "language", text: "z" }])).toBe(true);
    expect(needsRepair([])).toBe(false);
  });
});
