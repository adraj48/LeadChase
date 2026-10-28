"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead, Message } from "@/lib/types";
import {
  POLL_INTERVAL_MS,
  acceptsResponse,
  classifyIncoming,
  isPending,
  mergeRow,
  pollDecision,
  resolveFinalDraft,
  type DraftOutcome,
  type ChannelState,
} from "@/lib/analysis-state";
import { followUpLabel } from "@/lib/lead-view";
import {
  MAX_DRAFT,
  analysisNote,
  canSave,
  canSend,
  canAddMessage,
  updatedNote,
  formatDateLabel,
  sentToast,
  telHref,
  revalidatedDraft,
  sameRow,
} from "@/lib/detail-view";
import { validateMessage } from "@/lib/validate";
import { findUngroundedFacts, needsRepair, type DraftProblem } from "@/lib/draft-check";
import { countWords, takeWord, wordDelayMs } from "@/lib/word-reveal";
import { isAbortError, type LeadCache } from "@/lib/lead-cache";
import { LeadFetchError, type LeadDetailData } from "@/lib/lead-detail-client";
import { markChatReady, markFirstPaint, markOpenCache } from "@/lib/open-perf";
import { TagChip } from "./TagChip";
import { ChatThread } from "./ChatThread";

const LABEL_STYLE = {
  overdue: "text-red-700 font-semibold",
  today: "text-amber-800 font-semibold",
  upcoming: "text-neutral-600",
} as const;

interface Props {
  leadId: string;
  // The row already in the list: the header and draft render from it on the first
  // frame, while the chat comes from the cache or the network.
  initial: Lead;
  cache: LeadCache<LeadDetailData>;
  headingRef: React.Ref<HTMLHeadingElement>;
  today: string;
  showRep: boolean;
  onChanged: (lead?: Lead) => void;
  // Update the list row only (no refetch): used for pushed or polled analysis results.
  onPatched: (lead: Lead) => void;
  channel: ChannelState;
  subscribeRows: (fn: (lead: Lead) => void) => () => void;
  onGone: () => void;
}

function ChatSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading chat" className="chat-box chat-skel">
      <span className="chat-skel-bubble chat-skel-in w-3/5" />
      <span className="chat-skel-bubble chat-skel-out w-1/2" />
      <span className="chat-skel-bubble chat-skel-in w-2/3" />
    </div>
  );
}

