"""SQLite access. Short-lived connections per unit of work; each thread opens its own."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@contextmanager
def session(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)  # autocommit; transactions are explicit
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection, immediate: bool = False) -> Iterator[None]:
    conn.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def migrate(db_path: Path) -> list[int]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(resources.files("pipeline_api.migrations").iterdir(), key=lambda p: p.name)
    applied: list[int] = []
    with session(db_path) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)")
        done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
        for f in files:
            if not f.name.endswith(".sql"):
                continue
            version = int(f.name.split("_", 1)[0])
            if version in done:
                continue
            with transaction(conn, immediate=True):
                for statement in f.read_text().split(";\n"):
                    if statement.strip():
                        conn.execute(statement)
                conn.execute("INSERT INTO schema_migrations VALUES (?, ?)", (version, now()))
            applied.append(version)
    return applied
