from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from .. import runs
from ..db import session
from ..events import EventBus

router = APIRouter()


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def event_stream(
    run_id: str,
    bus: EventBus,
    snapshot: Callable[[], dict[str, Any]],
    is_disconnected: Callable[[], Awaitable[bool]],
    keepalive: float = 15.0,
) -> AsyncGenerator[str, None]:
    queue = bus.subscribe(run_id)  # before the snapshot, so nothing published in between is missed
    try:
        yield _sse({"type": "snapshot", "run": snapshot()})
        while not await is_disconnected():
            try:
                event = await asyncio.wait_for(queue.get(), keepalive)
            except TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield _sse(event)
    finally:
        bus.unsubscribe(run_id, queue)


@router.get("/api/runs/{run_id}/events")
async def events(request: Request, run_id: str) -> StreamingResponse:
    db_path = request.app.state.deps.settings.db_path
    with session(db_path) as conn:
        runs.get_run(conn, run_id)  # 404 before opening a stream

    def snapshot() -> dict[str, Any]:
        with session(db_path) as conn:
            return runs.run_detail(conn, run_id)

    return StreamingResponse(
        event_stream(run_id, request.app.state.bus, snapshot, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
