"""xlsx writers shared by the SERP export and the verifier input."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        return ILLEGAL_CHARACTERS_RE.sub("", value)
    return value


def write_rows_xlsx(path: Path, header: list[str], rows: list[list[Any]], sheet: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = sheet
    ws.append(header)
    for r, row in enumerate(rows, start=2):
        for col, value in enumerate(row, start=1):
            value = _clean(value)
            cell = ws.cell(row=r, column=col, value=value)
            if isinstance(value, str) and value.startswith("="):
                cell.data_type = "s"  # text that looks like a formula is data, never a formula
    tmp = path.with_suffix(".tmp.xlsx")
    wb.save(tmp)
    tmp.replace(path)


def write_serp_xlsx(path: Path, bs: Any, rows: list[dict[str, Any]]) -> None:
    write_rows_xlsx(path, list(bs.EXPORT_COLUMNS), bs.export_rows(rows), "Bulk Search")


def slug(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:60].strip("-")
    return s or "run"


def _period(run: Any) -> str:
    return f"_{run['start_date']}_{run['end_date']}" if run["start_date"] else ""


def serp_filename(run: Any) -> str:
    return f"{slug(run['name'])}{_period(run)}_serp.xlsx"


def verified_filename(run: Any, verify_job_id: int) -> str:
    return f"{slug(run['name'])}{_period(run)}_verified_{verify_job_id}.xlsx"
