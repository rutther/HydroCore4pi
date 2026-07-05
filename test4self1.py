#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HydroCore 3.1 现场体检脚本
作用：
1) 无侵入扫描：目录、关键文件、Python版本、依赖版本（若能导入）。
2) 尝试导入 backend.app:app，打印 URL Map；失败则完整异常回溯。
3) SQLite 数据库体检：表/索引存在性、最早/最晚时间、近1小时数据分布。
4) 计划文件体检：tasks/config_poll_plan.json 是否存在、基本合法性与统计。
5) 输出总结：P0/P1/P2 所需的最小修复清单（基于检测结果推断）。

运行：
python3 hydro_diag.py
"""

import os
import sys
import json
import traceback
import sqlite3
import importlib
from pathlib import Path
from datetime import datetime, timedelta

ROOT = Path(__file__).resolve().parent

def print_header(title):
    print("\n" + "=" * 80)
    print(title)
    print("=" * 80)

def find_path(*parts):
    p = ROOT.joinpath(*parts)
    return p if p.exists() else None

def try_import_app():
    # 兼容两种导入方式：包方式 backend.app / 直接路径加入sys.path
    backend_dir = find_path("backend")
    if backend_dir and str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    try:
        mod = importlib.import_module("backend.app")
        app = getattr(mod, "app", None)
        return app, None
    except Exception as e:
        return None, traceback.format_exc()

def url_map_to_lines(app):
    # 兼容 Flask 不同版本的 url_map
    rules = []
    for r in sorted(app.url_map.iter_rules(), key=lambda x: x.rule):
        methods = sorted(list(r.methods))
        rules.append(f"{methods} -> {r.rule}")
    return rules

def detect_sqlite():
    # 优先环境变量，其次默认路径
    db_env = os.environ.get("HYDRO_DB")
    default_db = find_path("data", "db", "hydro.db")
    cand = Path(db_env) if db_env else (default_db if default_db else None)
    if not cand:
        return None, "数据库文件未找到（既无 $HYDRO_DB，亦无 data/db/hydro.db）"
    exists = cand.exists()
    return cand, None if exists else f"数据库文件不存在: {cand}"

def sqlite_exec(db_path, sql, params=()):
    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]

def check_table_and_index(db_path):
    info = {}
    # 表存在性
    t = sqlite_exec(db_path, "SELECT name FROM sqlite_master WHERE type='table' AND name='sensor_data';")
    info["table_exists"] = len(t) == 1
    # 索引存在性（复合索引）
    idx = sqlite_exec(db_path, "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_series_ts';")
    info["index_exists"] = len(idx) == 1
    # 统计极值
    if info["table_exists"]:
        rng = sqlite_exec(db_path, "SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts, COUNT(*) AS n FROM sensor_data;")
        info["range"] = rng[0]
        # 最近1小时分布
        recent = sqlite_exec(db_path, """
            SELECT protocol, address, parameter, COUNT(*) AS n
            FROM sensor_data
            WHERE ts >= strftime('%Y-%m-%d %H:%M:%S','now','localtime','-1 hour')
            GROUP BY protocol, address, parameter
            ORDER BY protocol, address, parameter;
        """)
        info["recent_1h"] = recent
        # 任意选一条序列做采样检查
        one = sqlite_exec(db_path, """
            SELECT protocol, address, parameter, COUNT(*) AS n
            FROM sensor_data
            GROUP BY protocol, address, parameter
            ORDER BY n DESC LIMIT 1;
        """)
        if one:
            p,a,pm = one[0]["protocol"], one[0]["address"], one[0]["parameter"]
            sample = sqlite_exec(db_path, """
                SELECT ts, value FROM sensor_data
                WHERE protocol=? AND address=? AND parameter=?
                ORDER BY ts DESC LIMIT 5;
            """, (p,a,pm))
            info["sample_series"] = {"series": f"{p}:{a}:{pm}", "last5": sample}
    return info

def detect_plan():
    p = find_path("tasks", "config_poll_plan.json")
    if not p:
        return None, "缺少 tasks/config_poll_plan.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None, f"计划文件无法解析为 JSON：{p}"
    # 粗检
    plans = data.get("plans", [])
    meta = data.get("__meta__", {})
    return {"path": str(p), "plans_count": len(plans), "has_meta": bool(meta)}, None

def main():
    print_header("基本信息")
    print(f"项目根目录: {ROOT}")
    print(f"Python: {sys.version}")
    print(f"平台: {sys.platform}")
    print(f"时间(本地): {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    print_header("目录与关键文件探测")
    for rel in [
        ("backend",),
        ("backend","app.py"),
        ("backend","db.py"),
        ("backend","api","data_api.py"),
        ("backend","api","meta_api.py"),
        ("backend","tasks","config_poller.py"),
        ("ui",),
        ("ui","index.html"),
        ("ui","app.js"),
        ("tasks","config_poll_plan.json"),
        ("protocols",),
        ("data","db","hydro.db"),
    ]:
        p = find_path(*rel)
        print(f"{'/'.join(rel):<40} -> {'OK' if p else 'MISSING'}")

    print_header("Flask 入口导入尝试（backend.app:app）")
    app, err = try_import_app()
    if app:
        print("导入成功：app 对象存在。URL Map：")
        try:
            for line in url_map_to_lines(app):
                print("  " + line)
        except Exception as e:
            print("URL Map 枚举失败：", repr(e))
    else:
        print("导入失败，堆栈如下：")
        print(err)

    print_header("SQLite 数据库体检")
    db_path, db_err = detect_sqlite()
    if db_err:
        print(db_err)
    else:
        print(f"数据库路径: {db_path}")
        try:
            info = check_table_and_index(db_path)
            print(json.dumps(info, ensure_ascii=False, indent=2))
        except Exception:
            print("数据库检查异常：")
            print(traceback.format_exc())

    print_header("计划文件体检")
    plan_info, plan_err = detect_plan()
    if plan_err:
        print(plan_err)
    else:
        print(json.dumps(plan_info, ensure_ascii=False, indent=2))

    print_header("初步修复任务清单（根据检测结果人工核对）")
    print("- 若 Flask 导入失败：定位报错文件与行，修复蓝图注册或循环导入。")
    print("- 若 URL Map 缺失 /api/v1/meta/* 或 /api/v1/data/*：补齐对应蓝图。")
    print("- 若 SQLite 缺表/缺索引：执行初始化迁移，创建表与 idx_series_ts。")
    print("- 若 1h 内无数据：暂以仿真写入验证前端（后续恢复轮询器）。")
    print("- 若 计划文件缺失或 plans=0：补一份最小 plan，使 /meta/plan_view 可返回。")

if __name__ == "__main__":
    main()
