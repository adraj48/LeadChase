import type { NewLeadInput } from "@/lib/repo";

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

export const SOURCES = ["IndiaMART", "Referral", "Trade show", "Website", "Cold call"] as const;
const PHONE = /^\+?[0-9 ]{10,15}$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TEXT = 1000;
const MAX_NAME = 120;

const fail = (error: string): Err => ({ ok: false, error });

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function reqString(o: Record<string, unknown>, field: string, max: number): Ok<string> | Err {
  const v = o[field];
  if (typeof v !== "string" || !v.trim()) return fail(`${field} is required`);
  const t = v.trim();
  if (t.length > max) return fail(`${field} must be at most ${max} characters`);
  return { ok: true, value: t };
}

export function isRealIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function validateText(body: unknown, field: "text" | "draft"): Ok<string> | Err {
  const o = asObject(body);
  if (!o) return fail("Body must be a JSON object");
  return reqString(o, field, MAX_TEXT);
}

export function validateMessage(
  body: unknown,
): Ok<{ from: "rep" | "buyer"; text: string }> | Err {
  const o = asObject(body);
  if (!o) return fail("Body must be a JSON object");
  if (o.from !== "rep" && o.from !== "buyer") return fail("from must be 'rep' or 'buyer'");
  const t = reqString(o, "text", MAX_TEXT);
  if (!t.ok) return t;
  return { ok: true, value: { from: o.from, text: t.value } };
}

export function validateNewLead(body: unknown, today: string): Ok<NewLeadInput> | Err {
  const o = asObject(body);
  if (!o) return fail("Body must be a JSON object");
  const name = reqString(o, "name", MAX_NAME);
  if (!name.ok) return name;
  const company = reqString(o, "company", MAX_NAME);
  if (!company.ok) return company;
  const phone = reqString(o, "phone", 40);
  if (!phone.ok) return phone;
  if (!PHONE.test(phone.value)) return fail("phone is invalid");
  const source = reqString(o, "source", 40);
  if (!source.ok) return source;
  if (!(SOURCES as readonly string[]).includes(source.value)) return fail("source is invalid");
  const date = reqString(o, "lastContactDate", 10);
  if (!date.ok) return date;
  if (!isRealIsoDate(date.value)) return fail("lastContactDate must be a valid YYYY-MM-DD date");
  if (date.value > today) return fail("lastContactDate cannot be in the future");
  const value: NewLeadInput = {
    name: name.value,
    company: company.value,
    phone: phone.value,
    source: source.value,
    lastContactDate: date.value,
  };
  if (typeof o.repId === "string" && o.repId.trim()) value.repId = o.repId.trim();
  return { ok: true, value };
}
