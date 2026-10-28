// Deterministic bulk sample data (no I/O, no Math.random, no Date.now). 126 generated leads
// that sit next to the 24 hand-written SEED_LEADS so the demo DB holds ~150 leads.
// Same conventions as seed-data.ts: every date is an integer day offset from "today" and
// followUpOffset = lastContactOffset + a gap that respects the tag clamp (Hot 0-1, Warm 2-5,
// Cold 7-14). tag/reason/draft are precomputed from each lead's own chat, so the demo never
// calls the LLM. Generated leads go to rep1/2/3/5 only; rep4 keeps her 5 hand-written leads.
// Drafts and chats avoid gendered Hindi verb forms (reps and buyers are mixed).
import type { Tag } from "../src/lib/types";
import { SEED_LEADS, type SeedLead, type SeedMessage } from "./seed-data";

export const BULK_SEED = 20261028;
export const BULK_COUNT = 126;
export const BULK_REP_EMAILS = ["rep1@axon.demo", "rep2@axon.demo", "rep3@axon.demo", "rep5@axon.demo"];

type Source = SeedLead["source"];
type Cat = "overdue" | "today" | "upcoming";
type Lang = "en" | "hi";

const GAP: Record<Tag, [number, number]> = { Hot: [0, 1], Warm: [2, 5], Cold: [7, 14] };

// ---------- seeded PRNG ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

// ---------- reference data ----------
interface Region { hi: number; m: string[]; f: string[]; s: string[] }
const REGIONS: Region[] = [
  { hi: 0.7, // North
    m: ["Rohit", "Ankit", "Manish", "Pankaj", "Vivek", "Gaurav", "Deepak", "Naveen", "Ashok", "Harish", "Mohit", "Vinod", "Tarun", "Sanjay"],
    f: ["Neha", "Pooja", "Ritu", "Anita", "Sunita", "Meena", "Kiran", "Seema", "Rekha", "Shweta", "Nisha", "Preeti"],
    s: ["Gupta", "Mittal", "Singhal", "Khanna", "Malhotra", "Chauhan", "Tyagi", "Saxena", "Kapoor", "Bansal", "Goel", "Arora", "Yadav", "Mishra", "Tiwari", "Pandey", "Dubey", "Rastogi", "Kohli", "Bhatia", "Chopra", "Sethi"] },
  { hi: 0.5, // West
    m: ["Hitesh", "Jignesh", "Nilesh", "Chirag", "Paresh", "Kunal", "Nitin", "Mahesh", "Prashant", "Yogesh", "Tushar", "Ketan"],
    f: ["Hetal", "Komal", "Dipika", "Mansi", "Pallavi", "Snehal", "Anjali", "Varsha", "Rupal"],
    s: ["Patel", "Shah", "Desai", "Joshi", "Kulkarni", "Deshmukh", "Patil", "Gaikwad", "Thakkar", "Modi", "Parekh", "Kothari", "Shinde", "Jadhav", "Pawar", "Bhosale", "More", "Vora"] },
  { hi: 0.1, // South
    m: ["Venkatesh", "Suresh", "Ramesh", "Karthik", "Srinivas", "Ganesh", "Arun", "Prakash", "Mohan", "Balaji", "Manoj", "Anil", "Raghavan"],
    f: ["Divya", "Revathi", "Meera", "Anitha", "Deepa", "Swathi", "Padma", "Kavya", "Sowmya", "Latha"],
    s: ["Iyer", "Rao", "Naidu", "Pillai", "Menon", "Nambiar", "Krishnan", "Subramanian", "Gowda", "Shetty", "Hegde", "Rajan", "Chandran", "Varghese", "Murthy", "Prasad", "Sundaram", "Ramaswamy"] },
  { hi: 0.5, // East
    m: ["Subhash", "Debashis", "Amitava", "Sourav", "Rajib", "Tapan", "Anirban", "Biswajit", "Pranab", "Manas", "Dipak"],
    f: ["Moumita", "Sharmila", "Rina", "Sudipta", "Mousumi", "Payel", "Rituparna", "Sonali"],
    s: ["Banerjee", "Chatterjee", "Mukherjee", "Ghosh", "Das", "Sen", "Dutta", "Roy", "Basu", "Saha", "Mondal", "Bhattacharya", "Chakraborty", "Sarkar", "Mohanty", "Pattnaik", "Bora", "Baruah", "Hazarika"] },
  { hi: 0.6, // Punjab
    m: ["Harpreet", "Gurpreet", "Jaspreet", "Manpreet", "Amarjeet", "Navneet", "Balwinder", "Surinder", "Kuldeep"],
    f: ["Simran", "Jasleen", "Gurleen", "Amandeep", "Harleen", "Rupinder"],
    s: ["Sandhu", "Grewal", "Gill", "Bedi", "Walia", "Sidhu", "Dhillon", "Bajwa", "Randhawa", "Sodhi", "Bhullar", "Kang"] },
];

