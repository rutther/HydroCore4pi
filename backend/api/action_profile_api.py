from flask import Blueprint, request, jsonify
from pathlib import Path
import json

bp = Blueprint("action_profile_api", __name__, url_prefix="/api/v1/action-profile")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROFILE_DIR = PROJECT_ROOT / "data" / "action_profiles"
CURRENT_PROFILE_FILENAME = "current_profile.json"
CURRENT_PROFILE_FILE = PROFILE_DIR / CURRENT_PROFILE_FILENAME


def _ensure_storage() -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    if not CURRENT_PROFILE_FILE.exists():
        CURRENT_PROFILE_FILE.write_text(
            json.dumps({"filename": ""}, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )


def _normalize_filename(raw: str) -> str:
    filename = Path(str(raw)).name.strip()

    if not filename:
        raise ValueError("文件名不能为空")

    if not filename.lower().endswith(".json"):
        raise ValueError("只允许 .json 文件")

    if filename == CURRENT_PROFILE_FILENAME:
        raise ValueError(f"不允许使用保留文件名: {CURRENT_PROFILE_FILENAME}")

    return filename


def _split_filename(filename: str) -> tuple[str, str]:
    stem = Path(filename).stem
    parts = stem.split("_")

    if len(parts) >= 2:
        board_type = "_".join(parts[:-1])
        version = parts[-1]
        return board_type, version

    return stem, ""


def _load_profile_json(filename: str) -> dict:
    _ensure_storage()
    filename = _normalize_filename(filename)
    file_path = PROFILE_DIR / filename

    if not file_path.exists():
        raise FileNotFoundError(f"配置文件不存在: {filename}")

    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_profile_json(filename: str, content: dict) -> None:
    _ensure_storage()
    filename = _normalize_filename(filename)
    file_path = PROFILE_DIR / filename

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(content, f, ensure_ascii=False, indent=2)


def _read_current_filename() -> str:
    _ensure_storage()

    with open(CURRENT_PROFILE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    filename = str(data.get("filename", "")).strip()
    if not filename:
        return ""

    return _normalize_filename(filename)


def _write_current_filename(filename: str) -> None:
    _ensure_storage()
    filename = _normalize_filename(filename)

    with open(CURRENT_PROFILE_FILE, "w", encoding="utf-8") as f:
        json.dump({"filename": filename}, f, ensure_ascii=False, indent=2)


@bp.get("/list")
def api_action_profile_list():
    """
    返回可选控制板配置文件列表
    不返回 current_profile.json
    """
    try:
        _ensure_storage()

        items = []
        for file_path in sorted(PROFILE_DIR.glob("*.json")):
            if file_path.name == CURRENT_PROFILE_FILENAME:
                continue

            board_type, version = _split_filename(file_path.name)
            items.append({
                "type": board_type,
                "version": version,
                "filename": file_path.name
            })

        return jsonify({"ok": True, "items": items}), 200

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.get("/detail")
def api_action_profile_detail():
    """
    读取某个配置文件详情
    GET /api/v1/action-profile/detail?filename=raspberrypi_4.json
    """
    filename = str(request.args.get("filename", "")).strip()
    if not filename:
        return jsonify({"ok": False, "error": "缺少 filename"}), 400

    try:
        profile = _load_profile_json(filename)
        board_type, version = _split_filename(filename)

        return jsonify({
            "ok": True,
            "item": {
                "type": board_type,
                "version": version,
                "filename": filename,
                "profile": profile
            }
        }), 200

    except FileNotFoundError as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/import")
def api_action_profile_import():
    """
    导入控制板配置文件
    支持两种方式：
    1) multipart/form-data 上传文件，字段名 file
    2) application/json:
       {
         "filename": "raspberrypi_4.json",
         "content": {...}
       }
    """
    try:
        _ensure_storage()

        # 方式 1：上传文件
        if "file" in request.files:
            file = request.files["file"]

            if file.filename is None or file.filename.strip() == "":
                return jsonify({"ok": False, "error": "未选择文件"}), 400

            filename = _normalize_filename(file.filename)
            raw = file.read()

            try:
                content = json.loads(raw.decode("utf-8"))
            except Exception:
                return jsonify({"ok": False, "error": "上传文件不是合法 JSON"}), 400

            _write_profile_json(filename, content)

            board_type, version = _split_filename(filename)
            return jsonify({
                "ok": True,
                "item": {
                    "type": board_type,
                    "version": version,
                    "filename": filename
                }
            }), 200

        # 方式 2：JSON 请求体
        payload = request.get_json(force=True)
        filename = str(payload.get("filename", "")).strip()
        content = payload.get("content", None)

        if not filename:
            return jsonify({"ok": False, "error": "缺少 filename"}), 400

        if not isinstance(content, dict):
            return jsonify({"ok": False, "error": "content 必须是 JSON 对象"}), 400

        filename = _normalize_filename(filename)
        _write_profile_json(filename, content)

        board_type, version = _split_filename(filename)
        return jsonify({
            "ok": True,
            "item": {
                "type": board_type,
                "version": version,
                "filename": filename
            }
        }), 200

    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/confirm")
def api_action_profile_confirm():
    """
    确认当前选中的控制板配置
    POST /api/v1/action-profile/confirm
    {
      "filename": "raspberrypi_4.json"
    }
    """
    payload = request.get_json(force=True)
    filename = str(payload.get("filename", "")).strip()

    if not filename:
        return jsonify({"ok": False, "error": "缺少 filename"}), 400

    try:
        profile = _load_profile_json(filename)
        _write_current_filename(filename)

        board_type, version = _split_filename(filename)
        return jsonify({
            "ok": True,
            "current": {
                "type": board_type,
                "version": version,
                "filename": filename,
                "profile": profile
            }
        }), 200

    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except FileNotFoundError as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.get("/current")
def api_action_profile_current():
    """
    获取当前已确认的控制板配置
    """
    try:
        filename = _read_current_filename()

        if not filename:
            return jsonify({"ok": True, "current": None}), 200

        profile = _load_profile_json(filename)
        board_type, version = _split_filename(filename)

        return jsonify({
            "ok": True,
            "current": {
                "type": board_type,
                "version": version,
                "filename": filename,
                "profile": profile
            }
        }), 200

    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except FileNotFoundError as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500