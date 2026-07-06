# 文件：backend/services/config_get_service.py
# 职责：读取传感器参数（功能码 0x03），支持 float/int，协议定义来自 protocols/*.json

import os, time, struct, json
import serial
from typing import Dict, List, Any
from .serial_modbus import calc_crc16
from .protocol_loader import load_protocol
from ..utils.locks import try_port_lock, PortBusyError
from ..utils.locks import port_lock

def _build_read_cmd(slave: int, reg: int, count: int) -> bytes:
    """构造 0x03 读寄存器报文"""
    pkt = bytearray([
        slave,
        0x03,
        (reg >> 8) & 0xFF,
        reg & 0xFF,
        (count >> 8) & 0xFF,
        count & 0xFF
    ])
    return pkt + calc_crc16(pkt)


def _parse_response(resp: bytes, dtype: str, float_order: str):
    """解析响应报文"""
    if len(resp) < 5 or resp[1] != 0x03:
        raise ValueError("响应帧无效")
    byte_count = resp[2]
    raw = resp[3:3+byte_count]

    if dtype == "int":
        return int.from_bytes(raw, byteorder="big", signed=False)

    elif dtype == "float":
        if len(raw) != 4:
            raise ValueError("浮点寄存器长度错误")
        if float_order == "CDAB":
            raw = raw[2:4] + raw[0:2]
        return struct.unpack(">f", raw)[0]

    else:
        raise ValueError(f"不支持的数据类型: {dtype}")


def start_config_get(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    入参示例：
    {
      "port": "/dev/ttyACM0",
      "baudrate": 9600,
      "timeout": 0.5,
      "items": [
        {
          "protocol": "lanchang_ph",
          "address": 1,
          "parameters": ["measurement","temperature"],
          "description": "测试 ph"
        }
      ]
    }
    """
    port     = payload["port"]
    baudrate = int(payload.get("baudrate", 9600))
    timeout  = float(payload.get("timeout", 0.5))
    items    = payload.get("items", [])

    results: List[Dict] = []


    try:
        with try_port_lock(port):



            with serial.Serial(port, baudrate=baudrate, timeout=timeout) as ser:
                for item in items:
                    proto_name = item["protocol"]
                    slave      = int(item["address"])
                    desc       = item.get("description", proto_name)
                    params     = item.get("parameters", [])

                    proto = load_protocol(proto_name)
                    float_order = proto.get("__meta__", {}).get("_float_order", "ABCD")

                    for pname in params:
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

                        if meta.get("access") == "write_only":
                            results.append({
                                "sensor": proto_name,
                                "address": slave,
                                "parameter": pname,
                                "status": "skipped",
                                "error": "write_only"
                            })
                            continue

                        reg   = meta["addr"]
                        dtype = meta["type"]
                        length = meta.get("length", 2 if dtype=="float" else 1)

                        cmd = _build_read_cmd(slave, reg, length)
                        ser.write(cmd)
                        time.sleep(0.2)
                        resp = ser.read(5 + length*2)

                        entry = {
                            "sensor": proto_name,
                            "address": slave,
                            "parameter": pname,
                            "description": meta.get("description",""),
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                            "request_hex": cmd.hex().upper(),
                            "response_hex": resp.hex().upper()
                        }

                        try:
                            val = _parse_response(resp, dtype, float_order)
                            entry["status"] = "success"
                            entry["value"] = val
                        except Exception as e:
                            entry["status"] = "failed"
                            entry["error"] = str(e)

                        results.append(entry)

    except PortBusyError as e:
        return {"status": "error", "error": str(e), "results": []}

    return {"status": "ok", "results": results}



# 未全局串口控制4.2之前的版本
    # with serial.Serial(port, baudrate=baudrate, timeout=timeout) as ser:
    #     for item in items:
    #         proto_name = item["protocol"]
    #         slave      = int(item["address"])
    #         desc       = item.get("description", proto_name)
    #         params     = item.get("parameters", [])

    #         proto = load_protocol(proto_name)
    #         float_order = proto.get("__meta__", {}).get("_float_order", "ABCD")

    #         for pname in params:
    #             meta = proto.get(pname)
    #             if not meta:
    #                 results.append({
    #                     "sensor": proto_name,
    #                     "address": slave,
    #                     "parameter": pname,
    #                     "status": "error",
    #                     "error": "参数未定义"
    #                 })
    #                 continue

    #             if meta.get("access") == "write_only":
    #                 results.append({
    #                     "sensor": proto_name,
    #                     "address": slave,
    #                     "parameter": pname,
    #                     "status": "skipped",
    #                     "error": "write_only"
    #                 })
    #                 continue

    #             reg   = meta["addr"]
    #             dtype = meta["type"]
    #             length = meta.get("length", 2 if dtype=="float" else 1)

    #             cmd = _build_read_cmd(slave, reg, length)
    #             ser.write(cmd)
    #             time.sleep(0.2)
    #             resp = ser.read(5 + length*2)

    #             entry = {
    #                 "sensor": proto_name,
    #                 "address": slave,
    #                 "parameter": pname,
    #                 "description": meta.get("description",""),
    #                 "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    #                 "request_hex": cmd.hex().upper(),
    #                 "response_hex": resp.hex().upper()
    #             }

    #             try:
    #                 val = _parse_response(resp, dtype, float_order)
    #                 entry["status"] = "success"
    #                 entry["value"] = val
    #             except Exception as e:
    #                 entry["status"] = "failed"
    #                 entry["error"] = str(e)

    #             results.append(entry)

    # return {"status": "ok", "results": results}
