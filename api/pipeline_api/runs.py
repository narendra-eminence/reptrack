"""Run, query and SERP row data access, request validation and run status transitions."""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from .db import now, transaction
from .errors import ApiError
from .jobs import active_job, latest_job, latest_job_of_kind
from .monitor_bridge import key_errors
from .routes.health import VERTICALS

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass
class SearchRequest:
    queries: list[str]
    provider: str
    vertical: str
    pages: int
    start: str
    end: str


def _iso(label: str, value: str) -> date:
    # date.fromisoformat also accepts "20260301" and ISO week dates like "2026-W10-1" on Python 3.11+; neither is
    # the YYYY-MM-DD this API promises, and letting one through would leak into start_date, filenames and the
    # Google query string (after:20260301), so the shape is checked before the value is parsed.
    if not _ISO_DATE.match(value):
        raise ApiError(422, f"{label} date {value!r} is not a valid YYYY-MM-DD date")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, f"{label} date {value!r} is not a valid YYYY-MM-DD date") from None


def validate_search(
    bs: Any, *, queries: str, provider: str, vertical: str, pages: int | str | None, start: str, end: str
) -> SearchRequest:
    parsed = bs.parse_queries(queries or "")
    if not parsed:
        raise ApiError(422, "Enter at least one query (one per line).")
    start, end = (start or "").strip(), (end or "").strip()
    if bool(start) != bool(end):
        raise ApiError(422, "Start and end dates must be given together, or both left empty.")
    if start and _iso("start", start) > _iso("end", end):
        raise ApiError(422, f"Start date {start} is after end date {end}; the start must be on or before the end.")
    if vertical not in VERTICALS:
        raise ApiError(422, f"Unknown vertical {vertical!r}. Expected one of {', '.join(VERTICALS)}.")
    if provider not in bs.PROVIDERS:
        raise ApiError(422, f"Unknown provider {provider!r}. Expected one of {', '.join(bs.PROVIDERS)}.")
    return SearchRequest(parsed, provider, vertical, bs.pages_for(vertical, pages, provider), start, end)


def check_key(bs: Any, provider: str) -> None:
    try:
        bs.check_credentials(provider)
    except key_errors(bs) as e:
        raise ApiError(400, f"{e} (Company Monitor's .env is read at API startup.)") from None


def create_run(conn: sqlite3.Connection, req: SearchRequest, max_calls: int) -> str:
    run_id = uuid.uuid4().hex[:12]
    ts = now()
    conn.execute(
        "INSERT INTO runs (id, name, provider, vertical, pages, start_date, end_date, status, max_calls, "
        "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'scraping', ?, ?, ?)",
        (
            run_id,
            req.queries[0][:80],
            req.provider,
            req.vertical,
            req.pages,
            req.start or None,
            req.end or None,
            max_calls,
            ts,
            ts,
        ),
    )
    conn.executemany(
        "INSERT INTO queries (run_id, position, text, state) VALUES (?, ?, ?, 'pending')",
        [(run_id, i, q) for i, q in enumerate(req.queries)],
    )
    return run_id


