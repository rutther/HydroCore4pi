import time
import serial

def calc_crc16(data: bytes) -> bytes:
    """Modbus RTU CRC16（低字节在前）"""
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc >>= 1
                crc ^= 0xA001
            else:
                crc >>= 1
    return crc.to_bytes(2, byteorder="little")

def build_read_request(addr: int) -> bytes:
    """
    功能码 0x03，起始寄存器 0x0000，读取 2 个寄存器。
    目的：探测该地址是否有设备响应。
    """
    raw = bytearray([addr, 0x03, 0x00, 0x00, 0x00, 0x02])
    return raw + calc_crc16(raw)

def valid_resp(addr: int, resp: bytes) -> bool:
    """快速校验：地址+功能码+CRC"""
    if len(resp) < 7:
        return False
    if resp[0] != addr or resp[1] != 0x03:
        return False
    data, crc_lo, crc_hi = resp[:-2], resp[-2], resp[-1]
    return calc_crc16(data) == bytes([crc_lo, crc_hi])

def probe_one(ser: serial.Serial, addr: int, interval: float):
    """
    对单个地址发起一次探测。
    返回：(ok, raw_hex, latency_ms, request_hex)
    """
    req = build_read_request(addr)
    t0 = time.perf_counter()
    ser.write(req)
    time.sleep(interval)
    resp = ser.read(128)
    t1 = time.perf_counter()

    ok = valid_resp(addr, resp)
    raw_hex = resp.hex().upper() if resp else ""
    latency_ms = int((t1 - t0) * 1000)
    return ok, raw_hex, latency_ms, req.hex().upper()
