"use client";

import { api } from "./api";
import { EXPORT_COLUMNS, exportRow, type SerpRow } from "./serp/core";
import type { RunDetail } from "./types";

export function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "run";
}

/** The same file name the local pipeline gives a SERP export, so files from both sort together. */
export function serpFilename(run: Pick<RunDetail, "name" | "start_date" | "end_date" | "region">): string {
  const period = run.start_date && run.end_date ? `_${run.start_date}_${run.end_date}` : "";
  return `${slug(run.name)}${period}_${run.region.toUpperCase()}_serp.xlsx`;
}

/** Every row of the run as an xlsx built in the browser (the server's 4.5 MB response cap does not apply), in the
 * local pipeline's Bulk Search column order. Text that looks like a formula stays text. */
export async function downloadSerpXlsx(run: RunDetail, onProgress?: (done: number, total: number) => void): Promise<void> {
  const rows: SerpRow[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += 1000) {
    const page = await api.rows(run.id, { offset, limit: 1000 });
    total = page.total;
    rows.push(...(page.rows as unknown as SerpRow[]));
    onProgress?.(rows.length, total);
    if (!page.rows.length) break;
  }
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bulk Search");
  ws.addRow([...EXPORT_COLUMNS]);
  for (const r of rows) ws.addRow(exportRow(r));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = serpFilename(run);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
