// Number, price, percentage and date tokens found in free text. Pure; shared by the
// fact sheet (draft-facts) and the post-generation check (draft-check).

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Real month names only (with the usual abbreviations); "mari" or "marketing" are not months.
const MONTH_RE =
  "\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b";

export interface NumberToken {
  raw: string; // for display: a bare number also shows the word after it ("3 din")
  text: string; // exactly what was matched

  kind: "number" | "money" | "percent" | "date";
  value?: number; // numeric value, with lakh / crore / k applied
  dateKey?: string; // "day-month" for a date
  day?: number;
}

const UNIT: Record<string, number> = { lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, k: 1e3, l: 1e5 };

// Digits with comma grouping (64,500 and 1,00,000), space grouping (64 500) or plain,
// optional decimals; an optional currency prefix; an optional unit suffix. Not matched
// inside a word or another number (B2B, PM250x), so model names do not count as facts.
const NUM_RE =
  /(?<![\p{L}\d.,])(?:(rs\.?|inr|₹)\s*)?((?:\d{1,3}(?:,\d{2,3})+|\d{1,3}(?: \d{3})+(?!\d)|\d+)(?:\.\d+)?)(?:\s*(%|percent\b)|\s*(lakhs?|lacs?|crores?)\b|(k|l|cr)\b)?/giu;
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
// dd/mm, dd/mm/yyyy and dd-mm-yyyy. A bare "5-10" is a range, not a date.
const SLASH_RE = /(?<![\d/.-])(\d{1,2})(?:\/(\d{1,2})(?:\/\d{2,4})?|-(\d{1,2})-\d{2,4})(?![\d/-])/g;
const DAY_MONTH_RE = new RegExp(`^\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}\\b`, "i");
const MONTH_DAY_RE = new RegExp(`${MONTH_RE}\\.?\\s*$`, "i");

function monthNo(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
}

function norm(n: number): number {
  return Math.round(n * 100) / 100;
}

export function extractNumberTokens(text: string): NumberToken[] {
  const toks: NumberToken[] = [];
  let rest = text;
  // Numeric dates first (2026-11-15, 15/11/2026), blanked out so they are not re-read as plain numbers.
  rest = rest.replace(ISO_RE, (m, _y, mo, d) => {
    toks.push({ raw: m, text: m, kind: "date", dateKey: `${Number(d)}-${Number(mo)}`, day: Number(d) });
    return " ".repeat(m.length);
  });
  rest = rest.replace(SLASH_RE, (m, a, b, c) => {
    const d = Number(a);
    const mo = Number(b ?? c);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return m;
    toks.push({ raw: m, text: m, kind: "date", dateKey: `${d}-${mo}`, day: d });
    return " ".repeat(m.length);
  });

  for (const m of rest.matchAll(NUM_RE)) {
    const [whole, cur, digits, pct, word, short] = m;
    const base = Number(digits.replace(/[, ]/g, ""));
    if (!Number.isFinite(base)) continue;
    const start = m.index ?? 0;
    const after = rest.slice(start + whole.length);
    const before = rest.slice(0, start);
    const dm = after.match(DAY_MONTH_RE);
    if (!cur && !pct && !word && !short && dm) {
      toks.push({ raw: `${whole.trim()} ${dm[0].trim()}`, text: `${whole.trim()} ${dm[0].trim()}`, kind: "date", dateKey: `${base}-${monthNo(dm[1])}`, day: base });
      continue;
    }
    const md = !cur && !pct && !word && !short ? before.match(MONTH_DAY_RE) : null;
    if (md) {
      toks.push({ raw: `${md[0].trim()} ${whole.trim()}`, text: `${md[0].trim()} ${whole.trim()}`, kind: "date", dateKey: `${base}-${monthNo(md[1])}`, day: base });
      continue;
    }
    const unit = (word ?? short)?.toLowerCase();
    const value = norm(unit ? base * (UNIT[unit] ?? 1) : base);
    if (pct) {
      toks.push({ raw: whole.trim(), text: whole.trim(), kind: "percent", value: base });
    } else if (cur) {
      toks.push({ raw: whole.trim(), text: whole.trim(), kind: "money", value });
    } else {
      // Show the unit word that follows a bare number ("3 din", "10 days").
      const nextWord = after.match(/^\s+([\p{L}]+)/u);
      toks.push({ raw: unit || !nextWord ? whole.trim() : `${whole.trim()} ${nextWord[1]}`, text: whole.trim(), kind: "number", value });
    }
  }
  return toks;
}

