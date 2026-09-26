import asyncio
import contextlib
import json

from pipeline_api.events import EventBus
from pipeline_api.routes.events import event_stream


async def test_snapshot_first_then_live_events_then_keepalive():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    disconnected = False

    async def is_disconnected():
        return disconnected

    gen = event_stream("r1", bus, lambda: {"id": "r1", "status": "scraping"}, is_disconnected, keepalive=0.05)
    first = await gen.__anext__()
    assert first.startswith("data: ") and json.loads(first[6:])["type"] == "snapshot"
    bus.publish("r1", {"type": "query", "done": 1})
    assert json.loads((await gen.__anext__())[6:]) == {"type": "query", "done": 1}
    assert (await gen.__anext__()) == ": keepalive\n\n"
    disconnected = True
    await gen.aclose()
    assert "r1" not in bus._subs


async def test_event_stream_ends_promptly_when_shutdown_is_set():
    """Controller ruling 1: without racing a shutdown event, this generator only ends when the client disconnects,
    which is why uvicorn --reload / SIGINT hung forever with a run page's /events stream still open."""
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    shutdown = asyncio.Event()

    async def never_disconnected():
        return False

    gen = event_stream("r1", bus, lambda: {"id": "r1"}, never_disconnected, keepalive=5.0, shutdown=shutdown)
    first = await gen.__anext__()
    assert json.loads(first[6:])["type"] == "snapshot"

    async def wait_for_end():
        async for _ in gen:
            pass

    task = asyncio.ensure_future(wait_for_end())
    await asyncio.sleep(0.05)
    assert not task.done()  # still streaming; nothing has told it to stop
    shutdown.set()
    await asyncio.wait_for(task, timeout=1)  # ends promptly instead of waiting out the 5s keepalive
    assert "r1" not in bus._subs


async def test_shutdown_already_set_before_first_iteration_ends_after_snapshot():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    shutdown = asyncio.Event()
    shutdown.set()

    async def never_disconnected():
        return False

    gen = event_stream("r1", bus, lambda: {"id": "r1"}, never_disconnected, keepalive=5.0, shutdown=shutdown)
    first = await gen.__anext__()
    assert json.loads(first[6:])["type"] == "snapshot"
    with contextlib.suppress(StopAsyncIteration):
        await asyncio.wait_for(gen.__anext__(), timeout=1)
        raise AssertionError("expected the generator to end")


async def test_event_published_while_snapshot_builds_is_not_lost():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())

    def snapshot():
        bus.publish("r1", {"type": "job", "state": "done"})  # lands between subscribe and snapshot
        return {"id": "r1"}

    async def never():
        return False

    gen = event_stream("r1", bus, snapshot, never)
    await gen.__anext__()
    assert json.loads((await gen.__anext__())[6:])["type"] == "job"
    await gen.aclose()
