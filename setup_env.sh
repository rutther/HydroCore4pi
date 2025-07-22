#!/usr/bin/env bash
set -e

echo "========== HydroCore 一键初始化 =========="

# 步骤1：检查Python虚拟环境及依赖
bash setup_python_env.sh

# 步骤2：初始化/迁移SQLite数据库结构
bash setup_post_python.sh

echo "✅ 初始化流程全部完成。"

echo ">> 初始化 SQLite 数据库结构"
python3 -m utils.db_init