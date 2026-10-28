// Offline evaluation of the "Draft with agent" prompt. Builds the real prompt for 14
// seeded leads, calls Gemini (non-streaming), runs the fact check and prints what a
// sales manager needs to judge each reply. Reads seed files only: no database access.
// Not part of CI. Usage: npm run eval:draft   (needs GEMINI_API_KEY in .env.local).
import { config } from "dotenv";
import { addDays, todayIST } from "../src/lib/dates";
import { SEED_LEADS, SEED_REPS } from "./seed-data";
import { BULK_LEADS } from "./seed-bulk";
import { buildDraftPrompt, DRAFT_GENERATION_CONFIG } from "../src/lib/draft-prompt";
import { buildContext } from "../src/lib/draft-context";
import { findUngroundedFacts, needsRepair } from "../src/lib/draft-check";
import { sanitizeDraft } from "../src/lib/draft-stream";
import { geminiModel } from "../src/lib/agent";
import { deriveNextAction } from "../src/lib/next-action";

config({ path: ".env.local" });

// Diverse picks (index into hand-written + bulk leads): Hot/Warm/Cold, Hinglish and
// English, no chat, declined, later, ready to order, price objection, unanswered delivery.
const PICKS: [number, string][] = [
  [0, "Hot, Hinglish, buyer: 'kal baat karte hain'"],
  [1, "Warm, rep spoke last (demo video sent)"],
  [2, "Warm, Hinglish, asks dealer price list"],
  [6, "Hot, English, wants quote + delivery"],
  [11, "Warm, Hinglish price objection"],
  [15, "Hot, Hinglish, 'kal confirm karta hoon'"],
  [16, "Cold, English, rep followed up twice, no reply"],
  [20, "Cold, English, capex frozen"],
  [21, "Hot, Hinglish, ready to order, bank details"],
  [26, "Cold, Hinglish, bought from another supplier"],
  [33, "Hot, Hinglish, unanswered delivery-date question"],
  [51, "Hot, English, asks for live demo"],
  [3, "Cold, no chat yet"],
  [22, "Cold, English, 'maybe in 10 days'"],
];

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY is not set (put it in .env.local). Nothing was called.");
  process.exit(1);
}
const only = process.argv[2] ? process.argv[2].split(",").map(Number) : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generate(prompt: { systemInstruction: string; userContent: string }): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt.userContent }] }],
        generationConfig: DRAFT_GENERATION_CONFIG,
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch((e) => {
      console.error(`  (request failed: ${e instanceof Error ? e.name : "error"})`);
      return null;
    });
    if (!res) continue;
    if (res.status === 429 || res.status >= 500) {
      const wait = 12_000 * (attempt + 1);
      console.error(`  (HTTP ${res.status}, waiting ${wait / 1000}s)`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) return `<<HTTP ${res.status}>>`;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return sanitizeDraft((data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""));
  }
  return "<<gave up after retries>>";
}

interface Row {
  head: string;
  lines: string[];
}

async function evalOne(idx: number, label: string, today: string): Promise<Row> {
  const l = [...SEED_LEADS, ...BULK_LEADS][idx];
  const rep = SEED_REPS.find((r) => r.email === l.repEmail)?.name.split(" ")[0] ?? "the rep";
  const messages = l.messages.map((m) => ({
    from: m.from,
    text: m.text,
    at: `${addDays(today, m.dayOffset)}T${m.time}:00+05:30`,
  }));
  const lead = {
    name: l.name,
    company: l.company,
    source: l.source,
    tag: l.tag,
    reason: l.reason,
    lastContactDate: addDays(today, l.lastContactOffset),
    followUpDate: addDays(today, l.followUpOffset),
    draft: l.draft,
  };
  const input = { repFirstName: rep, lead, messages, todayIST: today };
  const ctx = buildContext(input);
  const next = deriveNextAction(ctx.facts, ctx.timeline, l.source);
  const checkCtx = { lead, messages, todayIST: today };
  const fmt = (text: string, problems: ReturnType<typeof findUngroundedFacts>) =>
    `  words=${text.split(/\s+/).filter(Boolean).length} problems=${problems.length ? problems.map((p) => `[${p.kind}] ${p.text}`).join(" | ") : "none"}`;

  const reply = await generate(buildDraftPrompt(input));
  const problems = findUngroundedFacts(reply, checkCtx);
  const lines = [
    `language=${ctx.facts.language} decision=${ctx.facts.buyerDecision} unanswered-follow-ups=${ctx.timeline.unansweredFollowUps}`,
    `NEXT: ${next.goal}`,
    `LAST BUYER: ${ctx.facts.buyerLastMessage ?? "(none)"}`,
    `REPLY: ${reply}`,
    fmt(reply, problems),
  ];
  if (needsRepair(problems)) {
    const fixed = await generate(buildDraftPrompt({ ...input, repair: problems.map((p) => p.text) }));
    lines.push(`REPAIRED: ${fixed}`, fmt(fixed, findUngroundedFacts(fixed, checkCtx)));
  }
  return { head: `=== #${idx} ${l.name} (${l.tag}) [${label}] rep=${rep}`, lines };
}

async function main() {
  const today = todayIST();
  const picks = PICKS.filter(([idx]) => !only || only.includes(idx));
  // One at a time and spaced out: the free tier allows only a few requests a minute,
  // and each result is printed as soon as it is ready.
  for (const [idx, label] of picks) {
    const r = await evalOne(idx, label, today);
    console.log(`\n${r.head}\n${r.lines.join("\n")}`);
    await sleep(Number(process.env.EVAL_GAP_MS ?? 8000));
  }
  console.log(`\nDone: ${picks.length} leads (model ${geminiModel()}).`);
}

main().catch((e) => {
  console.error("Eval failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
