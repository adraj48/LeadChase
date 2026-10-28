// Pure seed data (no I/O). Every date is an integer day offset from "today"
// (negative = past). tag/reason/followUpOffset/draft are precomputed so the
// demo never calls the LLM. followUpOffset = lastContactOffset + a gap that
// respects the tag clamp (Hot 0-1, Warm 2-5, Cold 7-14).
import type { Role, Tag } from "../src/lib/types";

export interface SeedRep {
  email: string;
  name: string;
  role: Role;
}

export interface SeedMessage {
  from: "rep" | "buyer";
  dayOffset: number; // <= 0
  time: string; // HH:MM, IST
  text: string;
}

export interface SeedLead {
  name: string;
  company: string;
  phone: string;
  source: "IndiaMART" | "Referral" | "Trade show" | "Website" | "Cold call";
  repEmail: string;
  lastContactOffset: number;
  tag: Tag;
  reason: string;
  followUpOffset: number;
  draft: string;
  messages: SeedMessage[];
}

export const SEED_REPS: SeedRep[] = [
  { email: "rep1@axon.demo", name: "Rajesh Verma", role: "rep" },
  { email: "rep2@axon.demo", name: "Priya Nair", role: "rep" },
  { email: "rep3@axon.demo", name: "Amit Sharma", role: "rep" },
  { email: "rep4@axon.demo", name: "Sneha Iyer", role: "rep" },
  { email: "rep5@axon.demo", name: "Vikram Singh", role: "rep" },
  { email: "owner@axon.demo", name: "Anand Mehta", role: "owner" },
];

const r = (dayOffset: number, time: string, text: string): SeedMessage => ({ from: "rep", dayOffset, time, text });
const b = (dayOffset: number, time: string, text: string): SeedMessage => ({ from: "buyer", dayOffset, time, text });

