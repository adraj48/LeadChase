"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/types";
import { formatChatTime } from "@/lib/detail-view";

export function ChatThread({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Chat history"
      className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      {messages.length === 0 ? (
        <p className="text-sm text-slate-500">No messages yet.</p>
      ) : (
        messages.map((m) => {
          const rep = m.from === "rep";
          return (
            <div key={m.id} className={`flex ${rep ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm text-slate-900 ${
                  rep ? "bg-emerald-100" : "border border-slate-200 bg-white"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className="mt-1 text-right text-xs text-slate-500">{formatChatTime(m.at)}</p>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
