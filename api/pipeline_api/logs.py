"""JSON-lines logs with run and job IDs on every line that has them."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("run_id", "job_id"):
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def configure_logging(logs_dir: Path) -> None:
    logs_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("pipeline_api")
    logger.setLevel(logging.INFO)
    target = str(logs_dir / "api.log")
    if not any(isinstance(h, RotatingFileHandler) and h.baseFilename == target for h in logger.handlers):
        handler = RotatingFileHandler(target, maxBytes=10_000_000, backupCount=3)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
