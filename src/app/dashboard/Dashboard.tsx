"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import { groupLeads, summaryLine, tagCounts } from "@/lib/lead-view";
import { Header } from "@/components/Header";
import { LeadRow } from "@/components/LeadRow";
import { AddLeadDialog } from "@/components/AddLeadDialog";
import { LeadDetail } from "@/components/LeadDetail";
import { sortByUrgency } from "@/lib/urgency";
import { classifyIncoming, mergeRow } from "@/lib/analysis-state";
import { useLeadsRealtime } from "@/lib/use-leads-realtime";
import { Prefetcher } from "@/lib/lead-cache";
import { createLeadDetailCache, warmupIds } from "@/lib/lead-detail-client";
import { markOpenClick } from "@/lib/open-perf";
import {
  ALL_REPS,
  leadsUrl,
  parseReps,
  readViewing,
  resolveViewing,
  writeViewing,
  type RepOption,
  type Viewing,
} from "@/lib/rep-selection";

// The list on screen and the view it belongs to: a list is only shown for the view it
// was fetched for, so switching reps never flashes another rep's leads.
interface ListState {
  viewing: Viewing;
  leads: Lead[];
  today: string;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type IdleHandle = { cancel: () => void };
function whenIdle(fn: () => void): IdleHandle {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const h = w.requestIdleCallback(fn, { timeout: 1500 });
    return { cancel: () => w.cancelIdleCallback!(h) };
  }
  const h = setTimeout(fn, 300);
  return { cancel: () => clearTimeout(h) };
}

function Section({
  title,
  leads,
  empty,
  today,
  selectedId,
  showRep,
  onSelect,
  onIntent,
  onIntentEnd,
}: {
  title: string;
  leads: Lead[];
  empty: string | null;
  today: string;
  selectedId: string | null;
  showRep: boolean;
  onSelect: (id: string) => void;
  onIntent: (id: string) => void;
  onIntentEnd: (id: string) => void;
}) {
  if (leads.length === 0 && empty === null) return null;
  return (
    <section aria-label={title} className="space-y-2.5">
      <h2 className="pill uppercase tracking-wide text-neutral-800">
        {title} <span className="tabular text-neutral-600">({leads.length})</span>
      </h2>
      {leads.length === 0 ? (
        <p className="rounded-card border border-dashed border-neutral-200 bg-white p-3.5 text-sm text-neutral-600">{empty}</p>
      ) : (
        leads.map((l) => (
          <LeadRow
            key={l.id}
            lead={l}
            today={today}
            selected={l.id === selectedId}
            showRep={showRep}
            onSelect={onSelect}
            onIntent={onIntent}
            onIntentEnd={onIntentEnd}
          />
        ))
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading leads" className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[4.5rem] animate-pulse rounded-card bg-neutral-50" />
      ))}
    </div>
  );
}

function DetailPlaceholder() {
  return (
    <div className="flex h-full min-h-48 items-center justify-center rounded-panel border border-dashed border-neutral-200 bg-white p-6 text-center text-neutral-600">
      Select a lead to see the chat, tag and draft
    </div>
  );
}

