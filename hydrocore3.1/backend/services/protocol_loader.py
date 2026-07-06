# 文件：backend/services/protocol_loader.py
# 职责：从“设备定义文件”加载配置（原 protocols/*.json）
# 约定：
# - 内置目录：<root>/protocols/*.json（随代码发布）
# - 用户目录：<root>/data/protocols_user/*.json（运行时导入/覆盖）
# - 同名：用户目录优先（覆盖内置）

import os, json
from typing import Dict, List

from .. import settings

PROTO_DIR = str(settings.BUILTIN_PROTOCOL_DIR)
USER_PROTO_DIR = str(settings.USER_PROTOCOL_DIR)


def _normalize_name(name: str) -> str:
    """
    规范化协议/文件名（不含 .json），并过滤危险字符，避免路径穿越
    """
    name = (name or "").strip()
    if name.endswith(".json"):
        name = name[:-5]

    safe = []
    for ch in name:
        if ch.isalnum() or ch in ("_", "-", "."):
            safe.append(ch)
    return "".join(safe)


def _candidate_paths(protocol: str) -> List[str]:
    """
    返回候选路径：用户目录优先
    """
    n = _normalize_name(protocol)
    if not n:
        return []
    return [
        os.path.join(USER_PROTO_DIR, f"{n}.json"),
        os.path.join(PROTO_DIR, f"{n}.json"),
    ]


def get_slave_addr_register(protocol: str) -> int:
    """
    给定协议名（不带 .json），返回 slave_address 的寄存器地址
    """
    proto = load_protocol(protocol)
    if "slave_address" not in proto:
        raise ValueError(f"协议文件中未定义 slave_address 项: {protocol}")
    return int(proto["slave_address"]["addr"])


def load_protocol(protocol: str) -> dict:
    """
    给定协议名（不带 .json），返回完整协议 JSON 字典
    """
    paths = _candidate_paths(protocol)
    for path in paths:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError(f"协议文件不存在: {paths}")


def list_protocol_files() -> List[Dict]:
    """
    列出所有设备定义文件（合并内置+用户）
    返回字段：
      - name: 不带 .json
      - source: builtin|user
      - mtime: int 时间戳
      - size: 字节
    规则：
      - 先扫 builtin，再扫 user；同名 user 覆盖 builtin
    """
    out: Dict[str, Dict] = {}

    def scan_dir(d: str, source: str):
        if not os.path.isdir(d):
            return
        for fn in os.listdir(d):
            if not fn.endswith(".json"):
                continue
            name = fn[:-5]
            path = os.path.join(d, fn)
            try:
                st = os.stat(path)
            except FileNotFoundError:
                continue
            out[name] = {
                "name": name,
                "source": source,
                "mtime": int(st.st_mtime),
                "size": int(st.st_size),
            }

    scan_dir(PROTO_DIR, "builtin")
    scan_dir(USER_PROTO_DIR, "user")

    # user 优先排前面，其次按 name 排
    return sorted(out.values(), key=lambda x: (x["source"] != "user", x["name"]))
