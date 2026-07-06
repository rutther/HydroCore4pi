# 文件：backend/services/config_set_service.py
# 职责：写传感器参数（0x06 / 0x10），支持 float/int，协议定义来自 protocols/*.json

import time
import struct
import serial
from typing import Dict, List, Any

from .serial_modbus import calc_crc16
from .protocol_loader import load_protocol


def _build_write_single(slave: int, reg: int, value_u16: int) -> bytes:
    """构造 0x06 写单寄存器"""
    pkt = bytearray([
        slave,
        0x06,
        (reg >> 8) & 0xFF,
        reg & 0xFF,
        (value_u16 >> 8) & 0xFF,
        value_u16 & 0xFF
    ])
    return pkt + calc_crc16(pkt)


def _build_write_multi(slave: int, reg: int, regs: List[int]) -> bytes:
    """构造 0x10 写多个寄存器（regs 每个为 0~65535）"""
    count = len(regs)
    byte_count = count * 2
    pkt = bytearray([
        slave,
        0x10,
        (reg >> 8) & 0xFF,
        reg & 0xFF,
        (count >> 8) & 0xFF,
        count & 0xFF,
        byte_count
    ])
    for v in regs:
        pkt.extend([(v >> 8) & 0xFF, v & 0xFF])
    return pkt + calc_crc16(pkt)


def _parse_write_ack(resp: bytes, fn: int):
    """
    0x06 ack: slave,0x06,addrHi,addrLo,valHi,valLo,crcLo,crcHi  => len=8
    0x10 ack: slave,0x10,addrHi,addrLo,countHi,countLo,crcLo,crcHi => len=8
    """
    if len(resp) < 8:
        raise ValueError("响应帧长度不足")
    if resp[1] != fn:
        # 异常响应：fn | 0x80
        if resp[1] == (fn | 0x80) and len(resp) >= 5:
            code = resp[2]
            raise ValueError(f"设备异常响应: code=0x{code:02X}")
        raise ValueError("响应功能码不匹配")
    # CRC 校验（可选但强烈建议）
    body = resp[:-2]
    crc = resp[-2:]
    if calc_crc16(body) != crc:
        raise ValueError("CRC 校验失败")


def _encode_value(dtype: str, value: Any, float_order: str) -> List[int]:
    """
    返回要写入的寄存器列表（u16）。
    int => [u16]
    float => [u16,u16]
    """
    if dtype == "int":
        # 允许传入 int/float(str)；最终取 int
        iv = int(float(value))
        if iv < 0 or iv > 0xFFFF:
            raise ValueError("int 超出 0~65535")
        return [iv]

    if dtype == "float":
        fv = float(value)
        raw = struct.pack(">f", fv)  # 大端 float
        # raw 4 bytes => two u16 words: ABCD => [AB,CD]
        w1 = int.from_bytes(raw[0:2], "big")
        w2 = int.from_bytes(raw[2:4], "big")
        regs = [w1, w2]
        if float_order == "CDAB":
            regs = [w2, w1]  # 交换 word
        return regs

    raise ValueError(f"不支持的数据类型: {dtype}")


def start_config_set(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    入参示例：
    {
      "port": "/dev/ttyACM0",
      "baudrate": 9600,
      "timeout": 0.5,
      "items": [
        {
          "protocol": "lanchang_ec",
          "address": 10,
          "writes": {
            "electrode_constant": 1.0,
            "compensation_coefficient": 0.98
          }
        }
      ]
    }
    """
    port     = payload["port"]
    baudrate = int(payload.get("baudrate", 9600))
    timeout  = float(payload.get("timeout", 0.5))
    items    = payload.get("items", [])

    results: List[Dict[str, Any]] = []

    with serial.Serial(port, baudrate=baudrate, timeout=timeout) as ser:
        for item in items:
            proto_name = item["protocol"]
            slave      = int(item["address"])
            writes     = item.get("writes") or {}

            proto = load_protocol(proto_name)
            float_order = proto.get("__meta__", {}).get("_float_order", "ABCD")

            if not isinstance(writes, dict) or not writes:
                results.append({
                    "sensor": proto_name,
                    "address": slave,
                    "status": "error",
                    "error": "writes 不能为空对象"
                })
                continue

            for pname, pval in writes.items():
                meta = proto.get(pname)
                if not meta:
                    results.append({
                        "sensor": proto_name,
                        "address": slave,
                        "parameter": pname,
                        "status": "error",
                        "error": "参数未定义"
                    })
                    continue

                acc = meta.get("access", "")
                if acc == "read_only":
                    results.append({
                        "sensor": proto_name,
                        "address": slave,
                        "parameter": pname,
                        "status": "failed",
                        "error": "read_only"
                    })
                    continue

                reg   = int(meta["addr"])
                dtype = meta["type"]
                length = int(meta.get("length", 2 if dtype == "float" else 1))

                entry = {
                    "sensor": proto_name,
                    "address": slave,
                    "parameter": pname,
                    "description": meta.get("description", ""),
                    "access": acc,
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                }

                try:
                    regs = _encode_value(dtype, pval, float_order)

                    # 与 length 对齐（float 默认 2；int 默认 1）
                    if length != len(regs):
                        # 允许协议 length 缺省/不一致时自动纠正，但要严格：不匹配就报错更安全
                        raise ValueError(f"length 不匹配：协议 length={length}，写入寄存器数={len(regs)}")

                    if len(regs) == 1:
                        cmd = _build_write_single(slave, reg, regs[0])
                        ser.write(cmd)
                        time.sleep(0.2)
                        resp = ser.read(8)
                        entry["request_hex"] = cmd.hex().upper()
                        entry["response_hex"] = resp.hex().upper()
                        _parse_write_ack(resp, 0x06)

                    else:
                        cmd = _build_write_multi(slave, reg, regs)
                        ser.write(cmd)
                        time.sleep(0.2)
                        resp = ser.read(8)
                        entry["request_hex"] = cmd.hex().upper()
                        entry["response_hex"] = resp.hex().upper()
                        _parse_write_ack(resp, 0x10)

                    entry["status"] = "success"
                    entry["written"] = pval

                except Exception as e:
                    entry["status"] = "failed"
                    entry["error"] = str(e)

                results.append(entry)

    return {"status": "ok", "results": results}
