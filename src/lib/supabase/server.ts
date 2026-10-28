// SERVER ONLY. Never import this module from a client component: it reads the
// service-role key, which bypasses Row Level Security. Next.js only inlines
// NEXT_PUBLIC_* variables into browser bundles, so the key itself never ships, and the
// runtime check below fails loudly if this file is ever bundled for the browser.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tracedFetch } from "@/lib/traced-fetch";

if (typeof window !== "undefined") {
  throw new Error("src/lib/supabase/server.ts is server-only and must not be imported in the browser.");
}

let client: SupabaseClient | null = null;

/**
 * The one server-side Supabase client used by every API route (demo mode: there is no
 * login, so there is no per-user client). Created lazily on first use, so `next build`
 * and CI never need the key; a missing variable is reported only when a route runs.
 * All writes go through the validated API routes; see the open_demo_access migration
 * for the security model.
 */
export function getServerSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Server Supabase client is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example).",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: tracedFetch("api") },
  });
  return client;
}
