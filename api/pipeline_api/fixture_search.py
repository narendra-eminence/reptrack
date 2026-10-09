"""A search_one stand-in for end-to-end tests: results come from a JSON file, never from a provider."""

from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .deps import SearchFn


def make_fixture_search(bs: Any, path: Path) -> SearchFn:
    data = json.loads(path.read_text())
    delay = float(data.get("delay_seconds", 0))

    def search_one(
        query: str,
        start: str,
        end: str,
        pages: int,
        vertical: str,
        provider: str = "serpapi",
        stop: threading.Event | None = None,
        region: str | None = None,
    ) -> tuple[list[dict[str, Any]], str, int]:
        time.sleep(delay)
        if query.startswith("fail:"):
            return [], "fixture: simulated provider failure (after 3 attempts)", 3
        key = next((k for k in data["queries"] if k in query), None)
        items = data["queries"][key] if key else data.get("default", [])
        fetched_at = datetime.now(UTC).isoformat(timespec="seconds")
        return bs.map_results(items, query, vertical, fetched_at, start, end, provider), "", 1

    return search_one
