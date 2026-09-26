import asyncio
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
