from flask import Flask, request, jsonify
from .db import init_db, get_conn
from .services.scan_service import start_scan_job
from .services.addr_writer_service import start_address_job 
from .services.config_get_service import start_config_get
from .api.data_api import bp as data_bp
from .api.meta_api import bp as meta_bp
from .api.system_api import bp as system_bp

from .api.action_profile_api import bp as action_profile_bp
from .api.action_api import bp as action_bp

from flask import send_from_directory

import os
from .services.config_set_service import start_config_set  # 新增
from threading import Thread

from .tasks.config_poller import DataCollectorThread

# 串口权威控制
from .services.poller_guard import (
    register_poller_thread,
    ensure_poller_not_running,
    PollerRunningError
)
from .services.action_scheduler import ensure_automation_thread
from .utils.json_io import atomic_write_json
from . import settings

app = Flask(__name__)

# 数据采集子系统的线程实例（控制平面持有）
data_collector_thread = None

# 初始化数据库
init_db()
ensure_automation_thread()

UI_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ui")

app.register_blueprint(data_bp)   # 提供 /api/v1/data/...
app.register_blueprint(meta_bp)   # 提供 /api/v1/meta/... 与 /api/v1/data/range
app.register_blueprint(system_bp)  # 提供 /api/v1/system/...
app.register_blueprint(action_profile_bp)  # 提供 /api/v1/action-profile/...
app.register_blueprint(action_bp)  # 提供 /api/v1/actions/...


# =====================
# Block 1: 扫描接口
# =====================
@app.post("/api/v1/scan")
def api_scan():
    # 扫描接口必须确保 poller 不在运行，避免串口冲突   PollerGuard
    try:
        ensure_poller_not_running()
    except PollerRunningError as e:
        return jsonify({"ok": False, "error": str(e)}), 409
    
    cfg = request.get_json(force=True)
    for k in ("port", "start_address", "end_address"):
        if k not in cfg:
            return jsonify({"ok": False, "error": f"缺少字段: {k}"}), 400
    res = start_scan_job(cfg)
    return jsonify({"ok": res["status"] == "ok", **res}), 200

@app.get("/api/v1/scan/<int:job_id>")
def api_scan_result(job_id: int):
    with get_conn() as conn:
        job = conn.execute("SELECT * FROM scan_job WHERE id=?", (job_id,)).fetchone()
        if not job:
            return jsonify({"ok": False, "error": "job_id 不存在"}), 404
        hits = conn.execute("""
            SELECT address, raw_hex, latency_ms FROM scan_hit
             WHERE job_id=? ORDER BY address
        """, (job_id,)).fetchall()
    return jsonify({
        "ok": True,
        "job": dict(job),
        "devices": [dict(r) for r in hits]
    }), 200

# =========================
# Block 2: 改地址（Address Writer）
# =========================



@app.post("/api/v1/address")
def api_address_write():

    try:
        ensure_poller_not_running()
    except PollerRunningError as e:
        return jsonify({"ok": False, "error": str(e)}), 409




    payload = request.get_json(force=True)
    if "port" not in payload or "items" not in payload:
        return jsonify({"ok": False, "error": "缺少 port 或 items"}), 400
    if not isinstance(payload["items"], list) or not payload["items"]:
        return jsonify({"ok": False, "error": "items 不能为空数组"}), 400

    res = start_address_job(payload)
    return jsonify({"ok": True, **res}), 200

# =========================
# Block 3: 读取信息
# =========================

@app.post("/api/v1/config/get")
def api_config_get():
# 读取信息接口必须确保 poller 不在运行，避免串口冲突   PollerGuard
    try:
        ensure_poller_not_running()
    except PollerRunningError as e:
        return jsonify({"ok": False, "error": str(e)}), 409

    """
    发起一次配置读取任务
    请求 JSON:
    {
      "port": "/dev/ttyACM0",
      "baudrate": 9600,
      "timeout": 0.5,
      "items": [
        {"protocol":"lanchang_ph","address":1,"parameters":["measurement","temperature"]}
      ]
    }
    """
    payload = request.get_json(force=True)
    for k in ("port","items"):
        if k not in payload:
            return jsonify({"ok": False, "error": f"缺少字段: {k}"}), 400
    if not payload["items"]:
        return jsonify({"ok": False, "error": "items 不能为空"}), 400

    res = start_config_get(payload)
    return jsonify(res), 200




# =========================
# Block 3.5: 写入信息（新增）
# =========================
@app.post("/api/v1/config/set")
def api_config_set():
    # 写入信息接口必须确保 poller 不在运行，避免串口冲突   PollerGuard 
    try:
        ensure_poller_not_running()
    except PollerRunningError as e:
        return jsonify({"ok": False, "error": str(e)}), 409


    """
    发起一次配置写入任务（0x06/0x10）
    请求 JSON:
    {
      "port": "/dev/ttyACM0",
      "baudrate": 9600,
      "timeout": 0.5,
      "items": [
        {"protocol":"lanchang_ec","address":10,"writes":{"electrode_constant":1.0}}
      ]
    }
    """
    payload = request.get_json(force=True)
    for k in ("port", "items"):
        if k not in payload:
            return jsonify({"ok": False, "error": f"缺少字段: {k}"}), 400
    if not payload["items"]:
        return jsonify({"ok": False, "error": "items 不能为空"}), 400

    try:
        res = start_config_set(payload)
        return jsonify(res), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500