export function LeadDetail({
  leadId,
  initial,
  cache,
  headingRef,
  today,
  showRep,
  onChanged,
  onPatched,
  channel,
  subscribeRows,
  onGone,
}: Props) {
  // The pane is keyed by lead id, so this initial state is per open. Cached chat
  // (if any) is shown at once; null messages means the chat is still loading.
  const [lead, setLead] = useState<Lead | null>(initial);
  const [messages, setMessages] = useState<Message[] | null>(() => cache.get(leadId)?.messages ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState(initial.draft ?? "");
  const [saved, setSaved] = useState(initial.draft ?? "");
  const [busy, setBusy] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [msgFrom, setMsgFrom] = useState<"buyer" | "rep">("buyer");
  const [msgText, setMsgText] = useState("");
  const [highlight, setHighlight] = useState(false);
  const hlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refocusRef = useRef(false);
  const [refocusTick, setRefocusTick] = useState(0);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const onPatchedRef = useRef(onPatched);
  onPatchedRef.current = onPatched;
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const todayRef = useRef(today);
  todayRef.current = today;
  // Latest values for event handlers (Realtime pushes and polls) that must not re-subscribe.
  const leadRef = useRef<Lead | null>(null);
  leadRef.current = lead;
  const textRef = useRef(text);
  textRef.current = text;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // Provisional-then-final analysis: pendingSince is when this view started waiting,
  // gaveUp unlocks the draft if no final result ever arrives, suggestion holds a new
  // reply that must not overwrite the rep's unsaved edits.
  const pendingSinceRef = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [, setTick] = useState(0);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // "Draft with agent": phase of the streaming suggestion, where it came from, and the
  // text to restore with Undo. The streamed text is an ordinary local draft edit.
  const [agentPhase, setAgentPhase] = useState<"idle" | "drafting" | "refining">("idle");
  const [agentSource, setAgentSource] = useState<"llm" | "fallback" | null>(null);
  const [undoText, setUndoText] = useState<string | null>(null);
  const agentBusyRef = useRef(false);
  const agentCtrlRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const agentFocusRef = useRef(false);
  const [agentFocusTick, setAgentFocusTick] = useState(0);
  const agentBusy = agentPhase !== "idle";

  const flash = useCallback((msg: string) => {
    if (!mountedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus(msg);
    timerRef.current = setTimeout(() => setStatus(null), 4000);
  }, []);

  const flashHighlight = useCallback(() => {
    if (hlTimerRef.current) clearTimeout(hlTimerRef.current);
    setHighlight(true);
    hlTimerRef.current = setTimeout(() => setHighlight(false), 2000);
  }, []);

  const startPending = useCallback(() => {
    pendingSinceRef.current = Date.now();
    setGaveUp(false);
    setSuggestion(null);
  }, []);

  // A row with a newer analysis state arrived (Realtime push or poll). Stale or
  // already-applied rows are dropped by classifyIncoming, so this never double-applies.
  const applyIncoming = useCallback(
    (row: Lead) => {
      const cur = leadRef.current;
      if (!cur || !mountedRef.current) return;
      const kind = classifyIncoming(cur, row);
      if (kind === "ignore") return;
      const merged = mergeRow(cur, row);
      leadRef.current = merged;
      setLead(merged);
      onPatchedRef.current(merged);
      cacheRef.current.patch(merged.id, (d) => ({ ...d, lead: merged }));
      if (kind === "provisional") {
        startPending();
        return;
      }
      // While the agent is writing into the box, the final draft is only ever offered, never applied.
      const out: DraftOutcome = agentBusyRef.current
        ? { kind: "suggest", suggestion: merged.draft }
        : resolveFinalDraft({ text: textRef.current, saved: savedRef.current }, merged.draft);
      if (out.kind === "replace") {
        setText(out.text);
        setSaved(out.saved);
        setSuggestion(null);
        setAgentSource(null);
        setUndoText(null);
      } else {
        setSuggestion(out.suggestion);
      }
      flash(updatedNote(merged, todayRef.current));
      flashHighlight();
    },
    [flash, flashHighlight, startPending],
  );

  useEffect(() => subscribeRows((row) => { if (row.id === leadId) applyIncoming(row); }), [subscribeRows, leadId, applyIncoming]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      agentCtrlRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hlTimerRef.current) clearTimeout(hlTimerRef.current);
    };
  }, []);

  // Full payload from the cache or the network (first load or background
  // revalidation). The list row on screen may be newer (a Realtime push), so an older
  // lead state is ignored, and the draft box is only replaced while it is clean.
  const applyLoaded = useCallback(
    (data: LeadDetailData) => {
      if (!mountedRef.current) return;
      setMessages(data.messages);
      setLoadError(null);
      const cur = leadRef.current;
      if (cur && !acceptsResponse(cur, data.lead)) return;
      const next: Lead = cur ? { ...data.lead, repName: data.lead.repName || cur.repName } : data.lead;
      const wasPending = !!cur && isPending(cur, Date.now());
      leadRef.current = next;
      setLead(next);
      if (!cur || !sameRow(cur, next)) onPatchedRef.current(next);
      const box = revalidatedDraft(
        { text: textRef.current, saved: savedRef.current, agentBusy: agentBusyRef.current },
        next.draft ?? "",
      );
      if (box) {
        setText(box.text);
        setSaved(box.saved);
      }
      if (!wasPending && isPending(next, Date.now())) startPending();
    },
    [startPending],
  );

  // Opened while a result is still being written (and not stuck): wait for it.
  useEffect(() => {
    if (isPending(initial, Date.now())) startPending();
    // Initial row only: later rows go through applyIncoming / applyLoaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stale-while-revalidate: cached chat is already on screen; fetch only when it is
  // missing or no longer fresh. A request started by a hover prefetch is joined, not repeated.
  useEffect(() => {
    const c = cacheRef.current;
    const cached = c.get(leadId);
    if (attempt === 0) {
      markOpenCache(leadId, cached ? "hit" : c.isLoading(leadId) ? "inflight" : "miss");
      markFirstPaint(leadId);
    }
    if (cached && c.isFresh(leadId)) return;
    const ctrl = new AbortController();
    c.load(leadId, { signal: ctrl.signal }).then(
      (data) => {
        if (!ctrl.signal.aborted) applyLoaded(data);
      },
      (e) => {
        if (ctrl.signal.aborted || isAbortError(e) || !mountedRef.current) return;
        if (e instanceof LeadFetchError && e.status === 404) {
          onGoneRef.current();
          return;
        }
        // With cached chat on screen a failed revalidation stays quiet.
        if (!cached) setLoadError(e instanceof Error ? e.message : "Network error");
      },
    );
    return () => ctrl.abort();
  }, [leadId, attempt, applyLoaded]);

  const chatReady = messages !== null;
  useEffect(() => {
    if (chatReady) markChatReady(leadId);
  }, [chatReady, leadId]);

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
    // Patch list row and cache from what was saved; no refetch needed.
    const cur = leadRef.current;
    if (cur) {
      const next = { ...cur, draft: sentText };
      leadRef.current = next;
      setLead(next);
      onPatchedRef.current(next);
      cacheRef.current.patch(leadId, (d) => ({ ...d, lead: { ...d.lead, draft: sentText } }));
    }
    setSaved(sentText);
    setUndoText(null);
    flash("Draft saved");
  }

  // Apply the lead + chat returned by a POST. In the normal case the lead is
  // 'pending': tag/reason/date are provisional and the final draft follows by push.
  function applyResponse(body: { lead: Lead; messages: Message[] }, mode: "sent" | "message", sentText = ""): void {
    setMessages(body.messages);
    const cur = leadRef.current;
    if (cur && !acceptsResponse(cur, body.lead)) {
      // the final push already won: keep its lead, take the new chat
      cacheRef.current.set(leadId, { lead: cur, messages: body.messages });
      return;
    }
    cacheRef.current.set(leadId, { lead: body.lead, messages: body.messages });
    leadRef.current = body.lead;
    setLead(body.lead);
    if (isPending(body.lead, Date.now())) {
      startPending();
      // What was sent is no longer a draft: treat the box as clean so it can be locked.
      if (mode === "sent") setSaved(sentText);
      return;
    }
    // Ready already (database without the analysis columns, or a very fast result).
    const draft = body.lead.draft ?? "";
    if (mode === "sent") {
      setText(draft);
      setSaved(draft);
      return;
    }
    const out = resolveFinalDraft({ text: textRef.current, saved: savedRef.current }, draft);
    if (out.kind === "replace") {
      setText(out.text);
      setSaved(out.saved);
    } else {
      setSuggestion(out.suggestion);
    }
  }

  async function send() {
    const sentText = text;
    const body = await request("sent", "POST");
    if (!body) return;
    // Server state changed: always refresh the list, even if this pane is gone.
    onChanged(body.lead && typeof body.lead === "object" ? (body.lead as Lead) : undefined);
    if (!mountedRef.current) return;
    if (!body.lead || !Array.isArray(body.messages)) {
      setActionError("Unexpected response from server");
      return;
    }
    applyResponse(body, "sent", sentText);
    setAgentSource(null);
    setUndoText(null);
    flash(sentToast(body.lead.followUpDate, today));
  }

  // ---- Draft with agent -------------------------------------------------------------
  // POSTs to the streaming route and shows the text word by word in the draft box.
  // Network chunks arrive in bursts, so they are buffered and revealed one word at a time
  // (all at once with prefers-reduced-motion). Nothing here writes to the database.
  type StreamOutcome =
    | { kind: "ok"; text: string; source: "llm" | "fallback"; stopped: boolean }
    | { kind: "error"; message: string }
    | { kind: "cancelled" }; // lead changed or pane closed: touch no state

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function streamSuggestion(forLead: string, repair?: string[]): Promise<StreamOutcome> {
    const ctrl = new AbortController();
    agentCtrlRef.current = ctrl;
    const gone = () => !mountedRef.current || (ctrl.signal.aborted && !stoppedRef.current);
    let res: Response;
    try {
      res = await fetch(`/api/leads/${encodeURIComponent(forLead)}/draft-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(repair ? { repair } : {}),
        signal: ctrl.signal,
      });
    } catch {
      if (gone()) return { kind: "cancelled" };
      if (stoppedRef.current) return { kind: "ok", text: "", source: "llm", stopped: true };
      return { kind: "error", message: "Couldn't reach the server. Check your connection and try again." };
    }
    if (res.status === 404) {
      if (mountedRef.current) onGoneRef.current();
      return { kind: "error", message: "Lead not found" };
    }
    if (res.status === 429) return { kind: "error", message: "Too many requests, try again in a minute" };
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      return { kind: "error", message: body.error ?? "Something went wrong" };
    }

    const source = res.headers.get("X-Draft-Source") === "fallback" ? "fallback" : "llm";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = "";
    let shown = "";
    let ended = false;
    let readFailed = false;
    const reading = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
        }
        buffer += dec.decode();
      } catch {
        readFailed = true; // aborted (Stop, lead change) or the connection dropped
      }
      ended = true;
    })();

    for (;;) {
      if (!mountedRef.current || ctrl.signal.aborted) break;
      const w = reduce ? null : takeWord(buffer, ended);
      if (w) {
        shown += w.word;
        buffer = w.rest;
        setText(shown);
        await sleep(wordDelayMs(countWords(buffer), ended));
        continue;
      }
      if (ended) break;
      await sleep(16);
    }
    await reading;
    if (gone()) return { kind: "cancelled" };
    // Stop keeps what the rep has seen appear (with reduced motion nothing is shown until
    // the end, so there it keeps everything that arrived).
    const text = (stoppedRef.current && !reduce ? shown : shown + buffer).trim();
    if (!text) {
      if (stoppedRef.current) return { kind: "ok", text: "", source, stopped: true };
      return { kind: "error", message: readFailed ? "The connection dropped. Try again." : "No suggestion came back. Try again." };
    }
    setText(text);
    return { kind: "ok", text, source, stopped: stoppedRef.current };
  }

  function checkContext() {
    return { lead: leadRef.current!, messages: messages ?? [], todayIST: todayRef.current };
  }

  async function draftWithAgent() {
    if (agentBusyRef.current || !leadRef.current || messages === null) return;
    const forLead = leadId;
    const previous = textRef.current;
    stoppedRef.current = false;
    agentBusyRef.current = true;
    setAgentPhase("drafting");
    setActionError(null);
    setAgentSource(null);
    setUndoText(null);
    setSuggestion(null);
    setText("");

    const restore = (message: string | null) => {
      setText(previous);
      if (message) setActionError(message);
    };
    const finish = (text: string, source: "llm" | "fallback") => {
      setText(text);
      setAgentSource(source);
      setUndoText(previous !== text && previous.trim() ? previous : null);
      agentFocusRef.current = true;
      setAgentFocusTick((n) => n + 1);
    };
    const idle = () => {
      agentBusyRef.current = false;
      agentCtrlRef.current = null;
      setAgentPhase("idle");
    };

    const first = await streamSuggestion(forLead);
    if (first.kind === "cancelled") return;
    if (first.kind === "error") {
      restore(first.message);
      idle();
      return;
    }
    if (!first.text) {
      restore(null); // stopped before anything arrived
      idle();
      return;
    }
    let final = first;
    // One automatic rewrite when the first answer states something the chat does not
    // contain or is in the wrong language. The first text stays on screen until the
    // rewrite starts to arrive; if the rewrite fails, the first text is kept.
    if (!first.stopped && first.source === "llm") {
      const problems = findUngroundedFacts(first.text, checkContext());
      if (needsRepair(problems)) {
        setAgentPhase("refining");
        const second = await streamSuggestion(
          forLead,
          problems.filter((p) => p.kind !== "style").map((p) => p.text),
        );
        if (second.kind === "cancelled") return;
        if (second.kind === "ok" && second.text) final = second;
        else setText(first.text);
      }
    }
    finish(final.text, final.source);
    idle();
  }

  function stopAgent() {
    stoppedRef.current = true;
    agentCtrlRef.current?.abort();
  }

  function undoAgent() {
    if (undoText === null) return;
    setText(undoText);
    setUndoText(null);
    setAgentSource(null);
    agentFocusRef.current = true;
    setAgentFocusTick((n) => n + 1);
  }

  useEffect(() => {
    if (agentPhase === "idle" && agentFocusRef.current) {
      agentFocusRef.current = false;
      const el = document.getElementById("draft-message") as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [agentPhase, agentFocusTick]);

  // Keep the newest words in view while the text grows.
  useEffect(() => {
    if (!agentBusy) return;
    const el = document.getElementById("draft-message");
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, agentBusy]);

  async function addMessage() {
    if (!canAddMessage(msgText, busy)) return;
    const v = validateMessage({ from: msgFrom, text: msgText });
    if (!v.ok) {
      setActionError(v.error);
      return;
    }
    const body = await request("messages", "POST", v.value);
    if (!body) return;
    // Server state changed: always refresh the list, even if this pane is gone.
    onChanged(body.lead && typeof body.lead === "object" ? (body.lead as Lead) : undefined);
    if (!mountedRef.current) return;
    if (!body.lead || !Array.isArray(body.messages)) {
      setActionError("Unexpected response from server");
      return;
    }
    applyResponse(body, "message");
    setMsgText("");
    flash(updatedNote(body.lead, today));
    flashHighlight();
    // Ask the effect below to return focus to the message box once the fieldset is re-enabled.
    refocusRef.current = true;
    setRefocusTick((n) => n + 1);
  }

  useEffect(() => {
    if (!busy && refocusRef.current) {
      refocusRef.current = false;
      document.getElementById("new-message")?.focus();
    }
  }, [busy, refocusTick]);

  const pending = !!lead && !gaveUp && isPending(lead, Date.now());
  const dirty = text !== saved;
  // Anything in the finished suggestion the chat does not support (amber notice, never blocks).
  const problems: DraftProblem[] = lead && agentSource === "llm" && !agentBusy ? findUngroundedFacts(text, { lead, messages: messages ?? [], todayIST: today }) : [];
  // While the reply is being written a clean draft box is locked and shows a shimmer;
  // a box with the rep's unsaved edits stays editable and is never overwritten.
  const locked = pending && !dirty;

  // Backup for a Realtime channel that is down or silent: poll the lead until the
  // result is ready (see pollDecision). Realtime delivering the result ends this.
  useEffect(() => {
    if (!pending) return;
    const ctrl = new AbortController();
    let inFlight = false;
    const timer = setInterval(async () => {
      const d = pollDecision({
        pending: true,
        channel: channelRef.current,
        pendingForMs: Date.now() - pendingSinceRef.current,
      });
      if (d === "give-up") {
        setGaveUp(true);
        return;
      }
      setTick((n) => n + 1); // re-evaluate the 90 s stuck-pending rule
      if (d !== "poll" || inFlight) return;
      inFlight = true;
      try {
        // Forced: a poll must see the newest state, not join an older request.
        const data = await cacheRef.current.load(leadId, { signal: ctrl.signal, force: true });
        if (!ctrl.signal.aborted) applyIncoming(data.lead);
      } catch {
        // Offline or aborted: try again on the next tick.
      } finally {
        inFlight = false;
      }
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [pending, leadId, applyIncoming]);

  const label = lead ? followUpLabel(lead.followUpDate, today) : null;
  const note = lead && !pending ? analysisNote(lead.analysisSource) : null;
  const shownText = locked ? "" : text;
  const over = text.length > MAX_DRAFT;
  const blocked = busy || !chatReady;

  return (
    <div className="panel lead-enter flex flex-col space-y-4 p-4 sm:p-6 lg:max-h-[calc(100dvh-5.5rem)] lg:space-y-2 lg:overflow-y-auto lg:px-5 lg:py-3.5">
      <h2 ref={headingRef} tabIndex={-1} className="break-words text-xl font-semibold lg:text-lg text-neutral-900 focus:outline-none">
        {lead?.name}
      </h2>
      {lead && label && (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 lg:shrink-0">
        <p className="break-words text-sm text-neutral-800">{lead.company}</p>
        <p className="text-sm text-neutral-800">
          <a href={telHref(lead.phone)} className="focus-ring rounded-sm font-medium text-primary-600 underline underline-offset-2 transition-colors duration-150 hover:text-primary-500 hover:decoration-2">
            {lead.phone}
          </a>
          <span className="text-neutral-600"> · {lead.source}</span>
        </p>
        <p className="text-sm text-neutral-600">Last contact: {formatDateLabel(lead.lastContactDate)}</p>
        {showRep && <p className="text-sm text-neutral-600">Rep: {lead.repName}</p>}
      </div>

      <div className={`min-w-0 space-y-1 rounded-card transition-shadow duration-700 lg:shrink-0 ${highlight ? "bg-amber-50 ring-2 ring-amber-400" : "ring-0 ring-transparent"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <TagChip tag={lead.tag} />
          <span className={`text-sm ${LABEL_STYLE[label.tone]}`}>{label.text}</span>
          <span className="tabular text-sm text-neutral-600">({formatDateLabel(lead.followUpDate)})</span>
        </div>
        <p className="break-words text-sm text-neutral-900">{lead.reason}</p>
        {note && <p className="text-xs text-neutral-600">{note}</p>}
      </div>

      {messages !== null ? (
        <ChatThread messages={messages} />
      ) : loadError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-card border border-red-200 bg-red-50 p-3 text-red-700">
          <span className="min-w-0 break-words">{loadError}</span>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
            className="btn btn-danger"
          >
            Retry
          </button>
        </div>
      ) : (
        <ChatSkeleton />
      )}

      <fieldset className="space-y-1.5 lg:shrink-0" disabled={busy}>
        <legend className="text-sm font-medium text-neutral-900">Add to chat</legend>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div role="radiogroup" aria-label="Who said it" className="inline-flex overflow-hidden rounded-input border border-neutral-200 bg-white shadow-input">
          {([["buyer", "Buyer said"], ["rep", "I said"]] as const).map(([val, lbl]) => (
            <label
              key={val}
              className={`cursor-pointer px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-primary-500 ${msgFrom === val ? "bg-primary-500 text-white" : "bg-white text-neutral-800 hover:bg-neutral-25"}`}
            >
              <input type="radio" name="msg-from" value={val} checked={msgFrom === val} onChange={() => setMsgFrom(val)} className="sr-only" />
              {lbl}
            </label>
          ))}
        </div>
        <label htmlFor="new-message" className="block text-sm text-neutral-800">
          Paste or type a message
        </label>
        </div>
        <textarea
          id="new-message"
          rows={2}
          value={msgText}
          readOnly={busy}
          onChange={(e) => setMsgText(e.target.value)}
          className="field resize-y lg:max-h-24"
        />
        <div className="flex items-center justify-between gap-2">
          <span className={`tabular text-xs ${msgText.length > MAX_DRAFT ? "font-semibold text-red-600" : "text-neutral-600"}`}>
            {msgText.length}/{MAX_DRAFT}
          </span>
          <button
            type="button"
            onClick={addMessage}
            disabled={!canAddMessage(msgText, blocked || agentBusy)}
            className="btn btn-primary"
          >
            {busy && busyPath === "messages" ? "Analysing…" : "Add to chat"}
          </button>
        </div>
      </fieldset>

      <div className={`space-y-1.5 rounded-card transition-shadow duration-700 lg:sticky lg:bottom-0 lg:shrink-0 ${highlight ? "bg-amber-50 ring-2 ring-amber-400" : "bg-white ring-0 ring-transparent"}`}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="draft-message" className="block text-sm font-medium text-neutral-900">
            Draft message
          </label>
          <button
            type="button"
            onClick={agentBusy ? stopAgent : draftWithAgent}
            disabled={!agentBusy && (blocked || pending)}
            className="btn btn-secondary !gap-1.5 !px-2.5 !py-1 !text-xs !leading-4"
          >
            {agentBusy ? (
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 text-primary-500" fill="currentColor">
                <path d="M6.5 1.5 7.6 5a2 2 0 0 0 1.4 1.4l3.5 1.1-3.5 1.1A2 2 0 0 0 7.6 10l-1.1 3.5L5.4 10a2 2 0 0 0-1.4-1.4L.5 7.5 4 6.4A2 2 0 0 0 5.4 5l1.1-3.5Z" />
                <path d="M12.5 1 13 2.5l1.5.5-1.5.5-.5 1.5-.5-1.5L10.5 3l1.5-.5.5-1.5Z" />
              </svg>
            )}
            {agentBusy ? "Stop" : "Draft with agent"}
          </button>
        </div>
        <textarea
          id="draft-message"
          rows={3}
          value={shownText}
          readOnly={busy || locked || agentBusy}
          aria-busy={locked || agentBusy}
          placeholder={agentBusy ? "Writing a suggestion…" : locked ? "Writing your reply…" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (undoText !== null) setUndoText(null);
          }}
          className={`field resize-y lg:max-h-28 ${locked || (agentBusy && !text) ? "shimmer" : ""}`}
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span aria-live="polite" className="text-neutral-600">
            {suggestion !== null ? (
              <button
                type="button"
                onClick={() => {
                  setText(suggestion);
                  setSaved(suggestion);
                  setSuggestion(null);
                  setAgentSource(null);
                  setUndoText(null);
                }}
                className="focus-ring rounded-sm font-medium text-primary-600 underline underline-offset-2 hover:text-primary-500"
              >
                New suggested reply is ready. Use it
              </button>
            ) : agentPhase !== "idle" ? (
              agentPhase === "refining" ? "Refining the suggestion…" : "Drafting with the agent…"
            ) : agentSource ? (
              <>
                {agentSource === "fallback" ? "Rule-based suggestion (AI unavailable)." : "Suggested by the agent. Edit before sending."}
                {undoText !== null && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={undoAgent}
                      className="focus-ring rounded-sm font-medium text-primary-600 underline underline-offset-2 hover:text-primary-500"
                    >
                      Undo
                    </button>
                  </>
                )}
              </>
            ) : pending ? (
              dirty ? "Unsaved changes · new reply coming" : "Writing your reply…"
            ) : dirty ? (
              "Unsaved changes"
            ) : (
              ""
            )}
          </span>
          <span className={over ? "font-semibold text-red-600" : "text-neutral-600"}>
            {shownText.length}/{MAX_DRAFT}
          </span>
        </div>
        {problems.length > 0 && (
          <p role="status" className="break-words rounded-input border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            Check before sending: {problems.slice(0, 3).map((p) => p.text).join("; ")}
            {problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}
          </p>
        )}
        {actionError && (
          <p role="alert" className="break-words rounded-input border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
            {actionError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!canSave(text, saved, blocked) || pending || agentBusy}
            className="btn btn-secondary"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!canSend(text, blocked) || pending || agentBusy}
            className="btn btn-dark"
          >
            {busy && busyPath === "sent" ? "Sending…" : "Mark as sent"}
          </button>
          <p role="status" aria-live="polite" className="min-h-5 min-w-0 flex-1 text-sm text-emerald-700">
            {status}
          </p>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
