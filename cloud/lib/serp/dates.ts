/**
 * Publication dates from SerpAPI results, as precisely as the payload allows.
 *
 * Ported from Company Monitor's monitor.parse_pub_date and bulk_search.published_date; golden.json (generated
 * from the Python) pins the two together. A date is a plain "YYYY-MM-DD" string, or null for "unknown" - never a
 * guess at an unreadable value.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A calendar date as YYYY-MM-DD, or null when it does not exist (Feb 30, month 13). */
export function ymd(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

const utcDate = (t: Date) => `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;

const RELATIVE = /^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i;
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000, // monitor.parse_pub_date counts a month as 30 days
};

// RFC 2822, what Google News RSS carries: "Wed, 08 Jul 2026 07:09:00 GMT". The date as written, like Python's
// parsedate_to_datetime(...).date(), which keeps the stated offset rather than converting to UTC.
const RFC2822 = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+\d{1,2}:\d{2}(?::\d{2})?\s+(?:[+-]\d{4}|[A-Za-z]{1,5})$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})T\d{6}Z$/; // GDELT seendate
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\s?[+-]\d{2}:?\d{2})$/;
const MON_D_Y = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/; // "Jul 8, 2026"
const D_MON_Y = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/; // "8 Jul 2026"
const M_D_Y = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/; // "07/08/2026"

const month = (name: string) => MONTHS[name.toLowerCase()];

/** Best-effort parse of the date strings SerpAPI shows. `now` anchors relative ages ("3 days ago"). */
export function parsePubDate(raw: string | null | undefined, now: Date = new Date()): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  const rel = RELATIVE.exec(s);
  if (rel) return utcDate(new Date(now.getTime() - Number(rel[1]) * UNIT_MS[rel[2].toLowerCase()]));
  if (s.toLowerCase() === "yesterday") return utcDate(new Date(now.getTime() - UNIT_MS.day));

  let m = RFC2822.exec(s);
  if (m && month(m[2])) return ymd(+m[3], month(m[2]), +m[1]);
  m = COMPACT.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = ISO.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = MON_D_Y.exec(s);
  if (m && month(m[1])) return ymd(+m[3], month(m[1]), +m[2]);
  m = D_MON_Y.exec(s);
  if (m && month(m[2])) return ymd(+m[3], month(m[2]), +m[1]);
  m = M_D_Y.exec(s);
  if (m) return ymd(+m[3], +m[1], +m[2]);
  return null;
}

/** google_news results carry iso_date, an exact UTC timestamp; everything else has a display string only. */
export function publishedDate(res: { iso_date?: unknown; date?: unknown }, now: Date = new Date()): string | null {
  const iso = typeof res.iso_date === "string" ? res.iso_date.trim() : "";
  if (iso) {
    const t = new Date(iso);
    if (!Number.isNaN(t.getTime())) return utcDate(t);
  }
  return parsePubDate(typeof res.date === "string" ? res.date : "", now);
}

/** True when the row is confirmed outside [start, end]; null when that cannot be told (no window, no date). */
export function rangeFlag(published: string | null, start: string, end: string): boolean | null {
  if (!(start && end) || published === null) return null;
  return !(start <= published && published <= end);
}

/** The day after an ISO date: Google's before: operator is exclusive, so an inclusive window ends a day later. */
export function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return utcDate(new Date(Date.UTC(y, m - 1, d + 1)));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD that is a real date. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return ymd(y, m, d) === value;
}
