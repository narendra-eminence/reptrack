"""Import Company Monitor's bulk_search from its own folder, in place.

Company Monitor is a folder of flat modules, not a package, and it has its own app.py and config/. Its folder is
appended to sys.path (never prepended) so nothing there can shadow a module of this app.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

from dotenv import load_dotenv


def load_bulk_search(company_monitor_dir: Path) -> ModuleType:
    # Keys live in Company Monitor's .env; override=False so a value exported in the shell wins.
    load_dotenv(company_monitor_dir / ".env", override=False)
    path = str(company_monitor_dir)
    if path not in sys.path:
        sys.path.append(path)
    return importlib.import_module("bulk_search")


def key_errors(bs: Any) -> tuple[type[Exception], ...]:
    return (bs.MissingKeyError, bs.dataforseo_serp.MissingCredentialsError)


def provider_key_status(bs: Any) -> dict[str, str | None]:
    """provider -> None when its credentials are present, else the message saying what to set."""
    status: dict[str, str | None] = {}
    for provider in bs.PROVIDERS:
        try:
            bs.check_credentials(provider)
            status[provider] = None
        except key_errors(bs) as e:
            status[provider] = str(e)
    return status
