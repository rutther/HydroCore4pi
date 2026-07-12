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
import hashlib
import fnmatch
import gzip
import io
import lzma
import os
import shutil
import stat
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VERSION = "3.1.0+ai20260712offline3"
PACKAGE_NAME = "hydrocore-ai"
OFFLINE_KIOSK_DEBS = PROJECT_ROOT / "packaging" / "offline_debs" / "kiosk-bookworm-arm64"

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


def _dir_file(target: str, mode: int = 0o755) -> PackageFile:
    return PackageFile(PROJECT_ROOT, target, mode)


def _read_ar_members(path: Path) -> dict[str, bytes]:
    data = path.read_bytes()
    if not data.startswith(b"!<arch>\n"):
        raise ValueError(f"{path} is not a Debian ar archive")
    members: dict[str, bytes] = {}
    pos = 8
    while pos + 60 <= len(data):
        header = data[pos:pos + 60]
        pos += 60
        raw_name = header[:16].decode("ascii", "replace").strip()
        name = raw_name.rstrip("/")
        size = int(header[48:58].decode("ascii").strip())
        body = data[pos:pos + size]
        pos += size + (size % 2)
        members[name] = body
    return members


def _control_tar_payload(path: Path) -> bytes:
    members = _read_ar_members(path)
    for name, payload in members.items():
        if name == "control.tar.gz":
            return gzip.decompress(payload)
        if name == "control.tar.xz":
            return lzma.decompress(payload)
    raise ValueError(f"{path} does not contain supported control.tar.gz/xz")


