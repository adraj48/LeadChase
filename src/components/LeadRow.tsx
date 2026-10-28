import type { Lead } from "@/lib/types";
import { followUpLabel } from "@/lib/lead-view";
import { TagChip } from "./TagChip";

const ROW_STYLE = {
  overdue: "border-l-4 border-red-500 bg-red-50",
  today: "border-l-4 border-amber-400 bg-white",
  upcoming: "border-l-4 border-transparent bg-white",
} as const;

const LABEL_STYLE = {
  overdue: "text-red-700 font-semibold",
  today: "text-amber-800 font-semibold",
  upcoming: "text-slate-500",
} as const;

export function LeadRow({
  lead,
  today,
  selected,
  showRep,
  onSelect,
}: {
  lead: Lead;
  today: string;
  selected: boolean;
  showRep: boolean;
  onSelect: (id: string) => void;
}) {
  const label = followUpLabel(lead.followUpDate, today);
  return (
    <button
      type="button"
      onClick={() => onSelect(lead.id)}
      aria-current={selected ? "true" : undefined}
      className={`block w-full rounded-lg border border-slate-200 p-3 text-left shadow-sm hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${ROW_STYLE[label.tone]} ${
        selected ? "ring-2 ring-blue-600" : ""
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="font-bold text-slate-900">{lead.name}</span>
          <span className="text-slate-600"> · {lead.company}</span>
        </span>
        <span className={`shrink-0 text-sm ${LABEL_STYLE[label.tone]}`}>{label.text}</span>
      </span>
      <span className="mt-1.5 flex items-center gap-2">
        <TagChip tag={lead.tag} />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{lead.reason}</span>
      </span>
      {showRep && <span className="mt-1 block text-xs text-slate-500">Rep: {lead.repName}</span>}
    </button>
  );
}
