"""Cleaning: brand-set cleaning details, starting a cleaning of a finished verification, and its workbook."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from urlverify import brands

from .. import runs
from ..clean.details import CleaningDetails, DetailsError
from ..cleaning import load_details
from ..config_errors import CONFIG_LOAD_ERRORS, CONFIG_WRITE_ERRORS
from ..db import now, session, transaction
from ..errors import ApiError
from ..jobs import ActiveJobError, active_job

router = APIRouter()


class DetailsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    own_websites: list[str] = []
    own_handles: list[str] = []
    competitor_websites: list[str] = []
    competitor_handles: list[str] = []


class CleanBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verify_job_id: int | None = None  # default: the run's latest finished verification


def _deps(request: Request) -> Any:
    return request.app.state.deps


def details_or_422(config_path: Path, brand_set: str, missing_ok: bool = False) -> tuple[CleaningDetails, bool]:
    try:
        return load_details(config_path, brand_set)
    except DetailsError as e:  # before CONFIG_LOAD_ERRORS, which includes its base class ValueError
        raise ApiError(422, f"The cleaning details for {brand_set!r} in config.yaml are not valid: {e}") from None
    except CONFIG_LOAD_ERRORS as e:
        raise ApiError(422, f"config.yaml could not be read: {e}") from None
    except LookupError:
        if missing_ok:
            return CleaningDetails(), False
        raise ApiError(404, f"No brand set named {brand_set!r}.") from None


def normalised(body: DetailsBody) -> CleaningDetails:
    try:
        return CleaningDetails.from_dict(body.model_dump())
    except DetailsError as e:
        raise ApiError(422, str(e)) from None


@router.get("/api/cleaning-details/{brand_set}")
def get_details(request: Request, brand_set: str) -> dict:
    details, saved = details_or_422(_deps(request).settings.verifier_config, brand_set)
    return {"brand_set": brand_set, "details": details.to_dict(), "saved": saved}


@router.put("/api/cleaning-details/{brand_set}")
def put_details(request: Request, brand_set: str, body: DetailsBody) -> dict:
    """Saves into config.yaml next to the set (with a backup, like every brand save). For hand-written sets; a form
    set's details are saved together with its answers by PUT /api/brand-profiles/{name}."""
    config = _deps(request).settings.verifier_config
    details = normalised(body)
    details_or_422(config, brand_set)  # 404 for an unknown set
    try:
        backup = brands.save_cleaning(config, brand_set, details.to_dict())
    except CONFIG_WRITE_ERRORS as e:
        raise ApiError(422, str(e)) from None
    return {"brand_set": brand_set, "details": details.to_dict(), "saved": True, "backup": str(backup)}


def _conflict(e: ActiveJobError) -> ApiError:
    return ApiError(409, f"{e} Wait for it to finish or cancel it first.", active_job={"id": e.job_id, "kind": e.kind})


@router.post("/api/runs/{run_id}/clean")
def start_clean(request: Request, run_id: str, body: CleanBody | None = None) -> dict:
    deps = _deps(request)
    runner = request.app.state.runner
    vj_id = body.verify_job_id if body else None
    with session(deps.settings.db_path) as conn:
        try:
            with transaction(conn, immediate=True):
                runs.get_run(conn, run_id)
                active = active_job(conn, run_id)
                if active:
                    raise ActiveJobError(active.id, active.kind)
                if vj_id is None:
                    vj = conn.execute(
                        "SELECT * FROM verify_jobs WHERE run_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1",
                        (run_id,),
                    ).fetchone()
                    if vj is None:
                        raise ApiError(409, "Clean needs a finished verification. Run Verify first.")
                else:
                    vj = conn.execute(
                        "SELECT * FROM verify_jobs WHERE id = ? AND run_id = ?", (vj_id, run_id)
                    ).fetchone()
                    if vj is None:
                        raise ApiError(404, f"No verification #{vj_id} for this run.")
                    if vj["status"] != "done":
                        raise ApiError(409, f"Verification #{vj_id} has not finished, so it cannot be cleaned.")
                # A set deleted since its verification still cleans, just without own or competitor details.
                details, _ = details_or_422(deps.settings.verifier_config, vj["brand_set"], missing_ok=True)
                cur = conn.execute(
                    "INSERT INTO clean_jobs (run_id, verify_job_id, brand_set, details_json, status, created_at) "
                    "VALUES (?, ?, ?, ?, 'queued', ?)",
                    (run_id, vj["id"], vj["brand_set"], json.dumps(details.to_dict()), now()),
                )
                cj_id = cur.lastrowid
                job_id = runner.enqueue(conn, run_id, "clean", cj_id)
        except ActiveJobError as e:
            raise _conflict(e) from None
    runner.wake()
    return {"clean_job_id": cj_id, "job_id": job_id}


@router.get("/api/runs/{run_id}/clean/{cj_id}/cleaned.xlsx")
def cleaned_export(request: Request, run_id: str, cj_id: int) -> FileResponse:
    with session(_deps(request).settings.db_path) as conn:
        cj = conn.execute("SELECT * FROM clean_jobs WHERE id = ? AND run_id = ?", (cj_id, run_id)).fetchone()
    if cj is None:
        raise ApiError(404, f"No cleaning #{cj_id} for this run.")
    if cj["status"] != "done" or not cj["output_path"]:
        raise ApiError(409, "This cleaning has not finished, so there is no file yet.")
    path = Path(cj["output_path"])
    if not path.exists():
        raise ApiError(410, f"The cleaned file {path.name} is missing from data/exports. Run Clean again.")
    return FileResponse(
        path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
