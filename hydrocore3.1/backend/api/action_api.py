from flask import Blueprint, jsonify, request

from ..services.action_executor import (
    action_runtime_summary,
    execute_action_task,
    execute_action_unit,
    latest_task_activity_map,
    list_action_logs,
)
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
    result = execute_action_unit(
        item_id,
        source=str(payload.get("source") or "manual").strip() or "manual",
        dry_run=bool(payload.get("dry_run", True)),
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
    result = execute_action_task(
        item_id,
        source=str(payload.get("source") or "manual").strip() or "manual",
        dry_run=bool(payload.get("dry_run", True)),
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
    result = evaluate_action_rule(
        item_id,
        dry_run=bool(payload.get("dry_run", True)),
        execute_if_match=bool(payload.get("execute_if_match", False)),
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
    result = trigger_action_schedule(
        item_id,
        dry_run=bool(payload.get("dry_run", True)),
    )
    return jsonify(result), 200 if result.get("ok") else 400


@bp.get("/logs")
def api_action_logs():
    try:
        limit = int(request.args.get("limit", 100))
        return jsonify({"ok": True, "items": list_action_logs(limit)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
