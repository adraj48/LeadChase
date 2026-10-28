import type { Tag } from "@/lib/types";

const STYLES: Record<Tag, string> = {
  Hot: "bg-red-100 text-red-700",
  Warm: "bg-amber-100 text-amber-800",
  Cold: "bg-slate-100 text-slate-600",
};

export function TagChip({ tag, count }: { tag: Tag; count?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[tag]}`}
    >
      {tag}
      {count !== undefined && <span className="font-semibold">{count}</span>}
    </span>
  );
}
