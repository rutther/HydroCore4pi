# utils/db_init.py

from storage.models import Base, SerialPortConfig
from storage.db import engine, SessionLocal
import config
import os

def init_database():
    # 1. 初始化所有表结构
    Base.metadata.create_all(bind=engine)

    # 2. 种子数据（如无任何串口配置，则插入后备默认值）
    db = SessionLocal()
    if db.query(SerialPortConfig).count() == 0:
        db.add(SerialPortConfig(
            name='默认串口',
            port=config.SERIAL_PORT_DEFAULT,
            baudrate=config.BAUDRATE_DEFAULT
        ))
        db.commit()
    db.close()

    print("✅ 数据库及默认串口配置已初始化完成")

if __name__ == '__main__':
    init_database()
