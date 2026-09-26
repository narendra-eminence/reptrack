import asyncio
import threading

from pipeline_api.events import EventBus


async def test_publish_reaches_subscribers_of_that_run_only():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    a, b = bus.subscribe("r1"), bus.subscribe("r2")
    bus.publish("r1", {"type": "x"})
    assert await asyncio.wait_for(a.get(), 1) == {"type": "x"}
    assert b.empty()
    bus.unsubscribe("r1", a)
    bus.publish("r1", {"type": "y"})
    assert a.empty()


async def test_publish_threadsafe_from_worker_thread():
    bus = EventBus()
    bus.bind(asyncio.get_running_loop())
    q = bus.subscribe("r1")
    threading.Thread(target=bus.publish_threadsafe, args=("r1", {"type": "t"})).start()
    assert await asyncio.wait_for(q.get(), 1) == {"type": "t"}


async def test_full_queue_becomes_resync():
    bus = EventBus(max_queue=3)
    bus.bind(asyncio.get_running_loop())
    q = bus.subscribe("r1")
    for i in range(5):
        bus.publish("r1", {"type": "n", "i": i})
    items = [q.get_nowait() for _ in range(q.qsize())]
    assert {"type": "resync"} in items