def get_run(conn: sqlite3.Connection, run_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise ApiError(404, f"No run {run_id!r}. It may have been deleted.")
    return row


def set_run_status(conn: sqlite3.Connection, run_id: str, status: str, error: str | None = None) -> None:
    conn.execute("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?", (status, error, now(), run_id))


def pending_queries(conn: sqlite3.Connection, run_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM queries WHERE run_id = ? AND state = 'pending' ORDER BY position", (run_id,)
    ).fetchall()


def query_counts(conn: sqlite3.Connection, run_id: str) -> dict[str, int]:
    counts = {"queries": 0, "done": 0, "failed": 0, "pending": 0}
    for row in conn.execute("SELECT state, COUNT(*) n FROM queries WHERE run_id = ? GROUP BY state", (run_id,)):
        counts[row["state"]] = row["n"]
        counts["queries"] += row["n"]
    counts["serp_rows"] = conn.execute("SELECT COUNT(*) FROM serp_rows WHERE run_id = ?", (run_id,)).fetchone()[0]
    return counts


def store_query_result(
    conn: sqlite3.Connection,
    run_id: str,
    query_id: int,
    rows: list[dict[str, Any]],
    error: str | None,
    attempts: int,
    out_of_range: int,
) -> dict[str, Any]:
    """Rows and the query's new state in ONE transaction: a query is fully stored or still pending."""
    state = "failed" if error else "done"
    with transaction(conn, immediate=True):
        conn.execute("DELETE FROM serp_rows WHERE query_id = ?", (query_id,))  # a retry replaces earlier rows
        conn.executemany(
            "INSERT INTO serp_rows (run_id, query_id, seq, row_json) VALUES (?, ?, ?, ?)",
            # ensure_ascii=False: the default escapes every non-ASCII codepoint (e.g. "café" style \uXXXX
            # runs), which would still be valid JSON but would never again contain the literal characters that
            # serp_rows_page's LIKE search is asked to match ("Safari's" with a curly apostrophe, "cafe" with an
            # accent, Hindi text, ...).
            [(run_id, query_id, i, json.dumps(r, ensure_ascii=False)) for i, r in enumerate(rows)],
        )
        conn.execute(
            "UPDATE queries SET state = ?, found = ?, out_of_range = ?, attempts = ?, error = ? WHERE id = ?",
            (state, len(rows), out_of_range, attempts, error, query_id),
        )
        conn.execute("UPDATE runs SET updated_at = ? WHERE id = ?", (now(), run_id))
    q = conn.execute("SELECT position FROM queries WHERE id = ?", (query_id,)).fetchone()
    counts = query_counts(conn, run_id)
    return {
        "type": "query",
        "query_id": query_id,
        "position": q["position"],
        "state": state,
        "found": len(rows),
        "out_of_range": out_of_range,
        "attempts": attempts,
        "error": error,
        "done": counts["done"],
        "failed": counts["failed"],
        "total": counts["queries"],
        "rows": counts["serp_rows"],
    }


def serp_rows(conn: sqlite3.Connection, run_id: str) -> list[dict[str, Any]]:
    cur = conn.execute(
        "SELECT s.row_json FROM serp_rows s JOIN queries q ON q.id = s.query_id WHERE s.run_id = ? "
        "ORDER BY q.position, s.seq",
        (run_id,),
    )
    return [json.loads(r[0]) for r in cur]


def _like_pattern(text: str) -> str:
    """Escape LIKE's own wildcards so a literal '%' or '_' in the search text is matched literally, not as a
    wildcard - e.g. q="100%" must not also match "1000"."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def serp_rows_page(conn: sqlite3.Connection, bs: Any, run_id: str, offset: int, limit: int, q: str) -> dict[str, Any]:
    where, args = "s.run_id = ?", [run_id]
    if q:
        where += " AND s.row_json LIKE ? ESCAPE '\\'"
        args.append(_like_pattern(q))
    total = conn.execute(f"SELECT COUNT(*) FROM serp_rows s WHERE {where}", args).fetchone()[0]
    cur = conn.execute(
        f"SELECT s.row_json FROM serp_rows s JOIN queries qq ON qq.id = s.query_id WHERE {where} "
        "ORDER BY qq.position, s.seq LIMIT ? OFFSET ?",
        [*args, limit, offset],
    )
    raw = [json.loads(r[0]) for r in cur]
    cols = list(bs.EXPORT_COLUMNS)
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "rows": [dict(zip(cols, values, strict=True)) for values in bs.export_rows(raw)],
    }


def verify_jobs_for(conn: sqlite3.Connection, run_id: str) -> list[dict[str, Any]]:
    """Filled in by Task 9; returns [] until verify_jobs rows exist."""
    out = []
    for r in conn.execute("SELECT * FROM verify_jobs WHERE run_id = ? ORDER BY id DESC", (run_id,)):
        out.append(
            {
                "id": r["id"],
                "brand_set": r["brand_set"],
                "brand_rules": json.loads(r["brand_rules_json"]),
                "status": r["status"],
                "total_urls": r["total_urls"],
                "done_urls": r["done_urls"],
                "status_counts": json.loads(r["status_counts_json"]),
                "error": r["error"],
                "started_at": r["started_at"],
                "finished_at": r["finished_at"],
                "has_output": bool(r["output_path"]) and r["status"] == "done",
            }
        )
    return out


def run_detail(conn: sqlite3.Connection, run_id: str) -> dict[str, Any]:
    run = dict(get_run(conn, run_id))
    queries = [
        dict(q)
        for q in conn.execute(
            "SELECT id, position, text, state, found, out_of_range, attempts, error FROM queries WHERE run_id = ? "
            "ORDER BY position",
            (run_id,),
        )
    ]
    active, last = active_job(conn, run_id), latest_job(conn, run_id)
    last_scrape = latest_job_of_kind(conn, run_id, "scrape")
    return {
        **run,
        "counts": query_counts(conn, run_id),
        "queries": queries,
        "verify_jobs": verify_jobs_for(conn, run_id),
        "active_job": active.to_dict() if active else None,
        "last_job": last.to_dict() if last else None,
        "last_scrape_job": last_scrape.to_dict() if last_scrape else None,
    }


def list_runs(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("""
        SELECT r.id, r.name, r.provider, r.vertical, r.start_date, r.end_date, r.status, r.updated_at,
               (SELECT COUNT(*) FROM serp_rows s WHERE s.run_id = r.id) AS serp_rows,
               (SELECT v.status_counts_json FROM verify_jobs v WHERE v.run_id = r.id AND v.status = 'done'
                ORDER BY v.id DESC LIMIT 1) AS last_counts
        FROM runs r ORDER BY r.updated_at DESC""").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        counts = json.loads(d.pop("last_counts")) if d["last_counts"] else None
        d["verified"] = counts.get("Verified", 0) if counts is not None else None
        out.append(d)
    return out
