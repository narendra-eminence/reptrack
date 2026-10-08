"""Where the two sibling repos, the verifier config and this app's data live."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    company_monitor_dir: Path
    url_verification_dir: Path
    verifier_config: Path
    verifier_cache: Path
    data_dir: Path
    search_backend: str = "live"  # "live" | "fixture"
    search_fixture: Path | None = None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def check(self) -> None:
        """Fail at startup, naming the setting and path, instead of on the first request."""
        required = (
            ("COMPANY_MONITOR_DIR", self.company_monitor_dir / "bulk_search.py"),
            ("URL_VERIFICATION_DIR", self.url_verification_dir / "urlverify"),
            ("URL_VERIFICATION_CONFIG", self.verifier_config),
        )
        for label, path in required:
            if not path.exists():
                raise RuntimeError(f"{label}: {path} does not exist")
        if self.search_backend not in ("live", "fixture"):
            raise RuntimeError(f"PIPELINE_SEARCH_BACKEND must be 'live' or 'fixture', not {self.search_backend!r}")
        if self.search_backend == "fixture" and (self.search_fixture is None or not self.search_fixture.exists()):
            raise RuntimeError(
                "PIPELINE_SEARCH_FIXTURE must point to an existing file when PIPELINE_SEARCH_BACKEND=fixture"
            )


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    home = Path.home()
    uv_dir = Path(env.get("URL_VERIFICATION_DIR", str(home / "Desktop/niks/url-verification"))).expanduser()
    fixture = env.get("PIPELINE_SEARCH_FIXTURE")
    return Settings(
        company_monitor_dir=Path(
            env.get("COMPANY_MONITOR_DIR", str(home / "Desktop/Eminence/CompanyMonitor"))
        ).expanduser(),
        url_verification_dir=uv_dir,
        verifier_config=Path(env.get("URL_VERIFICATION_CONFIG", str(uv_dir / "config.yaml"))).expanduser(),
        verifier_cache=Path(env.get("URL_VERIFICATION_CACHE", str(uv_dir / "cache"))).expanduser(),
        data_dir=Path(env.get("PIPELINE_DATA_DIR", str(REPO_ROOT / "data"))).expanduser(),
        search_backend=env.get("PIPELINE_SEARCH_BACKEND", "live"),
        search_fixture=Path(fixture).expanduser() if fixture else None,
    )
