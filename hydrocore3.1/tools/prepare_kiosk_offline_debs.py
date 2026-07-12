#!/usr/bin/env python3
"""
Prepare bundled Debian packages for the HydroCore local-screen kiosk.

Run this on a Raspberry Pi OS Bookworm arm64 machine with network access:

    python3 tools/prepare_kiosk_offline_debs.py

The output directory is consumed by tools/build_deb.py and packed into:

    /opt/hydrocore/offline-debs

The installed HydroCore package then installs Chromium, labwc/cage,
squeekboard, and wlr-randr from that local file repository without using
network package sources.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = PROJECT_ROOT / "packaging" / "offline_debs" / "kiosk-bookworm-arm64"
DEFAULT_ROOTS = ("chromium", "labwc", "cage", "squeekboard", "wlr-randr")


def run(argv: list[str], *, capture: bool = False, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, check=check, text=True, capture_output=capture)


def simulate_empty_install(roots: tuple[str, ...]) -> list[str]:
    status = Path("/tmp/hydrocore-empty-dpkg-status")
    ext = Path("/tmp/hydrocore-empty-apt-extended-states")
    status.write_text("", encoding="utf-8")
    ext.write_text("", encoding="utf-8")
    result = run([
        "apt-get",
        "-o", f"Dir::State::status={status}",
        "-o", f"Dir::State::extended_states={ext}",
        "-o", "Debug::NoLocking=1",
        "-s",
        "--no-install-recommends",
        "install",
        *roots,
    ], capture=True)
    packages: list[str] = []
    for line in result.stdout.splitlines():
        match = re.match(r"Inst\s+(\S+)\s+", line)
        if match and match.group(1) not in packages:
            packages.append(match.group(1))
    return packages


def download_packages(packages: list[str], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.deb"):
        old.unlink()
    chunk_size = 40
    for index in range(0, len(packages), chunk_size):
        chunk = packages[index:index + chunk_size]
        print(f"Downloading {index + 1}-{index + len(chunk)} / {len(packages)}")
        run(["apt-get", "download", *chunk], check=True)


def package_sizes(out_dir: Path) -> tuple[int, int]:
    files = list(out_dir.glob("*.deb"))
    return len(files), sum(path.stat().st_size for path in files)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT))
    parser.add_argument("--root", action="append", dest="roots")
    parser.add_argument("--no-download", action="store_true", help="Only compute the dependency package list.")
    args = parser.parse_args()

    if not shutil.which("apt-get"):
        print("apt-get is required; run this script on Raspberry Pi OS/Debian.", file=sys.stderr)
        return 2

    roots = tuple(args.roots or DEFAULT_ROOTS)
    out_dir = Path(args.out_dir).resolve()
    packages = simulate_empty_install(roots)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "roots": roots,
        "package_count": len(packages),
        "packages": packages,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Dependency packages: {len(packages)}")

    if args.no_download:
        print(f"Wrote manifest: {out_dir / 'manifest.json'}")
        return 0

    cwd = Path.cwd()
    try:
        os.chdir(out_dir)
        download_packages(packages, out_dir)
    finally:
        os.chdir(cwd)

    count, size = package_sizes(out_dir)
    manifest["downloaded_count"] = count
    manifest["downloaded_bytes"] = size
    manifest["downloaded_mb"] = round(size / 1024 / 1024, 1)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Downloaded {count} packages, {size / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
