"""One-at-a-time background job runner over the `jobs` table.

Jobs run as asyncio tasks inside the API process, one at a time, in id order. Every job kind is resumable from
stored state, so a restart re-queues whatever was running. Cancel is cooperative: it sets an event the job checks.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sqlite3
import threading
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from .db import now, session, transaction
from .events import EventBus

log = logging.getLogger("pipeline_api.jobs")
ACTIVE_STATES = ("queued", "running", "cancelling")


class JobOutcome(Enum):
    DONE = "done"
    CANCELLED = "cancelled"


@dataclass
class JobRecord:
    id: int
    kind: str
    run_id: str
    ref_id: int | None
    state: str
    error: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    resumed_at: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> JobRecord:
        return cls(**dict(row))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class JobContext:
    job: JobRecord
    db_path: Path
    cancel: threading.Event
    publish: Callable[[dict[str, Any]], None]  # thread-safe


@dataclass(frozen=True)
class JobKind:
    run: Callable[[JobContext], Awaitable[JobOutcome]]
    on_failed: Callable[[sqlite3.Connection, JobRecord, str], None]
    on_cancelled: Callable[[sqlite3.Connection, JobRecord], None]


class ActiveJobError(Exception):
    def __init__(self, job_id: int, kind: str):
        super().__init__(f"a {kind} job (#{job_id}) is already queued or running for this run")
        self.job_id = job_id
        self.kind = kind


def active_job(conn: sqlite3.Connection, run_id: str) -> JobRecord | None:
    placeholders = ",".join("?" * len(ACTIVE_STATES))
    row = conn.execute(
        f"SELECT * FROM jobs WHERE run_id = ? AND state IN ({placeholders})",
        (run_id, *ACTIVE_STATES),
    ).fetchone()
    return JobRecord.from_row(row) if row else None


def latest_job(conn: sqlite3.Connection, run_id: str) -> JobRecord | None:
    row = conn.execute("SELECT * FROM jobs WHERE run_id = ? ORDER BY id DESC LIMIT 1", (run_id,)).fetchone()
    return JobRecord.from_row(row) if row else None


def _get(conn: sqlite3.Connection, job_id: int) -> JobRecord:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise LookupError(f"no job #{job_id}")
    return JobRecord.from_row(row)


class JobRunner:
    def __init__(self, db_path: Path, bus: EventBus, kinds: dict[str, JobKind]):
        self.db_path = db_path
        self.bus = bus
        self.kinds = kinds
        self._wake = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task[None] | None = None
        self._cancel_events: dict[int, threading.Event] = {}

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.bus.bind(self._loop)
        self.resume_interrupted()
        self._task = asyncio.create_task(self._loop_forever())

    async def stop(self) -> None:
        for ev in self._cancel_events.values():
            ev.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def wake(self) -> None:
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._wake.set)

    def enqueue(self, conn: sqlite3.Connection, run_id: str, kind: str, ref_id: int | None = None) -> int:
        """Insert a queued job. The caller holds `transaction(conn, immediate=True)` and calls wake() after commit."""
        existing = active_job(conn, run_id)
        if existing:
            raise ActiveJobError(existing.id, existing.kind)
        try:
            cur = conn.execute(
                "INSERT INTO jobs (kind, run_id, ref_id, state, created_at) VALUES (?, ?, ?, 'queued', ?)",
                (kind, run_id, ref_id, now()),
            )
        except sqlite3.IntegrityError:
            existing = active_job(conn, run_id)
            if existing:
                raise ActiveJobError(existing.id, existing.kind) from None
            raise
        assert cur.lastrowid is not None
        return cur.lastrowid

    def requeue(self, conn: sqlite3.Connection, job_id: int) -> None:
        """Move a failed/cancelled job back to queued. The caller holds `transaction(conn, immediate=True)`."""
        job = _get(conn, job_id)
        if job.state not in ("failed", "cancelled"):
            raise ValueError(f"cannot requeue job #{job_id} in state {job.state!r}")
        existing = active_job(conn, job.run_id)
        if existing:
            raise ActiveJobError(existing.id, existing.kind)
        conn.execute(
            "UPDATE jobs SET state = 'queued', error = NULL, started_at = NULL, finished_at = NULL WHERE id = ?",
            (job_id,),
        )

    def cancel(self, job_id: int) -> str:
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            job = _get(conn, job_id)
            if job.state == "queued":
                conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job_id))
                kind = self.kinds.get(job.kind)
                if kind is not None:
                    kind.on_cancelled(conn, job)
                new_state = "cancelled"
            elif job.state == "running":
                conn.execute("UPDATE jobs SET state = 'cancelling' WHERE id = ?", (job_id,))
                new_state = "cancelling"
            else:
                return job.state
        # Publish 'cancelling'/'cancelled' before poking the cancel event: call_soon_threadsafe is FIFO, so any
        # 'cancelled' event the job publishes once it wakes up is guaranteed to be enqueued after this one.
        self.bus.publish_threadsafe(
            job.run_id, {"type": "job", "job_id": job_id, "kind": job.kind, "state": new_state, "error": None}
        )
        event = self._cancel_events.get(job_id)
        if event is not None:
            event.set()
        return new_state

    def resume_interrupted(self) -> list[int]:
        resumed: list[int] = []
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            for row in conn.execute("SELECT * FROM jobs WHERE state = 'cancelling'").fetchall():
                job = JobRecord.from_row(row)
                kind = self.kinds.get(job.kind)
                if kind is None:
                    log.error("resume: unknown job kind %r for job #%s; marking failed", job.kind, job.id)
                    conn.execute(
                        "UPDATE jobs SET state = 'failed', error = ?, finished_at = ? WHERE id = ?",
                        (f"unknown job kind: {job.kind!r}", now(), job.id),
                    )
                    continue
                conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.id))
                kind.on_cancelled(conn, job)
            for row in conn.execute("SELECT id FROM jobs WHERE state = 'running'").fetchall():
                conn.execute("UPDATE jobs SET state = 'queued', resumed_at = ? WHERE id = ?", (now(), row["id"]))
                resumed.append(row["id"])
        if resumed:
            log.info("re-queued jobs interrupted by a restart: %s", resumed)
        return resumed

    def _claim_next(self) -> JobRecord | None:
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            row = conn.execute("SELECT * FROM jobs WHERE state = 'queued' ORDER BY id LIMIT 1").fetchone()
            if row is None:
                return None
            conn.execute("UPDATE jobs SET state = 'running', started_at = ? WHERE id = ?", (now(), row["id"]))
            return _get(conn, row["id"])

    async def _loop_forever(self) -> None:
        while True:
            try:
                job = self._claim_next()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("failed to claim the next job; retrying in 1s")
                await asyncio.sleep(1)
                continue
            if job is None:
                self._wake.clear()
                try:
                    job = self._claim_next()  # an enqueue may have landed between the claim and the clear
                except asyncio.CancelledError:
                    raise
                except Exception:
                    log.exception("failed to claim the next job; retrying in 1s")
                    await asyncio.sleep(1)
                    continue
                if job is None:
                    await self._wake.wait()
                    continue
            try:
                await self._execute(job)
            except asyncio.CancelledError:
                raise
            except Exception:
                # _execute already funnels run()/finalize failures into a 'failed' row; this is a last-resort
                # net so one bad job (or an unhandled bug in the runner itself) never wedges every later job.
                log.exception("unexpected error executing job #%s; continuing", job.id)

    async def _execute(self, job: JobRecord) -> None:
        cancel = threading.Event()
        self._cancel_events[job.id] = cancel
        extra = {"run_id": job.run_id, "job_id": job.id}

        # Close the window between _claim_next's commit of 'running' and this registration: a cancel() call
        # landing in that window writes 'cancelling' to the row but finds no event yet to set.
        try:
            with session(self.db_path) as conn:
                row = conn.execute("SELECT state FROM jobs WHERE id = ?", (job.id,)).fetchone()
            if row is not None and row["state"] == "cancelling":
                cancel.set()
        except Exception:
            log.exception("failed to check for a pending cancel", extra=extra)

        ctx = JobContext(
            job=job,
            db_path=self.db_path,
            cancel=cancel,
            publish=lambda ev: self.bus.publish_threadsafe(job.run_id, ev),
        )
        self.bus.publish(
            job.run_id, {"type": "job", "job_id": job.id, "kind": job.kind, "state": "running", "error": None}
        )
        log.info("job started: %s", job.kind, extra=extra)

        outcome: JobOutcome | None = None
        error: str | None = None
        kind = self.kinds.get(job.kind)
        if kind is None:
            error = f"unknown job kind: {job.kind!r}"
        else:
            try:
                outcome = await kind.run(ctx)
            except asyncio.CancelledError:
                # Runner shutdown: leave the job 'running' so the next start re-queues it.
                self._cancel_events.pop(job.id, None)
                raise
            except Exception as e:
                log.exception("job failed: %s", job.kind, extra=extra)
                error = f"{type(e).__name__}: {e}"
        self._cancel_events.pop(job.id, None)

        state = self._finalize(job, outcome, error, extra)
        log.info("job %s: %s", state, job.kind, extra=extra)
        self.bus.publish(
            job.run_id, {"type": "job", "job_id": job.id, "kind": job.kind, "state": state, "error": error}
        )

    def _finalize(self, job: JobRecord, outcome: JobOutcome | None, error: str | None, extra: dict[str, Any]) -> str:
        """Write the terminal state and call the kind's hook. Never raises: a hook or DB failure here still
        leaves the job in a terminal state so the runner can move on to the next one."""
        try:
            with session(self.db_path) as conn, transaction(conn, immediate=True):
                current = _get(conn, job.id)
                kind = self.kinds.get(job.kind)
                if error is not None:
                    conn.execute(
                        "UPDATE jobs SET state = 'failed', error = ?, finished_at = ? WHERE id = ?",
                        (error, now(), job.id),
                    )
                    if kind is not None:
                        kind.on_failed(conn, current, error)
                    return "failed"
                if outcome is JobOutcome.CANCELLED:
                    conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.id))
                    if kind is not None:
                        kind.on_cancelled(conn, current)
                    return "cancelled"
                conn.execute("UPDATE jobs SET state = 'done', finished_at = ? WHERE id = ?", (now(), job.id))
                return "done"
        except Exception as e:
            log.exception("failed to finalize job #%s (kind=%s)", job.id, job.kind, extra=extra)
            fallback_error = f"finalize failed: {type(e).__name__}: {e}"
            try:
                with session(self.db_path) as conn, transaction(conn, immediate=True):
                    conn.execute(
                        "UPDATE jobs SET state = 'failed', error = ?, finished_at = ? WHERE id = ?",
                        (fallback_error, now(), job.id),
                    )
            except Exception:
                log.exception("failed to mark job #%s failed after a finalize error", job.id, extra=extra)
            return "failed"
