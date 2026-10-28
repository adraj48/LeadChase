"use client";

import type { Tag } from "@/lib/types";
import { ALL_REPS, type RepOption, type Viewing } from "@/lib/rep-selection";
import { TagChip } from "./TagChip";
import { BrandMark } from "./BrandMark";

interface Props {
  reps: RepOption[];
  viewing: Viewing | null; // null until the rep list (or a stored choice) is known
  onViewing: (v: Viewing) => void;
  counts: Record<Tag, number>;
  onAddLead?: () => void;
  addDisabled?: boolean;
}

export function Header({ reps, viewing, onViewing, counts, onAddLead, addDisabled }: Props) {
  const all = viewing === ALL_REPS;
  // Keep a stored rep selectable while the list is still loading.
  const known = viewing === null || all || reps.some((r) => r.id === viewing);
  return (
    <header className="sticky top-0 z-10 border-b border-neutral-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
          <BrandMark />
          LeadChase
        </h1>
        {all && (
          <div className="flex items-center gap-2" aria-label="Lead counts by tag">
            {(["Hot", "Warm", "Cold"] as Tag[]).map((t) => (
              <TagChip key={t} tag={t} count={counts[t]} />
            ))}
          </div>
        )}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
          {onAddLead && (
            <button type="button" onClick={onAddLead} disabled={addDisabled} className="btn btn-primary">
              + Add lead
            </button>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor="viewing-as" className="shrink-0 text-sm text-neutral-800">
              Viewing as
            </label>
            <select
              id="viewing-as"
              value={viewing ?? ""}
              disabled={viewing === null}
              onChange={(e) => onViewing(e.target.value)}
              className="field w-auto min-w-0 max-w-[11rem] py-1.5"
            >
              {viewing === null && <option value="">Loading…</option>}
              {!known && viewing && <option value={viewing}>Loading…</option>}
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              <option value={ALL_REPS}>All reps</option>
            </select>
          </div>
        </div>
      </div>
    </header>
  );
}
