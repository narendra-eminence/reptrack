from __future__ import annotations

import asyncio
import contextlib
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
    shutdown: asyncio.Event | None = None,
) -> AsyncGenerator[str, None]:
    """`shutdown`, when given, is raced against the queue wait: without it, a stream only ends when the client
    disconnects, so uvicorn's graceful shutdown blocks forever with any run page still open ("Waiting for
    connections to close")."""
    queue = bus.subscribe(run_id)  # before the snapshot, so nothing published in between is missed
    # Single long-lived tasks, reused across iterations (not recreated per loop) and cancelled in `finally` no
    # matter which await was in flight when this generator is torn down (client disconnect, shutdown, or a
    # cancelled task) - otherwise whichever one was still pending at that moment is destroyed without ever being
    # awaited, which asyncio logs as "Task was destroyed but it is pending!".
    get_task: asyncio.Task[dict[str, Any]] | None = None
    shutdown_wait = asyncio.ensure_future(shutdown.wait()) if shutdown is not None else None
    try:
        yield _sse({"type": "snapshot", "run": snapshot()})
        if shutdown_wait is not None and shutdown_wait.done():
            return
        while not await is_disconnected():
            get_task = asyncio.ensure_future(queue.get())
            waiting: set[asyncio.Future[Any]] = {get_task}
            if shutdown_wait is not None:
                waiting.add(shutdown_wait)
            done, _pending = await asyncio.wait(waiting, timeout=keepalive, return_when=asyncio.FIRST_COMPLETED)
            if shutdown_wait is not None and shutdown_wait in done:
                return
            if get_task not in done:
                get_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await get_task
                get_task = None
                yield ": keepalive\n\n"
                continue
            result = get_task.result()
            get_task = None
            yield _sse(result)
    finally:
        if get_task is not None and not get_task.done():
            get_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await get_task
        if shutdown_wait is not None and not shutdown_wait.done():
            shutdown_wait.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await shutdown_wait
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
        event_stream(
            run_id, request.app.state.bus, snapshot, request.is_disconnected, shutdown=request.app.state.shutdown
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
