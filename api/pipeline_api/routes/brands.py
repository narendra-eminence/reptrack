from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from urlverify import brands
from urlverify.profile import profile_to_dict

from ..clean.details import DetailsError
from ..cleaning import details_for
from ..config_errors import CONFIG_LOAD_ERRORS, CONFIG_WRITE_ERRORS
from ..errors import ApiError

router = APIRouter()


def _config(request: Request) -> Any:
    return request.app.state.deps.settings.verifier_config


@router.get("/api/brands")
def list_brands(request: Request) -> dict:
    try:
        sets = brands.list_sets_detailed(_config(request))
    except CONFIG_LOAD_ERRORS as e:
        raise ApiError(422, f"config.yaml could not be read: {e}") from None
    return {
        "sets": [
            {
                "name": n,
                "rules": [brands.rule_to_dict(r) for r in s.rules],
                "managed": s.managed,
                "stale": s.stale,
                "profile": profile_to_dict(s.profile) if s.profile else None,
                "cleaning": _cleaning(n, s),
            }
            for n, s in sets.items()
        ]
    }


@router.delete("/api/brands/{name}")
def delete_brand(request: Request, name: str) -> dict:
    try:
        backup = brands.delete_set(_config(request), name)
    except CONFIG_WRITE_ERRORS as e:
        raise ApiError(422, str(e)) from None
    return {"deleted": name, "backup": str(backup)}  # its cleaning details go with it


def _cleaning(name: str, info: Any) -> dict:
    try:
        details, saved = details_for(info)
    except DetailsError as e:
        raise ApiError(422, f"The cleaning details for {name!r} in config.yaml are not valid: {e}") from None
    return {"details": details.to_dict(), "saved": saved}
