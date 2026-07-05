# 串口权威中心
# 作用：统一管理数据采集线程（poller）的运行状态，并提供串口访问权限裁决。
#       此文件不访问串口，不操作业务逻辑，只负责系统级治理与约束。
#
# 1. poller 为唯一合法的长期串口持有者；运行时禁止其他串口操作。
# 2. 所有 scan / get / set 属于短期访问者，必须经过 poller 状态审查。
# 3. 该治理层避免业务层之间相互耦合，避免未来扩展时产生结构污染。
# 4. 通过 authority center 模式，实现系统的长期稳定性与安全性。

from typing import Optional
import threading

# 全局变量：由 app.py 写入 poller 线程对象
_data_collector_thread: Optional[threading.Thread] = None


def register_poller_thread(t: Optional[threading.Thread]) -> None:

    global _data_collector_thread
    _data_collector_thread = t


def is_poller_running() -> bool:

    global _data_collector_thread
    return bool(_data_collector_thread and _data_collector_thread.is_alive())


class PollerRunningError(Exception):
    pass


def ensure_poller_not_running() -> None:

    if is_poller_running():
        raise PollerRunningError("数据采集中，不允许执行该操作")