import datetime
import json
import threading
import time
from typing import Any, Dict, List, Optional

from ..db import get_conn
from .action_store import (
    get_action_task,
    get_action_unit,
    get_actuator,
    list_action_rules,
    list_action_schedules,
    list_action_tasks,
    list_action_units,
    list_actuators,
)
from .gpio_driver import get_gpio_driver, inspect_gpio_environment


_output_locks: Dict[str, threading.Lock] = {}
_task_locks: Dict[str, threading.Lock] = {}
_global_lock = threading.Lock()


def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _lock_for(lock_map: Dict[str, threading.Lock], item_id: str) -> threading.Lock:
    with _global_lock:
        if item_id not in lock_map:
            lock_map[item_id] = threading.Lock()
        return lock_map[item_id]


def _sleep(duration_ms: int, dry_run: bool) -> int:
    actual_ms = min(duration_ms, 100) if dry_run else duration_ms
    time.sleep(actual_ms / 1000.0)
    return actual_ms


def _parse_ts(raw: str) -> Optional[datetime.datetime]:
    try:
        return datetime.datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def _recent_success_exists(scope: str, scope_id: str, cooldown_sec: int) -> bool:
    if cooldown_sec <= 0:
        return False

    column = "task_id" if scope == "task" else "action_unit_id"
    with get_conn() as conn:
        row = conn.execute(
            f"""
            SELECT ts
            FROM action_log
            WHERE {column} = ? AND status = 'success'
            ORDER BY id DESC
            LIMIT 1
            """,
            (scope_id,),
        ).fetchone()

    if not row:
        return False
    last_ts = _parse_ts(str(row["ts"]))
    if not last_ts:
        return False
    delta = datetime.datetime.now() - last_ts
    return delta.total_seconds() < cooldown_sec


