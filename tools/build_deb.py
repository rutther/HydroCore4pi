#!/usr/bin/env python3
"""
Build an internal Debian binary package for HydroCore.

The script intentionally avoids dpkg-deb so the package can be produced from
the Windows development machine. It writes the standard ar container with:
  - debian-binary
  - control.tar.gz
  - data.tar.gz
"""

from __future__ import annotations

import argparse
import fnmatch
import gzip
import io
import os
import shutil
import stat
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VERSION = "3.1.0~ai20260706"
PACKAGE_NAME = "hydrocore-ai"

APP_EXCLUDES = (
    "__pycache__",
    "*.pyc",
    "*.pyo",
    ".venv",
    "venv",
    "env",
    "logs",
    "*.log",
    "local_*.log",
    "data",
    "dist",
    "dev",
    "ui/dev",
)

DEFAULT_DATA_DIRS = (
    "action_profiles",
    "actuators",
    "action_units",
    "action_tasks",
    "action_rules",
    "action_schedules",
    "automation",
    "protocols_user",
)


@dataclass(frozen=True)
class PackageFile:
    source: Path | None
    target: str
    mode: int
    data: bytes | None = None


def _posix(path: str | Path) -> str:
    return str(path).replace("\\", "/").lstrip("/")


def _is_excluded(rel: Path, patterns: Iterable[str]) -> bool:
    text = _posix(rel)
    parts = rel.parts
    for pattern in patterns:
        if "/" in pattern:
            if text == pattern or text.startswith(pattern.rstrip("/") + "/"):
                return True
        elif any(fnmatch.fnmatch(part, pattern) for part in parts):
            return True
        elif fnmatch.fnmatch(text, pattern):
            return True
    return False


def _iter_tree(source_root: Path, target_root: str, excludes: Iterable[str] = ()) -> Iterable[PackageFile]:
    for path in sorted(source_root.rglob("*")):
        rel = path.relative_to(source_root)
        if _is_excluded(rel, excludes):
            continue
        target = _posix(Path(target_root) / rel)
        if path.is_dir():
            yield PackageFile(path, target, 0o755)
        elif path.is_file():
            mode = 0o755 if path.suffix in (".sh",) else 0o644
            yield PackageFile(path, target, mode)


def _bytes_file(target: str, data: str | bytes, mode: int = 0o644) -> PackageFile:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return PackageFile(None, _posix(target), mode, data)


def _script_postinst() -> str:
    return r"""#!/bin/sh
set -e

if ! getent group hydrocore >/dev/null; then
  addgroup --system hydrocore >/dev/null
fi

if ! getent passwd hydrocore >/dev/null; then
  adduser --system --home /var/lib/hydrocore --no-create-home --ingroup hydrocore hydrocore >/dev/null
fi

for group in dialout gpio video render input audio; do
  if getent group "$group" >/dev/null; then
    usermod -a -G "$group" hydrocore || true
  fi
done

install -d -o hydrocore -g hydrocore -m 0750 /var/lib/hydrocore
install -d -o hydrocore -g hydrocore -m 0750 /var/lib/hydrocore/db
install -d -o hydrocore -g hydrocore -m 0750 /var/lib/hydrocore/logs
install -d -o hydrocore -g hydrocore -m 0750 /var/lib/hydrocore/runtime
install -d -o hydrocore -g hydrocore -m 0750 /var/lib/hydrocore/kiosk
install -d -o hydrocore -g hydrocore -m 0750 /var/lib/hydrocore/kiosk/chromium
install -d -o hydrocore -g hydrocore -m 0750 /var/log/hydrocore
install -d -m 0755 /etc/hydrocore
install -d -m 0755 /etc/chromium/policies/managed
install -d -m 0755 /etc/chromium-browser/policies/managed

seed_dir() {
  src="$1"
  dst="$2"
  if [ -d "$src" ] && [ ! -e "$dst" ]; then
    cp -a "$src" "$dst"
  fi
}

seed_file() {
  src="$1"
  dst="$2"
  if [ -f "$src" ] && [ ! -e "$dst" ]; then
    cp -a "$src" "$dst"
  fi
}

seed_file /usr/share/hydrocore/defaults/config_poll_plan.json /var/lib/hydrocore/config_poll_plan.json
for name in action_profiles actuators action_units action_tasks action_rules action_schedules automation protocols_user; do
  seed_dir "/usr/share/hydrocore/defaults/data/$name" "/var/lib/hydrocore/$name"
done

chown -R hydrocore:hydrocore /var/lib/hydrocore /var/log/hydrocore

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
  systemctl set-default multi-user.target || true
  for service in display-manager.service lightdm.service gdm3.service sddm.service lxdm.service; do
    systemctl disable "$service" 2>/dev/null || true
    systemctl stop "$service" 2>/dev/null || true
  done
  systemctl enable hydrocore.service || true
  systemctl enable hydrocore-watchdog.timer || true
  if command -v cage >/dev/null 2>&1 && { command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; }; then
    systemctl enable hydrocore-kiosk.service || true
    systemctl enable hydrocore-kiosk-reload.path || true
  fi
  if [ "${1:-}" = "configure" ]; then
    systemctl restart hydrocore.service || systemctl start hydrocore.service || true
    if command -v cage >/dev/null 2>&1 && { command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; }; then
      systemctl restart hydrocore-kiosk.service || systemctl start hydrocore-kiosk.service || true
      systemctl restart hydrocore-kiosk-reload.path || systemctl start hydrocore-kiosk-reload.path || true
    fi
    systemctl restart hydrocore-watchdog.timer || systemctl start hydrocore-watchdog.timer || true
  fi
  systemctl restart systemd-journald.service || true
fi

exit 0
"""


