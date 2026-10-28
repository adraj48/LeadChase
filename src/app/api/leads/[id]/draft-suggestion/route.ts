import { getServerSupabase } from "@/lib/supabase/server";
import { getLead } from "@/lib/repo";
import { todayIST } from "@/lib/dates";
import { streamDraft } from "@/lib/draft-stream";
import { MAX_REPAIR_HINTS, MAX_REPAIR_HINT_CHARS } from "@/lib/draft-prompt";
import { createRateLimiter } from "@/lib/rate-limit";
import { HttpError, clientIp, leadIdFrom, withErrors } from "@/lib/http";

// Streams ONE suggested WhatsApp message as plain text. Read-only: nothing is written
// to the database; the rep edits the text in the browser and saves or sends it through
// the existing routes.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// 10 drafts per minute per client IP (there is no login; see clientIp), counted in
// units: a draft costs 2, the automatic rewrite the client asks for after a failed
// check costs 1 (so a click plus its rewrite is 3 of the 20 units). In-memory, so
// best-effort per server instance.
const limiter = createRateLimiter(20, 60_000);
const COST_DRAFT = 2;
const COST_REPAIR = 1;

// Optional body {"repair": ["problem", ...]}: what the previous attempt got wrong.
async function readRepair(req: Request): Promise<string[]> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return []; // no body: a plain draft request
  }
  const r = (body as { repair?: unknown } | null)?.repair;
  if (r === undefined) return [];
  if (!Array.isArray(r) || r.length > MAX_REPAIR_HINTS || r.some((x) => typeof x !== "string" || x.length > MAX_REPAIR_HINT_CHARS)) {
    throw new HttpError(400, "Invalid repair hints");
  }
  return r as string[];
}

export const POST = withErrors(async (req: Request, ctx: Ctx) => {
  const repair = await readRepair(req);
  if (!limiter.take(clientIp(req), Date.now(), repair.length > 0 ? COST_REPAIR : COST_DRAFT)) throw new HttpError(429, "Too many requests, try again in a minute");
  const id = await leadIdFrom(ctx);
  const found = await getLead(getServerSupabase(), id); // one request: lead + chat
  if (!found) throw new HttpError(404, "Lead not found");
  const { lead, messages } = found;
  const today = todayIST();

  const { stream, source } = await streamDraft(
    {
      repFirstName: (lead.repName || "").trim().split(/\s+/)[0] || "the rep",
      lead,
      messages,
      todayIST: today,
      repair,
    },
    {
      lead: { name: lead.name, company: lead.company, source: lead.source, lastContactDate: lead.lastContactDate },
      messages: messages.map((m) => ({ from: m.from, text: m.text, at: m.at })),
      today,
      repName: lead.repName,
      previousTag: lead.tag,
    },
    req.signal,
  );
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Draft-Source": source,
    },
  });
});