export const SEED_LEADS: SeedLead[] = [
  // ---- rep1 ----
  {
    name: "Sunil Agarwal", company: "Agarwal Foods Pvt Ltd", phone: "+91 90000 00001", source: "IndiaMART",
    repEmail: "rep1@axon.demo", lastContactOffset: -1, tag: "Hot", followUpOffset: 0,
    reason: "Asked delivery time for 4-head pouch machine, may order this week; partner still to review.",
    draft: "Namaste Sunil ji, kal ki baat ke hisaab se maine 3 hafte ka delivery slot hold kar liya hai. Aapke partner ke liye 2 minute ka machine video bhej raha hoon. Kya aaj shaam 5 baje 10 minute call kar sakte hain taaki order finalise ho jaaye?",
    messages: [
      r(-4, "11:05", "Namaste Sunil ji, Axon Packaging se. IndiaMART pe aapne pouch packing machine ki enquiry daali thi. Namkeen ke liye hai na?"),
      b(-4, "11:40", "Haan, namkeen 200g aur 500g pouch. Daily 3000 pouch chahiye."),
      r(-3, "10:10", "Samajh gaya. Hamari 4-head weigh-filler pouch machine 35 pouch/min chalti hai. Quote bhejta hoon."),
      b(-1, "18:20", "Quote mila. Price theek lag raha hai. Delivery kitne din mein hogi agar is hafte order de dein?"),
      r(-1, "18:45", "Normally 3 hafte. 50% advance pe slot block kar sakte hain."),
      b(-1, "19:05", "Ok, kal baat karte hain. Mere partner ko bhi dikhana hai."),
    ],
  },
  {
    name: "Rakesh Jain", company: "Jain Spices", phone: "+91 90000 00002", source: "IndiaMART",
    repEmail: "rep1@axon.demo", lastContactOffset: -4, tag: "Warm", followUpOffset: -1,
    reason: "Asked for demo video after price; rep sent it, no reaction for 4 days.",
    draft: "Rakesh ji, kya aapne band sealer ka demo video dekha? 1500 pouch per hour aaram se nikalta hai. Agar aap chahein to Jaipur ke ek masala customer se baat karwa sakta hoon jo yahi machine chalate hain. Kya main unka number bhej doon?",
    messages: [
      b(-7, "15:20", "Need sealing machine for masala pouches 50g 100g. Price?"),
      r(-7, "15:50", "Rakesh ji, continuous band sealer Rs 38,000 with date coder option. Aapko kitne pouch per hour chahiye?"),
      b(-6, "10:05", "Around 1500 per hour. Koi demo video hai?"),
      r(-4, "12:30", "Haan, video bhej raha hoon. Dekh ke bataiye."),
    ],
  },
  {
    name: "Sandeep Bhatt", company: "Bhatt Packaging Traders", phone: "+91 90000 00003", source: "Referral",
    repEmail: "rep1@axon.demo", lastContactOffset: -2, tag: "Warm", followUpOffset: 1,
    reason: "Liked two strapping models, wants dealer price list; trader so decision is slow.",
    draft: "Sandeep bhai, dono models ka dealer price list 12% margin ke saath ready hai. Main abhi WhatsApp pe bhej doon, ya aap email pe lena pasand karenge?",
    messages: [
      r(-4, "11:15", "Sandeep bhai, Jignesh ji ne aapka reference diya. Strapping machines resale ke liye dekh rahe hain?"),
      b(-4, "13:00", "Haan, hum traders hain, apne customers ko dena hai. Dealer margin kitna milega?"),
      r(-3, "10:40", "Dealer margin 12% hai. Catalogue bhej raha hoon."),
      b(-2, "16:10", "Catalogue mil gaya, 2 models pasand aaye. Dealer price list bhejo."),
    ],
  },
  {
    name: "Shalini Bose", company: "Bose Sweets", phone: "+91 90000 00004", source: "Cold call",
    repEmail: "rep1@axon.demo", lastContactOffset: -15, tag: "Cold", followUpOffset: -5,
    reason: "Cold call 15 days ago pitching carton sealing; no interest shown or reply since.",
    draft: "Hello Shalini ji, humne sweet boxes ke carton sealing ke baare mein baat ki thi. busy season mein kya sealing mein dikkat aati hai, ya main rush ke baad dobara contact karoon?",
    messages: [],
  },
  {
    name: "Bhavna Trivedi", company: "Trivedi Ayurveda", phone: "+91 90000 00005", source: "Referral",
    repEmail: "rep1@axon.demo", lastContactOffset: -1, tag: "Warm", followUpOffset: 2,
    reason: "Referred by Rakesh Jain yesterday; interested in herbal powder pouch packing.",
    draft: "Namaste Bhavna ji, Rakesh Jain ji ne aapka naam suggest kiya tha, herbal powders ki pouch packing ke liye. Kya hum kal subah 11 baje 10 minute baat kar sakte hain?",
    messages: [],
  },
  // ---- rep2 ----
  {
    name: "Dr. Kavita Reddy", company: "Reddy Pharma Labs", phone: "+91 90000 00006", source: "Trade show",
    repEmail: "rep2@axon.demo", lastContactOffset: -1, tag: "Hot", followUpOffset: 0,
    reason: "Quote within budget; asked for engineer visit this week; rep owes a visit date.",
    draft: "Good morning Dr. Reddy, our engineer is free in the next two days to visit your Jeedimetla unit. Which day and time suits you? He will carry a spec sheet to confirm the line height for the carton sealer.",
    messages: [
      r(-5, "10:00", "Good morning Dr. Reddy, thanks for visiting our stall. Sharing the auto carton sealing machine brochure."),
      b(-5, "14:30", "Received. We need to seal about 800 cartons per shift, carton size 300x200x150."),
      r(-3, "11:20", "Our CS-450 handles that at 20 cartons/min. Quote attached, Rs 2.85 lakh + GST."),
      b(-1, "17:05", "Quote is within budget. Can your engineer visit our Jeedimetla unit this week to check the line height?"),
      r(-1, "17:30", "Sure, I will check with the service team and confirm a day."),
    ],
  },
  {
    name: "Lakshmi Narayanan", company: "Sri Lakshmi Pickles", phone: "+91 90000 00007", source: "Referral",
    repEmail: "rep2@axon.demo", lastContactOffset: 0, tag: "Hot", followUpOffset: 0,
    reason: "Wants quote today with Chennai delivery before Pongal; leak-proof sealing is key.",
    draft: "Vanakkam sir, quote for the paste filler pouch machine with triple seal is on its way, delivered to Chennai in 3 weeks, well before Pongal. Shall I call you at 4 pm today to walk through it?",
    messages: [
      r(-2, "10:30", "Vanakkam sir, Suresh sir from Madurai suggested I contact you about pickle pouch packing."),
      b(-2, "12:10", "Yes, we need to pack 100g and 250g pickle in pouches. Oil leakage is the problem."),
      r(-1, "11:00", "Our paste filler with triple seal handles that. I can send a quote."),
      b(0, "09:30", "Please send quote today with delivery to Chennai. We want to start before Pongal."),
    ],
  },
  {
    name: "Rohit Saxena", company: "Saxena Biscuits", phone: "+91 90000 00008", source: "IndiaMART",
    repEmail: "rep2@axon.demo", lastContactOffset: 0, tag: "Hot", followUpOffset: 0,
    reason: "IndiaMART enquiry today for a biscuit flow-wrap quote; nobody has replied yet.",
    draft: "Namaste Rohit ji, Axon Packaging se. Maine aapki IndiaMART enquiry dekhi, biscuit flow-wrap machine ke liye. Sahi quote bhejne ke liye bata dein, aapka pack size aur daily output kitna hai?",
    messages: [],
  },
  {
    name: "Farhan Sheikh", company: "Sheikh Frozen Foods", phone: "+91 90000 00009", source: "IndiaMART",
    repEmail: "rep2@axon.demo", lastContactOffset: -16, tag: "Cold", followUpOffset: -4,
    reason: "IndiaMART enquiry 16 days ago; first message went unanswered.",
    draft: "Hi Farhan, aapne IndiaMART pe frozen food packing machines ke liye enquiry ki thi. Kya aap abhi bhi dekh rahe hain? Aur kaunsa product pack karte hain?",
    messages: [],
  },
  {
    name: "Tarun Khanna", company: "Khanna Pharma Packaging", phone: "+91 90000 00010", source: "Trade show",
    repEmail: "rep2@axon.demo", lastContactOffset: -2, tag: "Warm", followUpOffset: 1,
    reason: "Met at trade show two days ago; interested in pharma carton sealing; spec sheet pending.",
    draft: "Hi Tarun ji, great meeting you at the show. Our carton sealing spec sheet for pharma lines is attached. Which carton sizes do you run, so I can recommend the right model?",
    messages: [],
  },
  // ---- rep3 ----
  {
    name: "Mohammed Irfan", company: "Irfan Textiles", phone: "+91 90000 00011", source: "Trade show",
    repEmail: "rep3@axon.demo", lastContactOffset: -3, tag: "Warm", followUpOffset: 0,
    reason: "Likes the L-bar plus tunnel combo; waiting for travelling director's approval.",
    draft: "Irfan bhai, umeed hai director sahab ki trip achhi rahi. Jo L-bar tunnel combo ka quote bheja tha, uski delivery abhi 2 hafte mein ho jaati hai. Director sahab kab tak wapas aa rahe hain, taaki main usi hisaab se follow up karoon?",
    messages: [
      r(-8, "11:00", "Assalamualaikum Irfan bhai, shrink wrapping machine ki baat karni thi, trade show wali."),
      b(-8, "12:20", "Walaikum salaam. Haan, saree ke bundles wrap karne hain. Heat tunnel wali machine."),
      r(-5, "10:15", "L-bar sealer + tunnel combo, Rs 1.9 lakh. Quote WhatsApp kar diya."),
      b(-3, "19:00", "Dekha. Director sahab se approval lena hai, woh Dubai gaye hain. Wapas aate hi batata hoon."),
    ],
  },
  {
    name: "Vivek Malhotra", company: "Malhotra FMCG Distributors", phone: "+91 90000 00012", source: "Trade show",
    repEmail: "rep3@axon.demo", lastContactOffset: -5, tag: "Warm", followUpOffset: -1,
    reason: "Comparing our Rs 79k strapping quote against a Rs 72k competitor; will revert.",
    draft: "Vivek ji, price ke alawa ek baat: hamari 2 saal warranty aur Delhi NCR mein same-day service. Agar zarurat ho to main manager se Rs 7k ke gap par baat kar sakta hoon. Kya aapne quotes compare kar liye?",
    messages: [
      r(-9, "11:30", "Hi Vivek ji, Pack Expo mein milke achha laga. Carton bundles ke liye strapping line dekh rahe hain?"),
      b(-9, "15:00", "Yes. Competitor ne fully-auto ke liye 72k bola hai."),
      r(-7, "10:20", "Hamari Rs 79k hai, 2 saal warranty aur Delhi NCR mein local service ke saath."),
      b(-5, "17:45", "Hmm, 7k zyada hai. Ek baar compare karke batata hoon."),
    ],
  },
  {
    name: "Gurpreet Kaur", company: "Punjab Agro Foods", phone: "+91 90000 00013", source: "Website",
    repEmail: "rep3@axon.demo", lastContactOffset: 0, tag: "Hot", followUpOffset: 1,
    reason: "Requested a pouch packing quote on the website today; fresh buyer-initiated enquiry.",
    draft: "Hello Gurpreet ji, thanks for requesting a quote on our website. To send an accurate price, could you tell me the pouch size and how many pouches you pack per day?",
    messages: [],
  },
  {
    name: "Ramesh Chandra", company: "Chandra Textile Mills", phone: "+91 90000 00014", source: "Trade show",
    repEmail: "rep3@axon.demo", lastContactOffset: -7, tag: "Cold", followUpOffset: 3,
    reason: "Only swapped cards at the trade show a week ago; no conversation since.",
    draft: "Namaste Ramesh ji, hum trade show mein mile the. Axon textile bundles ke liye shrink wrap aur strapping machines banata hai. Kya main ek chhota brochure WhatsApp pe bhej doon?",
    messages: [],
  },
  {
    name: "Manoj Tiwari", company: "Tiwari Courier & Cargo", phone: "+91 90000 00015", source: "IndiaMART",
    repEmail: "rep3@axon.demo", lastContactOffset: -2, tag: "Warm", followUpOffset: 2,
    reason: "IndiaMART strapping enquiry; first quote sent two days ago, awaiting reaction.",
    draft: "Hello Manoj ji, maine do din pehle strapping machine ka quote bheja tha. Kya aapko quote ke baare mein koi sawaal hai?",
    messages: [],
  },
  // ---- rep4 ----
  {
    name: "Harpreet Singh Bedi", company: "Bedi Logistics", phone: "+91 90000 00016", source: "Website",
    repEmail: "rep4@axon.demo", lastContactOffset: -9, tag: "Hot", followUpOffset: -8,
    reason: "Agreed Rs 64,500 each for two machines, said he would confirm next day; silent 9 days.",
    draft: "Sat Sri Akal Bedi ji, aapne 2 strapping machines Rs 64,500 each pe final kiye the aur kal confirm karne wale the. Kya aap order confirm kar rahe hain? Bas haan ya na bata dein, to main dispatch plan kar loon.",
    messages: [
      b(-12, "10:10", "Strapping machine chahiye, PP strap, semi-automatic. Rate bhejo."),
      r(-12, "10:40", "Sardar ji, semi-auto strapping Rs 68,000 + GST, 1 saal warranty. Stock mein hai."),
      b(-11, "12:00", "Theek hai. Do machine lunga agar 5% discount mile."),
      r(-10, "11:25", "2 machine pe Rs 64,500 each final. Delivery 3 din mein."),
      b(-9, "18:30", "Ok done almost. Kal confirm karta hoon."),
    ],
  },
  {
    name: "Anjali Deshmukh", company: "Deshmukh Dairy", phone: "+91 90000 00017", source: "Website",
    repEmail: "rep4@axon.demo", lastContactOffset: -18, tag: "Cold", followUpOffset: -4,
    reason: "No reply since the quote 24 days ago despite two follow-ups; likely lost interest.",
    draft: "Hi Anjali, quote ke baad se aapki taraf se koi reply nahi aaya, to lagta hai abhi timing sahi nahi hai. Agar 1L bottle packs ki shrink wrapping abhi bhi plan mein hai, to main Rs 2.4 lakh ka rate hold kar sakti hoon. Kya plan abhi chal raha hai?",
    messages: [
      b(-24, "11:00", "Looking for shrink wrap machine for 1L milk bottle packs of 6."),
      r(-24, "11:35", "Hi Anjali, tunnel shrink machine Rs 2.4 lakh. Quote attached."),
      r(-21, "10:30", "Following up on the quote, any questions?"),
      r(-18, "10:45", "Anjali ji, just checking again. Happy to arrange a demo."),
    ],
  },
  {
    name: "Dinesh Patil", company: "Patil Cold Storage & Logistics", phone: "+91 90000 00018", source: "Cold call",
    repEmail: "rep4@axon.demo", lastContactOffset: -20, tag: "Cold", followUpOffset: -6,
    reason: "Single cold call 20 days ago pitching strapping; no response since.",
    draft: "Hello Dinesh ji, kuch hafte pehle maine aapke dispatch bay ke liye pallet strapping machines ke baare mein call kiya tha. Agar strapping abhi zaruri nahi hai to koi baat nahi. Kya ek chhoti price sheet bhejna theek rahega?",
    messages: [],
  },
  {
    name: "Aarti Joshi", company: "Joshi Ready Meals", phone: "+91 90000 00019", source: "Website",
    repEmail: "rep4@axon.demo", lastContactOffset: -4, tag: "Warm", followUpOffset: 0,
    reason: "Downloaded our sealing brochure from the website four days ago; no conversation yet.",
    draft: "Hello Aarti ji, maine dekha aapne hamara tray sealing brochure download kiya. Aap ready meals abhi trays mein pack karte hain ya pouches mein? Jawab milte hi sahi machine suggest karungi.",
    messages: [],
  },
  {
    name: "Kunal Shah", company: "Shah Plastics & Textiles", phone: "+91 90000 00020", source: "Trade show",
    repEmail: "rep4@axon.demo", lastContactOffset: -6, tag: "Warm", followUpOffset: -2,
    reason: "Asked for a shrink wrap brochure at the trade show six days ago; follow-up overdue.",
    draft: "Hi Kunal ji, kya shrink wrap brochure aap tak pahunch gaya? Aapke bundle ka size bata dein to main sahi tunnel size aur exact price share kar dungi. Aap kis size ke bundles pack karte hain?",
    messages: [],
  },
  // ---- rep5 ----
  {
    name: "Neha Gupta", company: "FreshBite Snacks", phone: "+91 90000 00021", source: "Cold call",
    repEmail: "rep5@axon.demo", lastContactOffset: -3, tag: "Cold", followUpOffset: 11,
    reason: "Capex frozen; buyer explicitly said not this year, suggested checking next year.",
    draft: "Hi Neha, koi pressure nahi, mujhe pata hai is saal capex on hold hai. Main FreshBite ko agle saal ke liye list mein rakhunga. Tab tak kya main ek one-page payback comparison bhej doon, hand packing versus pouch machine?",
    messages: [
      r(-6, "11:00", "Hi Neha, Axon Packaging here. Are you looking at pouch packing automation for FreshBite?"),
      b(-6, "11:45", "Hi. Currently we pack by hand and it works."),
      r(-3, "10:30", "Understood. Our machine pays back in around 8 months at your volume. Can I send a quote?"),
      b(-3, "12:15", "Honestly we have frozen all capex. Not this year, maybe check in the new year."),
    ],
  },
  {
    name: "Imran Qureshi", company: "Qureshi Garments Exports", phone: "+91 90000 00022", source: "IndiaMART",
    repEmail: "rep5@axon.demo", lastContactOffset: -1, tag: "Hot", followUpOffset: 0,
    reason: "Needs carton sealer before his export shipment; asked for bank details to pay advance.",
    draft: "Imran bhai, proforma invoice aur bank details bhej raha hoon, Rs 2.6 lakh + GST. Advance aate hi hum Tiruppur dispatch kar denge, shipment se pehle machine pahunch jayegi. Kya aap aaj advance bhej paayenge?",
    messages: [
      b(-3, "10:20", "Carton sealing machine price? Export cartons, 5 ply."),
      r(-3, "10:50", "Imran bhai, auto carton sealer with side belts 5 ply handle karta hai. Rs 2.6 lakh + GST."),
      b(-2, "14:00", "GST invoice mil jayega? Delivery Tiruppur tak kitne din mein?"),
      r(-2, "14:25", "Haan GST invoice milega. Delivery 10 din."),
      b(-1, "20:10", "Good. Shipment 2 hafte mein hai, uske pehle machine chahiye. Bank details bhejo, advance bhej dunga."),
    ],
  },
  {
    name: "Pooja Menon", company: "Menon Nutraceuticals", phone: "+91 90000 00023", source: "Cold call",
    repEmail: "rep5@axon.demo", lastContactOffset: -10, tag: "Cold", followUpOffset: 0,
    reason: "Busy with an audit; asked to be contacted in about 10 days, details by email.",
    draft: "Hello Pooja, hope the audit went smoothly. As discussed, sachet packing machine details are on email. Would a 15 minute call this week work to go through them?",
    messages: [
      r(-12, "11:10", "Hello Pooja, Axon Packaging here. Do you pack your nutraceutical sachets in-house?"),
      b(-12, "11:50", "Yes, we do, partly outsourced. Not looking right now, we have an audit running."),
      r(-10, "10:05", "No problem, shall I call after the audit?"),
      b(-10, "10:40", "Maybe in 10 days or so. Send details on email."),
    ],
  },
  {
    name: "Divya Pillai", company: "Pillai Agro Exports", phone: "+91 90000 00024", source: "Referral",
    repEmail: "rep5@axon.demo", lastContactOffset: -3, tag: "Warm", followUpOffset: 2,
    reason: "Customer referral; intro call three days ago, interested in spice pouch sealing.",
    draft: "Hello Divya ji, nice speaking with you a few days ago. I have put together two pouch sealing options for spice exports. May I send them to you today?",
    messages: [],
  },
];
