import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

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