const BRANDS = [
  "Shree Ganesh", "Sai Krupa", "Annapurna", "Kaveri", "Ganga", "Himalayan", "Deccan", "Malwa", "Konkan", "Bharat",
  "Nutan", "Surya", "Anand", "Om Sai", "Jai Mata", "Navkar", "Krishna", "Gokul", "Maruti", "Tirupati",
  "Vaishnavi", "Satyam", "Pragati", "Utkarsh", "Sagar", "Madhuban", "Swad", "Amrit", "Kesar", "Rajdhani",
  "Nilgiri", "Godavari", "Narmada", "Yamuna", "Sahyadri", "Aravali", "Vindhya", "Chenab", "Brahmaputra", "Mahalaxmi",
  "Shakti", "Vijay", "Ujjwal", "Prerna", "Samarth", "Tulsi", "Kamdhenu", "Ruchi", "Swastik", "Lakshya",
];

const SUFFIXES = ["Pvt Ltd", "Pvt Ltd", "Industries", "& Co", "LLP", "Enterprises", ""];

interface Product { name: string; unit: string; qty: [number, number, number]; price: [number, number, number] }
const POUCH: Product = { name: "pouch form-fill-seal machine", unit: "pouches per hour", qty: [1200, 6000, 300], price: [320000, 950000, 5000] };
const STRAP: Product = { name: "strapping machine", unit: "bundles per hour", qty: [150, 600, 50], price: [55000, 180000, 500] };
const SHRINK: Product = { name: "shrink wrap tunnel", unit: "packs per hour", qty: [300, 1200, 100], price: [85000, 240000, 5000] };
const CARTON: Product = { name: "carton sealer", unit: "cartons per shift", qty: [400, 1500, 100], price: [70000, 290000, 5000] };
const LBAR: Product = { name: "L-bar sealer", unit: "packs per hour", qty: [200, 600, 50], price: [45000, 140000, 500] };
const FLOW: Product = { name: "flow wrap machine", unit: "packs per minute", qty: [40, 120, 10], price: [250000, 650000, 5000] };
const BAND: Product = { name: "band sealer", unit: "pouches per hour", qty: [800, 2500, 100], price: [28000, 70000, 500] };

interface Industry { word: string; goods: string[]; prods: Product[] }
const INDUSTRIES: Industry[] = [
  { word: "Foods", goods: ["namkeen", "ready-mix packs", "frozen snacks", "papad"], prods: [POUCH, FLOW, BAND] },
  { word: "Masala", goods: ["masala powders", "whole spices"], prods: [POUCH, BAND] },
  { word: "Pharma Labs", goods: ["tablet cartons", "ointment cartons", "syrup boxes"], prods: [CARTON, SHRINK, LBAR] },
  { word: "Healthcare", goods: ["surgical item packs", "sanitiser cartons"], prods: [LBAR, CARTON, FLOW] },
  { word: "Textiles", goods: ["shirt packs", "towel bundles", "fabric rolls"], prods: [STRAP, SHRINK] },
  { word: "Garments", goods: ["garment polybags", "hosiery packs"], prods: [SHRINK, LBAR, BAND] },
  { word: "Logistics", goods: ["outbound cartons", "palletised bundles"], prods: [STRAP, CARTON] },
  { word: "Dairy", goods: ["paneer packs", "ghee pouches", "curd cups"], prods: [POUCH, SHRINK, FLOW] },
  { word: "Beverages", goods: ["bottle multipacks", "juice cartons"], prods: [SHRINK, CARTON, STRAP] },
  { word: "Bakery", goods: ["biscuit packs", "rusk packs", "cake boxes"], prods: [FLOW, CARTON, LBAR] },
  { word: "Agro Products", goods: ["rice bags", "pulses packs", "tea packs"], prods: [POUCH, STRAP, BAND] },
  { word: "Cosmetics", goods: ["cream cartons", "soap boxes"], prods: [CARTON, LBAR, SHRINK] },
  { word: "Plastics", goods: ["moulded item bundles", "pipe bundles"], prods: [STRAP, SHRINK] },
  { word: "Stationery", goods: ["notebook bundles", "pen boxes"], prods: [SHRINK, STRAP, LBAR] },
  { word: "Ceramics", goods: ["tile cartons"], prods: [STRAP, CARTON] },
  { word: "Tea Co", goods: ["tea packets"], prods: [POUCH, FLOW, CARTON] },
  { word: "Sweets", goods: ["sweet boxes", "mithai packs"], prods: [CARTON, SHRINK, LBAR] },
  { word: "Pickles", goods: ["pickle pouches"], prods: [POUCH, BAND] },
  { word: "Oils", goods: ["edible oil pouches"], prods: [POUCH] },
  { word: "Nutrition", goods: ["protein powder sachets"], prods: [POUCH, CARTON, FLOW] },
];

const REFERRERS = ["Suresh", "Mahesh", "Anil", "Rakesh", "Dinesh", "Ramesh", "Vijay", "Kamal", "Naresh", "Girish"];

