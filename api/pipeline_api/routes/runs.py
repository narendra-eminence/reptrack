from __future__ import annotations

import shutil
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import runs
from ..db import session, transaction
from ..errors import ApiError
from ..export import serp_filename, write_serp_xlsx
from ..jobs import ActiveJobError, active_job

router = APIRouter()


class SearchBody(BaseModel):
    queries: str = ""
    provider: str = "serpapi"
    vertical: str = "web"
    pages: int | str | None = 1
    start: str = ""
    end: str = ""
    # A bulk_search.REGIONS key. Omitted (None) keeps the provider's legacy default market.
    region: str | None = None
    confirmed_calls: int | None = None


def _deps(request: Request) -> Any:
    return request.app.state.deps


def _conflict(e: ActiveJobError) -> ApiError:
    return ApiError(409, f"{e} Wait for it to finish or cancel it first.", active_job={"id": e.job_id, "kind": e.kind})


def _validate(request: Request, body: SearchBody) -> runs.SearchRequest:
    return runs.validate_search(
        _deps(request).bs,
        queries=body.queries,
        provider=body.provider,
        vertical=body.vertical,
        pages=body.pages,
        start=body.start,
        end=body.end,
        region=body.region,
    )


@router.post("/api/plan")
def plan(request: Request, body: SearchBody) -> dict:
    bs = _deps(request).bs
    req = _validate(request, body)
    runs.check_key(bs, req.provider)
    p = bs.plan(req.queries, req.start, req.end, req.pages, req.vertical, req.provider, req.region)
    return {
        "queries": req.queries,
        "count": p["queries"],
        "pages": p["pages"],
        "max_calls": p["max_calls"],
        "cached_calls": p["cached_calls"],
        "region": req.region,
    }


@router.post("/api/runs")
def create_run(request: Request, body: SearchBody) -> dict:
    deps = _deps(request)
    req = _validate(request, body)
    ceiling = deps.bs.max_calls(req.queries, req.pages)
    if body.confirmed_calls != ceiling:
        raise ApiError(
            409,
            f"This search can make up to {ceiling} billable SERP page requests. Confirm that figure to start.",
            max_calls=ceiling,
        )
    runs.check_key(deps.bs, req.provider)
    runner = request.app.state.runner
    with session(deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                run_id = runs.create_run(conn, req, ceiling)
                runner.enqueue(conn, run_id, "scrape")
        except ActiveJobError as e:  # defensive: a brand-new run cannot have an active job
            raise _conflict(e) from None
    runner.wake()
    return {"id": run_id}


@router.get("/api/runs")
def list_runs(request: Request) -> list[dict]:
    with session(_deps(request).settings.db_path) as conn:
        return runs.list_runs(conn)


@router.get("/api/runs/{run_id}")
def run_detail(request: Request, run_id: str) -> dict:
    with session(_deps(request).settings.db_path) as conn:
        return runs.run_detail(conn, run_id)


@router.get("/api/runs/{run_id}/rows")
def rows(request: Request, run_id: str, offset: int = 0, limit: int = 100, q: str = "") -> dict:
    deps = _deps(request)
    limit = max(1, min(limit, 500))
    with session(deps.settings.db_path) as conn:
        runs.get_run(conn, run_id)
        return runs.serp_rows_page(conn, deps.bs, run_id, max(0, offset), limit, q.strip())


@router.get("/api/runs/{run_id}/serp.xlsx")
def serp_export(request: Request, run_id: str) -> FileResponse:
    deps = _deps(request)
    with session(deps.settings.db_path) as conn:
        run = runs.get_run(conn, run_id)
        data = runs.serp_rows(conn, run_id)
    name = serp_filename(run)
    path = deps.settings.exports_dir / run_id / name
    write_serp_xlsx(path, deps.bs, data)
    return FileResponse(
        path, filename=name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@router.post("/api/runs/{run_id}/retry-failed")
def retry_failed(request: Request, run_id: str) -> dict:
    deps = _deps(request)
    runner = request.app.state.runner
    with session(deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                runs.get_run(conn, run_id)
                active = active_job(conn, run_id)
                if active:
                    raise ActiveJobError(active.id, active.kind)
                n = conn.execute(
                    "UPDATE queries SET state = 'pending' WHERE run_id = ? AND state = 'failed'", (run_id,)
                ).rowcount
                pending = conn.execute(
                    "SELECT COUNT(*) FROM queries WHERE run_id = ? AND state = 'pending'", (run_id,)
                ).fetchone()[0]
                if not pending:
                    raise ApiError(409, "No failed or unfinished queries to retry.")
                job_id = runner.enqueue(conn, run_id, "scrape")
                runs.set_run_status(conn, run_id, "scraping")
        except ActiveJobError as e:
            raise _conflict(e) from None
    runner.wake()
    return {"job_id": job_id, "requeued_failed": n, "pending": pending}


@router.delete("/api/runs/{run_id}")
def delete_run(request: Request, run_id: str) -> dict:
    deps = _deps(request)
    with session(deps.settings.db_path) as conn, transaction(conn, immediate=True):
        runs.get_run(conn, run_id)
        active = active_job(conn, run_id)
        if active:
            raise _conflict(ActiveJobError(active.id, active.kind))
        conn.execute("DELETE FROM runs WHERE id = ?", (run_id,))
    shutil.rmtree(deps.settings.exports_dir / run_id, ignore_errors=True)
    return {"deleted": run_id}


@router.post("/api/jobs/{job_id}/cancel")
def cancel_job(request: Request, job_id: int) -> dict:
    deps = _deps(request)
    with session(deps.settings.db_path) as conn:
        if conn.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
            raise ApiError(404, f"No job #{job_id}.")
    try:
        return {"state": request.app.state.runner.cancel(job_id)}
    except LookupError as e:
        raise ApiError(404, str(e)) from None
