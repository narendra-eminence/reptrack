"""What route handlers and jobs need, bundled so tests can swap the provider and the verifier."""

from __future__ import annotations

import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol

from .settings import Settings


class SearchFn(Protocol):
    """Same call shape as bulk_search.search_one: (query, start, end, pages, vertical, provider, stop, region) ->
    (rows, error, attempts). region is a bulk_search.REGIONS key, or None for the legacy default market."""

    def __call__(
        self,
        query: str,
        start: str,
        end: str,
        pages: int,
        vertical: str,
        provider: str,
        stop: threading.Event | None,
        region: str | None = None,
        /,
    ) -> tuple[list[dict[str, Any]], str, int]: ...


# Same signature as urlverify.pipeline.run
PipelineRunFn = Callable[..., Awaitable[dict[str, Any]]]


@dataclass
class Deps:
    settings: Settings
    bs: Any  # the bulk_search module
    search_one: SearchFn
    pipeline_run: PipelineRunFn
