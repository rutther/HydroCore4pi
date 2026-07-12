from pathlib import Path
import json
import re
from typing import Any, Dict, List

from ..utils.json_io import atomic_write_json
from .. import settings


ACTUATOR_DIR = settings.DATA_DIR / "actuators"
ACTION_UNIT_DIR = settings.DATA_DIR / "action_units"
ACTION_TASK_DIR = settings.DATA_DIR / "action_tasks"
ACTION_RULE_DIR = settings.DATA_DIR / "action_rules"
ACTION_SCHEDULE_DIR = settings.DATA_DIR / "action_schedules"
POLL_PLAN_FILE = settings.POLL_PLAN_FILE

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
TIME_OF_DAY_RE = re.compile(r"^\d{2}:\d{2}$")
DATETIME_MINUTE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def normalize_id(raw: Any) -> str:
    value = str(raw or "").strip()
    if not ID_RE.match(value):
        raise ValueError("id may only contain letters, numbers, _ and - (1-64 chars)")
    return value


def _path_for(base: Path, item_id: str) -> Path:
    return base / f"{normalize_id(item_id)}.json"


def _read_json(path: Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return data


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    atomic_write_json(path, data)


def list_items(base: Path) -> List[Dict[str, Any]]:
    _ensure_dir(base)
    items: List[Dict[str, Any]] = []
    for path in sorted(base.glob("*.json")):
        try:
            item = _read_json(path)
            item.setdefault("id", path.stem)
            items.append(item)
        except Exception as exc:
            items.append({
                "id": path.stem,
                "name": path.name,
                "status": "invalid",
                "error": str(exc),
            })
    return items


def get_item(base: Path, item_id: str) -> Dict[str, Any]:
    path = _path_for(base, item_id)
    if not path.exists():
        raise FileNotFoundError(f"config not found: {item_id}")
    data = _read_json(path)
    data.setdefault("id", path.stem)
    return data


def delete_item(base: Path, item_id: str) -> None:
    path = _path_for(base, item_id)
    if not path.exists():
        raise FileNotFoundError(f"config not found: {item_id}")
    path.unlink()


def _usage_error(kind: str, item_id: str, refs: List[str]) -> ValueError:
    detail = ", ".join(refs[:8])
    if len(refs) > 8:
        detail += f" ... (+{len(refs) - 8})"
    return ValueError(f"cannot delete {kind} '{item_id}' because it is referenced by: {detail}")


def _as_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    return bool(value)


def _poll_plan_signal_keys() -> set[tuple[str, int, str]]:
    data = _read_json(POLL_PLAN_FILE)
    if isinstance(data, list):
        plans = data
    else:
        plans = data.get("plans", [])
    if not isinstance(plans, list):
        raise ValueError("采集计划格式不正确，无法校验触发参数")

    keys: set[tuple[str, int, str]] = set()
    for ent in plans:
        if not isinstance(ent, dict):
            continue
        try:
            protocol = str(ent["protocol"]).strip()
            address = int(ent["address"])
        except Exception:
            continue
        for raw_param in ent.get("parameters", []):
            if isinstance(raw_param, str):
                parameter = raw_param.strip()
            elif isinstance(raw_param, dict):
                parameter = str(raw_param.get("name") or "").strip()
            else:
                parameter = ""
            if protocol and parameter:
                keys.add((protocol, address, parameter))
    return keys


def _require_plan_signal(protocol: str, address: int, parameter: str) -> None:
    try:
        keys = _poll_plan_signal_keys()
    except FileNotFoundError as exc:
        raise ValueError("采集计划不存在，无法保存参数触发规则") from exc

    if (protocol, address, parameter) not in keys:
        raise ValueError(f"触发参数不在当前采集计划中: {protocol}@{address}:{parameter}")


def _ensure_kind(item: Dict[str, Any]) -> str:
    kind = str(item.get("kind") or item.get("type") or "relay").strip()
    if kind not in ("relay", "pwm"):
        raise ValueError("output kind must be relay or pwm")
    return kind


def _require_task(task_id: Any) -> str:
    normalized = normalize_id(task_id)
    get_action_task(normalized)
    return normalized


def save_actuator(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dir(ACTUATOR_DIR)
    item = dict(data or {})
    item_id = normalize_id(item.get("id"))
    kind = _ensure_kind(item)

    normalized: Dict[str, Any] = {
        "id": item_id,
        "name": str(item.get("name") or item_id).strip(),
        "kind": kind,
        "type": kind,
        "gpio_pin": int(item.get("gpio_pin", item.get("pin", 0))),
        "enabled": _as_bool(item.get("enabled"), True),
        "allow_real_output": _as_bool(item.get("allow_real_output", item.get("allow_real")), False),
        "allow_real": _as_bool(item.get("allow_real_output", item.get("allow_real")), False),
        "description": str(item.get("description") or "").strip(),
    }

    if normalized["gpio_pin"] < 0 or normalized["gpio_pin"] > 40:
        raise ValueError("gpio_pin must be between 0 and 40")

    for existing in list_actuators():
        if existing.get("id") == item_id:
            continue
        try:
            existing_pin = int(existing.get("gpio_pin", existing.get("pin", -1)))
        except Exception:
            continue
        if existing_pin == normalized["gpio_pin"]:
            raise ValueError(f"GPIO {normalized['gpio_pin']} is already used by output: {existing.get('id')}")

    if kind == "relay":
        active_level = str(item.get("active_level") or "low").strip()
        safe_state = str(item.get("safe_state") or "off").strip()
        if active_level not in ("low", "high"):
            raise ValueError("active_level must be low or high")
        if safe_state not in ("off", "on"):
            raise ValueError("safe_state must be off or on")
        normalized["active_level"] = active_level
        normalized["safe_state"] = safe_state
        normalized["pin"] = normalized["gpio_pin"]
    else:
        frequency = int(item.get("pwm_frequency", 1000))
        default_duty = int(item.get("default_duty", 0))
        safe_duty = int(item.get("safe_duty", 0))
        if frequency < 1 or frequency > 50000:
            raise ValueError("pwm_frequency must be between 1 and 50000")
        for field_name, value in (("default_duty", default_duty), ("safe_duty", safe_duty)):
            if value < 0 or value > 100:
                raise ValueError(f"{field_name} must be between 0 and 100")
        normalized["pwm_frequency"] = frequency
        normalized["default_duty"] = default_duty
        normalized["safe_duty"] = safe_duty

    _write_json(_path_for(ACTUATOR_DIR, item_id), normalized)
    return normalized


def _require_output(output_id: Any) -> str:
    normalized = normalize_id(output_id)
    get_actuator(normalized)
    return normalized


def _normalize_action_mode(raw: Any) -> str:
    mode = str(raw or "").strip()
    supported = {"relay_pulse", "relay_state", "relay_pattern", "pwm_run"}
    if mode not in supported:
        raise ValueError("unsupported action mode")
    return mode


def _validate_action_params(mode: str, params: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if mode == "relay_pulse":
        duration_ms = int(params.get("duration_ms", 0))
        if duration_ms < 1 or duration_ms > 3600000:
            raise ValueError("duration_ms must be between 1 and 3600000")
        out["duration_ms"] = duration_ms
        return out

    if mode == "relay_state":
        command = str(params.get("command") or "").strip()
        if command not in ("on", "off"):
            raise ValueError("command must be on or off")
        out["command"] = command
        return out

    if mode == "relay_pattern":
        total_duration_ms = int(params.get("total_duration_ms", 0))
        cycle_ms = int(params.get("cycle_ms", 0))
        on_duration_ms = int(params.get("on_duration_ms", 0))
        if total_duration_ms < 1 or total_duration_ms > 43200000:
            raise ValueError("total_duration_ms must be between 1 and 43200000")
        if cycle_ms < 1 or cycle_ms > 3600000:
            raise ValueError("cycle_ms must be between 1 and 3600000")
        if on_duration_ms < 1 or on_duration_ms > cycle_ms:
            raise ValueError("on_duration_ms must be between 1 and cycle_ms")
        out["total_duration_ms"] = total_duration_ms
        out["cycle_ms"] = cycle_ms
        out["on_duration_ms"] = on_duration_ms
        return out

    if mode == "pwm_run":
        duty_percent = int(params.get("duty_percent", 0))
        duration_ms = int(params.get("duration_ms", 0))
        if duty_percent < 0 or duty_percent > 100:
            raise ValueError("duty_percent must be between 0 and 100")
        if duration_ms < 1 or duration_ms > 3600000:
            raise ValueError("duration_ms must be between 1 and 3600000")
        out["duty_percent"] = duty_percent
        out["duration_ms"] = duration_ms
        return out

    raise ValueError("unsupported action mode")


def action_unit_summary(item: Dict[str, Any]) -> str:
    mode = item.get("mode")
    params = item.get("params") or {}
    output_name = item.get("output_name") or item.get("output_id") or "-"
    if mode == "relay_pulse":
        return f"{output_name} 运行 {int(params.get('duration_ms', 0) / 1000)} 秒"
    if mode == "relay_state":
        command = "打开" if params.get("command") == "on" else "关闭"
        return f"{output_name} {command}"
    if mode == "relay_pattern":
        total_s = int(params.get("total_duration_ms", 0) / 1000)
        cycle_s = int(params.get("cycle_ms", 0) / 1000)
        on_s = int(params.get("on_duration_ms", 0) / 1000)
        return f"{output_name} 每 {cycle_s} 秒运行 {on_s} 秒，共 {total_s} 秒"
    if mode == "pwm_run":
        duty = params.get("duty_percent", 0)
        duration_s = int(params.get("duration_ms", 0) / 1000)
        return f"{output_name} PWM {duty}% 运行 {duration_s} 秒"
    return str(item.get("description") or "").strip()


def save_action_unit(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dir(ACTION_UNIT_DIR)
    item = dict(data or {})
    item_id = normalize_id(item.get("id"))
    output_id = _require_output(item.get("output_id"))
    output = get_actuator(output_id)
    mode = _normalize_action_mode(item.get("mode"))
    params = _validate_action_params(mode, dict(item.get("params") or {}))

    if mode.startswith("relay_") and output.get("kind") != "relay":
        raise ValueError("relay action units must target relay outputs")
    if mode == "pwm_run" and output.get("kind") != "pwm":
        raise ValueError("pwm_run must target a pwm output")

    normalized = {
        "id": item_id,
        "name": str(item.get("name") or item_id).strip(),
        "enabled": _as_bool(item.get("enabled"), True),
        "output_id": output_id,
        "output_name": output.get("name", output_id),
        "mode": mode,
        "params": params,
        "description": str(item.get("description") or "").strip(),
    }
    normalized["summary"] = action_unit_summary(normalized)

    _write_json(_path_for(ACTION_UNIT_DIR, item_id), normalized)
    return normalized


def _normalize_task_step(step: Dict[str, Any], index: int) -> Dict[str, Any]:
    step_type = str(step.get("step_type") or "").strip()
    if step_type == "run_action_unit":
        action_unit_id = normalize_id(step.get("action_unit_id"))
        get_action_unit(action_unit_id)
        return {
            "step_type": "run_action_unit",
            "action_unit_id": action_unit_id,
        }

    if step_type == "wait":
        duration_ms = int(step.get("duration_ms", 0))
        if duration_ms < 1 or duration_ms > 3600000:
            raise ValueError(f"task steps[{index}].duration_ms must be between 1 and 3600000")
        return {
            "step_type": "wait",
            "duration_ms": duration_ms,
        }

    raise ValueError(f"unsupported task step type at index {index}")


def task_summary(item: Dict[str, Any]) -> str:
    steps = item.get("steps") or []
    parts: List[str] = []
    for step in steps:
        if step.get("step_type") == "run_action_unit":
            parts.append(str(step.get("action_unit_name") or step.get("action_unit_id") or "-"))
        elif step.get("step_type") == "wait":
            parts.append(f"等待 {int(step.get('duration_ms', 0) / 1000)} 秒")
    return " -> ".join(parts) if parts else "-"


def save_action_task(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dir(ACTION_TASK_DIR)
    item = dict(data or {})
    item_id = normalize_id(item.get("id"))
    task_type = str(item.get("task_type") or "single_action").strip()
    if task_type not in ("single_action", "sequence"):
        raise ValueError("task_type must be single_action or sequence")

    raw_steps = item.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise ValueError("task steps must be a non-empty list")

    normalized_steps: List[Dict[str, Any]] = []
    action_steps = 0
    for index, raw_step in enumerate(raw_steps):
        if not isinstance(raw_step, dict):
            raise ValueError(f"task steps[{index}] must be an object")
        step = _normalize_task_step(raw_step, index)
        if step["step_type"] == "run_action_unit":
            action_steps += 1
            unit = get_action_unit(step["action_unit_id"])
            step["action_unit_name"] = unit.get("name", step["action_unit_id"])
        normalized_steps.append(step)

    if task_type == "single_action" and len(normalized_steps) != 1:
        raise ValueError("single_action task must contain exactly one step")
    if task_type == "single_action" and normalized_steps[0]["step_type"] != "run_action_unit":
        raise ValueError("single_action task must point to one action unit")
    if action_steps < 1:
        raise ValueError("task must run at least one action unit")

    cooldown_sec = int(item.get("cooldown_sec", 0))
    if cooldown_sec < 0 or cooldown_sec > 86400:
        raise ValueError("cooldown_sec must be between 0 and 86400")

    normalized = {
        "id": item_id,
        "name": str(item.get("name") or item_id).strip(),
        "enabled": _as_bool(item.get("enabled"), True),
        "task_type": task_type,
        "cooldown_sec": cooldown_sec,
        "steps": normalized_steps,
        "description": str(item.get("description") or "").strip(),
    }
    normalized["summary"] = task_summary(normalized)

    _write_json(_path_for(ACTION_TASK_DIR, item_id), normalized)
    return normalized


def _normalize_operator(raw: Any) -> str:
    operator = str(raw or "").strip()
    if operator not in (">", ">=", "<", "<="):
        raise ValueError("operator must be one of >, >=, <, <=")
    return operator


def _normalize_aggregation(raw: Any) -> str:
    aggregation = str(raw or "last").strip().lower()
    if aggregation not in ("last", "avg", "min", "max"):
        raise ValueError("aggregation must be one of last, avg, min, max")
    return aggregation


def _legacy_condition_from_rule(item: Dict[str, Any]) -> Dict[str, Any]:
    bucket_sec = int(item.get("bucket_sec") or 0)
    bucket_count = int(item.get("bucket_count") or 1)
    pass_mode = str(
        item.get("pass_mode") or ("all" if bucket_sec > 0 and bucket_count > 1 else "latest")
    ).strip().lower()
    return {
        "metric_key": str(item.get("metric_key") or item.get("signal_parameter") or "").strip(),
        "signal_protocol": str(item.get("signal_protocol") or "").strip(),
        "signal_address": int(item.get("signal_address", 0)),
        "signal_parameter": str(item.get("signal_parameter") or item.get("metric_key") or "").strip(),
        "aggregation": str(item.get("aggregation") or "last").strip().lower(),
        "window_sec": int(item.get("window_sec", 60)),
        "bucket_sec": bucket_sec,
        "bucket_count": bucket_count,
        "bucket_agg": str(item.get("bucket_agg") or item.get("aggregation") or "last").strip().lower(),
        "pass_mode": pass_mode,
        "operator": str(item.get("operator") or "").strip(),
        "threshold": item.get("threshold"),
        "requires_fresh_data": _as_bool(item.get("requires_fresh_data"), True),
    }


def _rule_conditions(item: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_conditions = item.get("conditions")
    if isinstance(raw_conditions, list) and raw_conditions:
        return [dict(cond or {}) for cond in raw_conditions if isinstance(cond, dict)]
    return [_legacy_condition_from_rule(item)]


def _normalize_rule_condition(raw: Dict[str, Any], index: int) -> Dict[str, Any]:
    item = dict(raw or {})
    signal_protocol = str(item.get("signal_protocol") or "").strip()
    signal_address = int(item.get("signal_address", 0))
    signal_parameter = str(item.get("signal_parameter") or item.get("metric_key") or "").strip()
    aggregation = _normalize_aggregation(item.get("aggregation"))
    window_sec = int(item.get("window_sec", 60))
    bucket_sec = int(item.get("bucket_sec") or 0)
    bucket_count = int(item.get("bucket_count") or 1)
    bucket_agg = _normalize_aggregation(item.get("bucket_agg") or aggregation)
    pass_mode = str(
        item.get("pass_mode") or ("all" if bucket_sec > 0 and bucket_count > 1 else "latest")
    ).strip().lower()

    if window_sec < 1 or window_sec > 86400:
        raise ValueError(f"condition {index + 1}: window_sec must be between 1 and 86400")
    if bucket_sec < 0 or bucket_sec > 86400:
        raise ValueError(f"condition {index + 1}: bucket_sec must be between 0 and 86400")
    if bucket_sec > 0 and bucket_sec < 1:
        raise ValueError(f"condition {index + 1}: bucket_sec must be positive")
    if bucket_count < 1 or bucket_count > 1440:
        raise ValueError(f"condition {index + 1}: bucket_count must be between 1 and 1440")
    if bucket_sec > 0 and bucket_sec * bucket_count > 86400:
        raise ValueError(f"condition {index + 1}: bucket range must not exceed 24 hours")
    if pass_mode not in ("latest", "all", "any"):
        raise ValueError(f"condition {index + 1}: pass_mode must be latest, all or any")
    if not signal_protocol:
        raise ValueError(f"condition {index + 1}: signal_protocol is required")
    if signal_address < 0 or signal_address > 255:
        raise ValueError(f"condition {index + 1}: signal_address must be between 0 and 255")
    if not signal_parameter:
        raise ValueError(f"condition {index + 1}: signal_parameter is required")
    _require_plan_signal(signal_protocol, signal_address, signal_parameter)

    metric_key = str(item.get("metric_key") or signal_parameter).strip()
    return {
        "metric_key": metric_key,
        "signal_protocol": signal_protocol,
        "signal_address": signal_address,
        "signal_parameter": signal_parameter,
        "aggregation": aggregation,
        "window_sec": window_sec,
        "bucket_sec": bucket_sec,
        "bucket_count": bucket_count,
        "bucket_agg": bucket_agg,
        "pass_mode": pass_mode,
        "operator": _normalize_operator(item.get("operator")),
        "threshold": float(item.get("threshold")),
        "requires_fresh_data": _as_bool(item.get("requires_fresh_data"), True),
    }


def _format_seconds_zh(seconds: int) -> str:
    value = int(seconds or 0)
    if value > 0 and value % 3600 == 0:
        return f"{value // 3600} 小时"
    if value > 0 and value % 60 == 0:
        return f"{value // 60} 分钟"
    return f"{value} 秒"


def _metric_label(value: Any) -> str:
    raw = str(value or "").strip()
    known = {
        "ph": "pH",
        "ec": "电导率",
        "ec_value": "电导率",
        "resistivity": "电阻率",
        "resistivity_value": "电阻率",
        "tds": "TDS",
        "tds_value": "TDS",
        "salinity": "盐度",
        "temperature": "温度",
        "current_output": "电流输出",
        "corrosion_rate": "腐蚀率",
        "mv_value": "电位",
        "offset": "偏移量",
        "measurement": "pH",
        "warning": "报警",
    }
    return known.get(raw.lower(), raw or "-")


def rule_summary(item: Dict[str, Any]) -> str:
    sustain_sec = int(item.get("sustain_sec", 0))
    task_name = item.get("task_name") or item.get("task_id") or "-"
    parts: List[str] = []
    for cond in _rule_conditions(item):
        operator = cond.get("operator") or "-"
        threshold = cond.get("threshold")
        protocol = cond.get("signal_protocol") or "-"
        address = cond.get("signal_address")
        parameter = cond.get("signal_parameter") or cond.get("metric_key") or "-"
        aggregation = cond.get("aggregation") or "last"
        bucket_sec = int(cond.get("bucket_sec") or 0)
        bucket_count = int(cond.get("bucket_count") or 1)
        bucket_agg = cond.get("bucket_agg") or aggregation
        pass_mode = cond.get("pass_mode") or ("all" if bucket_sec > 0 and bucket_count > 1 else "latest")
        agg_text = {
            "last": "最近入库值",
            "avg": "平均值",
            "min": "最小值",
            "max": "最大值",
        }.get(str(aggregation), str(aggregation))
        op_text = {
            ">": "大于",
            ">=": "大于等于",
            "<": "小于",
            "<=": "小于等于",
        }.get(str(operator), str(operator))
        window_sec = int(cond.get("window_sec", 60))
        metric_key = str(cond.get("metric_key") or "").strip()
        target = _metric_label(metric_key or parameter) if (metric_key or parameter) else f"{protocol}@{address}:{parameter}"
        if bucket_sec > 0:
            if str(pass_mode) == "all" and bucket_count > 1:
                point_text = f"，连续 {bucket_count} 次"
            elif str(pass_mode) == "any" and bucket_count > 1:
                point_text = f"，最近 {bucket_count} 次任一"
            else:
                point_text = ""
            parts.append(
                f"{target} {_format_seconds_zh(bucket_sec)}{agg_text}{point_text}{op_text} {threshold}"
            )
        elif aggregation == "last":
            parts.append(f"{target} {agg_text}{op_text} {threshold}")
        else:
            parts.append(f"{target} 最近 {_format_seconds_zh(window_sec)}{agg_text}{op_text} {threshold}")
    condition_text = " 且 ".join(parts) if parts else "-"
    sustain_text = f" 并连续确认 {_format_seconds_zh(sustain_sec)}" if sustain_sec > 0 else ""
    return f"当 {condition_text}{sustain_text} 时，执行 {task_name}"


def _normalize_active_days(raw: Any) -> List[int]:
    if raw in (None, "", "all"):
        return [0, 1, 2, 3, 4, 5, 6]
    if not isinstance(raw, list):
        raise ValueError("active_days must be a list of weekday numbers")
    days: List[int] = []
    for value in raw:
        day = int(value)
        if day < 0 or day > 6:
            raise ValueError("active_days values must be between 0 and 6")
        if day not in days:
            days.append(day)
    if not days:
        raise ValueError("active_days cannot be empty")
    return sorted(days)


def _normalize_active_time(raw: Any, field_name: str) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    if not TIME_OF_DAY_RE.match(value):
        raise ValueError(f"{field_name} must be in HH:MM format")
    return value


def _apply_active_window(item: Dict[str, Any], normalized: Dict[str, Any]) -> None:
    normalized["active_days"] = _normalize_active_days(item.get("active_days"))
    normalized["active_start_time"] = _normalize_active_time(item.get("active_start_time"), "active_start_time")
    normalized["active_end_time"] = _normalize_active_time(item.get("active_end_time"), "active_end_time")


def save_action_rule(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dir(ACTION_RULE_DIR)
    item = dict(data or {})
    item_id = normalize_id(item.get("id"))
    task_id = _require_task(item.get("task_id"))
    task = get_action_task(task_id)
    sustain_sec = int(item.get("sustain_sec", 0))
    cooldown_sec = int(item.get("cooldown_sec", 0))
    max_runs_per_hour = int(item.get("max_runs_per_hour", 0))
    normalized_conditions = [
        _normalize_rule_condition(cond, index)
        for index, cond in enumerate(_rule_conditions(item))
    ]
    if not normalized_conditions:
        raise ValueError("at least one condition is required")
    first_condition = normalized_conditions[0]

    if sustain_sec < 0 or sustain_sec > 86400:
        raise ValueError("sustain_sec must be between 0 and 86400")
    if cooldown_sec < 0 or cooldown_sec > 86400:
        raise ValueError("cooldown_sec must be between 0 and 86400")
    if max_runs_per_hour < 0 or max_runs_per_hour > 3600:
        raise ValueError("max_runs_per_hour must be between 0 and 3600")

    normalized = {
        "id": item_id,
        "name": str(item.get("name") or item_id).strip(),
        "enabled": _as_bool(item.get("enabled"), False),
        "metric_key": first_condition["metric_key"],
        "signal_protocol": first_condition["signal_protocol"],
        "signal_address": first_condition["signal_address"],
        "signal_parameter": first_condition["signal_parameter"],
        "aggregation": first_condition["aggregation"],
        "window_sec": first_condition["window_sec"],
        "bucket_sec": first_condition["bucket_sec"],
        "bucket_count": first_condition["bucket_count"],
        "bucket_agg": first_condition["bucket_agg"],
        "pass_mode": first_condition["pass_mode"],
        "operator": first_condition["operator"],
        "threshold": first_condition["threshold"],
        "requires_fresh_data": first_condition["requires_fresh_data"],
        "condition_logic": "all",
        "conditions": normalized_conditions,
        "sustain_sec": sustain_sec,
        "task_id": task_id,
        "task_name": task.get("name", task_id),
        "cooldown_sec": cooldown_sec,
        "max_runs_per_hour": max_runs_per_hour,
        "description": str(item.get("description") or "").strip(),
    }

    _apply_active_window(item, normalized)

    normalized["summary"] = rule_summary(normalized)
    _write_json(_path_for(ACTION_RULE_DIR, item_id), normalized)
    return normalized


def _normalize_schedule_type(raw: Any) -> str:
    schedule_type = str(raw or "").strip()
    if schedule_type not in ("once", "daily", "interval"):
        raise ValueError("schedule_type must be once, daily, or interval")
    return schedule_type


def schedule_summary(item: Dict[str, Any]) -> str:
    schedule_type = item.get("schedule_type")
    task_name = item.get("task_name") or item.get("task_id") or "-"
    if schedule_type == "once":
        return f"{item.get('start_at') or '-'} 执行 {task_name}"
    if schedule_type == "daily":
        return f"每天 {item.get('time_of_day') or '-'} 执行 {task_name}"
    if schedule_type == "interval":
        return f"每隔 {_format_seconds_zh(int(item.get('interval_sec', 0)))} 执行 {task_name}"
    return "-"


def save_action_schedule(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dir(ACTION_SCHEDULE_DIR)
    item = dict(data or {})
    item_id = normalize_id(item.get("id"))
    task_id = _require_task(item.get("task_id"))
    task = get_action_task(task_id)
    schedule_type = _normalize_schedule_type(item.get("schedule_type"))
    cooldown_sec = int(item.get("cooldown_sec", 0))

    if cooldown_sec < 0 or cooldown_sec > 86400:
        raise ValueError("cooldown_sec must be between 0 and 86400")

    normalized = {
        "id": item_id,
        "name": str(item.get("name") or item_id).strip(),
        "enabled": _as_bool(item.get("enabled"), False),
        "schedule_type": schedule_type,
        "task_id": task_id,
        "task_name": task.get("name", task_id),
        "time_of_day": "",
        "interval_sec": 0,
        "start_at": "",
        "end_at": "",
        "cooldown_sec": cooldown_sec,
        "skip_if_task_running": _as_bool(item.get("skip_if_task_running"), True),
        "description": str(item.get("description") or "").strip(),
    }

    _apply_active_window(item, normalized)

    if schedule_type == "once":
        start_at = str(item.get("start_at") or "").strip()
        if not DATETIME_MINUTE_RE.match(start_at):
            raise ValueError("start_at must be in YYYY-MM-DDTHH:MM format")
        normalized["start_at"] = start_at
    elif schedule_type == "daily":
        time_of_day = str(item.get("time_of_day") or "").strip()
        if not TIME_OF_DAY_RE.match(time_of_day):
            raise ValueError("time_of_day must be in HH:MM format")
        normalized["time_of_day"] = time_of_day
        start_at = str(item.get("start_at") or "").strip()
        if start_at:
            if not DATETIME_MINUTE_RE.match(start_at):
                raise ValueError("start_at must be in YYYY-MM-DDTHH:MM format")
            normalized["start_at"] = start_at
        end_at = str(item.get("end_at") or "").strip()
        if end_at:
            if not DATETIME_MINUTE_RE.match(end_at):
                raise ValueError("end_at must be in YYYY-MM-DDTHH:MM format")
            normalized["end_at"] = end_at
    elif schedule_type == "interval":
        interval_sec = int(item.get("interval_sec", 0))
        if interval_sec < 60 or interval_sec > 604800:
            raise ValueError("interval_sec must be between 60 and 604800")
        normalized["interval_sec"] = interval_sec
        start_at = str(item.get("start_at") or "").strip()
        if start_at:
            if not DATETIME_MINUTE_RE.match(start_at):
                raise ValueError("start_at must be in YYYY-MM-DDTHH:MM format")
            normalized["start_at"] = start_at
        end_at = str(item.get("end_at") or "").strip()
        if end_at:
            if not DATETIME_MINUTE_RE.match(end_at):
                raise ValueError("end_at must be in YYYY-MM-DDTHH:MM format")
            normalized["end_at"] = end_at

    normalized["summary"] = schedule_summary(normalized)
    _write_json(_path_for(ACTION_SCHEDULE_DIR, item_id), normalized)
    return normalized


def list_actuators() -> List[Dict[str, Any]]:
    return list_items(ACTUATOR_DIR)


def get_actuator(item_id: str) -> Dict[str, Any]:
    item = get_item(ACTUATOR_DIR, item_id)
    kind = _ensure_kind(item)
    item.setdefault("kind", kind)
    item.setdefault("gpio_pin", int(item.get("pin", 0)))
    item.setdefault("allow_real_output", bool(item.get("allow_real", False)))
    return item


def delete_actuator(item_id: str) -> None:
    refs = [
        unit.get("id", "-")
        for unit in list_action_units()
        if unit.get("output_id") == item_id
    ]
    if refs:
        raise _usage_error("output", item_id, refs)
    delete_item(ACTUATOR_DIR, item_id)


def list_action_units() -> List[Dict[str, Any]]:
    items = list_items(ACTION_UNIT_DIR)
    for item in items:
        if "mode" in item:
            item["summary"] = action_unit_summary(item)
    return items


def get_action_unit(item_id: str) -> Dict[str, Any]:
    item = get_item(ACTION_UNIT_DIR, item_id)
    item["summary"] = action_unit_summary(item)
    return item


def delete_action_unit(item_id: str) -> None:
    refs = []
    for task in list_action_tasks():
        for step in task.get("steps", []):
            if step.get("step_type") == "run_action_unit" and step.get("action_unit_id") == item_id:
                refs.append(task.get("id", "-"))
                break
    if refs:
        raise _usage_error("action unit", item_id, refs)
    delete_item(ACTION_UNIT_DIR, item_id)


def list_action_tasks() -> List[Dict[str, Any]]:
    items = list_items(ACTION_TASK_DIR)
    for item in items:
        if "steps" in item:
            item["summary"] = task_summary(item)
    return items


def get_action_task(item_id: str) -> Dict[str, Any]:
    item = get_item(ACTION_TASK_DIR, item_id)
    item["summary"] = task_summary(item)
    return item


def delete_action_task(item_id: str) -> None:
    refs = [
        rule.get("id", "-")
        for rule in list_action_rules()
        if rule.get("task_id") == item_id
    ]
    refs.extend(
        schedule.get("id", "-")
        for schedule in list_action_schedules()
        if schedule.get("task_id") == item_id
    )
    if refs:
        raise _usage_error("task", item_id, refs)
    delete_item(ACTION_TASK_DIR, item_id)


def list_action_rules() -> List[Dict[str, Any]]:
    items = list_items(ACTION_RULE_DIR)
    for item in items:
        if "metric_key" in item:
            item.setdefault("condition_logic", "all")
            item.setdefault("conditions", _rule_conditions(item))
            item["summary"] = rule_summary(item)
    return items


def get_action_rule(item_id: str) -> Dict[str, Any]:
    item = get_item(ACTION_RULE_DIR, item_id)
    item.setdefault("condition_logic", "all")
    item.setdefault("conditions", _rule_conditions(item))
    item["summary"] = rule_summary(item)
    return item


def delete_action_rule(item_id: str) -> None:
    delete_item(ACTION_RULE_DIR, item_id)


def list_action_schedules() -> List[Dict[str, Any]]:
    items = list_items(ACTION_SCHEDULE_DIR)
    for item in items:
        if "schedule_type" in item:
            item["summary"] = schedule_summary(item)
    return items


def get_action_schedule(item_id: str) -> Dict[str, Any]:
    item = get_item(ACTION_SCHEDULE_DIR, item_id)
    item["summary"] = schedule_summary(item)
    return item


def delete_action_schedule(item_id: str) -> None:
    delete_item(ACTION_SCHEDULE_DIR, item_id)
