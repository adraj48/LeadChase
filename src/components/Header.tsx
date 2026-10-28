"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Rep, Tag } from "@/lib/types";
import { TagChip } from "./TagChip";

interface Props {
  me: Pick<Rep, "name" | "role">;
  reps: Rep[];
  repFilter: string;
  onRepFilter: (repId: string) => void;
  counts: Record<Tag, number>;
}

export function Header({ me, reps, repFilter, onRepFilter, counts }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const isOwner = me.role === "owner";

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <h1 className="text-lg font-bold text-slate-900">Axon Leads</h1>
        {isOwner && (
          <div className="flex items-center gap-2" aria-label="Lead counts by tag">
            {(["Hot", "Warm", "Cold"] as Tag[]).map((t) => (
              <TagChip key={t} tag={t} count={counts[t]} />
            ))}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {isOwner && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Rep
              <select
                value={repFilter}
                onChange={(e) => onRepFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="">All reps</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="text-sm text-slate-700">
            {me.name} <span className="text-slate-500">({me.role})</span>
          </span>
          <button
            type="button"
            onClick={logout}
            disabled={pending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
