"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "@/lib/types";
import { mapLead, type LeadRow } from "@/lib/mappers";
import type { ChannelState } from "@/lib/analysis-state";
import { ALL_REPS } from "@/lib/rep-selection";

let channelSeq = 0;
let client: SupabaseClient | null = null;

// One plain publishable-key client per tab, with no auth session at all (no cookies,
// no storage, no token refresh): it is only used for Realtime pushes.
function anonClient(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

function isLeadRow(r: unknown): r is LeadRow {
  const o = r as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o.id === "string" &&
    typeof o.tag === "string" &&
    typeof o.follow_up_date === "string" &&
    typeof o.draft === "string"
  );
}

/** postgres_changes filter for the rep being viewed (none for "all"). */
export function realtimeFilter(viewing: string | null): string | undefined {
  return viewing && viewing !== ALL_REPS ? `rep_id=eq.${viewing}` : undefined;
}

/**
 * One Supabase Realtime channel for lead row updates, scoped to the rep being viewed.
 * Re-subscribes when the rep changes and tears down on unmount. The returned state
 * drives the polling fallback: anything other than "subscribed" means the app must
 * not rely on pushes. `viewing` null = not chosen yet (no channel).
 */
export function useLeadsRealtime(viewing: string | null, onRow: (lead: Lead) => void): ChannelState {
  const [state, setState] = useState<ChannelState>("connecting");
  const onRowRef = useRef(onRow);
  onRowRef.current = onRow;

  useEffect(() => {
    if (!viewing) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    setState("connecting");
    try {
      const sb = anonClient();
      const filter = realtimeFilter(viewing);
      // Unique topic per subscription so a quick re-subscribe never reuses a closing channel.
      channel = sb
        .channel(`leads-live-${++channelSeq}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "leads", ...(filter ? { filter } : {}) },
          (payload) => {
            if (isLeadRow(payload.new)) onRowRef.current(mapLead(payload.new));
          },
        )
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") setState("subscribed");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setState("down");
        });
    } catch {
      setState("down");
    }
    return () => {
      cancelled = true;
      if (channel) void anonClient().removeChannel(channel);
    };
  }, [viewing]);

  return state;
}
