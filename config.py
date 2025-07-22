# config.py

import os

# ————— 数据库连接参数 —————
DB_TYPE = 'sqlite'
DB_PATH = os.path.abspath(os.getenv('SQLITE_DB_PATH', './data.db'))
