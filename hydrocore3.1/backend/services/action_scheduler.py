import datetime
import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .. import settings
from ..db import get_conn
from ..utils.json_io import atomic_write_json
from .action_executor import execute_action_task
from .action_store import (
    get_action_rule,
    get_action_schedule,
    list_action_rules,
    list_action_schedules,
)


AUTOMATION_FILE = settings.DATA_DIR / "automation" / "runtime.json"
DEFAULT_AUTOMATION_CONFIG = {
    "automation_enabled": True,
    "dry_run": False,
    "hardware_armed": True,
    "tick_sec": 2,
    "fresh_data_sec": 180,
}

_thread_lock = threading.Lock()
_runtime_thread: Optional["ActionAutomationThread"] = None


def _now() -> datetime.datetime:
    return datetime.datetime.now()


def _parse_runtime_ts(raw: str) -> Optional[datetime.datetime]:
    raw = str(raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M"):
        try:
            return datetime.datetime.strptime(raw, fmt)
        except Exception:
            continue
    return None


def _ensure_automation_dir() -> None:
    AUTOMATION_FILE.parent.mkdir(parents=True, exist_ok=True)


def load_automation_config() -> Dict[str, Any]:
    _ensure_automation_dir()
    if not AUTOMATION_FILE.exists():
        save_automation_config(DEFAULT_AUTOMATION_CONFIG)
    try:
        with open(AUTOMATION_FILE, "r", encoding="utf-8") as fh:
            item = json.load(fh)
    except Exception:
        item = dict(DEFAULT_AUTOMATION_CONFIG)
    return normalize_automation_config(item)


def normalize_automation_config(data: Dict[str, Any]) -> Dict[str, Any]:
    item = dict(DEFAULT_AUTOMATION_CONFIG)
    item.update(data or {})
    tick_sec = int(item.get("tick_sec", 2))
    fresh_data_sec = int(item.get("fresh_data_sec", 180))
    # A plan's own enabled flag is the product-level execution switch.
    # Keep the legacy fields fixed for compatibility with older API clients.
    item["automation_enabled"] = True
    item["dry_run"] = False
    item["hardware_armed"] = True
    item["tick_sec"] = min(max(tick_sec, 1), 60)
    item["fresh_data_sec"] = min(max(fresh_data_sec, 10), 3600)
    return item


def is_hardware_armed() -> bool:
    return bool(load_automation_config().get("hardware_armed", False))


def save_automation_config(data: Dict[str, Any]) -> Dict[str, Any]:
    config = normalize_automation_config(data)
    atomic_write_json(AUTOMATION_FILE, config)
    return config


def update_automation_config(data: Dict[str, Any]) -> Dict[str, Any]:
    merged = load_automation_config()
    merged.update(data or {})
    return save_automation_config(merged)


def _latest_log_for_source(source: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT id, ts, status, message
            FROM action_log
            WHERE source = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (source,),
        ).fetchone()
    return dict(row) if row else None


def _count_success_since(source: str, since_ts: str) -> int:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT COUNT(1) AS n
            FROM action_log
            WHERE source = ? AND status = 'success' AND ts >= ?
            """,
            (source, since_ts),
        ).fetchone()
    return int(row["n"]) if row else 0


def _series_window_stats(source: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    window_sec = int(source.get("window_sec", 60))
    protocol = str(source.get("signal_protocol") or "").strip()
    address = int(source.get("signal_address", 0))
    parameter = str(source.get("signal_parameter") or "").strip()
    if not protocol or not parameter:
        return None

    with get_conn() as conn:
        latest_row = conn.execute(
            """
            SELECT ts, value
            FROM sensor_data
            WHERE protocol = ? AND address = ? AND parameter = ?
            ORDER BY ts DESC
            LIMIT 1
            """,
            (protocol, address, parameter),
        ).fetchone()
        if not latest_row:
            return None

        since_row = conn.execute(
            """
            SELECT strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime', ?)
            """,
            (f"-{window_sec} seconds",),
        ).fetchone()
        since_ts = str(since_row[0])
        stats_row = conn.execute(
            """
            SELECT
              COUNT(1) AS n,
              AVG(value) AS avg_value,
              MIN(value) AS min_value,
              MAX(value) AS max_value
            FROM sensor_data
            WHERE protocol = ? AND address = ? AND parameter = ?
              AND ts >= ?
            """,
            (protocol, address, parameter, since_ts),
        ).fetchone()

    latest_ts = _parse_runtime_ts(str(latest_row["ts"]))
    latest_value = latest_row["value"]
    avg_value = stats_row["avg_value"] if stats_row and stats_row["n"] else None
    min_value = stats_row["min_value"] if stats_row and stats_row["n"] else None
    max_value = stats_row["max_value"] if stats_row and stats_row["n"] else None
    return {
        "latest_ts": latest_ts,
        "latest_value": latest_value,
        "avg_value": avg_value,
        "min_value": min_value,
        "max_value": max_value,
        "points": int(stats_row["n"] or 0) if stats_row else 0,
    }


def _series_bucket_stats(source: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    bucket_sec = int(source.get("bucket_sec") or 0)
    bucket_count = int(source.get("bucket_count") or 1)
    if bucket_sec <= 0:
        return None

    bucket_agg = str(source.get("bucket_agg") or source.get("aggregation") or "avg").strip().lower()
    if bucket_agg not in ("last", "avg", "min", "max"):
        bucket_agg = "avg"
    protocol = str(source.get("signal_protocol") or "").strip()
    address = int(source.get("signal_address", 0))
    parameter = str(source.get("signal_parameter") or "").strip()
    if not protocol or not parameter:
        return None

    # Add one extra bucket of lookback so a just-started current bucket can still
    # be evaluated without dropping the previous complete bucket from the query.
    window_sec = bucket_sec * bucket_count + bucket_sec
    with get_conn() as conn:
        since_row = conn.execute(
            "SELECT strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime', ?)",
            (f"-{window_sec} seconds",),
        ).fetchone()
        since_ts = str(since_row[0])
        if bucket_agg == "last":
            rows = conn.execute(
                """
                WITH grouped AS (
                  SELECT (CAST(strftime('%s', ts) AS INTEGER) / ?) * ? AS bkt,
                         MAX(ts) AS latest_ts
                    FROM sensor_data
                   WHERE protocol = ? AND address = ? AND parameter = ?
                     AND ts >= ?
                   GROUP BY bkt
                )
                SELECT grouped.bkt AS bkt, grouped.latest_ts AS latest_ts, d.value AS value, 1 AS n
                  FROM grouped
                  JOIN sensor_data d
                    ON d.protocol = ? AND d.address = ? AND d.parameter = ?
                   AND d.ts = grouped.latest_ts
                 ORDER BY grouped.bkt DESC
                 LIMIT ?
                """,
                (
                    bucket_sec,
                    bucket_sec,
                    protocol,
                    address,
                    parameter,
                    since_ts,
                    protocol,
                    address,
                    parameter,
                    bucket_count,
                ),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT (CAST(strftime('%s', ts) AS INTEGER) / ?) * ? AS bkt,
                       MAX(ts) AS latest_ts,
                       {bucket_agg}(value) AS value,
                       COUNT(1) AS n
                  FROM sensor_data
                 WHERE protocol = ? AND address = ? AND parameter = ?
                   AND ts >= ?
                 GROUP BY bkt
                 ORDER BY bkt DESC
                 LIMIT ?
                """,
                (bucket_sec, bucket_sec, protocol, address, parameter, since_ts, bucket_count),
            ).fetchall()

    if not rows:
        return None

    buckets = []
    for row in rows:
        bucket_ts = datetime.datetime.fromtimestamp(int(row["bkt"]))
        latest_ts = _parse_runtime_ts(str(row["latest_ts"]))
        value = row["value"]
        buckets.append({
            "bucket_ts": bucket_ts,
            "latest_ts": latest_ts,
            "value": value,
            "points": int(row["n"] or 0),
        })

    newest = buckets[0]
    values = [item["value"] for item in buckets if item["value"] is not None]
    latest_ts_values = [item["latest_ts"] for item in buckets if item.get("latest_ts")]
    latest_ts = max(latest_ts_values) if latest_ts_values else None
    return {
        "latest_ts": latest_ts,
        "latest_value": newest.get("value"),
        "avg_value": sum(values) / len(values) if values else None,
        "min_value": min(values) if values else None,
        "max_value": max(values) if values else None,
        "points": sum(int(item.get("points") or 0) for item in buckets),
        "bucket_sec": bucket_sec,
        "bucket_count": bucket_count,
        "bucket_agg": bucket_agg,
        "bucket_values": buckets,
        "matched_bucket_count": len(buckets),
    }


