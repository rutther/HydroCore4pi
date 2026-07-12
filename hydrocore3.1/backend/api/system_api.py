import datetime
import json
import shutil
import socket
import subprocess
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
LOGO_DIR = settings.DATA_DIR / "runtime" / "assets"
POLLER_STATE_FILE = settings.DATA_DIR / "runtime" / "poller_state.json"
SCREEN_FILE = settings.DATA_DIR / "runtime" / "screen.json"
SCREEN_APPLY_REQUEST_FILE = settings.DATA_DIR / "runtime" / "screen_apply.request"
SCREEN_APPLY_STATUS_FILE = settings.DATA_DIR / "runtime" / "screen_apply_status.json"
SCREEN_ACTIVE_FILE = settings.DATA_DIR / "runtime" / "screen_active.json"
REBOOT_REQUEST_FILE = settings.DATA_DIR / "runtime" / "reboot.request"

DEFAULT_PROFILE = {
    "device_name": "1号循环水控制机",
    "site_location": "冷却塔机房 / 3F",
    "device_id": "HC-EDGE-001",
    "logo_text": "HydroCore",
}

DEFAULT_SCREEN = {
    "orientation": "normal",
}

SCREEN_ORIENTATIONS = {"normal", "left", "right", "inverted"}
SCREEN_ROTATIONS = {
    "normal": 0,
    "left": 90,
    "inverted": 180,
    "right": 270,
}

REBOOT_CONFIRM_TEXT = "REBOOT"
LOGO_MAX_BYTES = 1024 * 1024
LOGO_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
}


def _now_text() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _current_boot_rotation() -> int:
    try:
        with open("/proc/cmdline", "r", encoding="utf-8") as fh:
            for token in fh.read().split():
                if not token.startswith("video=") or "DSI" not in token:
                    continue
                for part in token.split(","):
                    if part.startswith("rotate="):
                        return int(part.split("=", 1)[1]) % 360
    except Exception:
        return 0
    return 0


def _safe_text(value, default: str, limit: int) -> str:
    text = str(value if value is not None else default).strip()
    if not text:
        text = default
    return text[:limit]


def _logo_paths():
    return [LOGO_DIR / f"system_logo{ext}" for ext in LOGO_MIME_BY_EXT]


def _current_logo_path():
    for path in _logo_paths():
        if path.is_file():
            return path
    return None


def _profile_with_logo_assets(profile: dict) -> dict:
    result = dict(profile)
    logo_path = _current_logo_path()
    result["has_logo_image"] = bool(logo_path)
    result["logo_image_url"] = ""
    if logo_path:
        try:
            stamp = logo_path.stat().st_mtime_ns
        except OSError:
            stamp = 0
        result["logo_image_url"] = f"/api/v1/system/logo/image?v={stamp}"
    return result


def _detect_logo_ext(data: bytes):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


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
    return _profile_with_logo_assets(profile)


def load_screen() -> dict:
    raw = _read_json(SCREEN_FILE, {})
    active = _read_json(SCREEN_ACTIVE_FILE, {})
    screen = dict(DEFAULT_SCREEN)
    if isinstance(raw, dict):
        orientation = str(raw.get("orientation") or DEFAULT_SCREEN["orientation"]).strip()
        if orientation not in SCREEN_ORIENTATIONS:
            orientation = DEFAULT_SCREEN["orientation"]
        screen["orientation"] = orientation
        if raw.get("updated_at"):
            screen["updated_at"] = str(raw.get("updated_at"))
    screen.update({
        "active_orientation": "normal",
        "apply_mode": "runtime_and_boot_config",
        "requires_reboot": False,
        "pending_reboot": False,
        "current_boot_rotation": _current_boot_rotation(),
    })
    if isinstance(active, dict):
        active_orientation = str(active.get("orientation") or "normal").strip()
        if active_orientation in SCREEN_ORIENTATIONS:
            screen["active_orientation"] = active_orientation
        screen["active"] = {
            "orientation": screen["active_orientation"],
            "output": active.get("output"),
            "mode": active.get("mode"),
            "rotation": active.get("rotation"),
            "transform": active.get("transform"),
            "updated_at": active.get("updated_at"),
        }
    else:
        screen["active"] = {"orientation": "normal"}
    screen["pending_reboot"] = screen["orientation"] != screen["active_orientation"]
    screen["requires_reboot"] = screen["pending_reboot"]
    apply_status = _read_json(SCREEN_APPLY_STATUS_FILE, {})
    if isinstance(apply_status, dict):
        screen["apply_status"] = {
            "orientation": apply_status.get("orientation"),
            "output": apply_status.get("output"),
            "mode": apply_status.get("mode"),
            "rotation": apply_status.get("rotation"),
            "transform": apply_status.get("transform"),
            "state": apply_status.get("state"),
            "active": apply_status.get("active"),
            "message": apply_status.get("message"),
            "requires_reboot": bool(apply_status.get("requires_reboot")),
            "applied_to": apply_status.get("applied_to"),
            "updated_at": apply_status.get("updated_at"),
        }
        if apply_status.get("requires_reboot"):
            screen["requires_reboot"] = True
    return screen


