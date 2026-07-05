import sqlite3
from pathlib import Path

from . import settings


def get_conn():
    settings.DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def _column_names(conn, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row["name"]) for row in rows}


def _ensure_action_log_columns(conn) -> None:
    columns = _column_names(conn, "action_log")
    if not columns:
        return

    if "task_id" not in columns:
        conn.execute("ALTER TABLE action_log ADD COLUMN task_id TEXT")
    if "run_kind" not in columns:
        conn.execute("ALTER TABLE action_log ADD COLUMN run_kind TEXT DEFAULT 'action_unit'")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_action_log_task ON action_log(task_id)")


def _ensure_sensor_series_summary(conn) -> None:
    tables = {
        str(row["name"])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sensor_data','sensor_series_summary')"
        ).fetchall()
    }
    if not {"sensor_data", "sensor_series_summary"}.issubset(tables):
        return

    summary_n = conn.execute("SELECT COUNT(*) AS n FROM sensor_series_summary").fetchone()["n"]
    if summary_n:
        return

    data_n = conn.execute("SELECT COUNT(*) AS n FROM sensor_data").fetchone()["n"]
    if not data_n:
        return

    conn.execute("""
        INSERT INTO sensor_series_summary(protocol,address,parameter,first_ts,last_ts,n)
        SELECT protocol, address, parameter,
               MIN(ts) AS first_ts,
               MAX(ts) AS last_ts,
               COUNT(*) AS n
          FROM sensor_data
         GROUP BY protocol, address, parameter
    """)


def init_db():
    schema_path = Path(__file__).with_name("schema.sql")
    with get_conn() as conn, open(schema_path, "r", encoding="utf-8") as fh:
        conn.executescript(fh.read())
        _ensure_action_log_columns(conn)
        _ensure_sensor_series_summary(conn)
