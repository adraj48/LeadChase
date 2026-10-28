import type { SupabaseClient } from "@supabase/supabase-js";
import type { Rep } from "@/lib/types";
import { getCurrentRep } from "@/lib/repo";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const UNAVAILABLE = "Database unavailable, try again in a minute";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export async function requireUser(sb: SupabaseClient): Promise<Rep> {
  const me = await getCurrentRep(sb);
  if (!me) throw new HttpError(401, "Not signed in");
  return me;
}

const NETWORK_RE =
  /fetch failed|econn|enotfound|etimedout|eai_again|socket hang up|network|connection (refused|terminated|timed? ?out|reset)|bad gateway|service unavailable|gateway time-?out|upstream|\b5\d\d\b/i;

export function isDbUnavailable(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return NETWORK_RE.test(msg);
}

export async function leadIdFrom(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw new HttpError(404, "Lead not found");
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrors<A extends any[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      // Log only the message: never headers, keys or request objects.
      console.error("API error:", e instanceof Error ? e.message : String(e));
      if (isDbUnavailable(e)) return json({ error: UNAVAILABLE }, 503);
      return json({ error: "Something went wrong" }, 500);
    }
  };
}