def write_action_log(
    source: str,
    status: str,
    message: str,
    detail: Dict[str, Any],
    action_unit_id: Optional[str] = None,
    task_id: Optional[str] = None,
    run_kind: str = "action_unit",
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO action_log(ts, source, action_unit_id, task_id, run_kind, status, message, detail_json)
            VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                _now(),
                source,
                action_unit_id,
                task_id,
                run_kind,
                status,
                message,
                json.dumps(detail, ensure_ascii=False),
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_action_logs(limit: int = 100) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, ts, source, action_unit_id, task_id, run_kind, status, message, detail_json
            FROM action_log
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    out: List[Dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["detail"] = json.loads(item.pop("detail_json") or "{}")
        except Exception:
            item["detail"] = {}
        out.append(item)
    return out


def latest_task_activity_map() -> Dict[str, Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT task_id, ts, source, run_kind, status, message
            FROM action_log
            WHERE task_id IS NOT NULL AND task_id <> ''
            ORDER BY id DESC
            """
        ).fetchall()
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        task_id = str(row["task_id"] or "").strip()
        if not task_id or task_id in out:
            continue
        out[task_id] = {
            "last_ts": row["ts"],
            "last_source": row["source"],
            "last_run_kind": row["run_kind"],
            "last_status": row["status"],
            "last_message": row["message"],
        }
    return out


def _run_relay_command(driver: Any, output: Dict[str, Any], command: str, detail_steps: List[Dict[str, Any]]) -> None:
    result = driver.set_relay(output, command)
    detail_steps.append({
        "type": "relay_state",
        "output_id": output["id"],
        "command": command,
        "result": result,
    })


def _run_pwm_command(driver: Any, output: Dict[str, Any], duty_percent: int, detail_steps: List[Dict[str, Any]]) -> None:
    result = driver.set_pwm(output, duty_percent)
    detail_steps.append({
        "type": "pwm_state",
        "output_id": output["id"],
        "duty_percent": duty_percent,
        "result": result,
    })


def _execute_action_unit_inner(action_unit: Dict[str, Any], dry_run: bool) -> Dict[str, Any]:
    if not action_unit.get("enabled", True):
        raise RuntimeError("Action unit is disabled")
    if not dry_run:
        from .action_scheduler import is_hardware_armed
        if not is_hardware_armed():
            raise RuntimeError("Real GPIO output is blocked until hardware is armed")

    output = get_actuator(action_unit["output_id"])
    if not output.get("enabled", True):
        raise RuntimeError(f"Output is disabled: {output['id']}")
    if not dry_run and not output.get("allow_real_output", output.get("allow_real", False)):
        raise RuntimeError(f"Real GPIO output is not allowed for: {output['id']}")

    driver = get_gpio_driver(dry_run)
    lock = _lock_for(_output_locks, output["id"])
    if not lock.acquire(blocking=False):
        raise RuntimeError(f"Output is busy: {output['id']}")

    detail_steps: List[Dict[str, Any]] = []
    try:
        mode = action_unit["mode"]
        params = action_unit.get("params") or {}

        if mode == "relay_state":
            _run_relay_command(driver, output, params["command"], detail_steps)

        elif mode == "relay_pulse":
            _run_relay_command(driver, output, "on", detail_steps)
            slept_ms = _sleep(int(params["duration_ms"]), dry_run)
            detail_steps.append({"type": "wait", "slept_ms": slept_ms})
            _run_relay_command(driver, output, "off", detail_steps)

        elif mode == "relay_pattern":
            total_duration_ms = int(params["total_duration_ms"])
            cycle_ms = int(params["cycle_ms"])
            on_duration_ms = int(params["on_duration_ms"])
            elapsed_ms = 0
            while elapsed_ms < total_duration_ms:
                cycle_index = int(elapsed_ms / cycle_ms)
                _run_relay_command(driver, output, "on", detail_steps)
                slept_on = _sleep(min(on_duration_ms, total_duration_ms - elapsed_ms), dry_run)
                detail_steps.append({"type": "wait", "phase": "on", "cycle": cycle_index, "slept_ms": slept_on})
                elapsed_ms += on_duration_ms
                _run_relay_command(driver, output, "off", detail_steps)
                if elapsed_ms >= total_duration_ms:
                    break
                off_duration_ms = min(cycle_ms - on_duration_ms, total_duration_ms - elapsed_ms)
                if off_duration_ms > 0:
                    slept_off = _sleep(off_duration_ms, dry_run)
                    detail_steps.append({"type": "wait", "phase": "off", "cycle": cycle_index, "slept_ms": slept_off})
                    elapsed_ms += off_duration_ms

        elif mode == "pwm_run":
            duty_percent = int(params["duty_percent"])
            _run_pwm_command(driver, output, duty_percent, detail_steps)
            slept_ms = _sleep(int(params["duration_ms"]), dry_run)
            detail_steps.append({"type": "wait", "slept_ms": slept_ms})
            safe_duty = int(output.get("safe_duty", 0))
            _run_pwm_command(driver, output, safe_duty, detail_steps)

        else:
            raise RuntimeError(f"Unsupported action mode: {mode}")

        return {
            "output": output,
            "mode": mode,
            "steps": detail_steps,
            "dry_run": dry_run,
        }
    finally:
        lock.release()


def execute_action_unit(action_unit_id: str, source: str = "manual", dry_run: bool = True) -> Dict[str, Any]:
    action_unit = get_action_unit(action_unit_id)
    detail = {
        "run_kind": "action_unit",
        "action_unit": action_unit,
        "dry_run": bool(dry_run),
    }

    try:
        run_detail = _execute_action_unit_inner(action_unit, bool(dry_run))
        detail.update(run_detail)
        message = "Dry-run action completed" if dry_run else "Real action completed"
        log_id = write_action_log(
            source=source,
            status="success",
            message=message,
            detail=detail,
            action_unit_id=action_unit_id,
            run_kind="action_unit",
        )
        return {"ok": True, "status": "success", "message": message, "log_id": log_id, "detail": detail}
    except Exception as exc:
        detail["error"] = str(exc)
        log_id = write_action_log(
            source=source,
            status="failed",
            message=str(exc),
            detail=detail,
            action_unit_id=action_unit_id,
            run_kind="action_unit",
        )
        return {"ok": False, "status": "failed", "message": str(exc), "log_id": log_id, "detail": detail}


def execute_action_task(task_id: str, source: str = "manual", dry_run: bool = True) -> Dict[str, Any]:
    task = get_action_task(task_id)
    detail: Dict[str, Any] = {
        "run_kind": "task",
        "task": task,
        "dry_run": bool(dry_run),
        "steps": [],
    }

    if not task.get("enabled", True):
        message = "Task is disabled"
        log_id = write_action_log(source, "blocked", message, detail, task_id=task_id, run_kind="task")
        return {"ok": False, "status": "blocked", "message": message, "log_id": log_id, "detail": detail}

    cooldown_sec = int(task.get("cooldown_sec", 0))
    if _recent_success_exists("task", task_id, cooldown_sec):
        message = f"Task cooldown is active ({cooldown_sec}s)"
        log_id = write_action_log(source, "blocked", message, detail, task_id=task_id, run_kind="task")
        return {"ok": False, "status": "blocked", "message": message, "log_id": log_id, "detail": detail}

    task_lock = _lock_for(_task_locks, task_id)
    if not task_lock.acquire(blocking=False):
        message = "Task is already running"
        log_id = write_action_log(source, "blocked", message, detail, task_id=task_id, run_kind="task")
        return {"ok": False, "status": "blocked", "message": message, "log_id": log_id, "detail": detail}

    try:
        for index, step in enumerate(task.get("steps", [])):
            step_type = step.get("step_type")
            if step_type == "wait":
                slept_ms = _sleep(int(step["duration_ms"]), bool(dry_run))
                detail["steps"].append({
                    "index": index,
                    "step_type": "wait",
                    "slept_ms": slept_ms,
                })
                continue

            if step_type != "run_action_unit":
                raise RuntimeError(f"Unsupported task step type: {step_type}")

            action_unit = get_action_unit(step["action_unit_id"])
            run_detail = _execute_action_unit_inner(action_unit, bool(dry_run))
            detail["steps"].append({
                "index": index,
                "step_type": "run_action_unit",
                "action_unit_id": action_unit["id"],
                "action_unit_name": action_unit.get("name", action_unit["id"]),
                "result": run_detail,
            })

        message = "Dry-run task completed" if dry_run else "Real task completed"
        log_id = write_action_log(
            source=source,
            status="success",
            message=message,
            detail=detail,
            task_id=task_id,
            run_kind="task",
        )
        return {"ok": True, "status": "success", "message": message, "log_id": log_id, "detail": detail}
    except Exception as exc:
        detail["error"] = str(exc)
        log_id = write_action_log(
            source=source,
            status="failed",
            message=str(exc),
            detail=detail,
            task_id=task_id,
            run_kind="task",
        )
        return {"ok": False, "status": "failed", "message": str(exc), "log_id": log_id, "detail": detail}
    finally:
        task_lock.release()


def action_runtime_summary() -> Dict[str, Any]:
    actuators = list_actuators()
    action_units = list_action_units()
    tasks = list_action_tasks()
    logs = list_action_logs(20)
    return {
        "outputs": {
            "total": len(actuators),
            "enabled": sum(1 for item in actuators if item.get("enabled", True)),
        },
        "action_units": {
            "total": len(action_units),
            "enabled": sum(1 for item in action_units if item.get("enabled", True)),
        },
        "tasks": {
            "total": len(tasks),
            "enabled": sum(1 for item in tasks if item.get("enabled", True)),
        },
        "rules": {
            "total": len(list_action_rules()),
            "enabled": sum(1 for item in list_action_rules() if item.get("enabled", False)),
        },
        "schedules": {
            "total": len(list_action_schedules()),
            "enabled": sum(1 for item in list_action_schedules() if item.get("enabled", False)),
        },
        "driver": inspect_gpio_environment(),
        "logs": logs,
    }
