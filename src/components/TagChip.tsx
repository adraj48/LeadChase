import type { Tag } from "@/lib/types";

const STYLES: Record<Tag, string> = {
  Hot: "bg-red-50 text-red-600 border-red-100",
  Warm: "bg-amber-50 text-amber-700 border-amber-100",
  Cold: "bg-neutral-50 text-neutral-800 border-neutral-100",
};

const DOTS: Record<Tag, string> = {
  Hot: "bg-red-500",
  Warm: "bg-amber-500",
  Cold: "bg-primary-400",
};

export function TagChip({ tag, count }: { tag: Tag; count?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[tag]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOTS[tag]}`} />
      {tag}
      {count !== undefined && <span className="tabular font-semibold">{count}</span>}
    </span>
  );
}
