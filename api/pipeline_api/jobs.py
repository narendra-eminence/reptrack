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
    return JobRecord.from_row(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())


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
        job = _get(conn, job_id)
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
                self.kinds[job.kind].on_cancelled(conn, job)
                new_state = "cancelled"
            elif job.state == "running":
                conn.execute("UPDATE jobs SET state = 'cancelling' WHERE id = ?", (job_id,))
                new_state = "cancelling"
            else:
                return job.state
        if job_id in self._cancel_events:
            self._cancel_events[job_id].set()
        self.bus.publish_threadsafe(
            job.run_id, {"type": "job", "job_id": job_id, "kind": job.kind, "state": new_state, "error": None}
        )
        return new_state

    def resume_interrupted(self) -> list[int]:
        resumed: list[int] = []
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            for row in conn.execute("SELECT * FROM jobs WHERE state = 'cancelling'").fetchall():
                job = JobRecord.from_row(row)
                conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.id))
                self.kinds[job.kind].on_cancelled(conn, job)
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
            job = self._claim_next()
            if job is None:
                self._wake.clear()
                job = self._claim_next()  # an enqueue may have landed between the claim and the clear
                if job is None:
                    await self._wake.wait()
                    continue
            await self._execute(job)

    async def _execute(self, job: JobRecord) -> None:
        cancel = threading.Event()
        self._cancel_events[job.id] = cancel
        extra = {"run_id": job.run_id, "job_id": job.id}
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
        try:
            outcome = await self.kinds[job.kind].run(ctx)
        except asyncio.CancelledError:
            # Runner shutdown: leave the job 'running' so the next start re-queues it.
            self._cancel_events.pop(job.id, None)
            raise
        except Exception as e:
            log.exception("job failed: %s", job.kind, extra=extra)
            error = f"{type(e).__name__}: {e}"
        finally:
            self._cancel_events.pop(job.id, None)
        with session(self.db_path) as conn, transaction(conn, immediate=True):
            current = _get(conn, job.id)
            if error is not None:
                conn.execute(
                    "UPDATE jobs SET state = 'failed', error = ?, finished_at = ? WHERE id = ?",
                    (error, now(), job.id),
                )
                self.kinds[job.kind].on_failed(conn, current, error)
                state = "failed"
            elif outcome is JobOutcome.CANCELLED:
                conn.execute("UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?", (now(), job.id))
                self.kinds[job.kind].on_cancelled(conn, current)
                state = "cancelled"
            else:
                conn.execute("UPDATE jobs SET state = 'done', finished_at = ? WHERE id = ?", (now(), job.id))
                state = "done"
        log.info("job %s: %s", state, job.kind, extra=extra)
        self.bus.publish(
            job.run_id, {"type": "job", "job_id": job.id, "kind": job.kind, "state": state, "error": error}
        )
