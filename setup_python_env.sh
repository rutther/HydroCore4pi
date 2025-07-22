#!/usr/bin/env bash
set -e

echo ">> [1/2] 检查 Python 虚拟环境"
if [ ! -d .venv ]; then
  echo "⚠️ 未检测到 .venv，自动初始化虚拟环境"
  python3 -m venv .venv
fi

source .venv/bin/activate

echo ">> [2/2] 检查 requirements.txt"
if [ ! -f requirements.txt ]; then
  echo "❌ 未找到 requirements.txt，无法继续"
  exit 1
fi

echo ">> 检查网络连通性"
if ping -c 1 pypi.org >/dev/null 2>&1; then
  echo "→ 网络正常，使用官方源安装依赖"
  pip install --upgrade pip
  pip install -r requirements.txt
else
  echo "→ 网络不可用，尝试本地 vendor 离线包安装"
  if [ ! -d vendor ]; then
    echo "❌ vendor 目录不存在，无法离线安装依赖"
    exit 2
  fi
  pip install --upgrade pip
  pip install --no-index --find-links=vendor -r requirements.txt
fi

echo "✅ Python 环境与依赖检查/补全完成"
