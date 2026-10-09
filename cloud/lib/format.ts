import { REGIONS, VERTICAL_LABEL, type Region, type Vertical } from "@/lib/serp/core";

export const verticalLabel = (v: Vertical) => VERTICAL_LABEL[v] ?? v;
export const regionLabel = (r: Region) => REGIONS[r]?.label ?? r.toUpperCase();
export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");

export function period(r: { start_date: string | null; end_date: string | null }): string {
  return r.start_date && r.end_date ? `${r.start_date} to ${r.end_date}` : "Any date";
}

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
