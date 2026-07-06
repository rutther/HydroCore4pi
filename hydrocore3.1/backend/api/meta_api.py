# 文件：backend/api/meta_api.py
# ...（原有 import 保留）...
import os, json, datetime
import time
from pathlib import Path
from typing import Dict, Any, List
from flask import Blueprint, request, jsonify
from ..db import get_conn
from ..utils.json_io import atomic_write_json
from .. import settings

from werkzeug.utils import secure_filename
from ..services.protocol_loader import list_protocol_files, load_protocol, USER_PROTO_DIR

bp = Blueprint("meta_api", __name__, url_prefix="/api/v1")

PROTO_DIR = settings.BUILTIN_PROTOCOL_DIR
PLAN_FILE = settings.POLL_PLAN_FILE
_dashboard_state_cache: Dict[str, Any] = {"key": None, "expires_at": 0.0, "payload": None}

# ========= 现有的 meta_series / data_range / meta_protocol 保留，不删 =========

def _load_plan_raw() -> Dict[str, Any] | List[Dict[str, Any]]:
    """读取 plan 原始内容。兼容旧格式（顶层数组）与新格式（{__meta__, plans[]}）。"""
    try:
        with open(PLAN_FILE, "r", encoding="utf8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise RuntimeError(f"读取计划失败: {e}")

def _load_protocol_json(name: str) -> Dict[str, Any] | None:
    """尝试加载对应协议 json，用于兜底 label/description。失败则返回 None。"""
    try:
        return load_protocol(name)
    except Exception:
        return None

@bp.get("/meta/plan_raw")
def meta_plan_raw():
    """原样返回 config_poll_plan.json（只读，调试/可视用）"""
    try:
        data = _load_plan_raw()
        return jsonify({"ok": True, "plan": data})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@bp.get("/meta/plan_view")
def meta_plan_view():
    """
    面向前端的“计划视图”：
    - 以 plan 为唯一事实来源，返回 protocols/addresses/parameters 的可选项
    - 每个参数项尽量补充 label/unit/round_to/axis/event_only/agg_mode
    - 若 plan 未给 label，则尝试用协议文件里的 description 兜底
    - 去重 & 合并同 (protocol,address) 的参数集合
    """
    try:
        raw = _load_plan_raw()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    # 兼容两种顶层格式
    if isinstance(raw, list):
        meta = {}
        plans = raw
    elif isinstance(raw, dict):
        meta = raw.get("__meta__", {}) or {}
        plans = raw.get("plans", [])
        if not isinstance(plans, list):
            return jsonify({"ok": False, "error": "plans 字段必须为数组"}), 400
    else:
        return jsonify({"ok": False, "error": "计划文件格式不正确"}), 400

    default_round = int(meta.get("default_round_to", 3))

    # 归并结构：{ (proto, addr, port) : { protocol, address, port, parameters: {name: param_obj} } }
    merged: Dict[tuple, Dict[str, Any]] = {}

    # 协议缓存，避免反复读文件
    proto_cache: Dict[str, Dict[str, Any] | None] = {}

    for ent in plans:
        try:
            proto = ent["protocol"]
            addr  = int(ent["address"])
            port  = ent["port"]
        except Exception:
            # 跳过非法项
            continue

        key = (proto, addr, port)
        if key not in merged:
            merged[key] = {
                "protocol": proto,
                "address": addr,
                "port": port,
                "parameters": {}  # name -> obj
            }

        params_list = ent.get("parameters", [])
        # 加载协议兜底
        if proto not in proto_cache:
            proto_cache[proto] = _load_protocol_json(proto)
        proto_json = proto_cache[proto]

        for p in params_list:
            # 兼容字符串与对象
            if isinstance(p, str):
                pname = p
                pobj: Dict[str, Any] = {"name": pname}
            elif isinstance(p, dict) and "name" in p:
                pname = p["name"]
                pobj = dict(p)
            else:
                continue

            # 统一补默认字段
            pobj.setdefault("round_to", default_round)
            pobj.setdefault("axis", "left")
            # event_only 默认不启用（False / None 均视为关闭）
            if "event_only" not in pobj:
                pobj["event_only"] = None
            pobj.setdefault("agg_mode", None)

            # label/unit fallback. The poll plan is authoritative; protocol JSON only fills blanks.
            fld = proto_json.get(pname) if isinstance(proto_json, dict) else None
            if isinstance(fld, dict):
                if "label" not in pobj and "label_zh" not in pobj:
                    label = fld.get("label_zh") or fld.get("label") or fld.get("description")
                    if isinstance(label, str) and label.strip():
                        pobj["label"] = label

                if "unit" not in pobj:
                    unit = fld.get("unit")
                    if isinstance(unit, str):
                        pobj["unit"] = unit

                for meta_key in (
                    "value_kind",
                    "delta_mode",
                    "trend_enabled",
                    "normal_range",
                    "can_cross_zero",
                ):
                    if meta_key not in pobj and meta_key in fld:
                        pobj[meta_key] = fld.get(meta_key)

            if pobj.get("event_only") and "value_kind" not in pobj:
                pobj["value_kind"] = "event"

            # 合并（后者覆盖前者）
            merged[key]["parameters"][pname] = {
                **merged[key]["parameters"].get(pname, {}),
                **pobj
            }

    # 输出为数组，parameters 从 dict -> list
    out = []
    for (_k, group) in merged.items():
        params_arr = list(group["parameters"].values())
        # 排序：先保持计划里大致次序（这里按 name 排，够稳定）
        params_arr.sort(key=lambda x: x.get("name",""))
        out.append({
            "protocol": group["protocol"],
            "address": group["address"],
            "port": group["port"],
            "parameters": params_arr
        })

    # 也可以附带顶层 meta 的只读提示（便于前端显示 round/留存等缺省）
    return jsonify({
        "ok": True,
        "meta_defaults": {
            "default_round_to": default_round,
            "default_sampling_sec": meta.get("default_sampling_sec"),
            "default_persist_sec": meta.get("default_persist_sec"),
            "align_persist_to_wall": meta.get("align_persist_to_wall"),
            "retention_days": meta.get("retention_days"),
            "max_db_mb": meta.get("max_db_mb")
        },
        "entries": out
    })

# ========= 补回：/api/v1/meta/series =========
@bp.get("/meta/series")
def meta_series():
    server_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_conn() as conn:
        has_summary = conn.execute("""
            SELECT 1
              FROM sqlite_master
             WHERE type='table' AND name='sensor_series_summary'
        """).fetchone()
        if has_summary:
            rows = conn.execute("""
                SELECT protocol, address, parameter, first_ts, last_ts, n
                  FROM sensor_series_summary
                 ORDER BY protocol, address, parameter
            """).fetchall()
            if rows:
                return jsonify({"ok": True, "series": [dict(r) for r in rows], "source": "summary", "server_ts": server_ts})

        rows = conn.execute("""
            SELECT protocol, address, parameter,
                   MIN(ts) AS first_ts,
                   MAX(ts) AS last_ts,
                   COUNT(*) AS n
              FROM sensor_data
             GROUP BY protocol, address, parameter
             ORDER BY protocol, address, parameter
        """).fetchall()
    return jsonify({"ok": True, "series": [dict(r) for r in rows], "source": "sensor_data", "server_ts": server_ts})


def _parse_int_arg(name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(request.args.get(name, default))
    except Exception:
        value = default
    return max(lo, min(hi, value))


def _parse_dt(raw: Any) -> datetime.datetime | None:
    try:
        return datetime.datetime.strptime(str(raw), "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def _round_value(value: Any, digits: int) -> float | None:
    try:
        return round(float(value), digits)
    except Exception:
        return None


def _dashboard_plan_items() -> List[Dict[str, Any]]:
    raw = _load_plan_raw()
    if isinstance(raw, list):
        meta = {}
        plans = raw
    elif isinstance(raw, dict):
        meta = raw.get("__meta__", {}) or {}
        plans = raw.get("plans", [])
    else:
        raise ValueError("采集计划格式不正确")
    if not isinstance(plans, list):
        raise ValueError("采集计划 plans 字段必须为数组")

    default_round = int(meta.get("default_round_to", 3))
    proto_cache: Dict[str, Dict[str, Any] | None] = {}
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []

    for ent in plans:
        if not isinstance(ent, dict):
            continue
        try:
            protocol = str(ent["protocol"]).strip()
            address = int(ent["address"])
            port = str(ent.get("port") or "").strip()
        except Exception:
            continue
        if not protocol:
            continue

        if protocol not in proto_cache:
            proto_cache[protocol] = _load_protocol_json(protocol)
        proto_json = proto_cache[protocol]

        for raw_param in ent.get("parameters", []):
            if isinstance(raw_param, str):
                parameter = raw_param.strip()
                pobj: Dict[str, Any] = {"name": parameter}
            elif isinstance(raw_param, dict):
                parameter = str(raw_param.get("name") or "").strip()
                pobj = dict(raw_param)
            else:
                continue
            if not parameter:
                continue

            key = f"{protocol}:{address}:{parameter}"
            if key in seen:
                continue
            seen.add(key)

            pobj.setdefault("round_to", default_round)
            if "event_only" not in pobj:
                pobj["event_only"] = None

            fld = proto_json.get(parameter) if isinstance(proto_json, dict) else None
            if isinstance(fld, dict):
                if "label" not in pobj and "label_zh" not in pobj:
                    label = fld.get("label_zh") or fld.get("label") or fld.get("description")
                    if isinstance(label, str) and label.strip():
                        pobj["label"] = label
                if "unit" not in pobj:
                    unit = fld.get("unit")
                    if isinstance(unit, str):
                        pobj["unit"] = unit
                for meta_key in (
                    "value_kind",
                    "delta_mode",
                    "trend_enabled",
                    "normal_range",
                    "can_cross_zero",
                ):
                    if meta_key not in pobj and meta_key in fld:
                        pobj[meta_key] = fld.get(meta_key)

            if pobj.get("event_only") and "value_kind" not in pobj:
                pobj["value_kind"] = "event"

            value_kind = str(pobj.get("value_kind") or "continuous").strip() or "continuous"
            delta_mode = str(pobj.get("delta_mode") or ("none" if value_kind in ("event", "state") else "absolute_only")).strip()
            trend_enabled = bool(pobj.get("trend_enabled", value_kind not in ("event", "state")))

            out.append({
                "key": key,
                "protocol": protocol,
                "address": address,
                "parameter": parameter,
                "port": port,
                "label": str(pobj.get("label_zh") or pobj.get("label") or parameter).strip(),
                "unit": str(pobj.get("unit") or "").strip(),
                "round_to": int(pobj.get("round_to", default_round)),
                "value_kind": value_kind,
                "delta_mode": delta_mode,
                "trend_enabled": trend_enabled,
                "event_only": pobj.get("event_only"),
                "agg_mode": pobj.get("agg_mode"),
            })
    return out


@bp.get("/dashboard/state")
def dashboard_state():
    """
    轻量仪表盘状态接口：
    只围绕当前采集计划中的参数，按复合索引读取最新值和窗口起点值。
    不拉曲线、不全表分组，供前端自动刷新使用。
    """
    window_sec = _parse_int_arg("window_sec", 86400, 60, 604800)
    fresh_sec = _parse_int_arg("fresh_sec", 180, 10, 86400)
    cache_sec = _parse_int_arg("cache_sec", 3, 0, 30)
    cache_key = (window_sec, fresh_sec)
    now_mono = time.monotonic()

    if cache_sec > 0 and _dashboard_state_cache.get("key") == cache_key and now_mono < float(_dashboard_state_cache.get("expires_at") or 0):
        cached = dict(_dashboard_state_cache["payload"])
        cached["cache"] = "hit"
        return jsonify(cached)

    try:
        items = _dashboard_plan_items()
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

    with get_conn() as conn:
        server_ts = conn.execute(
            "SELECT strftime('%Y-%m-%d %H:%M:%S','now','localtime')"
        ).fetchone()[0]
        since_ts = conn.execute(
            "SELECT strftime('%Y-%m-%d %H:%M:%S','now','localtime', ?)",
            (f"-{window_sec} seconds",),
        ).fetchone()[0]

        summary_rows = conn.execute("""
            SELECT protocol, address, parameter, first_ts, last_ts, n
              FROM sensor_series_summary
        """).fetchall()
        summary_map = {
            (str(r["protocol"]), int(r["address"]), str(r["parameter"])): dict(r)
            for r in summary_rows
        }

        server_dt = _parse_dt(server_ts)
        for item in items:
            protocol = item["protocol"]
            address = int(item["address"])
            parameter = item["parameter"]
            rnd = max(0, min(8, int(item.get("round_to", 3))))

            latest = conn.execute("""
                SELECT ts, value
                  FROM sensor_data
                 WHERE protocol=? AND address=? AND parameter=?
                 ORDER BY ts DESC
                 LIMIT 1
            """, (protocol, address, parameter)).fetchone()

            first = conn.execute("""
                SELECT ts, value
                  FROM sensor_data
                 WHERE protocol=? AND address=? AND parameter=?
                   AND ts >= ? AND ts <= ?
                 ORDER BY ts ASC
                 LIMIT 1
            """, (protocol, address, parameter, since_ts, server_ts)).fetchone()

            latest_ts = latest["ts"] if latest else None
            latest_value = _round_value(latest["value"], rnd) if latest else None
            first_ts = first["ts"] if first else None
            first_value = _round_value(first["value"], rnd) if first else None
            age_sec = None
            latest_dt = _parse_dt(latest_ts) if latest_ts else None
            if server_dt and latest_dt:
                age_sec = max(0, int((server_dt - latest_dt).total_seconds()))

            if latest_value is None:
                data_status = "no_data"
            elif age_sec is not None and age_sec > fresh_sec:
                data_status = "stale"
            else:
                data_status = "fresh"

            delta = None
            delta_percent = None
            if item.get("delta_mode") != "none" and latest_value is not None and first_value is not None:
                delta = round(float(latest_value) - float(first_value), rnd)
                if item.get("delta_mode") == "absolute_percent" and float(first_value) != 0:
                    delta_percent = round(delta / float(first_value) * 100.0, 3)

            summary = summary_map.get((protocol, address, parameter), {})
            item.update({
                "latest_ts": latest_ts,
                "latest_value": latest_value,
                "age_sec": age_sec,
                "data_status": data_status,
                "window_first_ts": first_ts,
                "window_first_value": first_value,
                "delta": delta,
                "delta_percent": delta_percent,
                "summary_first_ts": summary.get("first_ts"),
                "summary_last_ts": summary.get("last_ts"),
                "sample_count": summary.get("n"),
            })

    payload = {
        "ok": True,
        "server_ts": server_ts,
        "window_sec": window_sec,
        "fresh_sec": fresh_sec,
        "source": "poll_plan_index_seek",
        "cache": "miss",
        "items": items,
    }
    if cache_sec > 0:
        _dashboard_state_cache.update({
            "key": cache_key,
            "expires_at": time.monotonic() + cache_sec,
            "payload": payload,
        })
    return jsonify(payload)

# ========= 工具：解析 s=proto:addr:param =========
def _parse_series_args(args):
    items = args.getlist("s")
    out = []
    for it in items:
        try:
            proto, addr_s, param = it.split(":", 2)
            out.append((proto, int(addr_s), param))
        except Exception:
            continue
    return out

# ========= 补回：/api/v1/data/range?s=...（可多次） =========
@bp.get("/data/range")
def data_range():
    series_list = _parse_series_args(request.args)
    out = []
    with get_conn() as conn:
        if not series_list:
            r = conn.execute("""
                SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*) AS n
                  FROM sensor_data
            """).fetchone()
            return jsonify({"ok": True, "overall": dict(r), "per_series": []})

        min_first, max_last = None, None
        for (proto, addr, param) in series_list:
            r = conn.execute("""
                SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*) AS n
                  FROM sensor_data
                 WHERE protocol=? AND address=? AND parameter=?
            """, (proto, addr, param)).fetchone()
            rec = {
                "key": f"{proto}:{addr}:{param}",
                "protocol": proto, "address": addr, "parameter": param,
                "first_ts": r["first_ts"], "last_ts": r["last_ts"], "n": r["n"]
            }
            out.append(rec)
            if r["first_ts"]:
                if min_first is None or r["first_ts"] < min_first:
                    min_first = r["first_ts"]
            if r["last_ts"]:
                if max_last is None or r["last_ts"] > max_last:
                    max_last = r["last_ts"]
    return jsonify({
        "ok": True,
        "overall": {"first_ts": min_first, "last_ts": max_last},
        "per_series": out
    })


# =========================
# 设备定义文件（protocols）管理 API
# 说明：
# - 内置目录：protocols/*.json（随代码发布）
# - 用户目录：data/protocols_user/*.json（运行时导入/覆盖）
# - 同名：用户目录优先
# =========================

@bp.get("/meta/protocols")
def meta_protocols_list():
    """
    列出所有设备定义文件（内置+用户）
    返回：
      { ok:true, items:[ {name, source, mtime, size}, ... ] }
    """
    try:
        items = list_protocol_files()
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        return jsonify({"ok": False, "error": f"列出失败: {e}"}), 500


@bp.get("/meta/protocols/<string:name>")
def meta_protocol_get(name: str):
    """
    读取某个设备定义文件 JSON（name 可带 .json 或不带）
    返回：
      { ok:true, name:"lanchang_ec", protocol:{...} }
    """
    try:
        n = name[:-5] if name.endswith(".json") else name
        data = load_protocol(n)
        return jsonify({"ok": True, "name": n, "protocol": data})
    except FileNotFoundError as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    except Exception as e:
        return jsonify({"ok": False, "error": f"读取失败: {e}"}), 500


@bp.post("/meta/protocols/upload")
def meta_protocol_upload():
    """
    上传设备定义文件（multipart/form-data）
    表单字段：
      - file: JSON 文件
    保存到：data/protocols_user/<filename>.json

    返回：
      { ok:true, name:"xxx", message:"已上传到用户库" }
    """
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "缺少文件字段 file"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"ok": False, "error": "空文件名"}), 400

    filename = secure_filename(f.filename)
    if not filename.endswith(".json"):
        return jsonify({"ok": False, "error": "只允许上传 .json 文件"}), 400

    os.makedirs(USER_PROTO_DIR, exist_ok=True)
    save_path = os.path.join(USER_PROTO_DIR, filename)

    # 先校验 JSON 再写入，避免落盘垃圾文件
    try:
        raw = f.read()
        text = raw.decode("utf-8-sig")  # 兼容 BOM
        obj = json.loads(text)
    except Exception as e:
        return jsonify({"ok": False, "error": f"JSON 解析失败: {e}"}), 400

    try:
        with open(save_path, "w", encoding="utf-8") as wf:
            json.dump(obj, wf, ensure_ascii=False, indent=2)
    except Exception as e:
        return jsonify({"ok": False, "error": f"写入失败: {e}"}), 500

    return jsonify({"ok": True, "name": filename[:-5], "message": "已上传到用户库"}), 200



@bp.delete("/meta/protocols/<string:name>")
def meta_protocol_delete(name: str):
    """
    删除“用户库”的设备定义文件（只允许删 data/protocols_user/*.json）
    规则：
    - 仅删除用户目录 data/protocols_user/<name>.json
    - 如果用户目录不存在但内置目录存在：403（内置不可删）
    - 都不存在：404
    返回：
      { ok:true, deleted:{name:"xxx", source:"user"} }
    """
    try:
        # 统一 name：允许传入 xxx 或 xxx.json
        n = name[:-5] if name.endswith(".json") else name

        # 基础安全：只允许 [a-zA-Z0-9._-] 这类文件名；否则拒绝
        safe_n = secure_filename(n)
        if not safe_n or safe_n != n:
            return jsonify({"ok": False, "error": "非法 name：只允许字母数字 . _ -"}), 400

        user_path = os.path.join(USER_PROTO_DIR, f"{n}.json")
        builtin_path = str(PROTO_DIR / f"{n}.json")

        # 优先判断用户目录
        if os.path.exists(user_path):
            try:
                os.remove(user_path)
            except Exception as e:
                return jsonify({"ok": False, "error": f"删除失败: {e}"}), 500
            return jsonify({"ok": True, "deleted": {"name": n, "source": "user"}}), 200

        # 用户目录没有，再看是否是内置（内置不可删）
        if os.path.exists(builtin_path):
            return jsonify({"ok": False, "error": "该文件为内置定义（builtin），不可删除"}), 403

        return jsonify({"ok": False, "error": "文件不存在"}), 404

    except Exception as e:
        return jsonify({"ok": False, "error": f"删除失败: {e}"}), 500
