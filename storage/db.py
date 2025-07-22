# storage/db.py

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import config

SQLALCHEMY_DATABASE_URL = f"sqlite:///{config.DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}  # SQLite 特有参数
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