export function Dashboard() {
  const [reps, setReps] = useState<RepOption[]>([]);
  const [viewing, setViewingState] = useState<Viewing | null>(null);
  const [list, setList] = useState<ListState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Lead detail payloads (lead + chat), kept across opens for instant re-open.
  const [cache] = useState(createLeadDetailCache);
  const [prefetcher] = useState(() => new Prefetcher(cache));
  const listCacheRef = useRef(new Map<Viewing, { leads: Lead[]; today: string }>());
  const warmedRef = useRef(new Set<Viewing>());
  const abortRef = useRef<AbortController | null>(null);
  const headlineRef = useRef<HTMLParagraphElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastSelectedRef = useRef<string | null>(null);

  const shown = list && list.viewing === viewing ? list : null;
  const leads = useMemo(() => shown?.leads ?? [], [shown]);
  const today = shown?.today ?? "";
  const todayRef = useRef("");
  todayRef.current = today;
  const listRef = useRef(list);
  listRef.current = list;

  // Rep list + remembered choice. A stored choice starts the lead fetch at once
  // (in parallel with /api/reps); otherwise the default rep is picked once reps arrive.
  useEffect(() => {
    const stored = readViewing(browserStorage());
    if (stored) setViewingState(stored);
    const ctrl = new AbortController();
    fetch("/api/reps", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`reps ${r.status}`))))
      .then((b) => {
        const list = parseReps(b);
        setReps(list);
        setViewingState((v) => resolveViewing(list, v ?? stored));
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setViewingState((v) => v ?? ALL_REPS);
      });
    return () => ctrl.abort();
  }, []);

  const setViewing = useCallback((v: Viewing) => {
    writeViewing(browserStorage(), v);
    setViewingState(v);
    // Keep an open lead only if it belongs to the new view.
    setSelectedId((id) => {
      if (!id || v === ALL_REPS) return id;
      const l = listRef.current?.leads.find((x) => x.id === id);
      return l && l.repId === v ? id : null;
    });
  }, []);

  // reload() refetches the list for the current view; called after sending a message
  // or adding a lead. A cached list for the view is shown at once while it refetches.
  const reload = useCallback(async () => {
    if (!viewing) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const cached = listCacheRef.current.get(viewing);
    if (cached) setList((prev) => (prev?.viewing === viewing ? prev : { viewing, ...cached }));
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(leadsUrl(viewing), { signal: ctrl.signal });
      const body = await res.json().catch(() => ({}));
      if (ctrl.signal.aborted) return;
      if (!res.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }
      if (!Array.isArray(body.leads) || typeof body.today !== "string") {
        setError("Unexpected response from the server");
        return;
      }
      setList({ viewing, leads: body.leads, today: body.today });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, [viewing]);

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
  }, [reload]);

  // Remember the latest list per view (including optimistic patches).
  useEffect(() => {
    if (list) listCacheRef.current.set(list.viewing, { leads: list.leads, today: list.today });
  }, [list]);

  // Warm the cache for the first few urgent leads once a view's list is on screen.
  useEffect(() => {
    if (!shown || warmedRef.current.has(shown.viewing)) return;
    warmedRef.current.add(shown.viewing);
    const ids = warmupIds(shown.leads, shown.today, 3);
    if (ids.length === 0) return;
    const h = whenIdle(() => prefetcher.now(ids));
    return () => h.cancel();
  }, [shown, prefetcher]);

  useEffect(() => () => prefetcher.cancelAll(), [prefetcher]);

  // Focus management: below lg the list is hidden while a lead is open, so move focus
  // into the detail pane on select and back to the row (or headline) on Back.
  useEffect(() => {
    if (selectedId) {
      lastSelectedRef.current = selectedId;
      if (!window.matchMedia("(min-width: 1024px)").matches) detailHeadingRef.current?.focus();
    } else if (lastSelectedRef.current) {
      const id = lastSelectedRef.current;
      lastSelectedRef.current = null;
      const row = document.querySelector<HTMLElement>(`[data-lead-id="${CSS.escape(id)}"]`);
      (row ?? headlineRef.current)?.focus();
    }
  }, [selectedId]);

  const closeAdd = useCallback(() => setAddOpen(false), []);
  // Optimistically put an API-returned lead into the list so list and detail change together.
  // A later reload() aborts any older in-flight refetch, so a stale response cannot overwrite this.
  const upsertLead = useCallback((lead: Lead) => {
    setList((prev) => {
      if (!prev) return prev;
      const exists = prev.leads.some((l) => l.id === lead.id);
      if (!exists && prev.viewing !== ALL_REPS && prev.viewing !== lead.repId) return prev;
      const next = exists ? prev.leads.map((l) => (l.id === lead.id ? lead : l)) : [...prev.leads, lead];
      return { ...prev, leads: sortByUrgency(next, todayRef.current) };
    });
  }, []);

  // Live updates (Supabase Realtime). Rows for leads in the list refresh tag/date in
  // place; the open LeadDetail gets the same rows through `subscribeRows`.
  const rowListeners = useRef(new Set<(lead: Lead) => void>());
  const subscribeRows = useCallback((fn: (lead: Lead) => void) => {
    rowListeners.current.add(fn);
    return () => {
      rowListeners.current.delete(fn);
    };
  }, []);
  const handleRow = useCallback(
    (row: Lead) => {
      setList((prev) => {
        const cur = prev?.leads.find((l) => l.id === row.id);
        if (!prev || !cur || classifyIncoming(cur, row) === "ignore") return prev;
        const next = prev.leads.map((l) => (l.id === row.id ? mergeRow(cur, row) : l));
        return { ...prev, leads: sortByUrgency(next, todayRef.current) };
      });
      // A cached lead that changed elsewhere: patch it and refetch its chat on next open.
      const cached = cache.get(row.id);
      if (cached && classifyIncoming(cached.lead, row) !== "ignore") {
        cache.patch(row.id, (d) => ({ ...d, lead: mergeRow(d.lead, row) }));
        cache.markStale(row.id);
      }
      rowListeners.current.forEach((fn) => fn(row));
    },
    [cache],
  );
  const channel = useLeadsRealtime(viewing, handleRow);

  // After a mutation: apply the returned lead now, then one background reconcile.
  const handleChanged = useCallback(
    (lead?: Lead) => {
      if (lead) upsertLead(lead);
      reload();
    },
    [upsertLead, reload],
  );

  const handleCreated = useCallback(
    (lead: Lead) => {
      cache.set(lead.id, { lead, messages: [] }); // a new lead has no chat yet
      upsertLead(lead);
      markOpenClick(lead.id);
      setSelectedId(lead.id);
      reload();
    },
    [cache, reload, upsertLead],
  );

  const select = useCallback((id: string) => {
    markOpenClick(id);
    setSelectedId(id);
  }, []);
  const intent = useCallback((id: string) => prefetcher.intent(id), [prefetcher]);
  const intentEnd = useCallback((id: string) => prefetcher.cancel(id), [prefetcher]);

  const all = viewing === ALL_REPS;
  const groups = useMemo(() => groupLeads(leads, today), [leads, today]);
  const counts = useMemo(() => tagCounts(leads), [leads]);
  const selected = (shown ?? list)?.leads.find((l) => l.id === selectedId) ?? null;
  const sectionProps = { today, selectedId, showRep: all, onSelect: select, onIntent: intent, onIntentEnd: intentEnd };

  return (
    <div className="bg-dots min-h-screen">
      <Header
        reps={reps}
        viewing={viewing}
        onViewing={setViewing}
        counts={counts}
        onAddLead={() => setAddOpen(true)}
        addDisabled={!today || !viewing}
      />
      {viewing && (
        <AddLeadDialog open={addOpen} onClose={closeAdd} onCreated={handleCreated} today={today} reps={reps} viewing={viewing} />
      )}
      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[2fr_3fr]">
        <div className={`min-w-0 ${selected ? "hidden lg:block" : ""}`}>
          {error ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-red-200 bg-red-50 p-3 text-red-700">
              <span>{error}</span>
              <button
                type="button"
                onClick={reload}
                className="btn btn-danger"
              >
                Retry
              </button>
            </div>
          ) : !shown ? (
            <Skeleton />
          ) : (
            <div className="space-y-6" aria-busy={loading || undefined}>
              <p ref={headlineRef} tabIndex={-1} aria-live="polite" className="font-display text-2xl font-semibold tracking-tight text-neutral-900 focus:outline-none">
                {summaryLine(groups)}
              </p>
              <Section title="Overdue" leads={groups.overdue} empty="Nothing here 🎉" {...sectionProps} />
              <Section title="Due today" leads={groups.today} empty="Nothing here 🎉" {...sectionProps} />
              <Section title="Upcoming" leads={groups.upcoming} empty="No upcoming follow-ups" {...sectionProps} />
            </div>
          )}
        </div>
        <div className={`min-w-0 ${selected ? "" : "hidden lg:block"}`}>
          {selected ? (
            <div className="lg:sticky lg:top-[4.5rem]">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="focus-ring mb-3 rounded-input px-2.5 py-1.5 text-sm font-medium text-neutral-800 transition-colors duration-150 hover:bg-white lg:hidden"
              >
                ← Back
              </button>
              <LeadDetail
                key={selected.id}
                leadId={selected.id}
                initial={selected}
                cache={cache}
                headingRef={detailHeadingRef}
                today={today || (list?.today ?? "")}
                showRep={all}
                onChanged={handleChanged}
                onPatched={upsertLead}
                channel={channel}
                subscribeRows={subscribeRows}
                onGone={() => {
                  cache.invalidate(selected.id);
                  setSelectedId(null);
                  reload();
                }}
              />
            </div>
          ) : (
            <DetailPlaceholder />
          )}
        </div>
      </main>
    </div>
  );
}
