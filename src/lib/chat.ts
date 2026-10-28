import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Message } from "@/lib/types";
import { addMessage, beginAnalysis, finishAnalysis, getLead, markReady, saveAnalysis } from "@/lib/repo";
import { analyzeLead, fallbackAnalysis, type AgentInput } from "@/lib/agent";
import { todayIST } from "@/lib/dates";
import { HttpError } from "@/lib/http";
import { stageTimer, withTripCounter } from "@/lib/timing";

// Synchronous path: re-analyze the full chat, persist the result and return the
// re-read chat. Only used while the database lacks the analysis_status columns
// (before the realtime_analysis migration is applied); the fast path below is the
// normal one.
export async function reanalyze(sb: SupabaseClient, id: string, lastContactDate?: string) {
  const chat = await getLead(sb, id);
  if (!chat) throw new HttpError(404, "Lead not found");
  const analysis = await analyzeLead({
    lead: {
      name: chat.lead.name,
      company: chat.lead.company,
      source: chat.lead.source,
      lastContactDate: lastContactDate ?? chat.lead.lastContactDate,
    },
    messages: chat.messages.map((m) => ({ from: m.from, text: m.text, at: m.at })),
    today: todayIST(),
    repName: chat.lead.repName,
    previousTag: chat.lead.tag,
  });
  if (!(await saveAnalysis(sb, id, analysis, lastContactDate))) {
    throw new HttpError(404, "Lead not found");
  }
  const fresh = await getLead(sb, id);
  if (!fresh) throw new HttpError(404, "Lead not found");
  return fresh;
}

// Retry guard: true when the latest message already matches (same sender, same
// trimmed text), i.e. a retried or double-submitted request. Skip the insert then.
export function isDuplicateOfLatest(
  messages: { from: "rep" | "buyer"; text: string }[],
  from: "rep" | "buyer",
  text: string,
): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.from === from && last.text.trim() === text.trim();
}

interface Incoming {
  from: "rep" | "buyer";
  text: string;
}

// Fast path shared by POST /messages and POST /sent. Everything the rep needs to see
// right away is written and returned without waiting on the model:
//   1. read the lead and chat (one request)
//   2. in parallel: insert the message (skipped for a retried duplicate) and store the
//      provisional tag/reason/follow-up date from the in-process rules with
//      analysis_status = 'pending' (the existing draft is left untouched)
//   3. respond with the updated lead and chat
// That is two database round trips before the response. After the response, the model
// result is written with analysis_status = 'ready' and pushed to the browser by
// Supabase Realtime (the client polls as a backup).
export async function addAndAnalyze(
  sb: SupabaseClient,
  id: string,
  msg: Incoming,
  lastContactDate: string | undefined,
  label: string,
): Promise<{ lead: Lead; messages: Message[] }> {
  const timer = stageTimer(label);
  const existing = await getLead(sb, id);
  timer.mark("read");
  if (!existing) throw new HttpError(404, "Lead not found");
  const duplicate = isDuplicateOfLatest(existing.messages, msg.from, msg.text);
  const baseInput = (msgs: { from: "rep" | "buyer"; text: string; at: string }[]): AgentInput => ({
    lead: {
      name: existing.lead.name,
      company: existing.lead.company,
      source: existing.lead.source,
      lastContactDate: lastContactDate ?? existing.lead.lastContactDate,
    },
    messages: msgs,
    today: todayIST(),
    repName: existing.lead.repName,
    previousTag: existing.lead.tag,
  });
  const prior = existing.messages.map((m) => ({ from: m.from, text: m.text, at: m.at }));
  const startedAt = new Date().toISOString();
  // The rules only need the new message's text and day, so the provisional result is
  // computed with a local timestamp instead of waiting for the insert to return.
  const provisional = fallbackAnalysis(
    baseInput(duplicate ? prior : [...prior, { from: msg.from, text: msg.text, at: startedAt }]),
  );

  const [addedRes, begunRes] = await Promise.allSettled([
    duplicate ? Promise.resolve(null) : addMessage(sb, id, msg.from, msg.text),
    beginAnalysis(sb, id, provisional, startedAt, lastContactDate),
  ]);
  timer.mark("insert+provisional");
  const insertFailed = addedRes.status === "rejected" || (!duplicate && addedRes.value === null);
  if (insertFailed && begunRes.status === "fulfilled" && begunRes.value.kind === "ok") {
    // The message was not stored, so no analysis follows: do not leave the lead pending.
    await markReady(sb, id, startedAt).catch(() => {});
  }
  if (addedRes.status === "rejected") throw addedRes.reason;
  if (begunRes.status === "rejected") throw begunRes.reason;
  if (insertFailed) throw new HttpError(404, "Lead not found");
  const begun = begunRes.value;
  const messages = addedRes.value ? [...existing.messages, addedRes.value] : existing.messages;
  if (begun.kind === "not-found") throw new HttpError(404, "Lead not found");
  if (begun.kind === "legacy") {
    // No analysis columns yet: nothing to push to, so analyse before replying (old behaviour).
    const fresh = await reanalyze(sb, id, lastContactDate);
    timer.mark("analysis");
    timer.done();
    return fresh;
  }

  timer.done();
  const input = baseInput(messages.map((m) => ({ from: m.from, text: m.text, at: m.at })));
  after(() => withTripCounter(() => finishInBackground(sb, id, startedAt, input, label)));
  return { lead: begun.lead, messages };
}

// Runs after the response has been sent. Never throws and never leaves the lead
// pending: model failure falls back to the rules (draft included, inside
// analyzeLead), and a failed write is retried once and then at least marked ready.
export async function finishInBackground(
  sb: SupabaseClient,
  id: string,
  startedAt: string,
  input: AgentInput,
  label: string,
): Promise<void> {
  const timer = stageTimer(`${label} analysis`);
  let analysis;
  try {
    analysis = await analyzeLead(input);
  } catch {
    analysis = fallbackAnalysis(input);
  }
  timer.mark("model");
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await finishAnalysis(sb, id, analysis, startedAt);
        break;
      } catch (e) {
        if (attempt >= 1) throw e;
      }
    }
  } catch (e) {
    console.error("Analysis write failed:", e instanceof Error ? e.message : String(e));
    try {
      await markReady(sb, id, startedAt);
    } catch {
      // The client treats a lead pending for over 90 s as ready.
    }
  }
  timer.mark("write");
  timer.done();
}