def _script_prerm() -> str:
    return r"""#!/bin/sh
set -e

if [ "${1:-}" = "remove" ] || [ "${1:-}" = "deconfigure" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop hydrocore-watchdog.timer || true
    systemctl disable hydrocore-watchdog.timer || true
    systemctl stop hydrocore-kiosk-reload.path || true
    systemctl disable hydrocore-kiosk-reload.path || true
    systemctl stop hydrocore-kiosk.service || true
    systemctl disable hydrocore-kiosk.service || true
    systemctl stop hydrocore.service || true
    systemctl disable hydrocore.service || true
  fi
fi

exit 0
"""


def _script_postrm() -> str:
    return r"""#!/bin/sh
set -e

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi

if [ "${1:-}" = "purge" ]; then
  rm -f /etc/hydrocore/hydrocore.env
  rm -f /etc/systemd/journald.conf.d/90-hydrocore.conf
  rmdir /etc/hydrocore 2>/dev/null || true
  echo "HydroCore runtime data kept at /var/lib/hydrocore. Remove manually if required." >&2
fi

exit 0
"""


def _control(version: str, arch: str, installed_size: int) -> str:
    return f"""Package: {PACKAGE_NAME}
Version: {version}
Section: misc
Priority: optional
Architecture: {arch}
Maintainer: HydroCore Maintainers <root@localhost>
Depends: python3, python3-flask, python3-serial, python3-gpiozero, gunicorn, adduser, systemd
Recommends: python3-lgpio | python3-rpi.gpio, chromium, cage, wlr-randr
Installed-Size: {installed_size}
Homepage: https://github.com/
Description: HydroCore AI rebuild edge controller
 HydroCore 3.1 AI rebuild for circulating-water edge control devices.
 It provides local sensor collection, dashboard UI, GPIO/PWM action control,
 task planning, and system settings for Raspberry Pi class hardware.
"""


def _tar_gz(files: Iterable[PackageFile]) -> bytes:
    raw = io.BytesIO()
    with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=9, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w") as tar:
            for item in files:
                name = _posix(item.target)
                info = tarfile.TarInfo(name)
                info.mode = item.mode
                info.uid = 0
                info.gid = 0
                info.uname = "root"
                info.gname = "root"
                info.mtime = 0
                if item.source and item.source.is_dir():
                    info.type = tarfile.DIRTYPE
                    tar.addfile(info)
                else:
                    data = item.data if item.data is not None else item.source.read_bytes()  # type: ignore[union-attr]
                    info.size = len(data)
                    tar.addfile(info, io.BytesIO(data))
    return raw.getvalue()


def _ar_member(name: str, data: bytes) -> bytes:
    header = (
        f"{name}/".ljust(16)
        + f"{0:<12}"
        + f"{0:<6}"
        + f"{0:<6}"
        + f"{0o100644:<8}"
        + f"{len(data):<10}"
        + "`\n"
    ).encode("ascii")
    body = header + data
    if len(data) % 2:
        body += b"\n"
    return body


