import sqlite3

import pytest

from pipeline_api.db import migrate, now, session, transaction


def _run(conn, run_id="r1"):
    conn.execute(
        "INSERT INTO runs (id, name, provider, vertical, pages, status, created_at, updated_at) "
        "VALUES (?, 'n', 'serpapi', 'web', 1, 'scraping', ?, ?)",
        (run_id, now(), now()),
    )


def test_migrate_is_idempotent(tmp_path):
    db = tmp_path / "app.db"
    assert migrate(db) == [1, 2]
    assert migrate(db) == []


def test_runs_from_before_regions_upgrade_with_no_region(tmp_path):
    db = tmp_path / "app.db"
    with session(db) as conn:  # a database at schema 1, as every install before regions has
        conn.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)")
        from importlib import resources

        sql = resources.files("pipeline_api.migrations").joinpath("001_init.sql").read_text()
        for statement in sql.split(";\n"):
            if statement.strip():
                conn.execute(statement)
        conn.execute("INSERT INTO schema_migrations VALUES (1, ?)", (now(),))
        _run(conn)
    assert migrate(db) == [2]
    with session(db) as conn:
        assert conn.execute("SELECT region FROM runs WHERE id = 'r1'").fetchone()[0] is None


def test_pragmas(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_one_active_job_per_run(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        _run(conn)
        conn.execute(
            "INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('scrape', 'r1', 'running', ?)", (now(),)
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('verify', 'r1', 'queued', ?)", (now(),)
            )
        conn.execute("UPDATE jobs SET state = 'done'")
        conn.execute(
            "INSERT INTO jobs (kind, run_id, state, created_at) VALUES ('verify', 'r1', 'queued', ?)", (now(),)
        )


def test_transaction_rolls_back(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        with pytest.raises(RuntimeError), transaction(conn):
            _run(conn)
            raise RuntimeError("boom")
        assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_delete_run_cascades(tmp_path):
    db = tmp_path / "app.db"
    migrate(db)
    with session(db) as conn:
        _run(conn)
        conn.execute("INSERT INTO queries (run_id, position, text, state) VALUES ('r1', 0, 'q', 'pending')")
        conn.execute("DELETE FROM runs WHERE id = 'r1'")
        assert conn.execute("SELECT COUNT(*) FROM queries").fetchone()[0] == 0