# =========================
# Block 4: Poller 计划管理
# =========================


import json
from pathlib import Path

PLAN_FILE = settings.POLL_PLAN_FILE
RUNTIME_DIR = settings.DATA_DIR / "runtime"
POLLER_STATE_FILE = RUNTIME_DIR / "poller_state.json"
_poller_restore_checked = False


def _read_poller_enabled() -> bool:
    try:
        data = json.load(open(POLLER_STATE_FILE, encoding="utf8"))
        return bool(data.get("enabled"))
    except Exception:
        return False


def _write_poller_enabled(enabled: bool) -> None:
    atomic_write_json(POLLER_STATE_FILE, {"enabled": bool(enabled)})


def _start_poller_thread() -> bool:
    global data_collector_thread
    if data_collector_thread and data_collector_thread.is_alive():
        return False
    data_collector_thread = DataCollectorThread()
    data_collector_thread.daemon = True
    data_collector_thread.start()
    register_poller_thread(data_collector_thread)
    return True


def _restore_poller_if_enabled() -> None:
    global _poller_restore_checked
    if _poller_restore_checked:
        return
    _poller_restore_checked = True
    if _read_poller_enabled():
        _start_poller_thread()


@app.before_request
def _restore_poller_before_first_request():
    _restore_poller_if_enabled()

@app.get("/api/v1/poll/plan")
def api_get_poll_plan():
    """
    获取当前的采集计划
    """
    try:
        plan = json.load(open(PLAN_FILE, encoding="utf8"))
    except Exception as e:
        return {"ok": False, "error": f"无法读取计划: {e}"}, 500
    return {"ok": True, "plan": plan}, 200

@app.put("/api/v1/poll/plan")
def api_put_poll_plan():
    """
    覆盖写入采集计划
    """
    payload = request.get_json(force=True)
    try:
        atomic_write_json(PLAN_FILE, payload)
    except Exception as e:
        return {"ok": False, "error": f"写入失败: {e}"}, 500
    return {"ok": True, "message": "已写入，采集器将自动重载"}, 200


# =========================
# Block 5: Poller 子系统控制接口
# =========================

@app.post("/api/v1/poller/start")
def api_poller_start():
    if data_collector_thread and data_collector_thread.is_alive():
        _write_poller_enabled(True)
        return jsonify({"ok": True, "message": "poller 已在运行"}), 200

    _write_poller_enabled(True)
    _start_poller_thread()
    return jsonify({"ok": True, "message": "poller 已启动"}), 200

    


@app.post("/api/v1/poller/stop")
def api_poller_stop():
    global data_collector_thread
    if not data_collector_thread or not data_collector_thread.is_alive():
        return jsonify({"ok": False, "message": "poller 未运行"}), 400


    data_collector_thread.stop()
    data_collector_thread.join(timeout=3.0)  # 给 poller 一个退出窗口（不会无限卡住）
    data_collector_thread = None
    register_poller_thread(None)
    _write_poller_enabled(False)
    return jsonify({"ok": True, "message": "poller 已停止"}), 200

# 4.2之前的老版本
    # data_collector_thread.stop()
    # data_collector_thread = None
    # register_poller_thread(None)
    # return jsonify({"ok": True, "message": "poller 已停止"}), 200



@app.get("/api/v1/poller/status")
def api_poller_status():
    global data_collector_thread
    running = bool(data_collector_thread and data_collector_thread.is_alive())
    return jsonify({"ok": True, "running": running, "enabled": _read_poller_enabled()}), 200




# 前端部分
@app.route("/ui/")
def ui_index():
    return send_from_directory(UI_DIR, "index.html")

@app.route("/ui/<path:filename>")
def ui_static(filename):
    return send_from_directory(UI_DIR, filename)






# # 数据采集服务启动函数
# def start_polling():
#     from .tasks.config_poller import main as poller_main
#     poller_thread = Thread(target=poller_main)
#     poller_thread.daemon = True  # 设置为守护线程，保证 Flask 退出时该线程也会退出
#     poller_thread.start()

# def main():
#     # 启动数据采集进程
#     start_polling()

#     # 启动 Flask 应用
#     app.run(host="0.0.0.0", port=5000, debug=True)

# if __name__ == "__main__":
#     main()


def main():
    debug = os.environ.get("HYDROCORE_DEBUG", "").lower() in ("1", "true", "yes", "on")
    if (debug and os.environ.get("WERKZEUG_RUN_MAIN") == "true") or not debug:
        _restore_poller_if_enabled()
    app.run(host=settings.HOST, port=settings.PORT, debug=debug, use_reloader=debug)

if __name__ == "__main__":
    main()
