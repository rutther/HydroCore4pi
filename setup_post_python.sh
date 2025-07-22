#!/usr/bin/env bash
set -e

echo ">> [1/2] 初始化数据库结构"
source .venv/bin/activate
python3 utils/db_init.py

echo ">> [2/2] 健康检查(可选扩展)"
# 可以添加其他自检步骤（如设备探测等）

echo "✅ 数据库初始化/自检完成"