def _save_screen(payload: dict) -> dict:
    current = load_screen()
    orientation = str(payload.get("orientation") or current["orientation"]).strip()
    if orientation not in SCREEN_ORIENTATIONS:
        raise ValueError("不支持的屏幕方向")
    saved = {
        "orientation": orientation,
        "updated_at": _now_text(),
    }
    atomic_write_json(SCREEN_FILE, saved)
    atomic_write_json(SCREEN_APPLY_STATUS_FILE, {
        "orientation": orientation,
        "state": "waiting_apply",
        "active": False,
        "message": "等待系统服务写入启动配置",
        "requires_reboot": True,
        "applied_to": "runtime_config",
        "updated_at": _now_text(),
    })
    try:
        SCREEN_APPLY_REQUEST_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SCREEN_APPLY_REQUEST_FILE, "w", encoding="utf-8") as fh:
            fh.write(_now_text())
            fh.write("\n")
    except Exception:
        pass
    return load_screen()


def _save_profile(payload: dict) -> dict:
    current = load_profile()
    saved = {
        "device_name": _safe_text(payload.get("device_name"), current["device_name"], 64),
        "site_location": _safe_text(payload.get("site_location"), current["site_location"], 80),
        "device_id": _safe_text(payload.get("device_id"), current["device_id"], 64),
        "logo_text": _safe_text(payload.get("logo_text"), current["logo_text"], 12),
        "updated_at": _now_text(),
    }
    atomic_write_json(PROFILE_FILE, saved)
    return load_profile()


def _save_logo_file(data: bytes, ext: str) -> None:
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    target = LOGO_DIR / f"system_logo{ext}"
    tmp = LOGO_DIR / f".system_logo_upload{ext}"
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
    for old in _logo_paths():
        if old != target and old.exists():
            try:
                old.unlink()
            except OSError:
                pass
    tmp.replace(target)


def _delete_logo_file() -> None:
    for path in _logo_paths():
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass


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


def _systemd_unit_status(unit: str) -> dict:
    try:
        result = subprocess.run(
            ["systemctl", "is-active", unit],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
        active_text = (result.stdout or result.stderr or "").strip()
        enabled_result = subprocess.run(
            ["systemctl", "is-enabled", unit],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
        enabled_text = (enabled_result.stdout or enabled_result.stderr or "").strip()
        return {
            "unit": unit,
            "running": active_text == "active",
            "active_state": active_text or "unknown",
            "enabled": enabled_text in {"enabled", "static", "indirect", "generated"},
            "enabled_state": enabled_text or "unknown",
        }
    except Exception:
        return {
            "unit": unit,
            "running": False,
            "active_state": "unknown",
            "enabled": False,
            "enabled_state": "unknown",
        }


def _request_device_reboot() -> None:
    REBOOT_REQUEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(REBOOT_REQUEST_FILE, "w", encoding="utf-8") as fh:
        fh.write(_now_text())
        fh.write("\n")
        fh.flush()


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
    kiosk = _systemd_unit_status("hydrocore-kiosk.service")
    screen_apply = _systemd_unit_status("hydrocore-screen-apply.path")
    return {
        "web": {"running": True, "label": "运行中"},
        "local_display": {
            "running": kiosk["running"],
            "enabled": kiosk["enabled"],
            "active_state": kiosk["active_state"],
            "enabled_state": kiosk["enabled_state"],
            "label": "运行中" if kiosk["running"] else "未运行",
        },
        "screen_apply": {
            "running": screen_apply["running"],
            "enabled": screen_apply["enabled"],
            "active_state": screen_apply["active_state"],
            "enabled_state": screen_apply["enabled_state"],
        },
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


@bp.get("/logo/image")
def api_system_logo_image():
    logo_path = _current_logo_path()
    if not logo_path:
        return Response("logo image not found", status=404, mimetype="text/plain")
    resp = Response(
        logo_path.read_bytes(),
        mimetype=LOGO_MIME_BY_EXT.get(logo_path.suffix.lower(), "application/octet-stream"),
    )
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.post("/logo")
def api_system_logo_upload():
    try:
        upload = request.files.get("logo")
        if not upload:
            return jsonify({"ok": False, "error": "缺少 logo 文件"}), 400
        data = upload.read(LOGO_MAX_BYTES + 1)
        if not data:
            return jsonify({"ok": False, "error": "logo 文件为空"}), 400
        if len(data) > LOGO_MAX_BYTES:
            return jsonify({"ok": False, "error": "logo 文件不能超过 1 MB"}), 400
        ext = _detect_logo_ext(data)
        if ext not in LOGO_MIME_BY_EXT:
            return jsonify({"ok": False, "error": "仅支持 PNG、JPG、WEBP 图片"}), 400
        _save_logo_file(data, ext)
        return jsonify({"ok": True, "profile": load_profile()}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.delete("/logo")
def api_system_logo_delete():
    try:
        _delete_logo_file()
        return jsonify({"ok": True, "profile": load_profile()}), 200
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


@bp.post("/reboot")
def api_system_reboot():
    try:
        payload = request.get_json(force=True) or {}
        if str(payload.get("confirm") or "").strip() != REBOOT_CONFIRM_TEXT:
            return jsonify({"ok": False, "error": "需要二次确认"}), 400
        _request_device_reboot()
        return jsonify({"ok": True, "message": "设备正在重启"}), 202
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@bp.get("/status")
def api_system_status():
    ip = _request_ip()
    request_host = request.host.split(":", 1)[0]
    port = request.host.split(":", 1)[1] if ":" in request.host else ""
    access_host = ip if request_host in ("127.0.0.1", "localhost", "::1") else request_host
    access_netloc = f"{access_host}:{port}" if port else access_host
    access_url = f"{request.scheme}://{access_netloc}/ui/"
    return jsonify({
        "ok": True,
        "profile": load_profile(),
        "network": {
            "hostname": socket.gethostname(),
            "ip": ip,
            "access_url": access_url,
            "port": port,
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
