import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// Browser client with the public publishable (anon) key and no auth session: it is
// only used for Realtime change events on public.leads, which anon may read (fake
// demo data, see the open_demo_access migration). It never writes; all writes go
// through the API routes. One shared instance per tab.
export function createBrowserSupabase(): SupabaseClient {
  if (client) return client;
  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return client;
}