// ---------- formatting ----------
function inr(n: number): string {
  if (n >= 100000) {
    return `Rs ${parseFloat((n / 100000).toFixed(2))} lakh`;
  }
  return `Rs ${Math.floor(n / 1000)},${String(n % 1000).padStart(3, "0")}`;
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const pad2 = (n: number) => String(n).padStart(2, "0");

const SRC_NOUN: Record<Source, Record<Lang, string>> = {
  IndiaMART: { en: "your IndiaMART enquiry", hi: "aapki IndiaMART enquiry" },
  Website: { en: "your website enquiry", hi: "aapki website enquiry" },
  Referral: { en: "the referral we received", hi: "referral" },
  "Trade show": { en: "your visit to our stall at the trade show", hi: "trade show mein hui mulaqat" },
  "Cold call": { en: "our recent call", hi: "hamari call" },
};
const INQ: Record<"IndiaMART" | "Website", Record<Lang, string>> = {
  IndiaMART: { en: "I saw your listing on IndiaMART", hi: "IndiaMART pe aapki listing dekhi" },
  Website: { en: "I filled the enquiry form on your website", hi: "website pe enquiry form bharaya tha" },
};

// ---------- per-lead context and scenarios ----------
interface Ctx {
  lang: Lang;
  inbound: boolean;
  vars: Record<string, string>;
}
type Say = (en: string[], hi: string[]) => string; // language-matched, placeholders filled
type En = (en: string[]) => string; // English only (reasons)
interface Built { core: string[]; reason: string; draft: string } // core starts with a rep message and alternates
interface Scenario {
  id: string;
  tag: Tag;
  chat: boolean;
  sources: Source[];
  last: [number, number];
  inboundOK: boolean; // inbound opening is 3 messages, so cores longer than 3 only fit outbound
  build: (s: Say, e: En, R: Rng) => Built;
}

const QUOTE = (s: Say) =>
  s(
    ["Thanks. For that output our {prod} is {price} + GST. Quote attached.", "For {qty} the {prod} suits well. Price is {price} + GST, quote shared.", "Sharing the quote: {prod} at {price} + GST."],
    ["Theek hai. Is output ke liye hamari {prod} {price} + GST mein aati hai. Quote bhej diya.", "{qty} ke liye {prod} sahi rahegi. Price {price} + GST, quote share kar diya hai.", "Quote share kiya hai: {prod}, {price} + GST."],
  );

const SCENARIOS: Scenario[] = [
  // ---- Hot: buyer showed a buying signal in the last two days, rep owes the next move ----
  {
    id: "ready_to_order", tag: "Hot", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-2, 0], inboundOK: true,
    build: (s, e) => ({
      core: [
        QUOTE(s),
        s(
          ["Price is fine. We are ready to order. What is the delivery time?", "Quote approved by our team. Please tell the earliest delivery date and we will place the order.", "OK with {price}. We want to confirm the order, when can it be delivered?"],
          ["Price theek hai. Order karne ko ready hain, delivery kab tak hogi?", "Quote approve ho gaya. Delivery date bataiye, order de denge.", "{price} chalega. Order confirm karna hai, delivery kitne din mein?"],
        ),
      ],
      reason: e(["Quote accepted and buyer is ready to order; asked for a delivery date, reply pending.", "Buyer approved the {price} quote and wants delivery date to place the order."]),
      draft: s(
        ["Hello {first}, thanks for approving the quote for the {prod}. I am checking the earliest delivery date with our dispatch team and will share it with you shortly. Shall I send the proforma invoice meanwhile?"],
        ["Namaste {addr}, {prod} ke quote ko approve karne ke liye dhanyavaad. Delivery date hum dispatch team se confirm karke batate hain. Tab tak proforma invoice bhej dein?"],
      ),
    }),
  },
  {
    id: "demo_before_order", tag: "Hot", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-2, 0], inboundOK: true,
    build: (s, e) => ({
      core: [
        QUOTE(s),
        s(
          ["Price looks fine. Before ordering we want to see the machine running. Can you arrange a demo this week?", "Quote is okay. Can we get a live demo of the {prod} before we decide?"],
          ["Price theek hai. Order se pehle machine chalti hui dekhni hai, is hafte demo mil jayega kya?", "Quote okay hai. Decide karne se pehle {prod} ka live demo mil jayega kya?"],
        ),
      ],
      reason: e(["Quote seems acceptable; buyer wants a live demo before ordering and is waiting for a slot.", "Asked for a live demo of the {prod} before ordering; our reply on the slot is pending."]),
      draft: s(
        ["Hello {first}, happy to arrange a live demo of the {prod}. Which day works for you? I will confirm the slot with our team once you reply."],
        ["Namaste {addr}, {prod} ka live demo arrange kar dete hain. Aapko kaunsa din theek rahega? Aapke batane par hum team se slot confirm kar lete hain."],
      ),
    }),
  },
  {
    id: "negotiation_close", tag: "Hot", chat: true, sources: ["Referral", "Trade show", "Cold call"], last: [-2, 0], inboundOK: false,
    build: (s, e) => ({
      core: [
        QUOTE(s),
        s(
          ["If you can do {counter}, we will finalise the order.", "Can you bring it down to {counter}? We will order right away."],
          ["Agar {counter} kar do to order final karte hain.", "{counter} mein ho jaye to turant order denge."],
        ),
        s(
          ["OK, we can do {counter} if you confirm the order this week.", "Fine, {counter} works for us. Please confirm the order this week."],
          ["Theek hai, order is hafte confirm ho to {counter} kar denge.", "Chalega, {counter} pe kar dete hain. Order is hafte confirm kar dijiye."],
        ),
        s(
          ["Done, we confirm. Please send the proforma invoice and the delivery date.", "Agreed at {counter}. Send PI and tell us the delivery schedule."],
          ["Done, confirm hai. Proforma invoice aur delivery date bhej dijiye.", "{counter} pe agree. PI aur delivery schedule bataiye."],
        ),
      ],
      reason: e(["Agreed at {counter} and confirmed the order; waiting for proforma invoice and delivery date."]),
      draft: s(
        ["Hello {first}, thank you for confirming at {counter}. I am preparing the proforma invoice for the {prod} and checking the delivery date, and will send both soon."],
        ["Namaste {addr}, {counter} pe confirm karne ke liye dhanyavaad. {prod} ka proforma invoice taiyar karke delivery date ke saath bhejte hain."],
      ),
    }),
  },
  {
    id: "payment_ready", tag: "Hot", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-2, 0], inboundOK: true,
    build: (s, e) => ({
      core: [
        QUOTE(s),
        s(
          ["Director has approved. Please send the proforma invoice with bank details for the advance.", "We are placing the order. Share PI and bank details for advance payment."],
          ["Director ne approve kar diya. Advance ke liye proforma invoice aur bank details bhejiye.", "Order de rahe hain. PI aur advance ke liye bank details share kijiye."],
        ),
      ],
      reason: e(["Approved the {price} quote and asked for proforma invoice and bank details; order imminent."]),
      draft: s(
        ["Hello {first}, thanks for the go-ahead on the {prod} at {price}. Sending the proforma invoice with bank details now. Please confirm once the advance is made."],
        ["Namaste {addr}, {price} mein {prod} ke go-ahead ke liye dhanyavaad. Proforma invoice aur bank details bhej rahe hain. Advance hone par confirm kar dijiye."],
      ),
    }),
  },

  // ---- Warm ----
  {
    id: "fresh_enquiry", tag: "Warm", chat: true, sources: ["IndiaMART", "Website"], last: [-3, 0], inboundOK: true,
    build: (s, e) => ({
      core: [],
      reason: e(["New {src} enquiry for {prod}, {qty}; buyer is waiting for our quote.", "Shared requirement of {qty} from {src}; quote for {prod} not sent yet."]),
      draft: s(
        ["Hello {first}, thanks for sharing your requirement. For {qty}, I am preparing the quote for the {prod} and will send it shortly along with the specifications."],
        ["Namaste {addr}, requirement share karne ke liye dhanyavaad. {qty} ke liye {prod} ka quote aur specifications jald bhej dete hain."],
      ),
    }),
  },
  {
    id: "quote_silent", tag: "Warm", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-8, -3], inboundOK: true,
    build: (s, e) => ({
      core: [QUOTE(s)],
      reason: e(["Quote of {price} sent {ago} days ago; no reply from buyer yet.", "No response for {ago} days since we sent the {price} quote."]),
      draft: s(
        ["Hello {first}, just checking if you could look at the quote of {price} for the {prod}. Happy to answer any questions.", "Hi {first}, did you get a chance to review the {price} quote for the {prod}? Let me know if anything is unclear."],
        ["Namaste {addr}, {prod} ke {price} wale quote ke baare mein poochna tha. Koi sawal ho to bata dijiye.", "Hello {addr}, {price} ka quote dekh liya? Kuch samajhna ho to bata dijiye."],
      ),
    }),
  },
  {
    id: "demo_video", tag: "Warm", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-6, -2], inboundOK: true,
    build: (s, e) => ({
      core: [
        QUOTE(s),
        s(["Thanks. Do you have a demo video of the {prod} running?", "Quote received. Is there a video of the {prod} in operation?"], ["Thanks. {prod} ke chalne ka koi demo video hai?", "Quote mil gaya. Machine ka koi running video hai kya?"]),
        s(["Yes, sharing the demo video link. Please watch and tell us what you think.", "Sending the demo video now, do check it."], ["Haan, demo video bhej diya hai. Dekh ke bataiye.", "Video link share kar diya, dekhiye aur batayiye."]),
      ],
      reason: e(["Asked for a demo video; we sent it and the buyer has not responded since."]),
      draft: s(
        ["Hello {first}, did you get a chance to watch the demo video of the {prod}? Let me know if you have questions or want to discuss the {price} quote."],
        ["Namaste {addr}, {prod} ka demo video dekha? Koi sawal ho ya {price} ke quote par baat karni ho to bata dijiye."],
      ),
    }),
  },
  {
    id: "tradeshow_followup", tag: "Warm", chat: true, sources: ["Trade show"], last: [-6, -1], inboundOK: false,
    build: (s, e) => ({
      core: [
        s(["Thanks. Sharing the brochure and quote: {prod} at {price} + GST.", "Sending the brochure with the quote for the {prod}, {price} + GST."], ["Shukriya. Brochure aur quote bhej diya: {prod}, {price} + GST.", "Brochure ke saath {prod} ka quote share kiya hai, {price} + GST."]),
        s(["Received. We will discuss internally and get back.", "Got it, we will review with our partner and revert."], ["Mil gaya. Internally discuss karke batate hain.", "Dekh lete hain, partner se baat karke batate hain."]),
      ],
      reason: e(["Met at trade show; got brochure and {price} quote; buyer reviewing internally, no decision yet."]),
      draft: s(
        ["Hello {first}, hope the brochure and quote for the {prod} were useful after the show. Any questions from your internal discussion?"],
        ["Namaste {addr}, show ke baad {prod} ka brochure aur quote kaam aaya hoga. Internal discussion mein koi sawal aaya to bata dijiye."],
      ),
    }),
  },
  {
    id: "referral_catalogue", tag: "Warm", chat: true, sources: ["Referral"], last: [-4, 0], inboundOK: false,
    build: (s, e) => ({
      core: [
        s(["Sharing our catalogue with a few models for {goods}. Tell me which suits you.", "Here is our catalogue, there are some models for {goods}. Please have a look."], ["Catalogue share kar rahe hain, {goods} ke liye kuch models hain. Dekh ke bataiye kaunsa suit karega.", "Hamara catalogue yeh raha, {goods} ke liye models hain. Ek nazar dal lijiye."]),
        s(["Got the catalogue. Two models look good. Please send the prices.", "Catalogue received. Send me the price list for the models."], ["Catalogue mil gaya, do models achhe lage. Price bhejiye.", "Catalogue aa gaya. Models ka price list bhejiye."]),
      ],
      reason: e(["Referred by {ref}; liked the catalogue and asked for prices; price list still pending from us."]),
      draft: s(
        ["Hello {first}, thanks for going through the catalogue. I will send the price list for the {prod} range covering {qty}. Let me know if you want anything else included."],
        ["Namaste {addr}, catalogue dekhne ke liye dhanyavaad. {qty} ke hisaab se {prod} range ka price list bhej dete hain. Kuch aur chahiye to bata dijiye."],
      ),
    }),
  },
  {
    id: "price_pushback", tag: "Warm", chat: true, sources: ["Referral", "Trade show", "Cold call"], last: [-5, -1], inboundOK: false,
    build: (s, e) => ({
      core: [
        QUOTE(s),
        s(["Price is a bit high for us. Another supplier is quoting less.", "{price} is above our budget. Can you reduce?"], ["Price thoda zyada hai. Ek aur supplier ka rate kam hai.", "{price} budget se upar hai. Kuch kam ho jayega kya?"]),
        s(["Understood. Let me check with my manager if anything can be done on the price.", "I will check with my manager if we can improve the price."], ["Samajh gaye. Manager se check karke batate hain, price par kuch ho paye to.", "Manager se poochte hain, price improve hoga ya nahi."]),
        s(["OK. We will discuss with our partner and tell you.", "Fine, let us talk to our partner and revert."], ["Theek hai. Partner se baat karke batate hain.", "Chalega, partner se discuss karke revert karenge."]),
      ],
      reason: e(["Buyer finds {price} quote high; we owe a price review while they discuss with partner."]),
      draft: s(
        ["Hello {first}, I am still reviewing the price for the {prod} with my manager and will update you soon. Meanwhile, did your partner share any feedback?"],
        ["Namaste {addr}, {prod} ke price par manager ke saath review mein hai, jald update dete hain. Tab tak partner ka koi feedback aaya?"],
      ),
    }),
  },
  {
    id: "decision_pending", tag: "Warm", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-7, -2], inboundOK: true,
    build: (s, e) => ({
      core: [
        QUOTE(s),
        s(["Thanks, our boss is reviewing it. Will revert next week.", "Under review with the management, we will let you know."], ["Thanks, boss ke paas review mein hai. Agle hafte batayenge.", "Management ke paas review mein hai, jaldi batayenge."]),
      ],
      reason: e(["Quote of {price} under review with their management; buyer to revert, no reply yet."]),
      draft: s(
        ["Hello {first}, checking in on the review of the {prod} quote. Happy to join a quick call with your team if that helps in deciding."],
        ["Namaste {addr}, {prod} ke quote ke review ke baare mein poochna tha. Aapki team ke saath chhoti call ho sake to faisla karna aasaan hoga."],
      ),
    }),
  },
  {
    id: "warm_first_touch", tag: "Warm", chat: false, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-6, 0], inboundOK: true,
    build: (s, e) => ({
      core: [],
      reason: e(["New {src} lead for {prod}; no conversation yet, first contact due."]),
      draft: s(
        ["Hello {first}, this is Axon Packaging. We are following up on {srcNoun} regarding {aprod}. Could you share what you pack and the daily quantity so I can suggest the right model?"],
        ["Namaste {addr}, Axon Packaging se, {srcNoun} ke baare mein baat karni thi. Kya pack karte hain aur roz kitna quantity hai, bata dijiye to sahi {prod} suggest kar dete hain."],
      ),
    }),
  },

  // ---- Cold: buyer declined, postponed or went silent ----
  {
    id: "lost_interest", tag: "Cold", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-20, -3], inboundOK: true,
    build: (s, e, R) => {
      const v = R.int(0, 2);
      const buyer = [
        s(["We have already bought a machine from another supplier."], ["Humne dusre supplier se machine le li hai."]),
        s(["We are putting this project on hold. No requirement now."], ["Yeh project hold pe hai. Abhi requirement nahi hai."]),
        s(["Price is too high for us, we will not go ahead."], ["Price humare liye bahut zyada hai, aage nahi badhenge."]),
      ][v];
      const reason = [
        "Buyer already bought a machine elsewhere; no current requirement.",
        "Buyer put the project on hold; no requirement now.",
        "Buyer said {price} is too high and will not go ahead; no interest now.",
      ][v];
      const draft = [
        s(["Hello {first}, thanks for letting us know. If you need {aprod} or other packing equipment in future, we would be glad to help."], ["Namaste {addr}, bata dene ke liye shukriya. Aage kabhi {prod} ya packing equipment chahiye to hum madad ke liye taiyaar hain."]),
        s(["Hello {first}, understood on the project hold. Whenever it restarts, feel free to reach out about the {prod}."], ["Namaste {addr}, project hold ki baat samajh gaye. Jab bhi restart ho, {prod} ke liye bata dijiye."]),
        s(["Hello {first}, understood on the price. If your budget or requirement changes, I am happy to look at the {prod} again."], ["Namaste {addr}, price ki baat samajh gaye. Budget ya requirement badle to {prod} ke liye dobara dekh lenge."]),
      ][v];
      return { core: [QUOTE(s), buyer], reason: e([reason]), draft };
    },
  },
  {
    id: "quote_gone_silent", tag: "Cold", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-25, -8], inboundOK: true,
    build: (s, e, R) => {
      const long = R.next() < 0.5;
      const core = long
        ? [
            QUOTE(s),
            s(["Thanks, will check and let you know.", "Okay, we will look at it and revert."], ["Thanks, dekh ke batate hain.", "Theek hai, check karke revert karenge."]),
            s(["Hello {first}, any update on the quote?", "Hi {first}, just checking if you had a chance to look at the quote."], ["Namaste {addr}, quote par koi update?", "Hello {addr}, quote dekhne ka time mila kya?"]),
          ]
        : [QUOTE(s)];
      return {
        core,
        reason: e(long ? ["Buyer said they will check, then went silent; quote of {price} sent {ago} days ago."] : ["Quote of {price} sent {ago} days ago; buyer has gone silent since."]),
        draft: s(
          ["Hello {first}, I have not heard back about the {prod} quote of {price}. Is the requirement still on, or should I close this for now?"],
          ["Namaste {addr}, {prod} ke {price} wale quote par koi jawab nahi aaya. Requirement abhi hai ya hum is ko filhaal band kar dein?"],
        ),
      };
    },
  },
  {
    id: "postponed", tag: "Cold", chat: true, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-12, 0], inboundOK: true,
    build: (s, e, R) => {
      const v = R.int(0, 2);
      const buyer = [
        s(["Budget will come next quarter. Contact us then."], ["Budget agli quarter mein aayega. Tab contact kijiye."]),
        s(["We are not buying this financial year. Maybe next year."], ["Is financial year mein nahi le rahe. Shayad agle saal."]),
        s(["Season rush is on, we cannot think about a new machine now. Call after the season."], ["Abhi season ka rush hai, naye machine ke baare mein baad mein baat karenge."]),
      ][v];
      const reason = [
        "Buyer postponed purchase to next quarter; no active interest right now.",
        "Buyer not buying this financial year; may revisit next year.",
        "Buyer busy with season rush; asked to talk later, no active requirement.",
      ][v];
      const draft = [
        s(["Hello {first}, as you mentioned the budget comes next quarter, I will keep the {prod} details ready. Please tell me if the timing changes."], ["Namaste {addr}, aapne kaha tha budget agli quarter mein aayega, {prod} ki details taiyaar rakhte hain. Timing badle to bata dijiye."]),
        s(["Hello {first}, noted that you are not buying this financial year. I will check back later about the {prod}. Please reach out sooner if plans change."], ["Namaste {addr}, samajh gaye ki is financial year mein nahi le rahe. {prod} ke liye baad mein baat karenge. Plan badle to pehle bata dijiye."]),
        s(["Hello {first}, hope the season rush is going well. Whenever you are free, I can talk about the {prod}."], ["Namaste {addr}, season ke rush ke baad time mile to {prod} ke baare mein baat kar lenge."]),
      ][v];
      return { core: [QUOTE(s), buyer], reason: e([reason]), draft };
    },
  },
  {
    id: "cold_silent_no_chat", tag: "Cold", chat: false, sources: ["IndiaMART", "Website", "Referral", "Trade show", "Cold call"], last: [-25, -5], inboundOK: true,
    build: (s, e) => ({
      core: [],
      reason: e(["No reply or interest recorded since first {src} contact; low priority."]),
      draft: s(
        ["Hello {first}, following up on {srcNoun}. Is {aprod} still on your list at {co}? If not right now, I can check back later."],
        ["Namaste {addr}, {srcNoun} ke baare mein dobara contact kar rahe hain. {co} mein {prod} abhi list par hai kya? Nahi to baad mein dobara baat kar lenge."],
      ),
    }),
  },
];

