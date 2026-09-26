"""FastAPI app factory. Start with: uvicorn pipeline_api.main:create_app --factory --host 127.0.0.1 --port 8000"""

from __future__ import annotations

from fastapi import FastAPI

from .deps import Deps, PipelineRunFn, SearchFn
from .errors import install_error_handlers
from .logs import configure_logging
from .monitor_bridge import load_bulk_search
from .routes import health
from .settings import Settings, load_settings


def create_app(
    settings: Settings | None = None, *, search_one: SearchFn | None = None, pipeline_run: PipelineRunFn | None = None
) -> FastAPI:
    settings = settings or load_settings()
    settings.check()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.exports_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(settings.logs_dir)
    bs = load_bulk_search(settings.company_monitor_dir)
    if pipeline_run is None:
        from urlverify.pipeline import run as pipeline_run
    deps = Deps(settings=settings, bs=bs, search_one=search_one or bs.search_one, pipeline_run=pipeline_run)

    app = FastAPI(title="RepScore Pipeline API")
    app.state.deps = deps
    install_error_handlers(app)
    app.include_router(health.router)
    return app
