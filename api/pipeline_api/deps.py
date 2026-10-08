"""What route handlers and jobs need, bundled so tests can swap the provider and the verifier."""

from __future__ import annotations

import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .settings import Settings

# (query, start, end, pages, vertical, provider, stop) -> (rows, error, attempts); same as bulk_search.search_one
SearchFn = Callable[[str, str, str, int, str, str, threading.Event | None], tuple[list[dict[str, Any]], str, int]]
# Same signature as urlverify.pipeline.run
PipelineRunFn = Callable[..., Awaitable[dict[str, Any]]]


@dataclass
class Deps:
    settings: Settings
    bs: Any  # the bulk_search module
    search_one: SearchFn
    pipeline_run: PipelineRunFn
