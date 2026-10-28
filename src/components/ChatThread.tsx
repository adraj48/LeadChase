"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/types";
import { formatChatTime, formatDateLabel } from "@/lib/detail-view";
import "./chat-theme.css";

const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = (iso: string) => DAY_FMT.format(new Date(iso));

export function ChatThread({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);
  // Messages present when the thread first renders get a quick top-to-bottom stagger
  // (last 12 only); anything added later animates in on its own.
  const [initial] = useState(() => new Map(messages.slice(-12).map((m, i) => [m.id, i])));
  const [initialIds] = useState(() => new Set(messages.map((m) => m.id)));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const smooth = !firstRun.current && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    firstRun.current = false;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={ref} role="log" aria-label="Chat history" className="chat-box">
      {messages.length === 0 ? (
        <p className="chat-empty">No messages yet.</p>
      ) : (
        messages.map((m, i) => {
          const rep = m.from === "rep";
          const idx = initial.get(m.id);
          const animate = initialIds.has(m.id) ? idx !== undefined : true;
          const delay = idx === undefined ? undefined : Math.min(idx * 35, 400);
          const day = dayKey(m.at);
          const prev = i > 0 ? messages[i - 1] : undefined;
          const newDay = !prev || dayKey(prev.at) !== day;
          const sameRun = !newDay && prev !== undefined && prev.from === m.from;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div role="separator" className="chat-day">
                  {formatDateLabel(day)}
                </div>
              )}
              <div
                className={`chat-row ${rep ? "out chat-out" : "in chat-in"} ${sameRun ? "same" : "tail"} ${animate ? "msg-in" : ""}`}
                style={delay === undefined ? undefined : { animationDelay: `${delay}ms` }}
              >
                <div className="bubble">
                  <p className="chat-text">{m.text}</p>
                  <p className="chat-meta bubble-time">
                    {formatChatTime(m.at)}
                    {rep && (
                      <svg className="chat-ticks" viewBox="0 0 16 11" fill="none" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 6l3.200 3.200L10.500 1.500M6 8.500l.7.700L13 1.500" />
                      </svg>
                    )}
                  </p>
                </div>
              </div>
            </Fragment>
          );
        })
      )}
    </div>
  );
}
