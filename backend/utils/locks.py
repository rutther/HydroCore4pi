# 文件：backend/utils/locks.py
import threading
from collections import defaultdict
from contextlib import contextmanager

# 每个串口一个独立锁
_port_locks = defaultdict(threading.Lock)

class PortBusyError(RuntimeError):
    pass

def port_lock(port: str) -> threading.Lock:
    return _port_locks[port]

@contextmanager
def try_port_lock(port: str):
    """
    非阻塞获取串口锁：获取不到立刻报错（不排队）。
    用于实现“poller 活着时其他串口操作无效”，以及防止任何并发串口访问。
    """
    lk = port_lock(port)
    ok = lk.acquire(blocking=False)
    if not ok:
        raise PortBusyError(f"串口忙: {port}（已有任务占用）")
    try:
        yield
    finally:
        lk.release()