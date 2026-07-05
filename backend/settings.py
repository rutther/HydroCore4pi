from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).resolve().parents[1]

# 数据目录
DATA_DIR = BASE_DIR / "data"
DB_FILE  = DATA_DIR / "db" / "hydro.db"
LOG_DIR  = DATA_DIR / "logs"

# 串口默认参数（可以被 API 入参覆盖）
SERIAL_DEFAULTS = {
    "baudrate": 9600,
    "timeout": 0.5,   # 秒
    "interval": 0.2   # 地址轮询间隔，秒
}
