"""Chromium detection must check the exact headless-shell build Playwright expects, not any chromium* folder.

At baseline a stray `chromium-1223` folder existed while the verifier could not launch because the build
Playwright actually wanted (1234) was missing. A glob for `chromium*` would have reported "installed" wrongly.
"""

from __future__ import annotations

import json
from pathlib import Path

import playwright

from pipeline_api.routes.health import _chromium_installed


def _expected_revision() -> str:
    browsers_json = Path(playwright.__file__).resolve().parent / "driver" / "package" / "browsers.json"
    data = json.loads(browsers_json.read_text())
    return next(b["revision"] for b in data["browsers"] if b["name"] == "chromium-headless-shell")


def test_wrong_revision_folder_is_not_installed(tmp_path, monkeypatch):
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    (tmp_path / "chromium_headless_shell-0").mkdir()
    assert _chromium_installed() is False


def test_correct_revision_folder_is_installed(tmp_path, monkeypatch):
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    (tmp_path / f"chromium_headless_shell-{_expected_revision()}").mkdir()
    assert _chromium_installed() is True
