# 文件：backend/tasks/config_poller.py
# 职责：常驻采集器。按 tasks/config_poll_plan.json 周期性采样（sampling_sec），
#       在 persist_sec 对齐落库：连续量写 avg（四舍五入 round_to），状态量（如 warning）写 last。
#       支持参数级 event_only（nonzero / change / nonzero_or_change）。
#       计划热重载；基本留存/容量控制（retention_days / max_db_mb）。
#
# 依赖：start_config_get（逐参数 0x03 读取）、get_conn/init_db、port_lock（间接在读取服务里用）

import os, json, time, datetime
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

from ..db import get_conn, init_db
from ..services.config_get_service import start_config_get
from .. import settings

# ---------- 路径 ----------
PLAN_FILE = settings.POLL_PLAN_FILE
DB_FILE   = settings.DB_FILE

# ---------- 默认策略（可被 __meta__ 覆盖） ----------
DEFAULT_SAMPLING_SEC     = 3
DEFAULT_PERSIST_SEC      = 10
DEFAULT_ROUND_TO         = 3
ALIGN_PERSIST_TO_WALL    = True

RETENTION_DAYS           = 400
MAX_DB_MB                = 10240
CLEAN_INTERVAL_SEC       = 60
ENABLE_VACUUM            = False
VACUUM_EVERY_N_CLEAN     = 20

MAIN_TICK_SEC            = 0.5

# ---------- 采样窗口（内存中） ----------
# key: (protocol, addr, param) -> 累计器 {win_start_ts, sum, cnt, min, max, last}
Accumulator = Dict[str, Any]
WINDOWS: Dict[Tuple[str,int,str], Accumulator] = {}

# 上次成功持久化的值（用于 event_only=change 判断）
LAST_PERSISTED: Dict[Tuple[str,int,str], Any] = {}