def _write_deb(path: Path, control_tar: bytes, data_tar: bytes) -> None:
    payload = (
        b"!<arch>\n"
        + _ar_member("debian-binary", b"2.0\n")
        + _ar_member("control.tar.gz", control_tar)
        + _ar_member("data.tar.gz", data_tar)
    )
    path.write_bytes(payload)


def _copy_default_data() -> Iterable[PackageFile]:
    plan = PROJECT_ROOT / "tasks" / "config_poll_plan.json"
    if plan.exists():
        yield PackageFile(plan, "/usr/share/hydrocore/defaults/config_poll_plan.json", 0o644)

    data_root = PROJECT_ROOT / "data"
    for name in DEFAULT_DATA_DIRS:
        src = data_root / name
        if src.exists():
            yield from _iter_tree(src, f"/usr/share/hydrocore/defaults/data/{name}")


def _collect_data_files() -> list[PackageFile]:
    files: list[PackageFile] = []
    files.extend(_iter_tree(PROJECT_ROOT / "backend", "/opt/hydrocore/backend", APP_EXCLUDES))
    files.extend(_iter_tree(PROJECT_ROOT / "ui", "/opt/hydrocore/ui", APP_EXCLUDES))
    files.extend(_iter_tree(PROJECT_ROOT / "protocols", "/opt/hydrocore/protocols", APP_EXCLUDES))

    for rel in ("README.md", "requirements.txt", "Api.md", "flow.md"):
        src = PROJECT_ROOT / rel
        if src.exists():
            files.append(PackageFile(src, f"/opt/hydrocore/{rel}", 0o644))

    files.extend(_copy_default_data())
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore.env", "/etc/hydrocore/hydrocore.env", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-chromium-policy.json", "/etc/chromium/policies/managed/hydrocore.json", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-chromium-policy.json", "/etc/chromium-browser/policies/managed/hydrocore.json", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore.service", "/lib/systemd/system/hydrocore.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-kiosk.service", "/lib/systemd/system/hydrocore-kiosk.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-kiosk-reload.service", "/lib/systemd/system/hydrocore-kiosk-reload.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-kiosk-reload.path", "/lib/systemd/system/hydrocore-kiosk-reload.path", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-watchdog.service", "/lib/systemd/system/hydrocore-watchdog.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-watchdog.timer", "/lib/systemd/system/hydrocore-watchdog.timer", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-run", "/usr/bin/hydrocore-run", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-kiosk-launch", "/usr/bin/hydrocore-kiosk-launch", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-apply-screen-orientation", "/usr/bin/hydrocore-apply-screen-orientation", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-ctl", "/usr/bin/hydrocore-ctl", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-watchdog", "/usr/bin/hydrocore-watchdog", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-journald.conf", "/etc/systemd/journald.conf.d/90-hydrocore.conf", 0o644))
    return files


def build(version: str, arch: str, out_dir: Path) -> Path:
    data_files = _collect_data_files()
    installed_size = max(1, sum(
        (len(f.data) if f.data is not None else (f.source.stat().st_size if f.source and f.source.is_file() else 0))
        for f in data_files
    ) // 1024)

    control_files = [
        _bytes_file("control", _control(version, arch, installed_size)),
        _bytes_file("conffiles", "/etc/hydrocore/hydrocore.env\n/etc/chromium/policies/managed/hydrocore.json\n/etc/chromium-browser/policies/managed/hydrocore.json\n/etc/systemd/journald.conf.d/90-hydrocore.conf\n"),
        _bytes_file("postinst", _script_postinst(), 0o755),
        _bytes_file("prerm", _script_prerm(), 0o755),
        _bytes_file("postrm", _script_postrm(), 0o755),
    ]

    out_dir.mkdir(parents=True, exist_ok=True)
    deb_path = out_dir / f"{PACKAGE_NAME}_{version}_{arch}.deb"
    _write_deb(deb_path, _tar_gz(control_files), _tar_gz(data_files))
    return deb_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--arch", default="all")
    parser.add_argument("--out-dir", default=str(PROJECT_ROOT / "dist"))
    args = parser.parse_args()

    deb = build(args.version, args.arch, Path(args.out_dir))
    print(deb)


if __name__ == "__main__":
    main()
