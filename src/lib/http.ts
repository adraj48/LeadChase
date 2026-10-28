import { withTripCounter } from "@/lib/timing";
import { UUID_RE } from "@/lib/validate";

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
export { UUID_RE };

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

// Fallback key when a request carries no x-forwarded-for header (local dev, tests).
export const UNKNOWN_CLIENT = "unknown-client";

/**
 * Best-effort client key for rate limiting: the first hop of x-forwarded-for (set by
 * the hosting proxy, e.g. Vercel), else a shared constant. Spoofable where no trusted
 * proxy rewrites the header, which is acceptable for a quota guard (see rate-limit.ts).
 */
export function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : UNKNOWN_CLIENT;
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
  // Each request gets its own Supabase request counter (development timing logs).
  return (...args: A) => withTripCounter(async () => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      // Log only the message: never headers, keys or request objects.
      console.error("API error:", e instanceof Error ? e.message : String(e));
      if (isDbUnavailable(e)) return json({ error: UNAVAILABLE }, 503);
      return json({ error: "Something went wrong" }, 500);
    }
  });
}
