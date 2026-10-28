import { countRoundTrip } from "@/lib/timing";

// fetch wrapper for the server Supabase client. Always counts the request towards the
// current API request's total (see timing.ts). In development only it also logs one
// line per request (method, path without query values, status, milliseconds); it never
// logs headers, keys or bodies.
export function tracedFetch(tag: string): typeof fetch {
  const dev = process.env.NODE_ENV === "development";
  return async (input, init) => {
    countRoundTrip();
    if (!dev) return fetch(input, init);
    const t = performance.now();
    const res = await fetch(input, init);
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(raw);
      const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
      console.info(`[sb:${tag}] ${method} ${u.pathname} ${res.status} ${Math.round(performance.now() - t)}ms`);
    } catch {
      // logging must never break a request
    }
    return res;
  };
}
