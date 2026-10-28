"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/types";
import { PHONE_ERROR, SOURCES, validateNewLead } from "@/lib/validate";
import { ALL_REPS, repName, type RepOption, type Viewing } from "@/lib/rep-selection";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
  today: string;
  reps: RepOption[];
  // The rep the dashboard is viewing as: the new lead goes to them. With "All reps"
  // the dialog asks for a rep instead.
  viewing: Viewing;
}

export const REP_REQUIRED = "rep is required";

const FIELD =
  "field";

// Maps the first validation message to the field it is about (messages start with the field name).
function fieldOf(error: string): string | null {
  const names = ["name", "company", "phone", "source", "lastContactDate"];
  if (error === REP_REQUIRED || error.startsWith("repId") || error === "Unknown rep") return "rep";
  if (error === PHONE_ERROR) return "phone";
  return names.find((n) => error.startsWith(n)) ?? null;
}

export function AddLeadDialog({ open, onClose, onCreated, today, reps, viewing }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const mountedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<string>(SOURCES[0]);
  const [date, setDate] = useState(today);
  const [repId, setRepId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickRep = viewing === ALL_REPS;
  const effectiveRepId = pickRep ? repId : viewing;
  const assignee = pickRep ? null : repName(reps, viewing);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setName("");
      setCompany("");
      setPhone("");
      setSource(SOURCES[0]);
      setDate(today);
      setRepId("");
      setError(null);
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
    // today intentionally not a dependency: defaults are applied on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const payload: Record<string, string> = { name, company, phone, source, lastContactDate: date, repId: effectiveRepId };
    const v = validateNewLead(payload, today);
    if (!v.ok) {
      setError(v.error.startsWith("repId") ? REP_REQUIRED : v.error);
      return;
    }
    if (!effectiveRepId || !reps.some((r) => r.id === effectiveRepId)) {
      setError(REP_REQUIRED);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (mountedRef.current) setError(body.error ?? "Something went wrong");
        return;
      }
      if (!body || typeof body !== "object" || !body.id) {
        if (mountedRef.current) setError("Unexpected response from server");
        return;
      }
      onCreated(body as Lead);
      if (mountedRef.current) onCloseRef.current();
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Network error");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  const bad = error ? fieldOf(error) : null;
  const invalid = (f: string) => (bad === f ? true : undefined);

  return (
    <dialog
      ref={ref}
      aria-labelledby="add-lead-title"
      onCancel={(e) => {
        if (busyRef.current) e.preventDefault();
      }}
      onClose={() => onCloseRef.current()}
      className="m-auto w-[calc(100vw-2rem)] max-w-md panel p-0 backdrop:bg-neutral-900/40 backdrop:backdrop-blur-[2px]"
    >
      <form onSubmit={submit} noValidate aria-busy={busy} className="space-y-3.5 p-5 sm:p-6">
        <h2 id="add-lead-title" className="text-xl font-semibold text-neutral-900">
          Add lead
        </h2>
        <div>
          <label htmlFor="al-name" className="mb-1 block text-sm font-medium text-neutral-900">Name</label>
          <input id="al-name" value={name} readOnly={busy} aria-invalid={invalid("name")} autoComplete="off" onChange={(e) => setName(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="al-company" className="mb-1 block text-sm font-medium text-neutral-900">Company</label>
          <input id="al-company" value={company} readOnly={busy} aria-invalid={invalid("company")} autoComplete="off" onChange={(e) => setCompany(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="al-phone" className="mb-1 block text-sm font-medium text-neutral-900">Phone</label>
          <input id="al-phone" type="text" inputMode="tel" placeholder="+91 98xxx xxxxx" value={phone} readOnly={busy} aria-invalid={invalid("phone")} autoComplete="off" onChange={(e) => setPhone(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="al-source" className="mb-1 block text-sm font-medium text-neutral-900">Source</label>
          <select id="al-source" value={source} disabled={busy} aria-invalid={invalid("source")} onChange={(e) => setSource(e.target.value)} className={FIELD}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="al-date" className="mb-1 block text-sm font-medium text-neutral-900">Last contact date</label>
          <input id="al-date" type="date" value={date} max={today} readOnly={busy} aria-invalid={invalid("lastContactDate")} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </div>
        {pickRep ? (
          <div>
            <label htmlFor="al-rep" className="mb-1 block text-sm font-medium text-neutral-900">Rep</label>
            <select id="al-rep" value={repId} disabled={busy} required aria-invalid={invalid("rep")} onChange={(e) => setRepId(e.target.value)} className={FIELD}>
              <option value="">{reps.length === 0 ? "No reps available" : "Choose a rep"}</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-xs text-neutral-600">This lead will be assigned to {assignee ?? "the selected rep"}.</p>
        )}
        {error && (
          <p role="alert" className="break-words rounded-input border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            disabled={busy}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary"
          >
            {busy ? "Analysing…" : "Add lead"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
