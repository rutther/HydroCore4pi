# 文件：backend/api/data_api.py
# 职责：只读数据接口（时间序列查询与导出），支持多序列、多桶、多聚合。
# 依赖：backend/db.get_conn
# 说明：
#   - /api/v1/data/series
#       参数：
#         s=protocol:address:parameter  可重复多次（多序列） 例：s=lanchang_ec:10:ec_value&s=lanchang_ph:9:measurement
#         bucket=raw|10s|1m|3m|10m|30m|1h|3h|6h|8h|12h|1d|1w|1mo
#         agg=avg|min|max|last|ohlc  （raw 模式无 agg）
#         round=0..8                 （服务端四舍五入）
#         from=YYYY-MM-DD HH:MM:SS   （缺省为“现在-24h”）
#         to=YYYY-MM-DD HH:MM:SS     （缺省为“现在”）
#         limit=整数                 （每序列最大点数上限，JSON 2万，CSV 100万）
#   - /api/v1/data/export.csv
#       参数同 /series，但当前 CSV 对分桶仅支持 avg/min/max（三选一）；ohlc 也可扩展为四列导出（此版未实现）。

from flask import Blueprint, request, jsonify, Response
from typing import Optional, Tuple, List, Dict, Any
from ..db import get_conn

bp = Blueprint("data_api", __name__, url_prefix="/api/v1/data")

# 固定“秒桶”
_BUCKET_SEC = {
    "10s": 10,
    "1m": 60,
    "3m": 180,
    "10m": 600,
    "30m": 1800,
    "1h": 3600,
    "3h": 10800,
    "6h": 21600,
    "8h": 28800,
    "12h": 43200,
}
# “日/周/月”桶
_BUCKET_CAL = {"1d", "1w", "1mo"}

def _bucket_ts_expr(expr: str) -> str:
    """
    sensor_data.ts 当前按本地时间字符串入库。
    SQLite 的 strftime('%s', ts) 会把无时区字符串当 UTC 解释；如果输出时再加
    localtime，会把分桶标签整体偏移一个本地时区。这里明确不再二次 localtime。
    """
    return f"strftime('%Y-%m-%d %H:%M:%S', {expr}, 'unixepoch')"

def _parse_int(s: Optional[str], default: int, lo: int, hi: int) -> int:
    try:
        v = int(s)
        if v < lo: v = lo
        if v > hi: v = hi
        return v
    except Exception:
        return default

def _parse_round(s: Optional[str], default: int = 3) -> int:
    try:
        v = int(s)
        if v < 0: v = 0
        if v > 8: v = 8
        return v
    except Exception:
        return default

def _time_range(args) -> Tuple[str, str]:
    # 缺省=最近24小时，均用本地时区（localtime）
    t_from = args.get("from")
    t_to   = args.get("to")
    with get_conn() as conn:
        if not t_to:
            t_to = conn.execute(
                "SELECT strftime('%Y-%m-%d %H:%M:%S','now','localtime')"
            ).fetchone()[0]
        if not t_from:
            t_from = conn.execute(
                "SELECT strftime('%Y-%m-%d %H:%M:%S','now','localtime','-24 hours')"
            ).fetchone()[0]
    return t_from, t_to

def _parse_series_args(args) -> List[Tuple[str,int,str]]:
    """
    解析 ?s=proto:addr:param 参数（可重复）
    返回 [(protocol, address, parameter), ...]
    """
    items = args.getlist("s")
    out: List[Tuple[str,int,str]] = []
    for it in items:
        try:
            proto, addr_s, param = it.split(":", 2)
            out.append((proto, int(addr_s), param))
        except Exception:
            # 跳过非法项
            continue
    return out

