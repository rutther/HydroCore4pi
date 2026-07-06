import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).resolve().parents[1]

# deb 安装后由 systemd 环境文件覆盖：
#   HYDROCORE_DATA_DIR=/var/lib/hydrocore
#   HYDROCORE_CONFIG_DIR=/etc/hydrocore
#   HYDROCORE_DEFAULTS_DIR=/usr/share/hydrocore/defaults
# 开发模式不设置环境变量时，继续使用项目内目录。
DATA_DIR = Path(os.environ.get("HYDROCORE_DATA_DIR", BASE_DIR / "data")).resolve()
CONFIG_DIR = Path(os.environ.get("HYDROCORE_CONFIG_DIR", BASE_DIR / "tasks")).resolve()
DEFAULTS_DIR = Path(os.environ.get("HYDROCORE_DEFAULTS_DIR", BASE_DIR / "data")).resolve()
BUILTIN_PROTOCOL_DIR = Path(os.environ.get("HYDROCORE_PROTOCOL_DIR", BASE_DIR / "protocols")).resolve()
USER_PROTOCOL_DIR = Path(os.environ.get("HYDROCORE_USER_PROTOCOL_DIR", DATA_DIR / "protocols_user")).resolve()

DB_FILE  = DATA_DIR / "db" / "hydro.db"
LOG_DIR  = DATA_DIR / "logs"
POLL_PLAN_FILE = Path(os.environ.get("HYDROCORE_POLL_PLAN_FILE", CONFIG_DIR / "config_poll_plan.json")).resolve()
HOST = os.environ.get("HYDROCORE_HOST", "0.0.0.0")
PORT = int(os.environ.get("HYDROCORE_PORT", "5000"))

# 串口默认参数（可以被 API 入参覆盖）
SERIAL_DEFAULTS = {
    "baudrate": 9600,
    "timeout": 0.5,   # 秒
    "interval": 0.2   # 地址轮询间隔，秒
}
