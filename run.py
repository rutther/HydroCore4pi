#!/usr/bin/env python3
"""
run.py: 启动脚本
TODO: 初始化 Flask 应用并注册 Blueprint
"""


#!/usr/bin/env python3
from utils.db_init import init_database
from flask import Flask
import config
from api.data_api import data_bp
from api.control_api import control_bp
from api.port_api import port_bp

# 开箱即用：自动建库建表并种子数据
init_database()

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = (
    f"mysql+pymysql://{config.DB_USER}:"
    f"{config.DB_PASSWORD}@{config.DB_HOST}:"
    f"{config.DB_PORT}/{config.DB_NAME}"
)

app.register_blueprint(data_bp, url_prefix='/api/data')
app.register_blueprint(control_bp, url_prefix='/api/control')
app.register_blueprint(port_bp,    url_prefix='/api/ports')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