def _read_deb_control(path: Path) -> dict[str, str]:
    payload = _control_tar_payload(path)
    fields: dict[str, str] = {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as tar:
        member = next((m for m in tar.getmembers() if m.name in ("control", "./control")), None)
        if member is None:
            raise ValueError(f"{path} control archive has no control file")
        control = tar.extractfile(member)
        if control is None:
            raise ValueError(f"{path} control file cannot be read")
        key = None
        for line in control.read().decode("utf-8", "replace").splitlines():
            if not line:
                continue
            if line.startswith((" ", "\t")) and key:
                fields[key] = fields[key] + "\n" + line
                continue
            if ":" in line:
                key, value = line.split(":", 1)
                fields[key] = value.strip()
    return fields


def _build_packages_index(repo_root: Path) -> bytes:
    entries: list[str] = []
    for deb in sorted(repo_root.glob("*.deb")):
        fields = _read_deb_control(deb)
        payload = deb.read_bytes()
        size = len(payload)
        digest = hashlib.sha256(payload).hexdigest()
        md5 = hashlib.md5(payload).hexdigest()
        entry_fields = [
            "Package",
            "Version",
            "Architecture",
            "Maintainer",
            "Installed-Size",
            "Pre-Depends",
            "Depends",
            "Recommends",
            "Suggests",
            "Section",
            "Priority",
            "Homepage",
            "Description",
        ]
        lines = []
        for name in entry_fields:
            if name in fields:
                lines.append(f"{name}: {fields[name]}")
        lines.extend([
            f"Filename: ./{deb.name}",
            f"Size: {size}",
            f"MD5sum: {md5}",
            f"SHA256: {digest}",
        ])
        entries.append("\n".join(lines))
    return ("\n\n".join(entries) + "\n").encode("utf-8")


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
  systemctl stop hydrocore-reboot.path 2>/dev/null || true
  rm -f /var/lib/hydrocore/runtime/reboot.request
  systemctl set-default multi-user.target || true
  for service in display-manager.service lightdm.service gdm3.service sddm.service lxdm.service; do
    systemctl disable "$service" 2>/dev/null || true
    systemctl stop "$service" 2>/dev/null || true
  done
  systemctl enable hydrocore.service || true
  systemctl enable hydrocore-watchdog.timer || true
  systemctl enable hydrocore-screen-apply.path || true
  systemctl enable hydrocore-reboot.path || true
  systemctl enable hydrocore-kiosk-deps.service 2>/dev/null || true
  if command -v cage >/dev/null 2>&1 && { command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; }; then
    systemctl enable hydrocore-kiosk.service || true
  fi
  if [ "${1:-}" = "configure" ]; then
    systemctl restart hydrocore.service || systemctl start hydrocore.service || true
    if command -v cage >/dev/null 2>&1 && { command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; }; then
      systemctl restart hydrocore-kiosk.service || systemctl start hydrocore-kiosk.service || true
    fi
    systemctl restart hydrocore-screen-apply.path || systemctl start hydrocore-screen-apply.path || true
    systemctl restart hydrocore-reboot.path || systemctl start hydrocore-reboot.path || true
    systemctl restart hydrocore-watchdog.timer || systemctl start hydrocore-watchdog.timer || true
    if [ -s /opt/hydrocore/offline-debs/Packages ] || [ -s /opt/hydrocore/offline-debs/Packages.gz ]; then
      systemctl start --no-block hydrocore-kiosk-deps.service || true
    fi
    if command -v hydrocore-selfcheck >/dev/null 2>&1; then
      hydrocore-selfcheck --json > /var/lib/hydrocore/runtime/install-selfcheck.json 2>/var/lib/hydrocore/runtime/install-selfcheck.err || true
      chown hydrocore:hydrocore /var/lib/hydrocore/runtime/install-selfcheck.json /var/lib/hydrocore/runtime/install-selfcheck.err 2>/dev/null || true
    fi
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
    systemctl stop hydrocore-screen-apply.path || true
    systemctl disable hydrocore-screen-apply.path || true
    systemctl stop hydrocore-reboot.path || true
    systemctl disable hydrocore-reboot.path || true
    systemctl disable hydrocore-screen-boot.service || true
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
  rm -f /etc/udev/rules.d/99-hydrocore-touchscreen-orientation.rules
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
Depends: python3, adduser, systemd, apt
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
            yield _dir_file(f"/usr/share/hydrocore/defaults/data/{name}")
            yield from _iter_tree(src, f"/usr/share/hydrocore/defaults/data/{name}")


def _collect_data_files() -> list[PackageFile]:
    files: list[PackageFile] = []
    files.extend([
        _dir_file("/opt"),
        _dir_file("/opt/hydrocore"),
        _dir_file("/opt/hydrocore/backend"),
        _dir_file("/opt/hydrocore/ui"),
        _dir_file("/opt/hydrocore/protocols"),
        _dir_file("/opt/hydrocore/vendor"),
        _dir_file("/opt/hydrocore/vendor/python"),
        _dir_file("/opt/hydrocore/vendor/lib"),
        _dir_file("/opt/hydrocore/offline-debs"),
        _dir_file("/usr"),
        _dir_file("/usr/bin"),
        _dir_file("/usr/share"),
        _dir_file("/usr/share/hydrocore"),
        _dir_file("/usr/share/hydrocore/defaults"),
        _dir_file("/usr/share/hydrocore/defaults/data"),
        _dir_file("/etc"),
        _dir_file("/etc/hydrocore"),
        _dir_file("/etc/chromium"),
        _dir_file("/etc/chromium/policies"),
        _dir_file("/etc/chromium/policies/managed"),
        _dir_file("/etc/chromium-browser"),
        _dir_file("/etc/chromium-browser/policies"),
        _dir_file("/etc/chromium-browser/policies/managed"),
        _dir_file("/etc/systemd"),
        _dir_file("/etc/systemd/journald.conf.d"),
        _dir_file("/lib"),
        _dir_file("/lib/systemd"),
        _dir_file("/lib/systemd/system"),
    ])
    files.extend(_iter_tree(PROJECT_ROOT / "backend", "/opt/hydrocore/backend", APP_EXCLUDES))
    files.extend(_iter_tree(PROJECT_ROOT / "ui", "/opt/hydrocore/ui", APP_EXCLUDES))
    files.extend(_iter_tree(PROJECT_ROOT / "protocols", "/opt/hydrocore/protocols", APP_EXCLUDES))
    vendor_root = PROJECT_ROOT / "packaging" / "vendor"
    if vendor_root.exists():
        files.extend(_iter_tree(vendor_root, "/opt/hydrocore/vendor", ()))
    if OFFLINE_KIOSK_DEBS.exists():
        offline_debs = sorted(OFFLINE_KIOSK_DEBS.glob("*.deb"))
        if offline_debs:
            files.extend(_iter_tree(OFFLINE_KIOSK_DEBS, "/opt/hydrocore/offline-debs", ("Packages", "Packages.gz")))
            packages = _build_packages_index(OFFLINE_KIOSK_DEBS)
            packages_gz = gzip.compress(packages, compresslevel=9, mtime=0)
            files.append(_bytes_file("/opt/hydrocore/offline-debs/Packages", packages, 0o644))
            files.append(_bytes_file("/opt/hydrocore/offline-debs/Packages.gz", packages_gz, 0o644))

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
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-kiosk-deps.service", "/lib/systemd/system/hydrocore-kiosk-deps.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-screen-boot.service", "/lib/systemd/system/hydrocore-screen-boot.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-screen-apply.service", "/lib/systemd/system/hydrocore-screen-apply.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-screen-apply.path", "/lib/systemd/system/hydrocore-screen-apply.path", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-reboot.service", "/lib/systemd/system/hydrocore-reboot.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-reboot.path", "/lib/systemd/system/hydrocore-reboot.path", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-watchdog.service", "/lib/systemd/system/hydrocore-watchdog.service", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-watchdog.timer", "/lib/systemd/system/hydrocore-watchdog.timer", 0o644))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-run", "/usr/bin/hydrocore-run", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-kiosk-launch", "/usr/bin/hydrocore-kiosk-launch", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-kiosk-deps-install", "/usr/bin/hydrocore-kiosk-deps-install", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-apply-screen-orientation", "/usr/bin/hydrocore-apply-screen-orientation", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-ctl", "/usr/bin/hydrocore-ctl", 0o755))
    files.append(PackageFile(PROJECT_ROOT / "packaging" / "hydrocore-selfcheck", "/usr/bin/hydrocore-selfcheck", 0o755))
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
    parser.add_argument("--arch", default="arm64")
    parser.add_argument("--out-dir", default=str(PROJECT_ROOT / "dist"))
    args = parser.parse_args()

    deb = build(args.version, args.arch, Path(args.out_dir))
    print(deb)


if __name__ == "__main__":
    main()