class CompiledPlan:
    """编译后的计划项"""
    def __init__(self, raw: List[Dict], meta: Dict[str, Any]) -> None:
        self.raw = raw
        self.meta = meta or {}

        self.default_sampling_sec = float(self.meta.get("default_sampling_sec", DEFAULT_SAMPLING_SEC))
        self.default_persist_sec  = float(self.meta.get("default_persist_sec",  DEFAULT_PERSIST_SEC))
        self.default_round_to     = int(self.meta.get("default_round_to",      DEFAULT_ROUND_TO))
        self.align_to_wall        = bool(self.meta.get("align_persist_to_wall", ALIGN_PERSIST_TO_WALL))

        self.retention_days       = int(self.meta.get("retention_days", RETENTION_DAYS))
        self.max_db_mb            = int(self.meta.get("max_db_mb",     MAX_DB_MB))

        self.entries: List[Dict[str, Any]] = []   # 每个计划项
        self.sample_due: List[float] = []         # 下一次采样时间戳
        self.flush_due:  List[float] = []         # 下一次落库时间戳（对齐 persist_sec）

    def _norm_param(self, p) -> Dict[str, Any]:
        # 接受 "measurement" 或 {"name":"measurement",...}
        if isinstance(p, str):
            return {"name": p, "round_to": self.default_round_to}
        elif isinstance(p, dict) and "name" in p:
            o = dict(p)
            if "round_to" not in o:
                o["round_to"] = self.default_round_to
            return o
        else:
            raise ValueError(f"无效的 parameters 项: {p}")

    def _compile_entry(self, e: Dict[str, Any]) -> Dict[str, Any]:
        proto = e["protocol"]
        addr  = int(e["address"])
        port  = e["port"]

        sampling_sec = float(e.get("sampling_sec", self.default_sampling_sec))
        persist_sec  = float(e.get("persist_sec",  self.default_persist_sec))
        baud  = int(e.get("baudrate", 9600))
        tout  = float(e.get("timeout", 0.5))

        params = [self._norm_param(p) for p in e.get("parameters", [])]

        return {
            "protocol": proto,
            "address":  addr,
            "port":     port,
            "sampling_sec": sampling_sec,
            "persist_sec":  persist_sec,
            "baudrate": baud,
            "timeout":  tout,
            "parameters": params
        }

    def compile(self) -> None:
        self.entries.clear()
        self.sample_due.clear()
        self.flush_due.clear()

        now = time.time()
        for e in self.raw:
            ent = self._compile_entry(e)
            self.entries.append(ent)
            # 采样：立即可执行
            self.sample_due.append(now)
            # 落库：对齐墙钟或相对 now
            if self.align_to_wall:
                ps = ent["persist_sec"]
                self.flush_due.append(((int(now) // int(ps)) * int(ps)) + int(ps))
            else:
                self.flush_due.append(now + float(ent["persist_sec"]))


def _load_plan() -> CompiledPlan:
    data = json.load(open(PLAN_FILE, encoding="utf8"))
    if isinstance(data, list):
        meta = {}
        plans = data
    elif isinstance(data, dict) and "plans" in data:
        meta = data.get("__meta__", {}) or {}
        plans = data["plans"]
        if not isinstance(plans, list):
            raise RuntimeError("plans 字段必须为数组")
    else:
        raise RuntimeError("计划文件格式不正确，应为数组或含 plans 的对象")

    cp = CompiledPlan(plans, meta)
    cp.compile()
    return cp


def _file_size_mb(path: Path) -> float:
    try:
        return os.path.getsize(path) / (1024 * 1024)
    except FileNotFoundError:
        return 0.0


def _rebuild_series_summary(conn) -> None:
    conn.execute("DELETE FROM sensor_series_summary")
    conn.execute("""
        INSERT INTO sensor_series_summary(protocol,address,parameter,first_ts,last_ts,n)
        SELECT protocol, address, parameter,
               MIN(ts) AS first_ts,
               MAX(ts) AS last_ts,
               COUNT(*) AS n
          FROM sensor_data
         GROUP BY protocol, address, parameter
    """)


def _retention_clean(retention_days: int, max_db_mb: int, vac_state: Dict[str,int]) -> None:
    now = datetime.datetime.now()
    cutoff = (now - datetime.timedelta(days=retention_days)).strftime("%Y-%m-%d %H:%M:%S")
    changed = False
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM sensor_data WHERE ts < ?", (cutoff,))
        changed = changed or (cur.rowcount > 0)
        if changed:
            _rebuild_series_summary(conn)
        conn.commit()

    mb = _file_size_mb(DB_FILE)
    while mb > max_db_mb:
        with get_conn() as conn:
            cur = conn.execute("""
                DELETE FROM sensor_data
                 WHERE rowid IN (
                   SELECT rowid FROM sensor_data ORDER BY ts ASC LIMIT 50000
                 )
            """)
            if cur.rowcount > 0:
                _rebuild_series_summary(conn)
            conn.commit()
        mb = _file_size_mb(DB_FILE)

    if ENABLE_VACUUM:
        vac_state["n"] = vac_state.get("n", 0) + 1
        if vac_state["n"] >= VACUUM_EVERY_N_CLEAN:
            with get_conn() as conn:
                conn.execute("VACUUM")
            vac_state["n"] = 0


def _acc_key(proto: str, addr: int, pname: str) -> Tuple[str,int,str]:
    return (proto, addr, pname)


def _win_start(ts: float, persist_sec: float, align_to_wall: bool) -> int:
    if align_to_wall:
        p = int(persist_sec)
        return (int(ts) // p) * p
    else:
        # 不对齐墙钟时，按“当前 flush_due - persist_sec”为窗口起点
        return int(ts) - int(persist_sec)


def _add_sample(proto: str, addr: int, pname: str, val: float,
                ts_now: float, persist_sec: float, align_to_wall: bool) -> None:
    key = _acc_key(proto, addr, pname)
    win_start = _win_start(ts_now, persist_sec, align_to_wall)
    acc = WINDOWS.get(key)

    if (not acc) or (acc["win_start_ts"] != win_start):
        # 新窗口
        WINDOWS[key] = {
            "win_start_ts": win_start,
            "sum": float(val),
            "cnt": 1,
            "min": float(val),
            "max": float(val),
            "last": float(val)
        }
    else:
        # 同一窗口累加
        acc["sum"] += float(val)
        acc["cnt"] += 1
        if val < acc["min"]: acc["min"] = float(val)
        if val > acc["max"]: acc["max"] = float(val)
        acc["last"] = float(val)





def _flush_window(ent: Dict[str, Any], ts_flush: int) -> List[Tuple[str,int,str,str,float]]:
    """
    对一个计划项的所有参数，把当前窗口的数据按规则落库。
    返回待写 rows: (protocol, address, parameter, ts_str, value)
    ts_flush 统一作为本窗口标签时间（对齐）；窗口起点应为 ts_flush - persist_sec
    """
    rows: List[Tuple[str,int,str,str,float]] = []
    proto = ent["protocol"]; addr = ent["address"]
    ts_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts_flush))

    # 关键修复：按窗口“起点”匹配，而不是拿 ts_flush 当起点
    persist_sec = int(float(ent["persist_sec"]))
    window_start = ts_flush - persist_sec

    for p in ent["parameters"]:
        pname = p["name"]
        round_to = int(p.get("round_to", DEFAULT_ROUND_TO))
        agg_mode = p.get("agg_mode", "avg")   # 连续量 avg；状态量 last
        event_only = p.get("event_only")      # None | "nonzero" | "change" | "nonzero_or_change"

        key = _acc_key(proto, addr, pname)
        acc = WINDOWS.get(key)
        if (not acc) or (acc["win_start_ts"] != window_start):
            # 这个参数在本窗口没有样本，跳过
            continue








        # 聚合
        if agg_mode == "last":
            val = acc["last"]
        else:
            # 默认 avg
            cnt = max(1, acc["cnt"])
            val = acc["sum"] / cnt

        # 四舍五入
        try:
            val_rounded = round(float(val), round_to)
        except Exception:
            val_rounded = float(val)

        # 事件存储判断（仅在 warning 等需要时启用）
        should_write = True
        if event_only:
            lp = LAST_PERSISTED.get(key)
            if event_only == "nonzero":
                should_write = (val_rounded != 0)
            elif event_only == "change":
                should_write = (lp is None) or (val_rounded != lp["value"])
            elif event_only == "nonzero_or_change":
                nonzero = (val_rounded != 0)
                changed = (lp is None) or (val_rounded != lp["value"])
                should_write = nonzero or changed
            else:
                should_write = True

        if should_write:
            rows.append((proto, addr, pname, ts_str, float(val_rounded)))
            LAST_PERSISTED[key] = {"value": val_rounded, "ts": ts_str}

        # 清理窗口（只清当前窗口，后续新窗口会重建）
        del WINDOWS[key]

    return rows


def _insert_points(rows: List[Tuple[str,int,str,str,float]]) -> None:
    if not rows:
        return
    with get_conn() as conn:
        conn.executemany("""
            INSERT INTO sensor_data(protocol,address,parameter,ts,value)
            VALUES(?,?,?,?,?)
        """, rows)
        summary: Dict[Tuple[str,int,str], Dict[str, Any]] = {}
        for proto, addr, pname, ts_str, _val in rows:
            key = (proto, addr, pname)
            rec = summary.get(key)
            if not rec:
                summary[key] = {"first_ts": ts_str, "last_ts": ts_str, "n": 1}
            else:
                if ts_str < rec["first_ts"]:
                    rec["first_ts"] = ts_str
                if ts_str > rec["last_ts"]:
                    rec["last_ts"] = ts_str
                rec["n"] += 1

        conn.executemany("""
            INSERT INTO sensor_series_summary(protocol,address,parameter,first_ts,last_ts,n)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(protocol,address,parameter) DO UPDATE SET
              first_ts = CASE
                WHEN sensor_series_summary.first_ts IS NULL THEN excluded.first_ts
                WHEN excluded.first_ts IS NULL THEN sensor_series_summary.first_ts
                WHEN excluded.first_ts < sensor_series_summary.first_ts THEN excluded.first_ts
                ELSE sensor_series_summary.first_ts
              END,
              last_ts = CASE
                WHEN sensor_series_summary.last_ts IS NULL THEN excluded.last_ts
                WHEN excluded.last_ts IS NULL THEN sensor_series_summary.last_ts
                WHEN excluded.last_ts > sensor_series_summary.last_ts THEN excluded.last_ts
                ELSE sensor_series_summary.last_ts
              END,
              n = sensor_series_summary.n + excluded.n
        """, [
            (proto, addr, pname, rec["first_ts"], rec["last_ts"], rec["n"])
            for (proto, addr, pname), rec in summary.items()
        ])
        conn.commit()






def main(stop_evt=None):
    """
    可停止的 poller 主循环：
    - stop_evt 为 threading.Event；置位后退出循环
    - 未传入则创建一个永不置位的 Event（兼容旧直接运行）
    """



    import threading
    if stop_evt is None:
        stop_evt = threading.Event()

    print(f"[poller] 启动，计划文件: {PLAN_FILE}")
    init_db()

    last_plan_mtime = None
    plan: Optional[CompiledPlan] = None
    last_clean = 0.0
    vac_state: Dict[str,int] = {}

    while not stop_evt.is_set():
        try:
            # 1) 热重载
            try:
                mtime = os.path.getmtime(PLAN_FILE)
            except FileNotFoundError:
                mtime = None

            if mtime != last_plan_mtime:
                # 切换计划前 flush 一次
                if plan is not None:
                    now_aligned = int(time.time())
                    for idx, ent in enumerate(plan.entries):
                        rows = _flush_window(ent, now_aligned)
                        _insert_points(rows)

                plan = _load_plan()
                last_plan_mtime = mtime
                print(f"[poller] 计划已加载：{len(plan.entries)} 项 "
                      f"(sampling_def={plan.default_sampling_sec}s, persist_def={plan.default_persist_sec}s, "
                      f"round_def={plan.default_round_to}, retention={plan.retention_days}d, max={plan.max_db_mb}MB)")

            # 没有 plan 就小睡（避免 NoneType）
            if plan is None:
                time.sleep(0.5)
                continue

            now = time.time()

            # 2) 到点采样
            for idx, ent in enumerate(plan.entries):
                if stop_evt.is_set():
                    break
                if now >= plan.sample_due[idx]:
                    names = [p["name"] for p in ent["parameters"]]
                    result = start_config_get({
                        "port": ent["port"],
                        "baudrate": ent["baudrate"],
                        "timeout": ent["timeout"],
                        "items": [{
                            "protocol": ent["protocol"],
                            "address":  ent["address"],
                            "port":     ent["port"],
                            "parameters": names
                        }]
                    })

                    # start_config_get 可能返回 {"status":"error"...}（例如 PortBusy）
                    if result.get("status") == "ok":
                        ts_now = now
                        for rec in result.get("results", []):
                            if rec.get("status") != "success":
                                continue
                            pname = rec["parameter"]
                            val   = float(rec["value"])
                            _add_sample(ent["protocol"], ent["address"], pname, val,
                                        ts_now, float(ent["persist_sec"]), plan.align_to_wall)

                    plan.sample_due[idx] = now + float(ent["sampling_sec"])

            # 3) 到点落库
            for idx, ent in enumerate(plan.entries):
                if stop_evt.is_set():
                    break
                if now >= plan.flush_due[idx]:
                    flush_ts = int(plan.flush_due[idx])
                    rows = _flush_window(ent, flush_ts)
                    _insert_points(rows)

                    ps = float(ent["persist_sec"])
                    if plan.align_to_wall:
                        plan.flush_due[idx] = flush_ts + int(ps)
                    else:
                        plan.flush_due[idx] = now + ps

            # 4) 留存/容量检查
            if (time.time() - last_clean) >= CLEAN_INTERVAL_SEC:
                _retention_clean(plan.retention_days, plan.max_db_mb, vac_state)
                last_clean = time.time()

            time.sleep(MAIN_TICK_SEC)

        except KeyboardInterrupt:
            print("[poller] 停止（Ctrl+C）。")
            break
        except Exception as e:
            # 这里不吞掉 stop
            print(f"[poller] 异常: {type(e).__name__}: {e}")
            time.sleep(1.0)

    print("[poller] stop_evt 已触发，主循环退出。")

# 4.2全局串口相关
# def main():
#     print(f"[poller] 启动，计划文件: {PLAN_FILE}")
#     init_db()

#     last_plan_mtime = None
#     plan: Optional[CompiledPlan] = None
#     last_clean = 0.0
#     vac_state: Dict[str,int] = {}

#     while True:
#         try:
#             # 1) 热重载
#             try:
#                 mtime = os.path.getmtime(PLAN_FILE)
#             except FileNotFoundError:
#                 mtime = None

#             if mtime != last_plan_mtime:
#                 # 在切换计划前，强制把所有当前窗口 flush 一次，避免丢数据
#                 if plan is not None:
#                     now_aligned = int(time.time())
#                     for idx, ent in enumerate(plan.entries):
#                         rows = _flush_window(ent, now_aligned)
#                         _insert_points(rows)

#                 plan = _load_plan()
#                 last_plan_mtime = mtime
#                 print(f"[poller] 计划已加载：{len(plan.entries)} 项 "
#                       f"(sampling_def={plan.default_sampling_sec}s, persist_def={plan.default_persist_sec}s, "
#                       f"round_def={plan.default_round_to}, retention={plan.retention_days}d, max={plan.max_db_mb}MB)")

#             now = time.time()

#             # 2) 到点采样
#             for idx, ent in enumerate(plan.entries):
#                 if now >= plan.sample_due[idx]:
#                     names = [p["name"] for p in ent["parameters"]]
#                     result = start_config_get({
#                         "port": ent["port"],
#                         "baudrate": ent["baudrate"],
#                         "timeout": ent["timeout"],
#                         "items": [{
#                             "protocol": ent["protocol"],
#                             "address":  ent["address"],
#                             "port":     ent["port"],
#                             "parameters": names
#                         }]
#                     })
#                     # 累加到当前窗口
#                     ts_now = now
#                     for rec in result.get("results", []):
#                         if rec.get("status") != "success":
#                             continue
#                         pname = rec["parameter"]
#                         val   = float(rec["value"])
#                         _add_sample(ent["protocol"], ent["address"], pname, val,
#                                     ts_now, float(ent["persist_sec"]), plan.align_to_wall)

#                     plan.sample_due[idx] = now + float(ent["sampling_sec"])

#             # 3) 到点落库（对齐 persist_sec）
#             for idx, ent in enumerate(plan.entries):
#                 if now >= plan.flush_due[idx]:
#                     flush_ts = int(plan.flush_due[idx])
#                     rows = _flush_window(ent, flush_ts)
#                     _insert_points(rows)

#                     # 下一次 flush
#                     ps = float(ent["persist_sec"])
#                     if plan.align_to_wall:
#                         plan.flush_due[idx] = flush_ts + int(ps)
#                     else:
#                         plan.flush_due[idx] = now + ps

#             # 4) 留存/容量检查
#             if (time.time() - last_clean) >= CLEAN_INTERVAL_SEC:
#                 _retention_clean(plan.retention_days, plan.max_db_mb, vac_state)
#                 last_clean = time.time()

#             time.sleep(MAIN_TICK_SEC)

#         except KeyboardInterrupt:
#             print("[poller] 停止（Ctrl+C）。")
#             break
#         except Exception as e:
#             print(f"[poller] 异常: {type(e).__name__}: {e}")
#             time.sleep(1.0)









# 4.3-1
# import threading


# class DataCollectorThread(threading.Thread):
#     """
#     Poller 线程包装：
#     - 通过 stop_evt 控制 main(stop_evt) 退出
#     - stop() 只负责置位；join 由调用方决定
#     """
#     def __init__(self):
#         super().__init__()
#         self._stop_evt = threading.Event()

#     def run(self):
#         main(self._stop_evt)

#     def stop(self):
#         self._stop_evt.set()

# 4.2之前的原版
# class DataCollectorThread(threading.Thread):

#     def __init__(self):
#         super().__init__()
#         self._stop = threading.Event()

#     def run(self):
#         while not self._stop.is_set():
#             try:
#                 main()
#             except Exception:
#                 pass

#     def stop(self):
#         self._stop.set()




# 4.3-2
# if __name__ == "__main__":
#     main()


import threading
import traceback

def run_poller(stop_event: threading.Event) -> None:
    """
    可停止的 poller 运行循环：
    - 复用你原来的 main() 逻辑，但把 while True 改为 stop_event 可控
    - 任何异常打印后短暂停顿，避免狂刷日志
    """
    print(f"[poller] 启动，计划文件: {PLAN_FILE}")
    init_db()

    last_plan_mtime = None
    plan: Optional[CompiledPlan] = None
    last_clean = 0.0
    vac_state: Dict[str,int] = {}

    while not stop_event.is_set():
        try:
            # 1) 热重载
            try:
                mtime = os.path.getmtime(PLAN_FILE)
            except FileNotFoundError:
                mtime = None

            if mtime != last_plan_mtime:
                # 在切换计划前，强制把所有当前窗口 flush 一次，避免丢数据
                if plan is not None:
                    now_aligned = int(time.time())
                    for idx, ent in enumerate(plan.entries):
                        rows = _flush_window(ent, now_aligned)
                        _insert_points(rows)

                plan = _load_plan()
                last_plan_mtime = mtime
                print(f"[poller] 计划已加载：{len(plan.entries)} 项 "
                      f"(sampling_def={plan.default_sampling_sec}s, persist_def={plan.default_persist_sec}s, "
                      f"round_def={plan.default_round_to}, retention={plan.retention_days}d, max={plan.max_db_mb}MB)")

            # plan 仍可能为 None（例如计划文件不存在/格式错误），此时不采样
            if plan is None:
                stop_event.wait(1.0)
                continue

            now = time.time()

            # 2) 到点采样
            for idx, ent in enumerate(plan.entries):
                if now >= plan.sample_due[idx]:
                    names = [p["name"] for p in ent["parameters"]]
                    result = start_config_get({
                        "port": ent["port"],
                        "baudrate": ent["baudrate"],
                        "timeout": ent["timeout"],
                        "items": [{
                            "protocol": ent["protocol"],
                            "address":  ent["address"],
                            "port":     ent["port"],
                            "parameters": names
                        }]
                    })

                    ts_now = now
                    for rec in result.get("results", []):
                        if rec.get("status") != "success":
                            continue
                        pname = rec["parameter"]
                        val   = float(rec["value"])
                        _add_sample(ent["protocol"], ent["address"], pname, val,
                                    ts_now, float(ent["persist_sec"]), plan.align_to_wall)

                    plan.sample_due[idx] = now + float(ent["sampling_sec"])

            # 3) 到点落库（对齐 persist_sec）
            for idx, ent in enumerate(plan.entries):
                if now >= plan.flush_due[idx]:
                    flush_ts = int(plan.flush_due[idx])
                    rows = _flush_window(ent, flush_ts)
                    _insert_points(rows)

                    ps = float(ent["persist_sec"])
                    if plan.align_to_wall:
                        plan.flush_due[idx] = flush_ts + int(ps)
                    else:
                        plan.flush_due[idx] = now + ps

            # 4) 留存/容量检查
            if (time.time() - last_clean) >= CLEAN_INTERVAL_SEC:
                _retention_clean(plan.retention_days, plan.max_db_mb, vac_state)
                last_clean = time.time()

            # 让 stop_event 有机会打断 sleep
            stop_event.wait(MAIN_TICK_SEC)

        except Exception as e:
            print(f"[poller] 异常: {type(e).__name__}: {e}")
            # 可选：打印堆栈（强烈建议保留，方便定位真实串口异常）
            print(traceback.format_exc())
            stop_event.wait(1.0)

    print("[poller] 已停止（stop_event）。")


class DataCollectorThread(threading.Thread):
    """
    采集线程：生命周期附属于 Flask 主进程
    stop() 会让 run_poller 退出，串口锁释放，其他串口操作才会恢复。
    """
    def __init__(self):
        super().__init__()
        self._stop_evt = threading.Event()

    def run(self):
        run_poller(self._stop_evt)

    def stop(self):
        self._stop_evt.set()


if __name__ == "__main__":
    # 直接运行脚本时：Ctrl+C 退出
    evt = threading.Event()
    try:
        run_poller(evt)
    except KeyboardInterrupt:
        evt.set()
