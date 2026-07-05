import datetime
import serial
from ..db import get_conn
from ..utils.locks import port_lock
from .serial_modbus import probe_one

def now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def start_scan_job(cfg: dict) -> dict:
    """
    cfg 结构：
    {
      'port': '/dev/ttyACM0',
      'start_address': 1,
      'end_address': 10,
      'baudrate': 9600,
      'timeout': 0.5,
      'interval': 0.2
    }
    同步执行扫描，结束后返回 job 概要。
    """
    port = cfg["port"]
    start_address = int(cfg["start_address"])
    end_address   = int(cfg["end_address"])
    baudrate = int(cfg.get("baudrate", 9600))
    timeout  = float(cfg.get("timeout", 0.5))
    interval = float(cfg.get("interval", 0.2))

    # 1) 建立 job，状态 running
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO scan_job
            (port, start_address, end_address, baudrate, timeout, interval, ts_start, status)
            VALUES(?,?,?,?,?,?,?,?)
        """, (port, start_address, end_address, baudrate, timeout, interval, now(), "running"))
        job_id = cur.lastrowid
        conn.commit()

    # 2) 串口独占执行扫描
    lock = port_lock(port)
    count_ok = 0
    err_msg  = None

    with lock:
        try:
            with serial.Serial(port, baudrate=baudrate, timeout=timeout) as ser:
                for addr in range(start_address, end_address + 1):
                    ok, raw_hex, latency_ms, _ = probe_one(ser, addr, interval)
                    if ok:
                        count_ok += 1
                        with get_conn() as conn:
                            conn.execute("""
                                INSERT INTO scan_hit(job_id, address, raw_hex, latency_ms, ok)
                                VALUES(?,?,?,?,1)
                            """, (job_id, addr, raw_hex, latency_ms))
                            conn.commit()
        except Exception as e:
            err_msg = f"{type(e).__name__}: {e}"

    # 3) 收尾更新 job 状态
    with get_conn() as conn:
        status = "ok" if err_msg is None else ("serial_error" if "Serial" in (err_msg or "") else "failed")
        conn.execute("""
            UPDATE scan_job
               SET ts_end = ?, status = ?, message = ?
             WHERE id = ?
        """, (now(), status, err_msg, job_id))
        conn.commit()

    return {"job_id": job_id, "status": "ok" if err_msg is None else "error", "found": count_ok, "message": err_msg}
