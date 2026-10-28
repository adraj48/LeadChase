"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead, Rep } from "@/lib/types";
import { SOURCES, validateNewLead } from "@/lib/validate";
import { signOutAndGoToLogin } from "@/lib/client-auth";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
  today: string;
  isOwner: boolean;
  reps: Rep[];
  me: Pick<Rep, "name" | "role">;
}

const FIELD =
  "block w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 aria-[invalid=true]:border-red-500 read-only:bg-slate-50 disabled:bg-slate-50";

// Maps the first validation message to the field it is about (messages start with the field name).
function fieldOf(error: string): string | null {
  const names = ["name", "company", "phone", "source", "lastContactDate"];
  return names.find((n) => error.startsWith(n)) ?? null;
}

export function AddLeadDialog({ open, onClose, onCreated, today, isOwner, reps, me }: Props) {
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

  const repChoices = reps.filter((r) => r.role === "rep");
  const effectiveRepId = repId || repChoices[0]?.id || "";

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
    const payload: Record<string, string> = { name, company, phone, source, lastContactDate: date };
    if (isOwner) payload.repId = effectiveRepId;
    const v = validateNewLead(payload, today);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    if (isOwner && !effectiveRepId) {
      setError("repId is required");
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
      if (res.status === 401) {
        await signOutAndGoToLogin();
        return;
      }
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
  const owner = isOwner;

  return (
    <dialog
      ref={ref}
      aria-labelledby="add-lead-title"
      onCancel={(e) => {
        if (busyRef.current) e.preventDefault();
      }}
      onClose={() => onCloseRef.current()}
      className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-lg border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <form onSubmit={submit} noValidate aria-busy={busy} className="space-y-3 p-4">
        <h2 id="add-lead-title" className="text-lg font-bold text-slate-900">
          Add lead
        </h2>
        <div>
          <label htmlFor="al-name" className="mb-1 block text-sm font-medium text-slate-800">Name</label>
          <input id="al-name" value={name} readOnly={busy} aria-invalid={invalid("name")} autoComplete="off" onChange={(e) => setName(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="al-company" className="mb-1 block text-sm font-medium text-slate-800">Company</label>
          <input id="al-company" value={company} readOnly={busy} aria-invalid={invalid("company")} autoComplete="off" onChange={(e) => setCompany(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="al-phone" className="mb-1 block text-sm font-medium text-slate-800">Phone</label>
          <input id="al-phone" type="text" inputMode="tel" placeholder="+91 98xxx xxxxx" value={phone} readOnly={busy} aria-invalid={invalid("phone")} autoComplete="off" onChange={(e) => setPhone(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="al-source" className="mb-1 block text-sm font-medium text-slate-800">Source</label>
          <select id="al-source" value={source} disabled={busy} aria-invalid={invalid("source")} onChange={(e) => setSource(e.target.value)} className={FIELD}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="al-date" className="mb-1 block text-sm font-medium text-slate-800">Last contact date</label>
          <input id="al-date" type="date" value={date} max={today} readOnly={busy} aria-invalid={invalid("lastContactDate")} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </div>
        {owner && (
          <div>
            <label htmlFor="al-rep" className="mb-1 block text-sm font-medium text-slate-800">Rep</label>
            <select id="al-rep" value={effectiveRepId} disabled={busy} required onChange={(e) => setRepId(e.target.value)} className={FIELD}>
              {repChoices.length === 0 && <option value="">No reps available</option>}
              {repChoices.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
        {!owner && <p className="text-xs text-slate-500">This lead will be assigned to {me.name}.</p>}
        {error && (
          <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Analysing…" : "Add lead"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
