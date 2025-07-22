
# TODO: 实现 check_env() 函数

#!/usr/bin/env python3
import os
import sys

# 把项目根目录（utils 的上一级）加入模块搜索路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import importlib
import serial
from storage.db import engine
import config

def check_dependencies():
    for pkg in [
        'flask',
        'sqlalchemy',
        'pymysql',
        'minimalmodbus',
        'apscheduler',
        'serial'
    ]:
        importlib.import_module(pkg)

def check_serial():
    try:
        ser = serial.Serial(
            config.SERIAL_PORT_DEFAULT,
            config.BAUDRATE_DEFAULT,
            timeout=1
        )
        ser.close()
    except Exception as e:
        raise RuntimeError(f"串口检测失败：{e}")

def check_database():
    conn = engine.connect()
    conn.close()

if __name__ == '__main__':
    try:
        print("→ 检查依赖包...")
        check_dependencies()
        print("   ✔ OK")
        print("→ 检查串口...")
        check_serial()
        print("   ✔ OK")
        print("→ 检查数据库连接...")
        check_database()
        print("   ✔ OK")
        print("🎉 系统自检通过")
    except Exception as e:
        print("❌ 自检失败：", e)
        sys.exit(1)
