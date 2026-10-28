// "Viewing as" selection: which rep's leads the dashboard shows. Pure helpers so the
// persistence and fallback rules are unit-tested; storage is injected and every
// access is guarded (private mode, blocked storage) so the app works without it.

export interface RepOption {
  id: string;
  name: string;
}

export const ALL_REPS = "all";
export type Viewing = string; // a rep id or ALL_REPS
export const VIEWING_KEY = "leadchase.viewingAs";
export const DEFAULT_REP_NAME = "Sneha Iyer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** True for ALL_REPS or a uuid: the only values a view can take. */
export function isViewing(v: unknown): v is Viewing {
  return v === ALL_REPS || (typeof v === "string" && UUID_RE.test(v));
}

/** A syntactically valid stored choice, or null. */
export function readViewing(storage: StorageLike | null | undefined): Viewing | null {
  try {
    const v = storage?.getItem(VIEWING_KEY);
    if (v === ALL_REPS || (typeof v === "string" && UUID_RE.test(v))) return v;
  } catch {
    // storage unavailable
  }
  return null;
}

export function writeViewing(storage: StorageLike | null | undefined, v: Viewing): void {
  try {
    storage?.setItem(VIEWING_KEY, v);
  } catch {
    // storage unavailable or full: the choice just is not remembered
  }
}

/**
 * The effective choice once the rep list is known: a stored "all" or a stored rep
 * that still exists wins; otherwise the default rep by name, then the first rep,
 * then "all" when there are no reps at all.
 */
export function resolveViewing(reps: RepOption[], stored: Viewing | null): Viewing {
  if (stored === ALL_REPS) return ALL_REPS;
  if (stored && reps.some((r) => r.id === stored)) return stored;
  return pickDefaultRepId(reps);
}

/** The default rep's id (by name, else the first rep by name), or ALL_REPS when none. Server and client share it. */
export function pickDefaultRepId(reps: RepOption[]): string {
  const preferred = reps.find((r) => r.name.trim().toLowerCase() === DEFAULT_REP_NAME.toLowerCase());
  if (preferred) return preferred.id;
  const first = [...reps].sort((a, b) => a.name.localeCompare(b.name))[0];
  return first?.id ?? ALL_REPS;
}

/** The leads URL for a first-time visitor: the server resolves the default rep itself. */
export const DEFAULT_LEADS_URL = "/api/leads?rep=default";

export function leadsUrl(v: Viewing): string {
  return `/api/leads?rep=${encodeURIComponent(v)}`;
}

/** Parse a GET /api/reps body defensively; sorted by name. */
export function parseReps(body: unknown): RepOption[] {
  const list = (body as { reps?: unknown } | null)?.reps;
  if (!Array.isArray(list)) return [];
  return list
    .filter((r): r is RepOption => !!r && typeof r.id === "string" && typeof r.name === "string")
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function repName(reps: RepOption[], id: string): string | null {
  return reps.find((r) => r.id === id)?.name ?? null;
}
