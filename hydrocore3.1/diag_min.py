#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, sys, json, sqlite3, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
def p(msg): print(msg, flush=True)

def try_import_app():
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    try:
        mod = __import__("backend.app", fromlist=["app"])
        app = getattr(mod, "app", None)
        return app, None
    except Exception:
        return None, traceback.format_exc()

def urlmap(app):
    lines = []
    try:
        for r in sorted(app.url_map.iter_rules(), key=lambda x: x.rule):
            lines.append(f"{sorted(list(r.methods))} -> {r.rule}")
    except Exception as e:
        lines.append("URL Map 读取失败：" + repr(e))
    return lines

def detect_db():
    cand = ROOT / "data" / "db" / "hydro.db"
    return cand if cand.exists() else None

def sql(db, q):
    with sqlite3.connect(str(db)) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(q).fetchall()]

if __name__ == "__main__":
    p("== 入口导入 ==")
    app, err = try_import_app()
    if app:
        p("backend.app:app 导入成功")
        for line in urlmap(app):
            p("  " + line)
    else:
        p("backend.app 导入失败：\n" + (err or ""))

    p("\n== 数据库检查 ==")
    db = detect_db()
    if not db:
        p("未发现 data/db/hydro.db（停机属正常场景）")
        sys.exit(0)
    p(f"数据库: {db}")
    try:
        t = sql(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='sensor_data';")
        p("sensor_data 表：" + ("存在" if t else "不存在"))
        if t:
            rng = sql(db, "SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts, COUNT(*) AS n FROM sensor_data;")
            p("全局范围/总数：" + json.dumps(rng[0], ensure_ascii=False))
    except Exception:
        p("数据库查询异常：\n" + traceback.format_exc())
