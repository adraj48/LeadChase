export type Tag = "Hot" | "Warm" | "Cold";
export type Role = "rep" | "owner";

// A sales rep as the API returns it (GET /api/reps). There is no login and no owner
// account: the old owner view is simply the "All reps" filter.
export interface Rep {
  id: string;
  name: string;
}

// The `me` field of GET /api/leads, kept so that response keeps its shape. Without a
// login it is always the fixed "All reps" viewer (ALL_REPS_VIEWER in src/lib/access.ts).
export interface Viewer {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Message {
  id: string;
  leadId: string;
  from: "rep" | "buyer";
  text: string;
  at: string; // ISO datetime
}

export interface Lead {
  id: string;
  repId: string;
  repName: string;
  name: string;
  company: string;
  phone: string;
  source: string;
  lastContactDate: string;
  tag: Tag;
  reason: string;
  followUpDate: string;
  draft: string;
  analysisSource: "llm" | "fallback" | "seed";
  // 'pending' while the model result is still being written (tag/date are then
  // provisional). Absent when the database has no such column yet: treat as ready.
  analysisStatus?: "pending" | "ready";
  analysisStartedAt?: string | null;
}

export type Bucket = "overdue" | "today" | "upcoming";
