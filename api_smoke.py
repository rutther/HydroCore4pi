#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
目的：
1) 实发 HTTP 调用校验 /meta 与 /data 端点的最小闭环。
2) 兼容“最近无数据”的情况：只要能列出 series，并能取到该 series 的 overall 窗口或 last_ts 即为通过。
3) 自动选择第一个 series 做一次 range 与 series 拉取（窗口用 overall，避免近窗为空）。
"""

import json
import urllib.request
import urllib.parse

BASE = "http://127.0.0.1:5000"

def GET(path, params=None):
    url = BASE + path
    if params:
        q = urllib.parse.urlencode(params)
        url += ("?" + q)
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.getcode(), r.read().decode("utf-8")

def main():
    print("== /api/v1/meta/plan_view ==")
    code, body = GET("/api/v1/meta/plan_view")
    print(code)
    print(body[:200])

    print("\n== /api/v1/meta/series ==")
    code, body = GET("/api/v1/meta/series")
    print(code)
    data = json.loads(body)
    print("series count:", len(data.get("series", [])))
    
    # 修改：处理 "series" 数据结构，避免 KeyError
    series_list = data.get("series", [])
    if not series_list:
        print("无 series（若历史库为空则属正常；否则需要检查写库环节）。")
        return

    # 取第一条 series，字段名按你的实现可能是 {protocol,address,parameter,first_ts,last_ts,n}
    s0 = series_list[0]
    proto = s0.get("protocol")
    addr = s0.get("address")
    param = s0.get("parameter")
    if not all([proto is not None, addr is not None, param is not None]):
        print("meta/series 返回结构与预期不同，需看后端代码。返回示例：", s0)
        return
    s_token = f"{proto}:{addr}:{param}"
    print("pick series:", s_token)

    print("\n== /api/v1/data/range ==")
    code, body = GET("/api/v1/data/range", {"s": s_token})
    print(code, body[:200])
    rng = json.loads(body)
    # 兼容实现差异：可能是 {overall:{first_ts,last_ts}} 或 {first_ts,last_ts}
    if "overall" in rng:
        first = rng["overall"].get("first_ts")
        last = rng["overall"].get("last_ts")
    else:
        first = rng.get("first_ts")
        last = rng.get("last_ts")
    print("window:", first, "→", last)

    # 若窗口存在，按 overall 全量拉一次稀疏桶，避免点数过多
    if first and last:
        print("\n== /api/v1/data/series ==")
        q = {
            "s": s_token,
            "bucket": "1h",     # 使用小时桶，降低点数
            "agg": "avg",
            "from": first,
            "to": last,
            "round": 3,
        }
        code, body = GET("/api/v1/data/series", q)
        print(code)
        print(body[:200])
    else:
        print("range 未返回窗口（库中可能有 series 元信息但无点，或实现差异），需看后端代码结构。")

if __name__ == "__main__":
    main()
