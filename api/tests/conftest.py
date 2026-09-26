import shutil
import threading
import time as _time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pipeline_api.settings import Settings, load_settings

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def settings(tmp_path) -> Settings:
    base = load_settings({})
    cfg = tmp_path / "verifier" / "config.yaml"
    cfg.parent.mkdir()
    shutil.copy(FIXTURES / "verifier_config.yaml", cfg)
    return Settings(
        company_monitor_dir=base.company_monitor_dir,
        url_verification_dir=base.url_verification_dir,
        verifier_config=cfg,
        verifier_cache=tmp_path / "verifier" / "cache",
        data_dir=tmp_path / "data",
    )


class _NoNetwork:
    def get(self, *a, **k):
        raise AssertionError("tests must not make live provider requests")

    post = get


@pytest.fixture(autouse=True)
def no_live_provider_calls(monkeypatch, tmp_path):
    """Company Monitor's shared requests session and disk cache are replaced for every test."""
    from pipeline_api.monitor_bridge import load_bulk_search

    load_bulk_search(load_settings({}).company_monitor_dir)
    import net  # pyright: ignore[reportMissingImports]  # flat module on sys.path, added at runtime above

    monkeypatch.setattr(net, "_session", _NoNetwork())
    monkeypatch.setattr(net, "CACHE_DIR", str(tmp_path / "monitor-cache"))


PARA = "Acme reported steady growth in its luggage business this quarter across every region it serves. "
FILLER = "Travel gear demand stayed firm as more families booked trips during the long holiday season. "
PAGES = {
    "/acme": "<html><head><title>Acme grows</title></head><body><article><h1>Acme grows</h1>"
    + "".join(f"<p>{PARA}</p>" for _ in range(3))
    + "</article></body></html>",
    "/plain": "<html><head><title>Travel</title></head><body><article><h1>Travel</h1>"
    + "".join(f"<p>{FILLER}</p>" for _ in range(4))
    + "</article></body></html>",
}


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        body = PAGES.get(self.path.split("?")[0])
        status = 200 if body else 404
        data = (body or "<html><body>missing</body></html>").encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):  # matches BaseHTTPRequestHandler's signature
        pass


@pytest.fixture(scope="session")
def page_server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()  # shutdown() only stops serve_forever's loop; this actually closes the listening socket
    t.join(timeout=5)


class FakeSearch:
    """Stands in for bulk_search.search_one. `results[query]` is a list of links; a query starting with 'fail:'
    fails; `gate` (when cleared) blocks every call until set, to hold a scrape mid-run."""

    def __init__(self, results: dict[str, list[str]] | None = None):
        self.results = results or {}
        self.calls: list[str] = []
        self.gate = threading.Event()
        self.gate.set()
        self.block_after: int | None = None  # calls beyond this many block on `gate`

    def __call__(self, query, start, end, pages, vertical, provider, stop):
        self.calls.append(query)
        if self.block_after is not None and len(self.calls) > self.block_after:
            self.gate.wait(10)
        if query.startswith("fail:"):
            return [], "page 1 request failed (SerpAPI call returned no data) (after 3 attempts)", 3
        links = self.results.get(query, [f"https://example.com/{query.replace(' ', '-')}"])
        rows = [
            {
                "query": query,
                "vertical": vertical,
                "provider": provider,
                "page": 1,
                "rank": i + 1,
                "title": f"Title {i}",
                "link": link,
                "domain": "example.com",
                "date": "",
                "published": "",
                "out_of_range": None,
                "range_start": start,
                "range_end": end,
                "snippet": "snippet",
                "outlet": "Example",
                "fetched_at": "2026-09-26T00:00:00+00:00",
            }
            for i, link in enumerate(links)
        ]
        return rows, "", 1


def make_client(settings, **kwargs) -> TestClient:
    from pipeline_api.main import create_app

    return TestClient(create_app(settings, **kwargs))


def wait_until(check: Callable[[], Any], timeout: float = 10.0) -> Any:
    deadline = _time.monotonic() + timeout
    while _time.monotonic() < deadline:
        value = check()
        if value:
            return value
        _time.sleep(0.02)
    raise AssertionError("condition not met in time")


SEARCH_BODY = {
    "queries": "alpha\nbeta",
    "provider": "serpapi",
    "vertical": "web",
    "pages": 1,
    "start": "2026-03-01",
    "end": "2026-08-31",
}
