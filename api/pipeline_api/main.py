"""FastAPI app factory. Start with: uvicorn pipeline_api.main:create_app --factory --host 127.0.0.1 --port 8000"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import migrate
from .deps import Deps, PipelineRunFn, SearchFn
from .errors import install_error_handlers
from .events import EventBus
from .jobs import JobRunner
from .logs import configure_logging
from .monitor_bridge import load_bulk_search
from .routes import brands as brands_routes
from .routes import events as events_routes
from .routes import health
from .routes import runs as runs_routes
from .routes import verify as verify_routes
from .scrape import scrape_kind
from .settings import Settings, load_settings
from .verify import verify_kind


def create_app(
    settings: Settings | None = None, *, search_one: SearchFn | None = None, pipeline_run: PipelineRunFn | None = None
) -> FastAPI:
    settings = settings or load_settings()
    settings.check()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.exports_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(settings.logs_dir)
    migrate(settings.db_path)
    bs = load_bulk_search(settings.company_monitor_dir)
    if pipeline_run is None:
        from urlverify.pipeline import run as pipeline_run
    deps = Deps(settings=settings, bs=bs, search_one=search_one or bs.search_one, pipeline_run=pipeline_run)

    bus = EventBus()
    runner = JobRunner(settings.db_path, bus, {"scrape": scrape_kind(deps), "verify": verify_kind(deps)})

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await runner.start()
        try:
            yield
        finally:
            await runner.stop()

    app = FastAPI(title="RepScore Pipeline API", lifespan=lifespan)
    app.state.deps = deps
    app.state.bus = bus
    app.state.runner = runner
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(runs_routes.router)
    app.include_router(verify_routes.router)
    app.include_router(events_routes.router)
    app.include_router(brands_routes.router)
    return app
