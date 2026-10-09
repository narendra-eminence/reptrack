"""Clean job: turn a finished verification's rows into the RepScore cleaning workbook, off the API event loop."""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from . import runs
from .clean.details import CleaningDetails, DetailsError
from .clean.engine import CleanContext, clean
from .clean.media import load_master_list
from .clean.workbook import write_workbook
from .db import now, session, transaction
from .deps import Deps
from .export import cleaned_filename
from .jobs import JobContext, JobKind, JobOutcome, JobRecord
from .verify import rules_from_snapshot


def suggested_details(profile: Any) -> CleaningDetails:
    """What a set without saved details starts with: the social handles from its brand form, when it has one."""
    handles = [h for b in profile.brands for h in b.handles] if profile else []
    try:
        return CleaningDetails.from_dict({"own_handles": handles})
    except DetailsError:
        return CleaningDetails()


def details_for(info: Any) -> tuple[CleaningDetails, bool]:
    """(details, saved) for a brand set (a urlverify SetInfo). Details saved in config.yaml are normalised the same
    way the API normalises what it saves; a set with none gets suggested_details."""
    if info.cleaning is None:
        return suggested_details(info.profile), False
    return CleaningDetails.from_dict(info.cleaning), True


def load_details(config_path: Path, brand_set: str) -> tuple[CleaningDetails, bool]:
    """(details, saved) for the named set, read fresh from config.yaml. Raises LookupError for an unknown set."""
    from urlverify import brands

    info = brands.list_sets_detailed(config_path).get(brand_set)
    if info is None:
        raise LookupError(brand_set)
    return details_for(info)


def _date(value: str | None) -> dt.date | None:
    return dt.date.fromisoformat(value) if value else None


def _work(deps: Deps, clean_job_id: int, cancel: threading.Event) -> tuple[Path, dict[str, Any]] | None:
    """Everything that reads, computes and writes, run on a worker thread. None when cancelled before writing."""
    from urlverify.match import BrandMatcher

    with session(deps.settings.db_path) as conn:
        cj = conn.execute("SELECT * FROM clean_jobs WHERE id = ?", (clean_job_id,)).fetchone()
        vj = conn.execute("SELECT * FROM verify_jobs WHERE id = ?", (cj["verify_job_id"],)).fetchone()
        run = runs.get_run(conn, cj["run_id"])
        rows = [
            json.loads(r[0])
            for r in conn.execute(
                "SELECT row_json FROM verify_rows WHERE verify_job_id = ? ORDER BY seq", (cj["verify_job_id"],)
            )
        ]
    if vj["status"] != "done":
        raise RuntimeError(f"verification #{vj['id']} is {vj['status']}, not done")
    matcher = BrandMatcher(rules_from_snapshot(vj["brand_rules_json"]))  # the verification's own brand copy
    media_path = deps.settings.master_media_list
    ctx = CleanContext(
        run_name=run["name"],
        brand_set=cj["brand_set"],
        verify_job_id=vj["id"],
        start=_date(run["start_date"]),
        end=_date(run["end_date"]),
        region=dict(run).get("region"),
        media=load_master_list(media_path),
        media_list_name=media_path.name,
        details=CleaningDetails.from_dict(json.loads(cj["details_json"])),
        mentions_brand=lambda text: bool(matcher.find(text, "title")),
        raw_columns=list(deps.bs.EXPORT_COLUMNS),
    )
    result = clean(rows, ctx)
    if cancel.is_set():
        return None
    path = deps.settings.exports_dir / run["id"] / cleaned_filename(run, cj["brand_set"], clean_job_id)
    write_workbook(path, result)
    return path, result.facts


async def run_clean(ctx: JobContext, deps: Deps) -> JobOutcome:
    cj_id = ctx.job.ref_id
    assert cj_id is not None
    with session(ctx.db_path) as conn:
        conn.execute(
            "UPDATE clean_jobs SET status = 'running', error = NULL, started_at = ?, finished_at = NULL WHERE id = ?",
            (now(), cj_id),
        )
    out = await asyncio.to_thread(_work, deps, cj_id, ctx.cancel)
    if out is None:
        return JobOutcome.CANCELLED
    path, facts = out
    with session(ctx.db_path) as conn, transaction(conn, immediate=True):
        conn.execute(
            "UPDATE clean_jobs SET status = 'done', summary_json = ?, output_path = ?, finished_at = ? WHERE id = ?",
            (json.dumps(facts), str(path), now(), cj_id),
        )
        runs.set_run_status(conn, ctx.job.run_id, runs.after_stop_status(conn, ctx.job.run_id))
    return JobOutcome.DONE


def clean_kind(deps: Deps) -> JobKind:
    async def run(ctx: JobContext) -> JobOutcome:
        return await run_clean(ctx, deps)

    def on_failed(conn: sqlite3.Connection, job: JobRecord, message: str) -> None:
        conn.execute(
            "UPDATE clean_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
            (message, now(), job.ref_id),
        )
        runs.set_run_status(
            conn, job.run_id, "failed", f"Cleaning failed: {message}. Use Retry to run it again with the same details."
        )

    def on_cancelled(conn: sqlite3.Connection, job: JobRecord) -> None:
        conn.execute("UPDATE clean_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.ref_id))
        runs.set_run_status(conn, job.run_id, runs.after_stop_status(conn, job.run_id))

    return JobKind(run=run, on_failed=on_failed, on_cancelled=on_cancelled)
