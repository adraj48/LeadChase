import { afterEach, describe, expect, it, vi } from "vitest";
import { tripCount, withTripCounter } from "@/lib/timing";
import { tracedFetch } from "@/lib/traced-fetch";
import { withErrors, json, clientIp, UNKNOWN_CLIENT } from "@/lib/http";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Supabase request counter", () => {
  it("counts every request made through tracedFetch, per scope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    const f = tracedFetch("api");
    const counts = await Promise.all([
      withTripCounter(async () => {
        await f("https://x.supabase.co/rest/v1/leads");
        await f("https://x.supabase.co/rest/v1/reps");
        return tripCount();
      }),
      withTripCounter(async () => {
        await f("https://x.supabase.co/rest/v1/leads");
        return tripCount();
      }),
    ]);
    expect(counts).toEqual([2, 1]);
    expect(tripCount()).toBeUndefined();
  });
  it("withErrors gives each API request its own counter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    const f = tracedFetch("api");
    const handler = withErrors(async () => {
      await f("https://x.supabase.co/rest/v1/leads");
      return json({ trips: tripCount() });
    });
    expect(await (await handler()).json()).toEqual({ trips: 1 });
    expect(await (await handler()).json()).toEqual({ trips: 1 });
  });
});

describe("clientIp", () => {
  const r = (h: Record<string, string>) => new Request("http://t/", { headers: h });
  it("uses the first x-forwarded-for hop, else a shared fallback", () => {
    expect(clientIp(r({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(r({ "x-forwarded-for": "  " }))).toBe(UNKNOWN_CLIENT);
    expect(clientIp(r({}))).toBe(UNKNOWN_CLIENT);
  });
});

describe("server Supabase client", () => {
  it("is created lazily: importing needs no env, first use without the key fails clearly", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const mod = await import("@/lib/supabase/server");
    expect(() => mod.getServerSupabase()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
  it("returns one shared, session-less client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    const mod = await import("@/lib/supabase/server");
    const a = mod.getServerSupabase();
    expect(mod.getServerSupabase()).toBe(a);
  });
});
