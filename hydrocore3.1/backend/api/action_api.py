from flask import Blueprint, jsonify, request

from ..services.action_executor import (
    action_runtime_summary,
    execute_action_task,
    execute_action_unit,
    latest_task_activity_map,
    list_action_logs,
    stop_all_outputs,
)
from ..services.action_jobs import get_action_job, list_action_jobs, start_action_job
from ..services.action_scheduler import (
    automation_runtime_status,
    evaluate_action_rule,
    ensure_automation_thread,
    preview_action_rule,
    preview_action_schedule,
    stop_automation_thread,
    trigger_action_schedule,
    update_automation_config,
)
from ..services.action_store import (
    delete_action_rule,
    delete_action_schedule,
    delete_action_task,
    delete_action_unit,
    delete_actuator,
    get_action_rule,
    get_action_schedule,
    get_action_task,
    get_action_unit,
    get_actuator,
    list_action_rules,
    list_action_schedules,
    list_action_tasks,
    list_action_units,
    list_actuators,
    save_action_rule,
    save_action_schedule,
    save_action_task,
    save_action_unit,
    save_actuator,
)


bp = Blueprint("action_api", __name__, url_prefix="/api/v1/actions")


def _json_payload() -> dict:
    return request.get_json(force=True) or {}


def _real_action_preflight(kind: str, target_id: str, dry_run: bool):
    if dry_run:
        return None

    units = []
    if kind == "action_unit":
        units.append(get_action_unit(target_id))
    elif kind == "task":
        task = get_action_task(target_id)
        if not task.get("enabled", True):
            return "任务已停用，不能执行"
        for step in task.get("steps", []):
            if step.get("step_type") == "run_action_unit":
                units.append(get_action_unit(step["action_unit_id"]))
    else:
        return f"unsupported action kind: {kind}"

    for unit in units:
        if not unit.get("enabled", True):
            return f"动作已停用，不能执行: {unit.get('name') or unit.get('id')}"
        output = get_actuator(unit["output_id"])
        if not output.get("enabled", True):
            return f"输出设备已停用，不能执行: {output.get('name') or output.get('id')}"
    return None


@bp.get("/summary")
def api_action_summary():
    return jsonify({"ok": True, **action_runtime_summary(), "automation": automation_runtime_status()}), 200


@bp.get("/automation/status")
def api_automation_status():
    return jsonify({"ok": True, **automation_runtime_status()}), 200


@bp.post("/automation/start")
def api_automation_start():
    ensure_automation_thread()
    return jsonify({"ok": True, **automation_runtime_status()}), 200


@bp.post("/automation/stop")
def api_automation_stop():
    return jsonify({"ok": True, **stop_automation_thread()}), 200


@bp.post("/output/stop-all")
def api_output_stop_all():
    result = stop_all_outputs(source="manual-stop-all")
    status = automation_runtime_status()
    if not result.get("ok") and "error" not in result:
        result["error"] = result.get("message") or "Failed to set outputs to safe state"
    status_code = 200 if result.get("status") == "partial" else (200 if result.get("ok") else 500)
    return jsonify({**result, "automation": status}), status_code


