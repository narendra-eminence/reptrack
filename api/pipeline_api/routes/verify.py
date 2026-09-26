from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import runs
from ..db import now, session, transaction
from ..errors import ApiError
from ..jobs import ActiveJobError, active_job
from ..runs import _like_pattern
from ..verify import snapshot_rules

router = APIRouter()


class VerifyBody(BaseModel):
    brand_set: str


def _conflict(e: ActiveJobError) -> ApiError:
    return ApiError(409, f"{e} Wait for it to finish or cancel it first.", active_job={"id": e.job_id, "kind": e.kind})


@router.post("/api/runs/{run_id}/verify")
def start_verify(request: Request, run_id: str, body: VerifyBody) -> dict:
    deps = request.app.state.deps
    runner = request.app.state.runner
    with session(deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                runs.get_run(conn, run_id)
                active = active_job(conn, run_id)
                if active:
                    raise ActiveJobError(active.id, active.kind)
                counts = runs.query_counts(conn, run_id)
                if not counts["serp_rows"]:
                    raise ApiError(409, "This run has no search results to verify.")
                snapshot = snapshot_rules(deps.settings.verifier_config, body.brand_set)
                cur = conn.execute(
                    "INSERT INTO verify_jobs (run_id, brand_set, brand_rules_json, status, created_at) "
                    "VALUES (?, ?, ?, 'queued', ?)",
                    (run_id, body.brand_set, snapshot, now()),
                )
                vj_id = cur.lastrowid
                job_id = runner.enqueue(conn, run_id, "verify", vj_id)
                runs.set_run_status(conn, run_id, "verifying")
        except ActiveJobError as e:
            raise _conflict(e) from None
    runner.wake()
    return {"verify_job_id": vj_id, "job_id": job_id}


def _verify_job(conn: Any, run_id: str, vj_id: int) -> Any:
    row = conn.execute("SELECT * FROM verify_jobs WHERE id = ? AND run_id = ?", (vj_id, run_id)).fetchone()
    if row is None:
        raise ApiError(404, f"No verification #{vj_id} for this run.")
    return row


@router.get("/api/runs/{run_id}/verify/{vj_id}/results")
def results(
    request: Request,
    run_id: str,
    vj_id: int,
    offset: int = 0,
    limit: int = 100,
    status: str = "",
    hide_duplicates: bool = False,
    q: str = "",
) -> dict:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    where = "verify_job_id = ?"
    args: list[Any] = [vj_id]
    if status:
        where += " AND status = ?"
        args.append(status)
    if hide_duplicates:
        where += " AND is_duplicate = 0"
    if q.strip():
        where += " AND row_json LIKE ? ESCAPE '\\'"
        args.append(_like_pattern(q.strip()))
    with session(request.app.state.deps.settings.db_path) as conn:
        _verify_job(conn, run_id, vj_id)
        total = conn.execute(f"SELECT COUNT(*) FROM verify_rows WHERE {where}", args).fetchone()[0]
        rows = conn.execute(
            f"SELECT seq, status, is_duplicate, row_json FROM verify_rows WHERE {where} ORDER BY seq LIMIT ? OFFSET ?",
            [*args, limit, offset],
        ).fetchall()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "rows": [
            {
                "seq": r["seq"],
                "status": r["status"],
                "is_duplicate": bool(r["is_duplicate"]),
                "row": json.loads(r["row_json"]),
            }
            for r in rows
        ],
    }


@router.get("/api/runs/{run_id}/verify/{vj_id}/verified.xlsx")
def verified_export(request: Request, run_id: str, vj_id: int) -> FileResponse:
    with session(request.app.state.deps.settings.db_path) as conn:
        vj = _verify_job(conn, run_id, vj_id)
    if vj["status"] != "done" or not vj["output_path"]:
        raise ApiError(409, "This verification has not finished, so there is no file yet.")
    path = Path(vj["output_path"])
    if not path.exists():
        raise ApiError(410, f"The verified file {path.name} is missing from data/exports. Re-run verification.")
    return FileResponse(
        path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@router.post("/api/jobs/{job_id}/retry")
def retry_job(request: Request, job_id: int) -> dict:
    runner = request.app.state.runner
    with session(request.app.state.deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
                if job is None:
                    raise ApiError(404, f"No job #{job_id}.")
                if job["kind"] != "verify":
                    raise ApiError(409, "Retry a search with 'Retry failed queries'.")
                if job["state"] not in ("failed", "cancelled"):
                    raise ApiError(
                        409, f"Job #{job_id} is {job['state']}; only failed or cancelled jobs can be retried."
                    )
                runner.requeue(conn, job_id)
                conn.execute("UPDATE verify_jobs SET status = 'queued', error = NULL WHERE id = ?", (job["ref_id"],))
                runs.set_run_status(conn, job["run_id"], "verifying")
        except ActiveJobError as e:
            raise _conflict(e) from None
    runner.wake()
    return {"job_id": job_id, "state": "queued"}