// ---------- chat opening (ends with a buyer message sharing the requirement) ----------
function opening(s: Say, ctx: Ctx, src: Source): string[] {
  const b2 = s(
    ["We pack {goods}, about {qty}.", "Mostly {goods}. Need around {qty}.", "{goods}, roughly {qty}."],
    ["{goods} pack karne hain, lagbhag {qty}.", "{qty} chahiye, {goods} ke liye.", "{goods}. Approx {qty} hoga."],
  );
  if (ctx.inbound) {
    return [
      s(["Hi, {inq}. We need {aprod} for our {goods}. Please share details and price.", "Hello, {inq}. Looking for {aprod}. What are the specs and price?"], ["Namaste, {inq}. {goods} ke liye {prod} chahiye. Details aur price bhejiye.", "Hello, {inq}. {prod} ki zarurat hai, specs aur rate kya hai?"]),
      s(["Thanks for your enquiry {first}. What do you pack and what daily quantity do you need?", "Hello {first}, thanks for reaching out. To suggest the right {prod}, could you share your product and daily output?"], ["Namaste {addr}, enquiry ke liye dhanyavaad. Kya pack karna hai aur roz ka quantity kitna hai?", "Hello {addr}, sahi {prod} suggest karne ke liye product aur daily output bata dijiye."]),
      b2,
    ];
  }
  const intro: Record<string, [string[], string[]]> = {
    Referral: [
      ["Hello {first}, {ref} suggested I contact you about {aprod} for your packing line. Is that still on your list?", "Hi {first}, I got your name from {ref}. Axon Packaging makes {prod}s. Are you looking at one?"],
      ["Namaste {addr}, {ref} ne aapka reference diya tha, {prod} ke liye. Abhi requirement hai kya?", "Hello {addr}, {ref} se aapka naam mila. Axon Packaging {prod} banati hai, kya aapko chahiye?"],
    ],
    "Trade show": [
      ["Hello {first}, thanks for visiting the Axon stall. Sharing details of the {prod} we showed. What would you like to pack on it?", "Hi {first}, good to meet you at the show. You asked about the {prod}. What are you packing and in what quantity?"],
      ["Namaste {addr}, stall pe aane ke liye dhanyavaad. {prod} ke liye kya pack karna hai aur kitna quantity?", "Hello {addr}, show mein {prod} ke baare mein baat hui thi. Kya pack karte hain aur roz kitna?"],
    ],
    "Cold call": [
      ["Hello {first}, this is Axon Packaging, as discussed on our call, sharing a note on the {prod}. What do you pack and how much per day?", "Hi {first}, following our call earlier. Is {aprod} something {co} could use?"],
      ["Namaste {addr}, call par baat hui thi, {prod} ke baare mein. Kya pack karte hain aur roz kitna?", "Hello {addr}, call ke baad yeh message. {co} ke liye {prod} kaam aayegi kya?"],
    ],
  };
  const [en, hi] = intro[src];
  return [s(en, hi), b2];
}