@bp.put("/automation/config")
def api_automation_config():
    try:
        config = update_automation_config(_json_payload())
        ensure_automation_thread()
        return jsonify({"ok": True, "config": config, **automation_runtime_status()}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/actuators")
def api_actuator_list():
    return jsonify({"ok": True, "items": list_actuators()}), 200


@bp.post("/actuators")
def api_actuator_save():
    try:
        item = save_actuator(_json_payload())
        return jsonify({"ok": True, "item": item}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/actuators/<string:item_id>")
def api_actuator_detail(item_id: str):
    try:
        return jsonify({"ok": True, "item": get_actuator(item_id)}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.put("/actuators/<string:item_id>")
def api_actuator_put(item_id: str):
    try:
        payload = _json_payload()
        try:
            existing = get_actuator(item_id)
            payload = {**existing, **payload}
        except FileNotFoundError:
            pass
        payload["id"] = item_id
        return jsonify({"ok": True, "item": save_actuator(payload)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.delete("/actuators/<string:item_id>")
def api_actuator_delete(item_id: str):
    try:
        delete_actuator(item_id)
        return jsonify({"ok": True}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/units")
def api_unit_list():
    return jsonify({"ok": True, "items": list_action_units()}), 200


@bp.post("/units")
def api_unit_save():
    try:
        item = save_action_unit(_json_payload())
        return jsonify({"ok": True, "item": item}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/units/<string:item_id>")
def api_unit_detail(item_id: str):
    try:
        return jsonify({"ok": True, "item": get_action_unit(item_id)}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.put("/units/<string:item_id>")
def api_unit_put(item_id: str):
    try:
        payload = _json_payload()
        payload["id"] = item_id
        return jsonify({"ok": True, "item": save_action_unit(payload)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.delete("/units/<string:item_id>")
def api_unit_delete(item_id: str):
    try:
        delete_action_unit(item_id)
        return jsonify({"ok": True}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.post("/units/<string:item_id>/execute")
def api_unit_execute(item_id: str):
    payload = _json_payload()
    dry_run = False
    source = str(payload.get("source") or "manual").strip() or "manual"
    if bool(payload.get("async", False)):
        blocked = _real_action_preflight("action_unit", item_id, dry_run)
        if blocked:
            return jsonify({"ok": False, "status": "blocked", "error": blocked, "message": blocked}), 400
        result = start_action_job("action_unit", item_id, source=source, dry_run=dry_run)
        return jsonify(result), 202
    result = execute_action_unit(
        item_id,
        source=source,
        dry_run=dry_run,
    )
    return jsonify(result), 200 if result.get("ok") else 400


@bp.get("/tasks")
def api_task_list():
    runtime_map = latest_task_activity_map()
    items = []
    for item in list_action_tasks():
        enriched = dict(item)
        enriched["runtime"] = runtime_map.get(item.get("id", ""), {})
        items.append(enriched)
    return jsonify({"ok": True, "items": items}), 200


@bp.post("/tasks")
def api_task_save():
    try:
        item = save_action_task(_json_payload())
        return jsonify({"ok": True, "item": item}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/tasks/<string:item_id>")
def api_task_detail(item_id: str):
    try:
        return jsonify({"ok": True, "item": get_action_task(item_id)}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.put("/tasks/<string:item_id>")
def api_task_put(item_id: str):
    try:
        payload = _json_payload()
        payload["id"] = item_id
        return jsonify({"ok": True, "item": save_action_task(payload)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.delete("/tasks/<string:item_id>")
def api_task_delete(item_id: str):
    try:
        delete_action_task(item_id)
        return jsonify({"ok": True}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.post("/tasks/<string:item_id>/execute")
def api_task_execute(item_id: str):
    payload = _json_payload()
    dry_run = False
    source = str(payload.get("source") or "manual").strip() or "manual"
    if bool(payload.get("async", False)):
        blocked = _real_action_preflight("task", item_id, dry_run)
        if blocked:
            return jsonify({"ok": False, "status": "blocked", "error": blocked, "message": blocked}), 400
        result = start_action_job("task", item_id, source=source, dry_run=dry_run)
        return jsonify(result), 202
    result = execute_action_task(
        item_id,
        source=source,
        dry_run=dry_run,
    )
    return jsonify(result), 200 if result.get("ok") else 400


@bp.get("/rules")
def api_rule_list():
    items = []
    for item in list_action_rules():
        enriched = dict(item)
        enriched["runtime"] = preview_action_rule(item)
        items.append(enriched)
    return jsonify({"ok": True, "items": items}), 200


@bp.post("/rules")
def api_rule_save():
    try:
        item = save_action_rule(_json_payload())
        return jsonify({"ok": True, "item": item}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/rules/<string:item_id>")
def api_rule_detail(item_id: str):
    try:
        return jsonify({"ok": True, "item": get_action_rule(item_id)}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.put("/rules/<string:item_id>")
def api_rule_put(item_id: str):
    try:
        payload = _json_payload()
        payload["id"] = item_id
        return jsonify({"ok": True, "item": save_action_rule(payload)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.delete("/rules/<string:item_id>")
def api_rule_delete(item_id: str):
    try:
        delete_action_rule(item_id)
        return jsonify({"ok": True}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.post("/rules/<string:item_id>/evaluate")
def api_rule_evaluate(item_id: str):
    payload = _json_payload()
    execute_if_match = bool(payload.get("execute_if_match", False))
    dry_run = not execute_if_match
    async_run = bool(payload.get("async", False))
    if execute_if_match and async_run:
        result = evaluate_action_rule(item_id, dry_run=dry_run, execute_if_match=False)
        if result.get("can_fire"):
            rule = get_action_rule(item_id)
            blocked = _real_action_preflight("task", rule["task_id"], dry_run)
            if blocked:
                return jsonify({"ok": False, "status": "blocked", "error": blocked, "message": blocked, "rule_result": result}), 400
            job = start_action_job("task", rule["task_id"], source=f"rule-test:{rule['id']}", dry_run=dry_run)
            result["task_result"] = job
            result["message"] = job.get("message") or "Action accepted"
            return jsonify(result), 202
        return jsonify(result), 200 if result.get("ok") else 400

    result = evaluate_action_rule(
        item_id,
        dry_run=dry_run,
        execute_if_match=execute_if_match,
    )
    return jsonify(result), 200 if result.get("ok") else 400


@bp.get("/schedules")
def api_schedule_list():
    items = []
    for item in list_action_schedules():
        enriched = dict(item)
        enriched["runtime"] = preview_action_schedule(item)
        items.append(enriched)
    return jsonify({"ok": True, "items": items}), 200


@bp.post("/schedules")
def api_schedule_save():
    try:
        item = save_action_schedule(_json_payload())
        return jsonify({"ok": True, "item": item}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/schedules/<string:item_id>")
def api_schedule_detail(item_id: str):
    try:
        return jsonify({"ok": True, "item": get_action_schedule(item_id)}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.put("/schedules/<string:item_id>")
def api_schedule_put(item_id: str):
    try:
        payload = _json_payload()
        payload["id"] = item_id
        return jsonify({"ok": True, "item": save_action_schedule(payload)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.delete("/schedules/<string:item_id>")
def api_schedule_delete(item_id: str):
    try:
        delete_action_schedule(item_id)
        return jsonify({"ok": True}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.post("/schedules/<string:item_id>/trigger")
def api_schedule_trigger(item_id: str):
    payload = _json_payload()
    dry_run = False
    if bool(payload.get("async", False)):
        schedule = get_action_schedule(item_id)
        preview = preview_action_schedule(schedule)
        blocked = _real_action_preflight("task", schedule["task_id"], dry_run)
        if blocked:
            return jsonify({"ok": False, "status": "blocked", "error": blocked, "message": blocked, "schedule": schedule, "preview": preview}), 400
        job = start_action_job("task", schedule["task_id"], source=f"schedule-test:{schedule['id']}", dry_run=dry_run)
        return jsonify({
            "ok": True,
            "schedule": schedule,
            "preview": preview,
            "task_result": job,
            "dry_run": dry_run,
            "message": job.get("message") or "Action accepted",
        }), 202
    result = trigger_action_schedule(
        item_id,
        dry_run=dry_run,
    )
    return jsonify(result), 200 if result.get("ok") else 400


@bp.get("/logs")
def api_action_logs():
    try:
        limit = int(request.args.get("limit", 100))
        return jsonify({"ok": True, "items": list_action_logs(limit)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/jobs")
def api_action_jobs():
    try:
        limit = int(request.args.get("limit", 50))
        return jsonify({"ok": True, "items": list_action_jobs(limit)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/jobs/<string:job_id>")
def api_action_job_detail(job_id: str):
    try:
        return jsonify({"ok": True, "job": get_action_job(job_id)}), 200
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
