"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead, Message } from "@/lib/types";
import { followUpLabel } from "@/lib/lead-view";
import {
  MAX_DRAFT,
  headingText,
  analysisNote,
  canSave,
  canSend,
  canAddMessage,
  updatedNote,
  formatDateLabel,
  sentToast,
  telHref,
} from "@/lib/detail-view";
import { validateMessage } from "@/lib/validate";
import { signOutAndGoToLogin } from "@/lib/client-auth";
import { TagChip } from "./TagChip";
import { ChatThread } from "./ChatThread";

const LABEL_STYLE = {
  overdue: "text-red-700 font-semibold",
  today: "text-amber-800 font-semibold",
  upcoming: "text-slate-600",
} as const;

interface Props {
  leadId: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  today: string;
  isOwner: boolean;
  onChanged: () => void;
  onGone: () => void;
}

export function LeadDetail({ leadId, headingRef, today, isOwner, onChanged, onGone }: Props) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [msgFrom, setMsgFrom] = useState<"buyer" | "rep">("buyer");
  const [msgText, setMsgText] = useState("");
  const [highlight, setHighlight] = useState(false);
  const hlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  const flash = useCallback((msg: string) => {
    if (!mountedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus(msg);
    timerRef.current = setTimeout(() => setStatus(null), 4000);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hlTimerRef.current) clearTimeout(hlTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(null);
    setLead(null);
    setMessages([]);
    setActionError(null);
    setStatus(null);
    (async () => {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, { signal: ctrl.signal });
        if (res.status === 401) {
          await signOutAndGoToLogin();
          return;
        }
        if (res.status === 404) {
          if (!ctrl.signal.aborted) onGoneRef.current();
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (ctrl.signal.aborted) return;
        if (!res.ok) {
          setLoadError(body.error ?? "Something went wrong");
        } else if (!body.lead || typeof body.lead !== "object" || !Array.isArray(body.messages)) {
          setLoadError("Unexpected response from server");
        } else {
          setLead(body.lead);
          setMessages(body.messages);
          setText(body.lead.draft ?? "");
          setSaved(body.lead.draft ?? "");
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setLoadError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [leadId, attempt]);

  async function request(path: string, method: string, payload: unknown = { draft: text }) {
    setBusy(true);
    setBusyPath(path);
    setActionError(null);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        await signOutAndGoToLogin();
        return null;
      }
      if (res.status === 404) {
        if (mountedRef.current) onGoneRef.current();
        return null;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (mountedRef.current) setActionError(body.error ?? "Something went wrong");
        return null;
      }
      return body;
    } catch (e) {
      if (mountedRef.current) setActionError(e instanceof Error ? e.message : "Network error");
      return null;
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setBusyPath(null);
      }
    }
  }

  async function save() {
    const sentText = text;
    const body = await request("draft", "PUT");
    if (!body || !mountedRef.current) return;
    setSaved(sentText);
    flash("Draft saved");
  }

  async function send() {
    const body = await request("sent", "POST");
    if (!body) return;
    // Server state changed: always refresh the list, even if this pane is gone.
    onChanged();
    if (!mountedRef.current) return;
    if (!body.lead || !Array.isArray(body.messages)) {
      setActionError("Unexpected response from server");
      return;
    }
    setLead(body.lead);
    setMessages(body.messages);
    setText(body.lead.draft ?? "");
    setSaved(body.lead.draft ?? "");
    flash(sentToast(body.lead.followUpDate, today));
  }

  async function addMessage() {
    if (!canAddMessage(msgText, busy)) return;
    if (dirty && !window.confirm("Adding this message will replace your unsaved draft edits with a new suggestion. Continue?")) return;
    const v = validateMessage({ from: msgFrom, text: msgText });
    if (!v.ok) {
      setActionError(v.error);
      return;
    }
    const body = await request("messages", "POST", v.value);
    if (!body) return;
    // Server state changed: always refresh the list, even if this pane is gone.
    onChanged();
    if (!mountedRef.current) return;
    if (!body.lead || !Array.isArray(body.messages)) {
      setActionError("Unexpected response from server");
      return;
    }
    setLead(body.lead);
    setMessages(body.messages);
    setMsgText("");
    setText(body.lead.draft ?? "");
    setSaved(body.lead.draft ?? "");
    flash(updatedNote(body.lead, today));
    if (hlTimerRef.current) clearTimeout(hlTimerRef.current);
    setHighlight(true);
    hlTimerRef.current = setTimeout(() => setHighlight(false), 2000);
    // Return focus to the message box once the fieldset is re-enabled (a textarea
    // inside a disabled fieldset cannot take focus until the next commit).
    requestAnimationFrame(() => {
      if (mountedRef.current) document.getElementById("new-message")?.focus();
    });
  }

  const label = lead ? followUpLabel(lead.followUpDate, today) : null;
  const note = lead ? analysisNote(lead.analysisSource) : null;
  const over = text.length > MAX_DRAFT;
  const dirty = text !== saved;
  const state = loadError ? "error" : loading || !lead ? "loading" : "loaded";

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 ref={headingRef} tabIndex={-1} className="break-words text-lg font-bold text-slate-900 focus:outline-none">
        {headingText(state, lead?.name ?? "")}
      </h2>
      {state === "error" && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          <span className="min-w-0 break-words">{loadError}</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </div>
      )}
      {state === "loading" && (
        <div aria-busy="true" aria-label="Loading lead" className="space-y-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="h-32 animate-pulse rounded bg-slate-200" />
          <div className="h-24 animate-pulse rounded bg-slate-200" />
        </div>
      )}
      {state === "loaded" && lead && label && (
        <>
          <div className="min-w-0 space-y-1">
        <p className="break-words text-sm text-slate-700">{lead.company}</p>
        <p className="text-sm text-slate-700">
          <a href={telHref(lead.phone)} className="text-blue-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            {lead.phone}
          </a>
          <span className="text-slate-500"> · {lead.source}</span>
        </p>
        <p className="text-sm text-slate-500">Last contact: {formatDateLabel(lead.lastContactDate)}</p>
        {isOwner && <p className="text-sm text-slate-500">Rep: {lead.repName}</p>}
      </div>

      <div className={`min-w-0 space-y-1 rounded-md transition-shadow duration-700 ${highlight ? "bg-amber-50 ring-2 ring-amber-400" : "ring-0 ring-transparent"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <TagChip tag={lead.tag} />
          <span className={`text-sm ${LABEL_STYLE[label.tone]}`}>{label.text}</span>
          <span className="text-sm text-slate-500">({formatDateLabel(lead.followUpDate)})</span>
        </div>
        <p className="break-words text-sm text-slate-800">{lead.reason}</p>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>

      <ChatThread messages={messages} />

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium text-slate-800">Add to chat</legend>
        <div role="radiogroup" aria-label="Who said it" className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {([["buyer", "Buyer said"], ["rep", "I said"]] as const).map(([val, lbl]) => (
            <label
              key={val}
              className={`cursor-pointer px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600 ${msgFrom === val ? "bg-blue-600 text-white" : "bg-white text-slate-800 hover:bg-slate-50"}`}
            >
              <input type="radio" name="msg-from" value={val} checked={msgFrom === val} onChange={() => setMsgFrom(val)} className="sr-only" />
              {lbl}
            </label>
          ))}
        </div>
        <label htmlFor="new-message" className="block text-sm text-slate-700">
          Paste or type a message
        </label>
        <textarea
          id="new-message"
          rows={3}
          value={msgText}
          readOnly={busy}
          onChange={(e) => setMsgText(e.target.value)}
          className="block w-full rounded-md border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        />
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs ${msgText.length > MAX_DRAFT ? "font-semibold text-red-600" : "text-slate-500"}`}>
            {msgText.length}/{MAX_DRAFT}
          </span>
          <button
            type="button"
            onClick={addMessage}
            disabled={!canAddMessage(msgText, busy)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && busyPath === "messages" ? "Analysing…" : "Add to chat"}
          </button>
        </div>
      </fieldset>

      <div className={`space-y-2 rounded-md transition-shadow duration-700 ${highlight ? "bg-amber-50 ring-2 ring-amber-400" : "ring-0 ring-transparent"}`}>
        <label htmlFor="draft-message" className="block text-sm font-medium text-slate-800">
          Draft message
        </label>
        <textarea
          id="draft-message"
          rows={6}
          value={text}
          readOnly={busy}
          onChange={(e) => setText(e.target.value)}
          className="block w-full rounded-md border border-slate-300 p-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-500">{dirty ? "Unsaved changes" : ""}</span>
          <span className={over ? "font-semibold text-red-600" : "text-slate-500"}>
            {text.length}/{MAX_DRAFT}
          </span>
        </div>
        {actionError && (
          <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {actionError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!canSave(text, saved, busy)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!canSend(text, busy)}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && busyPath === "sent" ? "Sending…" : "Mark as sent"}
          </button>
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-emerald-700">
          {status}
        </p>
      </div>
        </>
      )}
    </div>
  );
}
