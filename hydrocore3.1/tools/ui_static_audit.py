#!/usr/bin/env python3
"""Static UI audit for HydroCore.

Checks that are safe for an industrial controller:
- no network calls
- no backend API calls
- no GPIO/PWM access
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui"

ALLOW_VERSION_FILES = {
    UI / "dev" / "action_config_preview.html",
    UI / "dev" / "control_center_design_preview.html",
    UI / "dev" / "control_planner_redesign_preview.html",
}

ALLOW_THEME_COLOR_FILES = {
    UI / "styles" / "tokens.css",
    UI / "styles" / "themes" / "green-cyber.css",
    UI / "styles" / "themes" / "blue-cyber.css",
    UI / "dev" / "action_config_preview.html",
    UI / "dev" / "control_center_design_preview.html",
    UI / "dev" / "control_planner_redesign_preview.html",
}


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def expected_cache_version() -> str:
    text = (UI / "index.html").read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"/ui/js/app\.js\?v=([A-Za-z0-9_.-]+)", text)
    if not match:
        raise RuntimeError("Cannot find app.js cache version in ui/index.html")
    return match.group(1)


def iter_ui_files():
    for path in UI.rglob("*"):
        if "artifacts" in path.parts or "audits" in path.parts:
            continue
        if path.is_file() and path.suffix.lower() in {".html", ".js", ".css", ".json"}:
            yield path


def check_i18n() -> list[str]:
    zh = load_json(UI / "i18n" / "zh-CN.json")
    en = load_json(UI / "i18n" / "en-US.json")
    zh_keys = set(zh.keys())
    en_keys = set(en.keys())
    issues: list[str] = []
    for key in sorted(zh_keys - en_keys):
        issues.append(f"i18n missing in en-US: {key}")
    for key in sorted(en_keys - zh_keys):
        issues.append(f"i18n missing in zh-CN: {key}")
    return issues


def check_versions() -> list[str]:
    issues: list[str] = []
    expected_version = expected_cache_version()
    old_patterns = [
        "industrial-ui-16",
        "system-title-row-removed",
        "dashboard-calendar-lineicon",
        "dashboard-window-selector",
        "dashboard-frame-align",
    ]
    version_ref = re.compile(r"\?v=([A-Za-z0-9_.-]+)")
    for path in iter_ui_files():
        if path in ALLOW_VERSION_FILES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for old in old_patterns:
            if old in text:
                issues.append(f"old cache marker {old}: {rel(path)}")
        for match in version_ref.finditer(text):
            value = match.group(1)
            if value != expected_version:
                issues.append(f"cache version mismatch {value}: {rel(path)}")
    return issues


def check_theme_colors() -> list[str]:
    issues: list[str] = []
    hardcoded_green = re.compile(r"(rgba?\(\s*0\s*,\s*255\s*,\s*0\b|#00ff00\b|#008a00\b)", re.I)
    system_theme_color = re.compile(r"(rgba\(\s*(?:75\s*,\s*141\s*,\s*255|47\s*,\s*191\s*,\s*131)\b|#(?:4b8dff|1f5fbf|2fbf83|55d19c|176b4a)\b)", re.I)
    for path in iter_ui_files():
        if path in ALLOW_THEME_COLOR_FILES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for lineno, line in enumerate(text.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                continue
            if hardcoded_green.search(line):
                issues.append(f"hardcoded theme green: {rel(path)}:{lineno}: {stripped[:120]}")

    system_css = UI / "styles" / "pages" / "system.css"
    text = system_css.read_text(encoding="utf-8", errors="ignore")
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
            continue
        if system_theme_color.search(line):
            issues.append(f"system page hardcoded theme color: {rel(system_css)}:{lineno}: {stripped[:120]}")
    return issues


def check_no_bom() -> list[str]:
    issues: list[str] = []
    bom = b"\xef\xbb\xbf"
    for path in iter_ui_files():
        try:
            if path.read_bytes().startswith(bom):
                issues.append(f"utf-8 bom: {rel(path)}")
        except OSError:
            continue
    return issues


def check_touch_gesture_policy() -> list[str]:
    issues: list[str] = []
    for path in [UI / "index.html", UI / "lab" / "dashboard.html"]:
        text = path.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r'<meta\s+name=["\']viewport["\']\s+content=["\']([^"\']+)["\']', text, re.I)
        content = match.group(1) if match else ""
        for token in ["maximum-scale=1", "minimum-scale=1", "user-scalable=no"]:
            if token not in content:
                issues.append(f"viewport missing {token}: {rel(path)}")

    dashboard_css = (UI / "lab" / "css" / "dashboard.css").read_text(encoding="utf-8", errors="ignore")
    if ".chart" not in dashboard_css or "touch-action:none" not in dashboard_css.replace(" ", ""):
        issues.append("dashboard chart missing touch-action:none")
    if ".chart-wrap" not in dashboard_css or "touch-action:none" not in dashboard_css.replace(" ", ""):
        issues.append("dashboard chart wrapper missing touch-action:none")

    main_css = (UI / "styles" / "app.css").read_text(encoding="utf-8", errors="ignore")
    if "#page-dashboard #dashboardRoot iframe" not in main_css or "touch-action:none" not in main_css.replace(" ", ""):
        issues.append("dashboard iframe missing touch-action:none")

    dashboard_js = (UI / "lab" / "js" / "dashboard.js").read_text(encoding="utf-8", errors="ignore")
    for token in ["pinchZoomInstalled", "touchPanInstalled", "rangePickMode", "chart-select-overlay", 'type:"dataZoom"', "dispatchAction"]:
        if token not in dashboard_js:
            issues.append(f"dashboard touch gesture adapter missing {token}")

    kiosk = (ROOT / "packaging" / "hydrocore-kiosk-launch").read_text(encoding="utf-8", errors="ignore")
    if "--disable-pinch" not in kiosk:
        issues.append("kiosk chromium missing --disable-pinch")
    if "--overscroll-history-navigation=0" not in kiosk:
        issues.append("kiosk chromium missing --overscroll-history-navigation=0")
    return issues


def main() -> int:
    checks = [
        ("i18n", check_i18n()),
        ("cache_versions", check_versions()),
        ("theme_colors", check_theme_colors()),
        ("no_bom", check_no_bom()),
        ("touch_gesture_policy", check_touch_gesture_policy()),
    ]
    failed = False
    for name, issues in checks:
        if not issues:
            print(f"[PASS] {name}")
            continue
        failed = True
        print(f"[FAIL] {name}: {len(issues)}")
        for issue in issues:
            print(f"  - {issue}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
