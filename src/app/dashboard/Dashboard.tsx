"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead, Rep } from "@/lib/types";
import { groupLeads, summaryLine, tagCounts } from "@/lib/lead-view";
import { Header } from "@/components/Header";
import { LeadRow } from "@/components/LeadRow";

type Me = Pick<Rep, "name" | "role">;

function Section({
  title,
  leads,
  empty,
  today,
  selectedId,
  showRep,
  onSelect,
}: {
  title: string;
  leads: Lead[];
  empty: string | null;
  today: string;
  selectedId: string | null;
  showRep: boolean;
  onSelect: (id: string) => void;
}) {
  if (leads.length === 0 && empty === null) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title} ({leads.length})
      </h2>
      {leads.length === 0 ? (
        <p className="rounded-lg bg-white p-3 text-sm text-slate-500">{empty}</p>
      ) : (
        leads.map((l) => (
          <LeadRow
            key={l.id}
            lead={l}
            today={today}
            selected={l.id === selectedId}
            showRep={showRep}
            onSelect={onSelect}
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
        <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-200" />
      ))}
    </div>
  );
}

function DetailPlaceholder() {
  return (
    <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
      Select a lead to see the chat, tag and draft
    </div>
  );
}

export function Dashboard({ me }: { me: Me }) {
  const router = useRouter();
  const isOwner = me.role === "owner";
  const [leads, setLeads] = useState<Lead[]>([]);
  const [today, setToday] = useState("");
  const [reps, setReps] = useState<Rep[]>([]);
  const [repFilter, setRepFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const headlineRef = useRef<HTMLParagraphElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastSelectedRef = useRef<string | null>(null);

  // reload() refetches the list; Task 8/9 call it after sending a message or adding a lead.
  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const qs = repFilter ? `?rep=${encodeURIComponent(repFilter)}` : "";
      const res = await fetch(`/api/leads${qs}`, { signal: ctrl.signal });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (ctrl.signal.aborted) return;
      if (!res.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }
      setLeads(body.leads);
      setToday(body.today);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, [repFilter, router]);

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
  }, [reload]);

  useEffect(() => {
    if (!isOwner) return;
    fetch("/api/reps")
      .then((r) => (r.ok ? r.json() : { reps: [] }))
      .then((b) => setReps(b.reps ?? []))
      .catch(() => setReps([]));
  }, [isOwner]);

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

  const groups = useMemo(() => groupLeads(leads, today), [leads, today]);
  const counts = useMemo(() => tagCounts(leads), [leads]);
  const selected = leads.find((l) => l.id === selectedId) ?? null;
  const sectionProps = { today, selectedId, showRep: isOwner, onSelect: setSelectedId };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header me={me} reps={reps} repFilter={repFilter} onRepFilter={setRepFilter} counts={counts} />
      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[2fr_3fr]">
        <div className={`min-w-0 ${selected ? "hidden lg:block" : ""}`}>
          {error ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
              <span>{error}</span>
              <button
                type="button"
                onClick={reload}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
              >
                Retry
              </button>
            </div>
          ) : loading && leads.length === 0 ? (
            <Skeleton />
          ) : (
            <div className="space-y-5">
              <p ref={headlineRef} tabIndex={-1} aria-live="polite" className="text-xl font-bold text-slate-900 focus:outline-none">
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
            // replaced in Task 8
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="mb-3 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 lg:hidden"
              >
                ← Back
              </button>
              <h2 ref={detailHeadingRef} tabIndex={-1} className="text-lg font-bold text-slate-900 focus:outline-none">{selected.name}</h2>
            </div>
          ) : (
            <DetailPlaceholder />
          )}
        </div>
      </main>
    </div>
  );
}
