from pathlib import Path

import pytest

from pipeline_api.settings import REPO_ROOT, Settings, load_settings


def test_defaults_point_at_sibling_repos():
    s = load_settings({})
    assert s.company_monitor_dir == Path.home() / "Desktop/Eminence/CompanyMonitor"
    assert s.url_verification_dir == Path.home() / "Desktop/niks/url-verification"
    assert s.verifier_config == s.url_verification_dir / "config.yaml"
    assert s.verifier_cache == s.url_verification_dir / "cache"
    assert s.data_dir == REPO_ROOT / "data"
    assert s.search_backend == "live"


def test_env_overrides(tmp_path):
    s = load_settings(
        {
            "PIPELINE_DATA_DIR": str(tmp_path),
            "URL_VERIFICATION_CONFIG": str(tmp_path / "c.yaml"),
            "PIPELINE_SEARCH_BACKEND": "fixture",
            "PIPELINE_SEARCH_FIXTURE": str(tmp_path / "f.json"),
        }
    )
    assert s.data_dir == tmp_path and s.db_path == tmp_path / "app.db"
    assert s.verifier_config == tmp_path / "c.yaml"
    assert s.search_backend == "fixture" and s.search_fixture == tmp_path / "f.json"


def test_check_names_missing_path(settings: Settings, tmp_path):
    settings.check()
    broken = Settings(**{**settings.__dict__, "verifier_config": tmp_path / "nope.yaml"})
    with pytest.raises(RuntimeError, match="URL_VERIFICATION_CONFIG"):
        broken.check()


def test_fixture_backend_requires_fixture(settings: Settings):
    broken = Settings(**{**settings.__dict__, "search_backend": "fixture"})
    with pytest.raises(RuntimeError, match="PIPELINE_SEARCH_FIXTURE"):
        broken.check()


def test_default_env_reads_dotenv_without_touching_os_environ(tmp_path, monkeypatch):
    import os

    from pipeline_api import settings as settings_module

    (tmp_path / ".env").write_text("ANTHROPIC_API_KEY=from-dotenv\nPIPELINE_SEARCH_BACKEND=fixture\n")
    monkeypatch.setattr(settings_module, "REPO_ROOT", tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("PIPELINE_SEARCH_BACKEND", "live")  # the real environment wins over .env
    s = load_settings()
    assert s.anthropic_api_key == "from-dotenv"
    assert s.search_backend == "live"
    assert "ANTHROPIC_API_KEY" not in os.environ
