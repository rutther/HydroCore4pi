# 文件：backend/services/addr_writer_service.py
# 职责：接收一批改址任务，逐一执行并返回结果（无数据库）

import serial, time, datetime
from typing import Dict, List
from .protocol_loader import get_slave_addr_register
from ..utils.locks import try_port_lock, PortBusyError
from ..utils.locks import port_lock

def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def calc_crc16(data: bytes) -> bytes:
    crc = 0xFFFF
    for pos in data:
        crc ^= pos
        for _ in range(8):
            if crc & 1:
                crc >>= 1
                crc ^= 0xA001
            else:
                crc >>= 1
    return crc.to_bytes(2, byteorder='little')

def build_write_cmd(old_addr: int, reg_addr: int, new_addr: int) -> bytes:
    payload = bytearray([
        old_addr & 0xFF,
        0x06,
        (reg_addr >> 8) & 0xFF,
        reg_addr & 0xFF,
        0x00,
        new_addr & 0xFF
    ])
    return payload + calc_crc16(payload)

def write_address(entry: Dict, baudrate: int, timeout: float) -> Dict:
    """
    执行单条改址任务
    """
    port = entry["port"]
    old_addr = int(entry["current_addr"])
    new_addr = int(entry["new_addr"])
    protocol = entry["protocol"]
    description = entry.get("description", "")

    result = {
        "timestamp": _now(),
        "port": port,
        "from": old_addr,
        "to": new_addr,
        "protocol": protocol,
        "description": description,
        "status": "failed",
        "request_hex": "",
        "response_hex": ""
    }

    try:
        reg_addr = get_slave_addr_register(protocol)
        cmd = build_write_cmd(old_addr, reg_addr, new_addr)
        result["request_hex"] = cmd.hex().upper()


        lock = port_lock(port)
        with lock:



            with try_port_lock(port):
                with serial.Serial(port, baudrate=baudrate, timeout=timeout) as ser:
                    ser.write(cmd)
                    time.sleep(0.3)
                    resp = ser.read(128)


            # 4.3之前
            # with serial.Serial(port, baudrate=baudrate, timeout=timeout) as ser:
            #     ser.write(cmd)
            #     time.sleep(0.3)
            #     resp = ser.read(128)


                result["response_hex"] = resp.hex().upper()

                if resp[:6] == cmd[:6]:
                    result["status"] = "success"


        # with serial.Serial(port, baudrate=baudrate, timeout=timeout) as ser:
        #     ser.write(cmd)
        #     time.sleep(0.3)
        #     resp = ser.read(128)
        #     result["response_hex"] = resp.hex().upper()

        #     if resp[:6] == cmd[:6]:
        #         result["status"] = "success"




    except Exception as e:
        result["error"] = str(e)

    return result

def start_address_job(payload: Dict) -> Dict:
    """
    入参 payload:
    {
      "port": "/dev/ttyACM0",
      "baudrate": 9600,
      "timeout": 0.5,
      "items": [
        {"current_addr":1,"new_addr":9,"protocol":"lanchang_ph","description":"备注"}
      ]
    }
    """
    port     = payload["port"]
    baudrate = int(payload.get("baudrate", 9600))
    timeout  = float(payload.get("timeout", 0.5))
    items    = payload.get("items", [])

    results: List[Dict] = []
    for entry in items:
        entry["port"] = port  # 统一加上串口
        res = write_address(entry, baudrate, timeout)
        results.append(res)

    return {
        "status": "ok",
        "results": results
    }