def _condition_stats(condition: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if int(condition.get("bucket_sec") or 0) > 0:
        return _series_bucket_stats(condition)
    return _series_window_stats(condition)


def _rule_conditions(rule: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = rule.get("conditions")
    if isinstance(raw, list) and raw:
        return [dict(item or {}) for item in raw if isinstance(item, dict)]
    bucket_sec = int(rule.get("bucket_sec") or 0)
    bucket_count = int(rule.get("bucket_count") or 1)
    return [{
        "metric_key": rule.get("metric_key") or rule.get("signal_parameter") or "",
        "signal_protocol": rule.get("signal_protocol") or "",
        "signal_address": rule.get("signal_address", 0),
        "signal_parameter": rule.get("signal_parameter") or "",
        "aggregation": rule.get("aggregation") or "last",
        "window_sec": rule.get("window_sec", 60),
        "bucket_sec": bucket_sec,
        "bucket_count": bucket_count,
        "bucket_agg": rule.get("bucket_agg") or rule.get("aggregation") or "last",
        "pass_mode": rule.get("pass_mode") or ("all" if bucket_sec > 0 and bucket_count > 1 else "latest"),
        "operator": rule.get("operator") or "",
        "threshold": rule.get("threshold", 0),
        "requires_fresh_data": rule.get("requires_fresh_data", True),
    }]


def _condition_value(condition: Dict[str, Any], stats: Optional[Dict[str, Any]]) -> Optional[float]:
    if not stats:
        return None
    bucket_sec = int(condition.get("bucket_sec") or 0)
    if bucket_sec > 0:
        return stats.get("latest_value")
    aggregation = str(condition.get("aggregation") or "last")
    if aggregation == "avg":
        return stats.get("avg_value")
    if aggregation == "min":
        return stats.get("min_value")
    if aggregation == "max":
        return stats.get("max_value")
    return stats.get("latest_value")


def _condition_match(condition: Dict[str, Any], stats: Optional[Dict[str, Any]]) -> bool:
    if not stats:
        return False
    operator = str(condition.get("operator") or "")
    threshold = float(condition.get("threshold", 0))
    bucket_sec = int(condition.get("bucket_sec") or 0)
    if bucket_sec <= 0:
        return _compare_value(_condition_value(condition, stats), operator, threshold)

    buckets = list(stats.get("bucket_values") or [])
    if not buckets:
        return False
    bucket_count = int(condition.get("bucket_count") or 1)
    pass_mode = str(condition.get("pass_mode") or ("all" if bucket_count > 1 else "latest"))
    checks = [
        _compare_value(item.get("value"), operator, threshold)
        for item in buckets
        if item.get("value") is not None
    ]
    if pass_mode == "all":
        return len(checks) >= bucket_count and all(checks[:bucket_count])
    if pass_mode == "any":
        return any(checks[:bucket_count])
    return bool(checks and checks[0])


def _compare_value(value: Optional[float], operator: str, threshold: float) -> bool:
    if value is None:
        return False
    if operator == ">":
        return value > threshold
    if operator == ">=":
        return value >= threshold
    if operator == "<":
        return value < threshold
    if operator == "<=":
        return value <= threshold
    return False


def _condition_sustain_ready(item: Dict[str, Any]) -> bool:
    """Use the strongest window proof for legacy sustain rules."""
    condition = item.get("condition") or {}
    stats = item.get("stats") or {}
    operator = str(condition.get("operator") or "")
    threshold = float(condition.get("threshold", 0))
    if operator in (">", ">="):
        return _compare_value(stats.get("min_value"), operator, threshold)
    if operator in ("<", "<="):
        return _compare_value(stats.get("max_value"), operator, threshold)
    return False


def _format_dt(value: Optional[datetime.datetime]) -> Optional[str]:
    if not value:
        return None
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _parse_time_of_day(value: str) -> Optional[datetime.time]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        hour, minute = [int(part) for part in raw.split(":", 1)]
        return datetime.time(hour=hour, minute=minute)
    except Exception:
        return None


def _active_days(item: Dict[str, Any]) -> List[int]:
    raw = item.get("active_days")
    if not isinstance(raw, list) or not raw:
        return [0, 1, 2, 3, 4, 5, 6]
    days: List[int] = []
    for value in raw:
        try:
            day = int(value)
        except Exception:
            continue
        if 0 <= day <= 6 and day not in days:
            days.append(day)
    return days or [0, 1, 2, 3, 4, 5, 6]


def _is_in_active_window(item: Dict[str, Any], now: datetime.datetime) -> bool:
    days = _active_days(item)
    start_time = _parse_time_of_day(str(item.get("active_start_time") or ""))
    end_time = _parse_time_of_day(str(item.get("active_end_time") or ""))

    if not start_time and not end_time:
        return now.weekday() in days

    current_time = now.time().replace(second=0, microsecond=0)
    if not start_time:
        start_time = datetime.time(0, 0)
    if not end_time:
        end_time = datetime.time(23, 59)

    if start_time <= end_time:
        return now.weekday() in days and start_time <= current_time <= end_time

    previous_day = (now.weekday() - 1) % 7
    return (now.weekday() in days and current_time >= start_time) or (previous_day in days and current_time <= end_time)


def _active_window_info(item: Dict[str, Any], now: datetime.datetime) -> Dict[str, Any]:
    return {
        "active_days": _active_days(item),
        "active_start_time": str(item.get("active_start_time") or ""),
        "active_end_time": str(item.get("active_end_time") or ""),
        "active_now": _is_in_active_window(item, now),
    }


def preview_action_schedule(schedule: Dict[str, Any], now: Optional[datetime.datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    last_log = _latest_log_for_source(f"schedule:{schedule['id']}")
    last_success_ts = _parse_runtime_ts(last_log["ts"]) if last_log and last_log.get("status") == "success" else None
    schedule_type = schedule.get("schedule_type")
    next_run: Optional[datetime.datetime] = None
    blocked_reason = ""

    active_window = _active_window_info(schedule, now)

    if not schedule.get("enabled", False):
        blocked_reason = "Schedule is disabled"
    elif not active_window["active_now"]:
        blocked_reason = "Outside active window"
    else:
        end_at = _parse_runtime_ts(schedule.get("end_at") or "")
        if end_at and now > end_at:
            blocked_reason = "Schedule window ended"
        elif schedule_type == "once":
            start_at = _parse_runtime_ts(schedule.get("start_at") or "")
            if start_at and last_success_ts is None and start_at >= now:
                next_run = start_at
            elif last_success_ts is not None:
                blocked_reason = "One-shot schedule already executed"
            else:
                blocked_reason = "Missing or expired start time"
        elif schedule_type == "daily":
            time_of_day = str(schedule.get("time_of_day") or "").strip()
            start_at = _parse_runtime_ts(schedule.get("start_at") or "")
            try:
                hour, minute = [int(part) for part in time_of_day.split(":", 1)]
                anchor = start_at if start_at and start_at > now else now
                candidate = anchor.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if candidate < anchor:
                    candidate = candidate + datetime.timedelta(days=1)
                if last_success_ts and last_success_ts.date() == candidate.date() and candidate <= now:
                    candidate = candidate + datetime.timedelta(days=1)
                for _ in range(8):
                    if _is_in_active_window(schedule, candidate):
                        break
                    candidate = candidate + datetime.timedelta(days=1)
                next_run = candidate
            except Exception:
                blocked_reason = "Invalid daily time"
        elif schedule_type == "interval":
            interval_sec = int(schedule.get("interval_sec", 0))
            start_at = _parse_runtime_ts(schedule.get("start_at") or "")
            if interval_sec <= 0:
                blocked_reason = "Invalid interval"
            elif last_success_ts:
                next_run = last_success_ts + datetime.timedelta(seconds=interval_sec)
            elif start_at and start_at > now:
                next_run = start_at
            else:
                next_run = now + datetime.timedelta(seconds=interval_sec)
        else:
            blocked_reason = "Unsupported schedule type"

    return {
        "last_success_ts": _format_dt(last_success_ts),
        "next_run_ts": _format_dt(next_run),
        "blocked_reason": blocked_reason,
        "active_window": active_window,
    }


def preview_action_rule(rule: Dict[str, Any], now: Optional[datetime.datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    freshness_sec_limit = load_automation_config().get("fresh_data_sec", 180)
    sustain_sec = int(rule.get("sustain_sec", 0))
    condition_results: List[Dict[str, Any]] = []
    for condition in _rule_conditions(rule):
        stats_source = dict(condition)
        if (
            int(condition.get("bucket_sec") or 0) <= 0
            and sustain_sec > 0
            and str(condition.get("aggregation") or "last") == "last"
        ):
            stats_source["window_sec"] = max(1, sustain_sec)
        stats = _condition_stats(stats_source)
        latest_ts = stats.get("latest_ts") if stats else None
        freshness_sec = (now - latest_ts).total_seconds() if latest_ts else None
        requires_fresh = bool(condition.get("requires_fresh_data", True))
        fresh_ok = bool(latest_ts and freshness_sec is not None and freshness_sec <= freshness_sec_limit) if requires_fresh else True
        current_value = _condition_value(condition, stats)
        matched = _condition_match(condition, stats)
        bucket_values = list((stats or {}).get("bucket_values") or [])
        condition_results.append({
            "condition": condition,
            "stats": {
                "latest_ts": _format_dt(latest_ts),
                "latest_value": stats.get("latest_value") if stats else None,
                "avg_value": stats.get("avg_value") if stats else None,
                "min_value": stats.get("min_value") if stats else None,
                "max_value": stats.get("max_value") if stats else None,
                "points": stats.get("points") if stats else 0,
                "bucket_sec": stats.get("bucket_sec") if stats else None,
                "bucket_count": stats.get("bucket_count") if stats else None,
                "bucket_agg": stats.get("bucket_agg") if stats else None,
                "matched_bucket_count": stats.get("matched_bucket_count") if stats else 0,
                "bucket_values": [
                    {
                        "bucket_ts": _format_dt(item.get("bucket_ts")),
                        "latest_ts": _format_dt(item.get("latest_ts")),
                        "value": item.get("value"),
                        "points": item.get("points"),
                    }
                    for item in bucket_values[:20]
                ],
            },
            "current_value": current_value,
            "matched": matched,
            "fresh_ok": fresh_ok,
            "freshness_sec": freshness_sec,
            "freshness_limit_sec": freshness_sec_limit,
        })

    first_result = condition_results[0] if condition_results else {}
    stats = first_result.get("stats") or {}
    current_value = first_result.get("current_value")
    matched_now = bool(condition_results) and all(bool(item["matched"]) for item in condition_results)
    fresh_ok = bool(condition_results) and all(bool(item["fresh_ok"]) for item in condition_results)
    freshness_values = [
        item.get("freshness_sec")
        for item in condition_results
        if item.get("freshness_sec") is not None
    ]
    freshness_sec = max(freshness_values) if freshness_values else None
    sustain_ready = sustain_sec <= 0
    if matched_now and sustain_sec > 0:
        sustain_ready = all(_condition_sustain_ready(item) for item in condition_results)
    source = f"rule:{rule['id']}"
    last_log = _latest_log_for_source(source)
    last_success_ts = _parse_runtime_ts(last_log["ts"]) if last_log and last_log.get("status") == "success" else None
    cooldown_sec = int(rule.get("cooldown_sec", 0))
    cooldown_ready = True
    if last_success_ts and cooldown_sec > 0:
        cooldown_ready = (now - last_success_ts).total_seconds() >= cooldown_sec
    max_runs_per_hour = int(rule.get("max_runs_per_hour", 0))
    hourly_runs = 0
    hourly_ready = True
    if max_runs_per_hour > 0:
        since_ts = (now - datetime.timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        hourly_runs = _count_success_since(source, since_ts)
        hourly_ready = hourly_runs < max_runs_per_hour

    active_window = _active_window_info(rule, now)

    return {
        "stats": stats,
        "conditions": condition_results,
        "condition_count": len(condition_results),
        "matched_count": sum(1 for item in condition_results if item["matched"]),
        "current_value": current_value,
        "matched_now": matched_now,
        "fresh_ok": fresh_ok,
        "freshness_sec": freshness_sec,
        "freshness_limit_sec": freshness_sec_limit,
        "sustain_ready": sustain_ready,
        "sustain_required_sec": sustain_sec,
        "cooldown_ready": cooldown_ready,
        "cooldown_sec": cooldown_sec,
        "last_success_ts": _format_dt(last_success_ts),
        "hourly_runs": hourly_runs,
        "hourly_ready": hourly_ready,
        "active_window": active_window,
        "would_fire_now": bool(rule.get("enabled", False)) and active_window["active_now"] and matched_now and fresh_ok and sustain_ready and cooldown_ready and hourly_ready,
    }


def evaluate_action_rule(rule_id: str, dry_run: bool = True, execute_if_match: bool = False) -> Dict[str, Any]:
    rule = get_action_rule(rule_id)
    preview = preview_action_rule(rule)
    condition_results = list(preview.get("conditions", []))
    matched = bool(preview["matched_now"])
    can_fire = bool(preview["would_fire_now"])
    reason = ""

    if not rule.get("enabled", False):
        reason = "Rule is disabled"
    elif not preview["active_window"]["active_now"]:
        reason = "Outside active window"
    elif any(not ((item.get("stats") or {}).get("latest_ts")) for item in condition_results):
        reason = "No sensor data available"
    elif not preview["fresh_ok"]:
        reason = "Sensor data is stale"
    elif not matched:
        reason = "Threshold is not matched"
    elif not preview["sustain_ready"]:
        reason = "Current snapshot matches, but sustain time still needs live observation"
    elif not preview["cooldown_ready"]:
        reason = "Task cooldown is active"
    elif not preview["hourly_ready"]:
        reason = "Hourly run limit is reached"
    else:
        reason = "Rule would fire now"

    result: Dict[str, Any] = {
        "ok": True,
        "rule": rule,
        "stats": preview["stats"],
        "conditions": preview.get("conditions", []),
        "condition_count": preview.get("condition_count", 0),
        "matched_count": preview.get("matched_count", 0),
        "matched": matched,
        "sustained": bool(preview["sustain_ready"]),
        "can_fire": can_fire,
        "hold_seconds": float(preview["sustain_required_sec"]),
        "current_value": preview["current_value"],
        "fresh_ok": preview["fresh_ok"],
        "freshness_sec": preview["freshness_sec"],
        "freshness_limit_sec": preview["freshness_limit_sec"],
        "cooldown_ready": preview["cooldown_ready"],
        "cooldown_sec": preview["cooldown_sec"],
        "last_success_ts": preview["last_success_ts"],
        "hourly_runs": preview["hourly_runs"],
        "hourly_ready": preview["hourly_ready"],
        "active_window": preview["active_window"],
        "dry_run": bool(dry_run),
        "message": reason,
    }

    if execute_if_match and can_fire:
        task_result = execute_action_task(
            rule["task_id"],
            source=f"rule-test:{rule['id']}",
            dry_run=bool(dry_run),
        )
        result["task_result"] = task_result
        result["ok"] = bool(task_result.get("ok", False))
        result["message"] = task_result.get("message") or "Rule matched current data and was executed manually"
    return result


def trigger_action_schedule(schedule_id: str, dry_run: bool = True) -> Dict[str, Any]:
    schedule = get_action_schedule(schedule_id)
    preview = preview_action_schedule(schedule)
    task_result = execute_action_task(
        schedule["task_id"],
        source=f"schedule-test:{schedule['id']}",
        dry_run=bool(dry_run),
    )
    return {
        "ok": bool(task_result.get("ok", False)),
        "schedule": schedule,
        "preview": preview,
        "task_result": task_result,
        "dry_run": bool(dry_run),
        "message": task_result.get("message") or "",
    }


class ActionAutomationThread(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True, name="ActionAutomationThread")
        self._stop_evt = threading.Event()
        self._state_lock = threading.Lock()
        self._rule_holds: Dict[str, Optional[datetime.datetime]] = {}
        self._last_tick: Optional[str] = None
        self._last_error: str = ""

    def stop(self) -> None:
        self._stop_evt.set()

    def status(self) -> Dict[str, Any]:
        config = load_automation_config()
        with self._state_lock:
            return {
                "running": self.is_alive(),
                "automation_enabled": config["automation_enabled"],
                "dry_run": config["dry_run"],
                "hardware_armed": config["hardware_armed"],
                "tick_sec": config["tick_sec"],
                "fresh_data_sec": config["fresh_data_sec"],
                "last_tick": self._last_tick,
                "last_error": self._last_error,
            }

    def _set_tick(self) -> None:
        with self._state_lock:
            self._last_tick = _now().strftime("%Y-%m-%d %H:%M:%S")
            self._last_error = ""

    def _set_error(self, message: str) -> None:
        with self._state_lock:
            self._last_error = message

    def _schedule_should_fire(self, schedule: Dict[str, Any], now: datetime.datetime) -> bool:
        if not schedule.get("enabled", False):
            return False

        if not _is_in_active_window(schedule, now):
            return False

        source = f"schedule:{schedule['id']}"
        schedule_type = schedule.get("schedule_type")
        last_log = _latest_log_for_source(source)
        last_success_ts = _parse_runtime_ts(last_log["ts"]) if last_log and last_log.get("status") == "success" else None

        end_at = _parse_runtime_ts(schedule.get("end_at") or "")
        if end_at and now > end_at:
            return False

        cooldown_sec = int(schedule.get("cooldown_sec", 0))
        if last_success_ts and cooldown_sec > 0:
            if (now - last_success_ts).total_seconds() < cooldown_sec:
                return False

        if schedule_type == "once":
            start_at = _parse_runtime_ts(schedule.get("start_at") or "")
            if not start_at or now < start_at:
                return False
            return last_success_ts is None

        if schedule_type == "daily":
            time_of_day = str(schedule.get("time_of_day") or "").strip()
            start_at = _parse_runtime_ts(schedule.get("start_at") or "")
            if start_at and now < start_at:
                return False
            if not time_of_day:
                return False
            try:
                hour, minute = [int(part) for part in time_of_day.split(":", 1)]
            except Exception:
                return False
            if now.hour != hour or now.minute != minute:
                return False
            return not last_success_ts or last_success_ts.date() != now.date()

        if schedule_type == "interval":
            interval_sec = int(schedule.get("interval_sec", 0))
            if interval_sec <= 0:
                return False
            start_at = _parse_runtime_ts(schedule.get("start_at") or "")
            if start_at and now < start_at:
                return False
            if not last_success_ts:
                if start_at:
                    return now >= start_at
                return True
            return (now - last_success_ts).total_seconds() >= interval_sec

        return False

    def _maybe_run_schedule(self, schedule: Dict[str, Any], config: Dict[str, Any], now: datetime.datetime) -> None:
        if not self._schedule_should_fire(schedule, now):
            return
        execute_action_task(
            schedule["task_id"],
            source=f"schedule:{schedule['id']}",
            dry_run=False,
        )

    def _rule_conditions_match(self, rule: Dict[str, Any]) -> bool:
        freshness_sec = load_automation_config().get("fresh_data_sec", 180)
        conditions = _rule_conditions(rule)
        if not conditions:
            return False
        for condition in conditions:
            stats = _condition_stats(condition)
            if not stats:
                return False
            if condition.get("requires_fresh_data", True):
                latest_ts = stats.get("latest_ts")
                if not latest_ts:
                    return False
                if (_now() - latest_ts).total_seconds() > freshness_sec:
                    return False
            if not _condition_match(condition, stats):
                return False
        return True

    def _rule_can_fire(self, rule: Dict[str, Any], now: datetime.datetime) -> bool:
        if not _is_in_active_window(rule, now):
            return False

        source = f"rule:{rule['id']}"
        last_log = _latest_log_for_source(source)
        last_success_ts = _parse_runtime_ts(last_log["ts"]) if last_log and last_log.get("status") == "success" else None
        cooldown_sec = int(rule.get("cooldown_sec", 0))
        if last_success_ts and cooldown_sec > 0:
            if (now - last_success_ts).total_seconds() < cooldown_sec:
                return False
        max_runs_per_hour = int(rule.get("max_runs_per_hour", 0))
        if max_runs_per_hour > 0:
            since_ts = (now - datetime.timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
            if _count_success_since(source, since_ts) >= max_runs_per_hour:
                return False
        return True

    def _maybe_run_rule(self, rule: Dict[str, Any], config: Dict[str, Any], now: datetime.datetime) -> None:
        if not rule.get("enabled", False):
            self._rule_holds.pop(rule["id"], None)
            return

        if not _is_in_active_window(rule, now):
            self._rule_holds.pop(rule["id"], None)
            return

        if not self._rule_conditions_match(rule):
            self._rule_holds.pop(rule["id"], None)
            return

        sustain_sec = int(rule.get("sustain_sec", 0))
        if sustain_sec <= 0:
            if not self._rule_can_fire(rule, now):
                return
            execute_action_task(
                rule["task_id"],
                source=f"rule:{rule['id']}",
                dry_run=False,
            )
            self._rule_holds[rule["id"]] = now
            return

        hold_since = self._rule_holds.get(rule["id"])
        if hold_since is None:
            self._rule_holds[rule["id"]] = now
            return

        held_sec = (now - hold_since).total_seconds()
        if held_sec < sustain_sec:
            return

        if not self._rule_can_fire(rule, now):
            return

        execute_action_task(
            rule["task_id"],
            source=f"rule:{rule['id']}",
            dry_run=False,
        )
        self._rule_holds[rule["id"]] = now

    def run(self) -> None:
        while not self._stop_evt.is_set():
            config = load_automation_config()
            try:
                now = _now()
                for schedule in list_action_schedules():
                    self._maybe_run_schedule(schedule, config, now)
                for rule in list_action_rules():
                    self._maybe_run_rule(rule, config, now)
                self._set_tick()
            except Exception as exc:
                self._set_error(str(exc))
            self._stop_evt.wait(float(config.get("tick_sec", 2)))


def ensure_automation_thread() -> ActionAutomationThread:
    global _runtime_thread
    with _thread_lock:
        if _runtime_thread and _runtime_thread.is_alive():
            return _runtime_thread
        _runtime_thread = ActionAutomationThread()
        _runtime_thread.start()
        return _runtime_thread


def stop_automation_thread() -> Dict[str, Any]:
    global _runtime_thread
    with _thread_lock:
        thread = _runtime_thread
        if not thread or not thread.is_alive():
            _runtime_thread = None
            return automation_runtime_status()
        thread.stop()
        thread.join(timeout=3.0)
        _runtime_thread = None
    return automation_runtime_status()


def automation_runtime_status() -> Dict[str, Any]:
    config = load_automation_config()
    thread = _runtime_thread
    status = {
        "running": bool(thread and thread.is_alive()),
        "automation_enabled": config["automation_enabled"],
        "dry_run": config["dry_run"],
        "hardware_armed": config["hardware_armed"],
        "tick_sec": config["tick_sec"],
        "fresh_data_sec": config["fresh_data_sec"],
        "last_tick": None,
        "last_error": "",
    }
    if thread:
        status.update(thread.status())
    return status
