import asyncio
import threading

import pytest

from pipeline_api.db import migrate, now, session, transaction
from pipeline_api.events import EventBus
from pipeline_api.jobs import ActiveJobError, JobContext, JobKind, JobOutcome, JobRunner, active_job


def _make_run(db, run_id):
    with session(db) as conn:
        conn.execute(
            "INSERT INTO runs (id, name, provider, vertical, pages, status, created_at, updated_at) "
            "VALUES (?, 'n', 'serpapi', 'web', 1, 'scraping', ?, ?)",
            (run_id, now(), now()),
        )


def _enqueue(runner, db, run_id, kind="fake"):
    with session(db) as conn, transaction(conn, immediate=True):
        job_id = runner.enqueue(conn, run_id, kind)
    runner.wake()
    return job_id


async def _wait_state(db, job_id, states, timeout=5.0):
    state = None
    for _ in range(int(timeout / 0.02)):
        with session(db) as conn:
            state = conn.execute("SELECT state FROM jobs WHERE id = ?", (job_id,)).fetchone()[0]
        if state in states:
            return state
        await asyncio.sleep(0.02)
    raise AssertionError(f"job {job_id} stuck in {state}")


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "app.db"
    migrate(path)
    _make_run(path, "r1")
    _make_run(path, "r2")
    return path


class Recorder:
    def __init__(self):
        self.running = 0
        self.max_running = 0
        self.ran: list[int] = []
        self.failed: list[tuple[int, str]] = []
        self.cancelled: list[int] = []
        self.gate = threading.Event()
        self.gate.set()

    def kind(self, behaviour="ok"):
        async def run(ctx: JobContext) -> JobOutcome:
            self.running += 1
            self.max_running = max(self.max_running, self.running)
            try:
                while not self.gate.is_set():
                    if ctx.cancel.is_set():
                        return JobOutcome.CANCELLED
                    await asyncio.sleep(0.01)
                if behaviour == "boom":
                    raise ValueError("kaput")
                self.ran.append(ctx.job.id)
                return JobOutcome.DONE
            finally:
                self.running -= 1

        return JobKind(
            run=run,
            on_failed=lambda conn, job, msg: self.failed.append((job.id, msg)),
            on_cancelled=lambda conn, job: self.cancelled.append(job.id),
        )


async def test_jobs_run_one_at_a_time(db):
    rec = Recorder()
    rec.gate.clear()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    await runner.start()
    try:
        j1 = _enqueue(runner, db, "r1")
        j2 = _enqueue(runner, db, "r2")
        await asyncio.sleep(0.1)
        assert rec.max_running == 1
        rec.gate.set()
        await _wait_state(db, j2, {"done"})
        assert rec.ran == [j1, j2]
    finally:
        await runner.stop()


async def test_duplicate_enqueue_rejected(db):
    runner = JobRunner(db, EventBus(), {"fake": Recorder().kind()})
    _enqueue(runner, db, "r1")
    with pytest.raises(ActiveJobError) as err:
        _enqueue(runner, db, "r1")
    assert err.value.kind == "fake"


async def test_concurrent_enqueue_creates_exactly_one(db):
    runner = JobRunner(db, EventBus(), {"fake": Recorder().kind()})
    results: list[str] = []

    def attempt():
        try:
            _enqueue(runner, db, "r1")
            results.append("ok")
        except ActiveJobError:
            results.append("rejected")

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 1
    with session(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1


async def test_failure_marks_failed_and_calls_hook(db):
    rec = Recorder()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind("boom")})
    await runner.start()
    try:
        job_id = _enqueue(runner, db, "r1")
        await _wait_state(db, job_id, {"failed"})
        assert rec.failed == [(job_id, "ValueError: kaput")]
        with session(db) as conn:
            assert active_job(conn, "r1") is None
    finally:
        await runner.stop()


async def test_cancel_running_is_cooperative(db):
    rec = Recorder()
    rec.gate.clear()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    await runner.start()
    try:
        job_id = _enqueue(runner, db, "r1")
        await _wait_state(db, job_id, {"running"})
        assert runner.cancel(job_id) == "cancelling"
        await _wait_state(db, job_id, {"cancelled"})
        assert rec.cancelled == [job_id]
    finally:
        await runner.stop()


async def test_cancel_queued_never_runs(db):
    rec = Recorder()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    job_id = _enqueue(runner, db, "r1")
    assert runner.cancel(job_id) == "cancelled"
    await runner.start()
    try:
        await asyncio.sleep(0.1)
        assert rec.ran == [] and rec.cancelled == [job_id]
    finally:
        await runner.stop()


async def test_resume_interrupted_requeues_running_and_finishes_cancelling(db):
    rec = Recorder()
    with session(db) as conn:
        conn.execute("INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('fake', 'r1', 'running', ?)", (now(),))
        conn.execute(
            "INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('fake', 'r2', 'cancelling', ?)", (now(),)
        )
    runner = JobRunner(db, EventBus(), {"fake": rec.kind()})
    await runner.start()
    try:
        await _wait_state(db, 1, {"done"})
        await _wait_state(db, 2, {"cancelled"})
        with session(db) as conn:
            assert conn.execute("SELECT resumed_at FROM jobs WHERE id = 1").fetchone()[0] is not None
        assert rec.cancelled == [2]
    finally:
        await runner.stop()


async def test_requeue_failed_job(db):
    rec = Recorder()
    runner = JobRunner(db, EventBus(), {"fake": rec.kind("boom")})
    await runner.start()
    try:
        job_id = _enqueue(runner, db, "r1")
        await _wait_state(db, job_id, {"failed"})
        runner.kinds["fake"] = rec.kind()
        with session(db) as conn, transaction(conn, immediate=True):
            runner.requeue(conn, job_id)
        runner.wake()
        await _wait_state(db, job_id, {"done"})
    finally:
        await runner.stop()