@bp.get("/series")
def series():
    series_list = _parse_series_args(request.args)
    if not series_list:
        # 兼容旧单序列参数（protocol/address/parameter）
        proto  = request.args.get("protocol")
        addr_s = request.args.get("address")
        param  = request.args.get("parameter")
        if not (proto and addr_s and param):
            return jsonify({"ok": False, "error": "需要 s=proto:addr:param（可多次），或提供 protocol/address/parameter"}), 400
        try:
            series_list = [(proto, int(addr_s), param)]
        except Exception:
            return jsonify({"ok": False, "error": "address 必须为整数"}), 400

    bucket = request.args.get("bucket", "raw").lower()
    agg    = request.args.get("agg", "avg").lower()
    rnd    = _parse_round(request.args.get("round"), 3)
    limit  = _parse_int(request.args.get("limit"), default=20000, lo=1, hi=20000)
    t_from, t_to = _time_range(request.args)

    # 原始数据
    if bucket == "raw":
        body = []
        with get_conn() as conn:
            for (proto, addr, param) in series_list:
                rows = conn.execute("""
                    SELECT ts, ROUND(value, ?) AS value
                      FROM sensor_data
                     WHERE protocol=? AND address=? AND parameter=?
                       AND ts BETWEEN ? AND ?
                     ORDER BY ts ASC
                     LIMIT ?
                """, (rnd, proto, addr, param, t_from, t_to, limit)).fetchall()
                body.append({
                    "key": f"{proto}:{addr}:{param}",
                    "protocol": proto, "address": addr, "parameter": param,
                    "points": [{"ts": r["ts"], "value": r["value"]} for r in rows]
                })
        return jsonify({
            "ok": True,
            "meta": {"bucket": "raw", "agg": None, "round": rnd, "from": t_from, "to": t_to},
            "series": body
        })

    # 分桶聚合
    def _series_bucket_sec(bsec: int) -> Dict[str, Any]:
        if agg not in ("avg", "min", "max", "last", "ohlc"):
            return {"ok": False, "error": "agg 取值应为 avg|min|max|last|ohlc"}
        out = []
        with get_conn() as conn:
            for (proto, addr, param) in series_list:
                if agg == "last":
                    sql = f"""
                    WITH src AS (
                      SELECT (strftime('%s', ts)/?)*? AS bkt, ts, value
                        FROM sensor_data
                       WHERE protocol=? AND address=? AND parameter=?
                         AND ts BETWEEN ? AND ?
                    ),
                    rnk AS (
                      SELECT bkt, ts, value,
                             ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts DESC) rn
                        FROM src
                    )
                    SELECT {_bucket_ts_expr("bkt")} AS ts,
                           ROUND(value, ?) AS value
                      FROM rnk WHERE rn=1
                     ORDER BY bkt ASC
                     LIMIT ?
                    """
                    rows = conn.execute(sql, (bsec, bsec, proto, addr, param, t_from, t_to, rnd, limit)).fetchall()
                    points = [{"ts": r["ts"], "value": r["value"]} for r in rows]

                elif agg == "ohlc":
                    sql = f"""
                    WITH src AS (
                      SELECT (strftime('%s', ts)/?)*? AS bkt, ts, value
                        FROM sensor_data
                       WHERE protocol=? AND address=? AND parameter=?
                         AND ts BETWEEN ? AND ?
                    ),
                    o AS (
                      SELECT bkt, value AS open FROM (
                        SELECT bkt, ts, value,
                               ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts ASC) rn
                          FROM src
                      ) WHERE rn=1
                    ),
                    c AS (
                      SELECT bkt, value AS close FROM (
                        SELECT bkt, ts, value,
                               ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts DESC) rn
                          FROM src
                      ) WHERE rn=1
                    ),
                    hl AS (
                      SELECT bkt, MIN(value) AS low, MAX(value) AS high
                        FROM src GROUP BY bkt
                    )
                    SELECT {_bucket_ts_expr("o.bkt")} AS ts,
                           ROUND(o.open,  ?) AS o,
                           ROUND(hl.high, ?) AS h,
                           ROUND(hl.low,  ?) AS l,
                           ROUND(c.close, ?) AS c
                      FROM o
                      JOIN c  ON o.bkt = c.bkt
                      JOIN hl ON o.bkt = hl.bkt
                     ORDER BY o.bkt ASC
                     LIMIT ?
                    """
                    rows = conn.execute(sql, (bsec, bsec, proto, addr, param, t_from, t_to,
                                              rnd, rnd, rnd, rnd, limit)).fetchall()
                    points = [{"ts": r["ts"], "ohlc": {"open": r["o"], "high": r["h"], "low": r["l"], "close": r["c"]}}
                              for r in rows]
                else:
                    # avg/min/max
                    sql = f"""
                    SELECT {_bucket_ts_expr("(strftime('%s', ts)/?)*?")} AS ts,
                           ROUND({agg}(value), ?) AS value
                      FROM sensor_data
                     WHERE protocol=? AND address=? AND parameter=?
                       AND ts BETWEEN ? AND ?
                     GROUP BY (strftime('%s', ts)/?)*?
                     ORDER BY ts ASC
                     LIMIT ?
                    """
                    rows = conn.execute(sql, (bsec, bsec, rnd, proto, addr, param, t_from, t_to,
                                              bsec, bsec, limit)).fetchall()
                    points = [{"ts": r["ts"], "value": r["value"]} for r in rows]

                out.append({
                    "key": f"{proto}:{addr}:{param}",
                    "protocol": proto, "address": addr, "parameter": param,
                    "points": points
                })
        return {"ok": True, "series": out}

    def _series_bucket_cal(bkt: str) -> Dict[str, Any]:
        if agg not in ("avg", "min", "max", "last", "ohlc"):
            return {"ok": False, "error": "agg 取值应为 avg|min|max|last|ohlc"}
        if bkt == "1d":
            bkt_expr = "datetime(ts,'start of day')"
        elif bkt == "1w":
            bkt_expr = "datetime(date(ts,'weekday 1'),'start of day')"  # 周一为每周起始
        else:  # 1mo
            bkt_expr = "datetime(strftime('%Y-%m-01 00:00:00', ts))"

        out = []
        with get_conn() as conn:
            for (proto, addr, param) in series_list:
                if agg == "last":
                    sql = f"""
                    WITH src AS (
                      SELECT {bkt_expr} AS bkt, ts, value
                        FROM sensor_data
                       WHERE protocol=? AND address=? AND parameter=?
                         AND ts BETWEEN ? AND ?
                    ),
                    rnk AS (
                      SELECT bkt, ts, value,
                             ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts DESC) rn
                        FROM src
                    )
                    SELECT bkt AS ts, ROUND(value, ?) AS value
                      FROM rnk WHERE rn=1
                     ORDER BY ts ASC
                     LIMIT ?
                    """
                    rows = conn.execute(sql, (proto, addr, param, t_from, t_to, _parse_round(request.args.get("round"), 3), _parse_int(request.args.get("limit"), 20000, 1, 20000))).fetchall()
                    points = [{"ts": r["ts"], "value": r["value"]} for r in rows]

                elif agg == "ohlc":
                    sql = f"""
                    WITH src AS (
                      SELECT {bkt_expr} AS bkt, ts, value
                        FROM sensor_data
                       WHERE protocol=? AND address=? AND parameter=?
                         AND ts BETWEEN ? AND ?
                    ),
                    o AS (
                      SELECT bkt, value AS open FROM (
                        SELECT bkt, ts, value,
                               ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts ASC) rn
                          FROM src
                      ) WHERE rn=1
                    ),
                    c AS (
                      SELECT bkt, value AS close FROM (
                        SELECT bkt, ts, value,
                               ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts DESC) rn
                          FROM src
                      ) WHERE rn=1
                    ),
                    hl AS (
                      SELECT bkt, MIN(value) AS low, MAX(value) AS high
                        FROM src GROUP BY bkt
                    )
                    SELECT bkt AS ts,
                           ROUND(o.open,  ?) AS o,
                           ROUND(hl.high, ?) AS h,
                           ROUND(hl.low,  ?) AS l,
                           ROUND(c.close, ?) AS c
                      FROM o
                      JOIN c  ON o.bkt = c.bkt
                      JOIN hl ON o.bkt = hl.bkt
                     ORDER BY ts ASC
                     LIMIT ?
                    """
                    rnd_local  = _parse_round(request.args.get("round"), 3)
                    limit_local= _parse_int(request.args.get("limit"), 20000, 1, 20000)
                    rows = conn.execute(sql, (proto, addr, param, t_from, t_to,
                                              rnd_local, rnd_local, rnd_local, rnd_local, limit_local)).fetchall()
                    points = [{"ts": r["ts"], "ohlc": {"open": r["o"], "high": r["h"], "low": r["l"], "close": r["c"]}}
                              for r in rows]
                else:
                    # avg/min/max
                    sql = f"""
                    SELECT {bkt_expr} AS ts, ROUND({agg}(value), ?) AS value
                      FROM sensor_data
                     WHERE protocol=? AND address=? AND parameter=?
                       AND ts BETWEEN ? AND ?
                     GROUP BY {bkt_expr}
                     ORDER BY ts ASC
                     LIMIT ?
                    """
                    rows = conn.execute(sql, (_parse_round(request.args.get("round"), 3),
                                              proto, addr, param, t_from, t_to,
                                              _parse_int(request.args.get("limit"), 20000, 1, 20000))).fetchall()
                    points = [{"ts": r["ts"], "value": r["value"]} for r in rows]

                out.append({
                    "key": f"{proto}:{addr}:{param}",
                    "protocol": proto, "address": addr, "parameter": param,
                    "points": points
                })
        return {"ok": True, "series": out}

    if bucket in _BUCKET_SEC:
        res = _series_bucket_sec(_BUCKET_SEC[bucket])
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify({
            "ok": True,
            "meta": {"bucket": bucket, "agg": agg, "round": rnd, "from": t_from, "to": t_to},
            "series": res["series"]
        })
    if bucket in _BUCKET_CAL:
        res = _series_bucket_cal(bucket)
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify({
            "ok": True,
            "meta": {"bucket": bucket, "agg": agg, "round": rnd, "from": t_from, "to": t_to},
            "series": res["series"]
        })

    return jsonify({"ok": False, "error": "不支持的 bucket"}), 400


