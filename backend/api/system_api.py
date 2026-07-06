import datetime
import json
import shutil
import socket
from pathlib import Path

from flask import Blueprint, Response, jsonify, request

from .. import settings
from ..db import get_conn
from ..services.action_scheduler import automation_runtime_status
from ..services.poller_guard import is_poller_running
from ..services.qr_svg import qr_svg
from ..utils.json_io import atomic_write_json


bp = Blueprint("system_api", __name__, url_prefix="/api/v1/system")

PROFILE_FILE = settings.DATA_DIR / "runtime" / "system_profile.json"
POLLER_STATE_FILE = settings.DATA_DIR / "runtime" / "poller_state.json"
SCREEN_FILE = settings.DATA_DIR / "runtime" / "screen.json"

DEFAULT_PROFILE = {
    "device_name": "1号循环水控制机",
    "site_location": "冷却塔机房 / 3F",
    "device_id": "HC-EDGE-001",
    "logo_text": "LOGO",
}

DEFAULT_SCREEN = {
    "orientation": "normal",
}

SCREEN_ORIENTATIONS = {"normal", "left", "right", "inverted"}


def _now_text() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _safe_text(value, default: str, limit: int) -> str:
    text = str(value if value is not None else default).strip()
    if not text:
        text = default
    return text[:limit]


def _read_json(path: Path, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def load_profile() -> dict:
    raw = _read_json(PROFILE_FILE, {})
    profile = dict(DEFAULT_PROFILE)
    if isinstance(raw, dict):
        profile.update({
            "device_name": _safe_text(raw.get("device_name"), DEFAULT_PROFILE["device_name"], 64),
            "site_location": _safe_text(raw.get("site_location"), DEFAULT_PROFILE["site_location"], 80),
            "device_id": _safe_text(raw.get("device_id"), DEFAULT_PROFILE["device_id"], 64),
            "logo_text": _safe_text(raw.get("logo_text"), DEFAULT_PROFILE["logo_text"], 12),
        })
        if raw.get("updated_at"):
            profile["updated_at"] = str(raw.get("updated_at"))
    return profile


def load_screen() -> dict:
    raw = _read_json(SCREEN_FILE, {})
    screen = dict(DEFAULT_SCREEN)
    if isinstance(raw, dict):
        orientation = str(raw.get("orientation") or DEFAULT_SCREEN["orientation"]).strip()
        if orientation not in SCREEN_ORIENTATIONS:
            orientation = DEFAULT_SCREEN["orientation"]
        screen["orientation"] = orientation
        if raw.get("updated_at"):
            screen["updated_at"] = str(raw.get("updated_at"))
    return screen


def _save_screen(payload: dict) -> dict:
    current = load_screen()
    orientation = str(payload.get("orientation") or current["orientation"]).strip()
    if orientation not in SCREEN_ORIENTATIONS:
        raise ValueError("不支持的屏幕方向")
    current.update({
        "orientation": orientation,
        "updated_at": _now_text(),
    })
    atomic_write_json(SCREEN_FILE, current)
    return current


def _save_profile(payload: dict) -> dict:
    current = load_profile()
    current.update({
        "device_name": _safe_text(payload.get("device_name"), current["device_name"], 64),
        "site_location": _safe_text(payload.get("site_location"), current["site_location"], 80),
        "device_id": _safe_text(payload.get("device_id"), current["device_id"], 64),
        "logo_text": _safe_text(payload.get("logo_text"), current["logo_text"], 12),
        "updated_at": _now_text(),
    })
    atomic_write_json(PROFILE_FILE, current)
    return current


def _format_bytes(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(max(0, int(value)))
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{int(value)} B"


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    if path.is_file():
        return path.stat().st_size
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def _poller_enabled() -> bool:
    data = _read_json(POLLER_STATE_FILE, {})
    return bool(data.get("enabled")) if isinstance(data, dict) else False


def _request_ip() -> str:
    host = request.host.split(":", 1)[0]
    if host and host not in ("127.0.0.1", "localhost", "::1"):
        return host
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("192.0.2.1", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return host or "127.0.0.1"


def _latest_sensor_ts():
    try:
        with get_conn() as conn:
            row = conn.execute("SELECT MAX(ts) AS ts FROM sensor_data").fetchone()
            return row["ts"] if row else None
    except Exception:
        return None


def _storage_status() -> dict:
    total, used, free = shutil.disk_usage(settings.DATA_DIR)
    db_size = settings.DB_FILE.stat().st_size if settings.DB_FILE.exists() else 0
    log_size = _dir_size(settings.LOG_DIR)
    backups_dir = settings.DATA_DIR / "backups"
    backup_count = 0
    if backups_dir.exists():
        backup_count = sum(1 for item in backups_dir.iterdir() if item.is_dir() or item.is_file())
    return {
        "total_bytes": total,
        "used_bytes": used,
        "free_bytes": free,
        "used_percent": round(used / total * 100, 1) if total else 0,
        "total_text": _format_bytes(total),
        "used_text": _format_bytes(used),
        "free_text": _format_bytes(free),
        "db_bytes": db_size,
        "db_text": _format_bytes(db_size),
        "log_bytes": log_size,
        "log_text": _format_bytes(log_size),
        "backup_count": backup_count,
    }


def _service_status() -> dict:
    poller_running = is_poller_running()
    automation = automation_runtime_status()
    return {
        "web": {"running": True, "label": "运行中"},
        "data_collection": {
            "running": poller_running,
            "enabled": _poller_enabled(),
            "label": "运行中" if poller_running else "已停止",
        },
        "automation": {
            "running": bool(automation.get("running")),
            "enabled": bool(automation.get("automation_enabled")),
            "hardware_armed": bool(automation.get("hardware_armed")),
            "last_tick": automation.get("last_tick"),
            "label": "运行中" if automation.get("running") else "未运行",
        },
        "latest_data_ts": _latest_sensor_ts(),
    }


@bp.get("/profile")
def api_system_profile():
    return jsonify({"ok": True, "profile": load_profile()}), 200


@bp.put("/profile")
def api_system_profile_save():
    try:
        payload = request.get_json(force=True) or {}
        return jsonify({"ok": True, "profile": _save_profile(payload)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/screen")
def api_system_screen():
    return jsonify({"ok": True, "screen": load_screen()}), 200


@bp.put("/screen")
def api_system_screen_save():
    try:
        payload = request.get_json(force=True) or {}
        return jsonify({"ok": True, "screen": _save_screen(payload)}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.get("/status")
def api_system_status():
    ip = _request_ip()
    access_url = f"{request.scheme}://{request.host}/ui/"
    return jsonify({
        "ok": True,
        "profile": load_profile(),
        "network": {
            "hostname": socket.gethostname(),
            "ip": ip,
            "access_url": access_url,
            "port": request.host.split(":", 1)[1] if ":" in request.host else "",
        },
        "storage": _storage_status(),
        "services": _service_status(),
        "screen": load_screen(),
        "server_ts": _now_text(),
    }), 200


@bp.get("/qr.svg")
def api_system_qr():
    text = request.args.get("text") or f"{request.scheme}://{request.host}/ui/"
    try:
        body = qr_svg(text)
        return Response(body, mimetype="image/svg+xml")
    except Exception as exc:
        return Response(str(exc), status=400, mimetype="text/plain")