// ---------- the builder ----------
interface Planned { tag: Tag; cat: Cat; chat: boolean }

function catOf(f: number): Cat {
  return f < 0 ? "overdue" : f === 0 ? "today" : "upcoming";
}

export function buildBulkLeads(seed: number = BULK_SEED): SeedLead[] {
  const R = makeRng(seed);

  // 1. Plan: tag x follow-up category x has-chat, then shuffle.
  const plan: Planned[] = [];
  const addGroup = (tag: Tag, counts: Record<Cat, number>, chats: number) => {
    const cats: Cat[] = [];
    (Object.keys(counts) as Cat[]).forEach((c) => { for (let i = 0; i < counts[c]; i++) cats.push(c); });
    R.shuffle(cats).forEach((cat, i) => plan.push({ tag, cat, chat: i < chats }));
  };
  addGroup("Hot", { overdue: 4, today: 11, upcoming: 10 }, 25);
  addGroup("Warm", { overdue: 12, today: 5, upcoming: 34 }, 30);
  addGroup("Cold", { overdue: 16, today: 3, upcoming: 31 }, 21);
  const order = R.shuffle(plan);

  const usedFullNames = new Set(SEED_LEADS.map((l) => l.name));
  const usedCompanies = new Set(SEED_LEADS.map((l) => l.company));
  const usedPhones = new Set(SEED_LEADS.map((l) => l.phone));
  const srcCount: Record<Source, number> = { IndiaMART: 0, Referral: 0, "Trade show": 0, Website: 0, "Cold call": 0 };

  return order.map((p, idx) => {
    // identity
    let region: Region, first: string, surname: string, name: string;
    let guard = 0;
    do {
      region = R.pick(REGIONS);
      first = R.next() < 0.5 ? R.pick(region.m) : R.pick(region.f);
      surname = R.pick(region.s);
      name = `${first} ${surname}`;
    } while (usedFullNames.has(name) && ++guard < 200);
    usedFullNames.add(name);

    const industry = R.pick(INDUSTRIES);
    let company: string;
    do {
      const base = R.next() < 0.45 ? surname : R.pick(BRANDS);
      const suffix = R.pick(SUFFIXES);
      company = `${base} ${industry.word}${suffix ? " " + suffix : ""}`;
    } while (usedCompanies.has(company) && ++guard < 400);
    usedCompanies.add(company);

    let phone: string;
    do { phone = `+91 90001 ${R.int(10000, 99999)}`; } while (usedPhones.has(phone));
    usedPhones.add(phone);

    // scenario, source and offsets (retry until a feasible (last, gap) exists for the planned category)
    let chosen: { sc: Scenario; src: Source; last: number; gap: number } | null = null;
    for (const sc of R.shuffle(SCENARIOS.filter((s) => s.tag === p.tag && s.chat === p.chat))) {
      const srcs = sc.sources.filter((x) => sc.inboundOK || (x !== "IndiaMART" && x !== "Website"));
      if (srcs.length === 0) continue;
      const combos: [number, number][] = [];
      for (let last = sc.last[0]; last <= sc.last[1]; last++) {
        for (let gap = GAP[p.tag][0]; gap <= GAP[p.tag][1]; gap++) {
          if (catOf(last + gap) === p.cat) combos.push([last, gap]);
        }
      }
      if (combos.length === 0) continue;
      const min = Math.min(...srcs.map((x) => srcCount[x]));
      const src = R.pick(srcs.filter((x) => srcCount[x] === min));
      const [last, gap] = R.pick(combos);
      chosen = { sc, src, last, gap };
      break;
    }
    if (!chosen) throw new Error(`bulk seed: no feasible scenario for ${p.tag}/${p.cat}/chat=${p.chat}`);
    const { sc, src, last, gap } = chosen;
    srcCount[src]++;

    // language and template variables
    const lang: Lang = R.next() < region.hi ? "hi" : "en";
    const prod = R.pick(industry.prods);
    const goods = R.pick(industry.goods);
    const qtyN = prod.qty[0] + R.int(0, Math.floor((prod.qty[1] - prod.qty[0]) / prod.qty[2])) * prod.qty[2];
    const priceN = roundTo(prod.price[0] + R.next() * (prod.price[1] - prod.price[0]), prod.price[2]);
    let counterN = roundTo(priceN * 0.95, prod.price[2]);
    if (counterN >= priceN) counterN = priceN - prod.price[2];
    const refName = R.pick(REFERRERS);
    const inbound = src === "IndiaMART" || src === "Website";
    const vars: Record<string, string> = {
      first,
      addr: lang === "hi" ? `${first} ji` : first,
      co: company,
      prod: prod.name,
      aprod: `${/^(L-|[aeiou])/i.test(prod.name) ? "an" : "a"} ${prod.name}`,
      goods,
      qty: `${qtyN} ${prod.unit}`,
      price: inr(priceN),
      counter: inr(counterN),
      ref: lang === "hi" ? refName : `Mr. ${refName}`,
      inq: inbound ? INQ[src as "IndiaMART" | "Website"][lang] : "",
      src: src === "IndiaMART" ? src : src.toLowerCase(),
      srcNoun: SRC_NOUN[src][lang],
      ago: String(-last),
    };
    const fill = (t: string) => {
      const out = t.replace(/\{(\w+)\}/g, (_m, k: string) => {
        if (!(k in vars)) throw new Error(`bulk seed: unknown placeholder {${k}} in "${t}"`);
        return vars[k];
      });
      return out.replace(/(^|[.?!] )([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
    };
    const s: Say = (en, hi) => fill(R.pick(lang === "en" ? en : hi));
    const e: En = (arr) => fill(R.pick(arr));
    const ctx: Ctx = { lang, inbound, vars };

    // chat
    let messages: SeedMessage[] = [];
    if (p.chat) {
      const built = sc.build(s, e, R);
      const open = opening(s, ctx, src);
      const texts = [...open, ...built.core];
      const firstFrom: "rep" | "buyer" = inbound ? "buyer" : "rep";
      const n = texts.length;
      if (n < 3 || n > 6) throw new Error(`bulk seed: ${sc.id} produced ${n} messages`);
      const days = new Array<number>(n);
      days[n - 1] = last;
      for (let k = n - 2; k >= 0; k--) days[k] = days[k + 1] - R.pick([0, 0, 1, 1, 1, 2, 3]);
      let prevDay = Number.NEGATIVE_INFINITY;
      let prevMin = 0;
      messages = texts.map((text, k) => {
        const from: "rep" | "buyer" = (k % 2 === 0) === (firstFrom === "rep") ? "rep" : "buyer";
        let minutes: number;
        if (days[k] === prevDay) minutes = prevMin + R.int(6, 40);
        else minutes = days[k] === 0 ? R.int(8 * 60 + 30, 9 * 60 + 30) : R.int(9 * 60, 17 * 60 + 30);
        prevDay = days[k];
        prevMin = minutes;
        return { from, dayOffset: days[k], time: `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`, text };
      });
      return finish(built.reason, built.draft);
    }
    const built = sc.build(s, e, R);
    return finish(built.reason, built.draft);

    function finish(reason: string, draft: string): SeedLead {
      return {
        name, company, phone, source: src,
        repEmail: BULK_REP_EMAILS[idx % BULK_REP_EMAILS.length],
        lastContactOffset: last, tag: p.tag, reason, followUpOffset: last + gap, draft, messages,
      };
    }
  });
}

export const BULK_LEADS: SeedLead[] = buildBulkLeads();
