"""Scrape job: run a run's pending queries through search_one on a thread pool, storing each as it finishes."""

from __future__ import annotations

import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import runs
from .db import session
from .deps import Deps
from .jobs import JobContext, JobKind, JobOutcome, JobRecord


async def run_scrape(ctx: JobContext, deps: Deps) -> JobOutcome:
    run_id = ctx.job.run_id
    with session(ctx.db_path) as conn:
        run = runs.get_run(conn, run_id)
        pending = runs.pending_queries(conn, run_id)
    if pending:
        loop = asyncio.get_running_loop()
        pool = ThreadPoolExecutor(
            max_workers=max(1, min(int(deps.bs.MAX_WORKERS), len(pending))), thread_name_prefix=f"scrape-{run_id}"
        )

        def work(q: sqlite3.Row) -> tuple[list[dict[str, Any]], str, int] | None:
            if ctx.cancel.is_set():
                return None  # never started: stays pending
            return deps.search_one(
                q["text"],
                run["start_date"] or "",
                run["end_date"] or "",
                run["pages"],
                run["vertical"],
                run["provider"],
                ctx.cancel,
                run["region"],
            )

        futures = {loop.run_in_executor(pool, work, q): q for q in pending}
        try:
            remaining: set[asyncio.Future[Any]] = set(futures)
            while remaining:
                done, remaining = await asyncio.wait(remaining, return_when=asyncio.FIRST_COMPLETED)
                for fut in done:
                    result = fut.result()
                    if result is None:
                        continue
                    rows, error, attempts = result
                    with session(ctx.db_path) as conn:
                        event = runs.store_query_result(
                            conn,
                            run_id,
                            futures[fut]["id"],
                            rows,
                            error or None,
                            attempts,
                            deps.bs.count_out_of_range(rows),
                        )
                    ctx.publish(event)
        finally:
            # In-flight calls finish in their threads; nothing new starts. On runner shutdown their results are
            # dropped and those queries stay pending, to be re-run (from cache where possible) on restart.
            pool.shutdown(wait=False, cancel_futures=True)
    if ctx.cancel.is_set():
        return JobOutcome.CANCELLED
    with session(ctx.db_path) as conn:
        runs.set_run_status(conn, run_id, runs.after_stop_status(conn, run_id))
    return JobOutcome.DONE


def scrape_kind(deps: Deps) -> JobKind:
    async def run(ctx: JobContext) -> JobOutcome:
        return await run_scrape(ctx, deps)

    def on_failed(conn: sqlite3.Connection, job: JobRecord, message: str) -> None:
        runs.set_run_status(conn, job.run_id, "failed", f"Search failed: {message}. Use Retry to continue.")

    def on_cancelled(conn: sqlite3.Connection, job: JobRecord) -> None:
        runs.set_run_status(conn, job.run_id, runs.after_stop_status(conn, job.run_id))

    return JobKind(run=run, on_failed=on_failed, on_cancelled=on_cancelled)
