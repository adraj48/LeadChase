export type Tag = "Hot" | "Warm" | "Cold";
export type Role = "rep" | "owner";

export interface Rep {
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
}

export type Bucket = "overdue" | "today" | "upcoming";
