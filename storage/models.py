"""
models: SQLAlchemy ORM 模型
后续根据业务需求定义表结构
"""
# TODO: 定义 SensorReading 等表

from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, Integer, Float, DateTime, String, Boolean

Base = declarative_base()

class SensorReading(Base):
    __tablename__ = 'sensor_readings'
    id        = Column(Integer, primary_key=True)
    sensor_id = Column(Integer, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    value     = Column(Float, nullable=False)

class SerialPortConfig(Base):
    __tablename__ = 'serial_ports'
    id       = Column(Integer, primary_key=True)
    name     = Column(String(50), nullable=False)     # 显示名称
    port     = Column(String(100), nullable=False)    # /dev/xxx 或 COMx
    baudrate = Column(Integer, nullable=False)
    bytesize = Column(Integer, default=8)
    parity   = Column(String(1), default='N')
    stopbits = Column(Integer, default=1)
    timeout  = Column(Float, default=1.0)
