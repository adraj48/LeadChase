import { memo } from "react";
import type { Lead } from "@/lib/types";
import { followUpLabel } from "@/lib/lead-view";
import { TagChip } from "./TagChip";

const ROW_STYLE = {
  overdue: "border-red-200 bg-red-50/60 hover:border-red-300",
  today: "border-neutral-100 bg-neutral-25 hover:border-primary-200",
  upcoming: "border-neutral-100 bg-neutral-25 hover:border-primary-200",
} as const;

const LABEL_STYLE = {
  overdue: "text-red-700 font-semibold",
  today: "text-amber-800 font-semibold",
  upcoming: "text-neutral-600",
} as const;

// Memoized: selecting a lead re-renders only the two rows whose `selected` changed,
// not the whole list (151 rows in "All reps").
export const LeadRow = memo(function LeadRow({
  lead,
  today,
  selected,
  showRep,
  onSelect,
  onIntent,
  onIntentEnd,
}: {
  lead: Lead;
  today: string;
  selected: boolean;
  showRep: boolean;
  onSelect: (id: string) => void;
  // Prefetch hooks: the rep is likely about to open this lead (hover, focus, touch).
  onIntent?: (id: string) => void;
  onIntentEnd?: (id: string) => void;
}) {
  const label = followUpLabel(lead.followUpDate, today);
  return (
    <button
      type="button"
      data-lead-id={lead.id}
      onClick={() => onSelect(lead.id)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onIntent?.(lead.id);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onIntentEnd?.(lead.id);
      }}
      onTouchStart={() => onIntent?.(lead.id)}
      onTouchMove={() => onIntentEnd?.(lead.id)}
      onFocus={() => onIntent?.(lead.id)}
      onBlur={() => onIntentEnd?.(lead.id)}
      aria-current={selected ? "true" : undefined}
      className={`focus-ring lead-row block w-full rounded-card border p-3.5 text-left ${
        selected ? "border-primary-500 bg-primary-25 shadow-panel" : ROW_STYLE[label.tone]
      }`}
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="font-semibold text-neutral-900">{lead.name}</span>
          <span className="text-neutral-600"> · {lead.company}</span>
        </span>
        <span className={`tabular shrink-0 text-sm ${LABEL_STYLE[label.tone]}`}>{label.text}</span>
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-2">
        <TagChip tag={lead.tag} />
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-600">{lead.reason}</span>
      </span>
      {showRep && <span className="mt-1 block text-xs text-neutral-600">Rep: {lead.repName}</span>}
    </button>
  );
});
