from __future__ import annotations

import json
import os
from pathlib import Path

import playwright
from fastapi import APIRouter, Request

from ..monitor_bridge import provider_key_status

router = APIRouter()
VERTICALS = ("web", "news", "news_tab")  # Company Monitor app.py BULK_VERTICALS


def _browsers_json_path() -> Path:
    """Path to Playwright's browsers.json, extracted for test seam."""
    return Path(playwright.__file__).resolve().parent / "driver" / "package" / "browsers.json"


def _chromium_installed() -> bool:
    """True only when the exact Chromium headless-shell build the installed Playwright expects is present.

    Globbing for any `chromium*` folder is not enough: at baseline a `chromium-1223` folder existed while the
    verifier could not launch because build 1234 (what this Playwright wants) was missing. So the expected
    revision is read from Playwright's own browsers.json and only that exact folder counts.
    """
    browsers_json = _browsers_json_path()
    try:
        data = json.loads(browsers_json.read_text())
    except (OSError, ValueError):
        return False
    revision = next(
        (b["revision"] for b in data.get("browsers", []) if b.get("name") == "chromium-headless-shell"),
        None,
    )
    if revision is None:
        return False
    root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(Path.home() / "Library/Caches/ms-playwright"))
    return (root / f"chromium_headless_shell-{revision}").exists()


@router.get("/api/health")
def health(request: Request) -> dict:
    deps = request.app.state.deps
    import yaml
    from urlverify.config import ConfigError, load_config

    config_error = None
    try:
        load_config(deps.settings.verifier_config)
    # See verify.snapshot_rules for why yaml.YAMLError/AttributeError/TypeError join ConfigError/OSError/ValueError
    # here: malformed YAML, or a well-formed but top-level list/scalar document, must report as verifier_config_error
    # instead of a 500.
    except (ConfigError, OSError, ValueError, yaml.YAMLError, AttributeError, TypeError) as e:
        config_error = str(e)
    keys = provider_key_status(deps.bs)
    result = {
        "company_monitor": (deps.settings.company_monitor_dir / "bulk_search.py").exists(),
        "url_verification": (deps.settings.url_verification_dir / "urlverify").exists(),
        "verifier_config_error": config_error,
        "keys": keys,
        "chromium": _chromium_installed(),
    }
    result["ok"] = bool(
        result["company_monitor"] and result["url_verification"] and config_error is None and result["chromium"]
    )
    return result


@router.get("/api/options")
def options(request: Request) -> dict:
    bs = request.app.state.deps.bs
    return {
        "providers": list(bs.PROVIDERS),
        "verticals": list(VERTICALS),
        "max_pages": {p: bs.max_pages_for(p) for p in bs.PROVIDERS},
    }