@bp.get("/export.csv")
def export_csv():
    # 多序列导出：目前按“逐序列顺序输出”，列为 ts,protocol,address,parameter,value
    series_list = _parse_series_args(request.args)
    if not series_list:
        # 兼容旧单序列
        proto  = request.args.get("protocol")
        addr_s = request.args.get("address")
        param  = request.args.get("parameter")
        if not (proto and addr_s and param):
            return jsonify({"ok": False, "error": "需要 s=proto:addr:param（可多次），或提供 protocol/address/parameter"}), 400
        try:
            series_list = [(proto, int(addr_s), param)]
        except Exception:
            return jsonify({"ok": False, "error": "address 必须为整数"}), 400

    bucket = request.args.get("bucket", "raw").lower()
    agg    = request.args.get("agg", "avg").lower()
    rnd    = _parse_round(request.args.get("round"), 3)
    limit  = _parse_int(request.args.get("limit"), default=1000000, lo=1, hi=1000000)
    t_from, t_to = _time_range(request.args)

    def _gen():
        yield "ts,protocol,address,parameter,value\n"
        with get_conn() as conn:
            for (proto, addr, param) in series_list:
                if bucket == "raw":
                    cur = conn.execute("""
                        SELECT ts, ROUND(value, ?) AS value
                          FROM sensor_data
                         WHERE protocol=? AND address=? AND parameter=?
                           AND ts BETWEEN ? AND ?
                         ORDER BY ts ASC
                         LIMIT ?
                    """, (rnd, proto, addr, param, t_from, t_to, limit))
                    for r in cur:
                        yield f'{r["ts"]},{proto},{addr},{param},{r["value"]}\n'
                else:
                    # 为简洁：CSV 的分桶只实现 avg/min/max（三选一）；last/ohlc 后续如需可扩成 value 或四列
                    if bucket in _BUCKET_SEC and agg in ("avg", "min", "max"):
                        bsec = _BUCKET_SEC[bucket]
                        sql = f"""
                        SELECT {_bucket_ts_expr("(strftime('%s', ts)/?)*?")} AS ts,
                               ROUND({agg}(value), ?) AS value
                          FROM sensor_data
                         WHERE protocol=? AND address=? AND parameter=?
                           AND ts BETWEEN ? AND ?
                         GROUP BY (strftime('%s', ts)/?)*?
                         ORDER BY ts ASC
                         LIMIT ?
                        """
                        cur = conn.execute(sql, (bsec, bsec, rnd, proto, addr, param,
                                                 t_from, t_to, bsec, bsec, limit))
                        for r in cur:
                            yield f'{r["ts"]},{proto},{addr},{param},{r["value"]}\n'
                    elif bucket in _BUCKET_CAL and agg in ("avg", "min", "max"):
                        if bucket == "1d":
                            bkt_expr = "datetime(ts,'start of day')"
                        elif bucket == "1w":
                            bkt_expr = "datetime(date(ts,'weekday 1'),'start of day')"
                        else:
                            bkt_expr = "datetime(strftime('%Y-%m-01 00:00:00', ts))"
                        sql = f"""
                        SELECT {bkt_expr} AS ts, ROUND({agg}(value), ?) AS value
                          FROM sensor_data
                         WHERE protocol=? AND address=? AND parameter=?
                           AND ts BETWEEN ? AND ?
                         GROUP BY {bkt_expr}
                         ORDER BY ts ASC
                         LIMIT ?
                        """
                        cur = conn.execute(sql, (rnd, proto, addr, param, t_from, t_to, limit))
                        for r in cur:
                            yield f'{r["ts"]},{proto},{addr},{param},{r["value"]}\n'
                    else:
                        # 其他组合暂不导出（避免产生不一致的 CSV 列数）
                        continue

    # 文件名：若只导出一个序列，用更具体的；否则使用多序列标记
    fname = "series.csv" if len(series_list) > 1 else f"{series_list[0][0]}-{series_list[0][1]}-{series_list[0][2]}.csv"
    return Response(_gen(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})
