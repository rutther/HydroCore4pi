#!/usr/bin/env node
/*
 * Browser UI audit for HydroCore.
 *
 * This script is read-only from the product's point of view:
 * it opens pages, switches initial localStorage state, captures screenshots,
 * and checks layout. It does not click destructive controls.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const INDEX_HTML = fs.readFileSync(path.join(ROOT, "ui", "index.html"), "utf8");
const VERSION_MATCH = INDEX_HTML.match(/\/ui\/js\/app\.js\?v=([A-Za-z0-9_.-]+)/);
const VERSION = VERSION_MATCH ? VERSION_MATCH[1] : "dev";
const BASE_URL = process.env.HYDROCORE_UI_URL || `http://192.168.0.110:5000/ui/?v=${VERSION}`;
const OUT_DIR = path.join(ROOT, "ui", "dev", "artifacts", `ui-browser-audit-${VERSION}`);
const CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const VIEWPORTS = [
  { name: "landscape-1280x800", width: 1280, height: 800 },
  { name: "portrait-800x1280", width: 800, height: 1280 },
  { name: "breakpoint-900x844", width: 900, height: 844 },
  { name: "breakpoint-880x844", width: 880, height: 844 },
  { name: "breakpoint-879x844", width: 879, height: 844 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-390x740", width: 390, height: 740 },
  { name: "mobile-430x740", width: 430, height: 740 },
];

const LANGS = ["zh-CN", "en-US"];
const THEMES = ["green-cyber", "blue-cyber"];

const PAGES = [
  { name: "dashboard", page: "dashboard", hardwareSub: "scan" },
  { name: "hardware-scan", page: "hardware", hardwareSub: "scan" },
  { name: "action-config", page: "action_config", hardwareSub: "scan" },
  { name: "tasks", page: "tasks", hardwareSub: "scan" },
  { name: "system", page: "system", hardwareSub: "scan" },
];

function safeName(...parts) {
  return parts.join("__").replace(/[^a-z0-9_.-]+/gi, "_");
}

async function collectIssues(page) {
  return await page.evaluate((expectedVersion) => {
    const issues = [];
    const isVisible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const labelFor = (el) => {
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.id || el.className || el.tagName)
        .toString()
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80);
      return text || el.tagName.toLowerCase();
    };

    const textLineCount = (el) => {
      const tops = new Set();
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.nodeValue || !node.nodeValue.trim()) return;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width > 1 && rect.height > 1) tops.add(Math.round(rect.top));
          }
          range.detach();
          return;
        }
        for (const child of node.childNodes || []) visit(child);
      };
      visit(el);
      return tops.size || 1;
    };

    const shell = document.querySelector(".shell");
    const shellRect = shell ? shell.getBoundingClientRect() : null;
    if (!shell) {
      issues.push({ type: "missing-shell", text: "missing .shell" });
    }
    if (document.body.scrollWidth > window.innerWidth + 4) {
      issues.push({
        type: "body-horizontal-overflow",
        text: `${document.body.scrollWidth}px > ${window.innerWidth}px`,
      });
    }
    if (shellRect && shellRect.right > window.innerWidth + 4) {
      issues.push({
        type: "shell-overflow-right",
        text: `${Math.round(shellRect.right)}px > ${window.innerWidth}px`,
      });
    }

    const selectors = [
      "button",
      ".btn",
      ".tab",
      ".subtab",
      ".pill",
      "input",
      "select",
      "textarea",
      ".system-menu-item",
      ".system-kv",
      ".task-plan-card",
      ".task-plan-field",
      ".ac-unit-card",
    ].join(",");

    for (const el of document.querySelectorAll(selectors)) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const isControlButton = el.matches([
        ".btn",
        ".tab",
        ".subtab",
        ".pill",
        ".icon-btn",
        ".ac-tab-btn",
        ".task-filter-pill",
        ".system-primary",
        ".system-secondary",
        ".system-danger",
      ].join(","));
      const overflowX = el.scrollWidth > el.clientWidth + 2;
      const overflowY = el.scrollHeight > el.clientHeight + 2;
      if ((overflowX || overflowY) && style.overflow !== "visible") {
        issues.push({
          type: "element-overflow",
          text: `${labelFor(el)} ${Math.round(rect.width)}x${Math.round(rect.height)} scroll ${el.scrollWidth}x${el.scrollHeight}`,
        });
      }
      if (isControlButton && rect.height < 34) {
        issues.push({
          type: "small-touch-target",
          text: `${labelFor(el)} height ${Math.round(rect.height)}px`,
        });
      }
      if (isControlButton) {
        const textWraps = textLineCount(el) > 1;
        const textClips = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
        if (textWraps || textClips) {
          issues.push({
            type: "button-text-overflow",
            text: `${labelFor(el)} box ${Math.round(rect.width)}x${Math.round(rect.height)} scroll ${el.scrollWidth}x${el.scrollHeight}`,
          });
        }
      }
    }

    for (const el of document.querySelectorAll(".system-screen-status strong")) {
      if (!isVisible(el)) continue;
      if (el.scrollWidth > el.clientWidth + 2) {
        issues.push({
          type: "system-status-text-overflow",
          text: `${labelFor(el)} ${el.clientWidth}px < ${el.scrollWidth}px`,
        });
      }
    }

    const themeHref = document.getElementById("themeStylesheet")?.href || "";
    if (!themeHref.includes(expectedVersion)) {
      issues.push({ type: "theme-version", text: themeHref || "missing theme href" });
    }

    if (document.querySelector(".system-page")) {
      const menu = document.querySelector(".system-menu");
      const storage = document.querySelector(".system-storage-panel");
      if (menu && storage && isVisible(menu) && isVisible(storage)) {
        const menuRect = menu.getBoundingClientRect();
        const storageRect = storage.getBoundingClientRect();
        const sideBySide = menuRect.right < storageRect.left && Math.abs(menuRect.top - storageRect.top) < 4;
        if (sideBySide && Math.abs(menuRect.bottom - storageRect.bottom) > 2) {
          issues.push({
            type: "system-bottom-misalignment",
            text: `overview bottom ${Math.round(menuRect.bottom)} storage bottom ${Math.round(storageRect.bottom)}`,
          });
        }
      }

      const logoPreview = document.querySelector("#systemLogoPreview");
      if (logoPreview && isVisible(logoPreview)) {
        const logoBorder = getComputedStyle(logoPreview).borderTopColor.replace(/\s+/g, "");
        const accentBorder = getComputedStyle(document.documentElement).getPropertyValue("--accent-line-strong").trim().replace(/\s+/g, "");
        if (accentBorder && logoBorder !== accentBorder) {
          issues.push({
            type: "system-logo-theme-border",
            text: `${logoBorder} != ${accentBorder}`,
          });
        }
      }

      for (const panel of document.querySelectorAll(".system-panel")) {
        if (!isVisible(panel)) continue;
        const rect = panel.getBoundingClientRect();
        const escaped = [];
        for (const child of panel.querySelectorAll(":scope > *")) {
          if (!isVisible(child)) continue;
          const childRect = child.getBoundingClientRect();
          if (childRect.bottom > rect.bottom + 2 || childRect.right > rect.right + 2) {
            escaped.push(labelFor(child));
          }
        }
        if (escaped.length) {
          issues.push({
            type: "system-panel-clipping",
            text: `${labelFor(panel)} escaped children: ${escaped.slice(0, 3).join(" | ")}`,
          });
        }
      }
    }

    return issues;
  }, VERSION);
}

async function collectDashboardIssues(page, viewport) {
  const iframe = page.frame({ url: /\/ui\/lab\/dashboard\.html/ });
  if (!iframe) return [{ type: "dashboard-frame-missing", text: "missing /ui/lab/dashboard.html iframe" }];

  return await iframe.evaluate(({ width }) => {
    const issues = [];
    const mode = document.documentElement.dataset.shellMode || "";
    const expectedMode = width < 880 ? "phone" : "panel";
    if (mode !== expectedMode) {
      issues.push({ type: "dashboard-shell-mode", text: `${mode || "(empty)"} != ${expectedMode}` });
    }

    const docWidth = document.documentElement.clientWidth;
    const docScrollWidth = document.documentElement.scrollWidth;
    if (docScrollWidth > docWidth + 4) {
      issues.push({ type: "dashboard-horizontal-overflow", text: `${docScrollWidth}px > ${docWidth}px` });
    }

    const body = document.querySelector(".body");
    if (!body) {
      issues.push({ type: "dashboard-body-missing", text: "missing .body" });
      return issues;
    }

    const cols = getComputedStyle(body).gridTemplateColumns;
    const colCount = cols.split(" ").filter(Boolean).length;
    if (expectedMode === "phone" && colCount !== 1) {
      issues.push({ type: "dashboard-phone-columns", text: cols });
    }
    if (expectedMode === "panel" && colCount < 2) {
      issues.push({ type: "dashboard-panel-columns", text: cols });
    }

    for (const item of document.querySelectorAll(".series-list .item")) {
      if (item.scrollWidth > item.clientWidth + 2) {
        issues.push({
          type: "dashboard-series-card-overflow",
          text: (item.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
        });
        break;
      }
      const mid = item.querySelector(".item-mid");
      if (mid && mid.scrollWidth > mid.clientWidth + 2) {
        issues.push({
          type: "dashboard-series-value-overflow",
          text: (item.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
        });
        break;
      }
    }

    return issues;
  }, { width: viewport.width });
}

async function runCase(browser, item) {
  const context = await browser.newContext({
    viewport: { width: item.viewport.width, height: item.viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!/Failed to load resource/i.test(text)) consoleErrors.push(text);
    }
  });

  await page.addInitScript(({ lang, theme, route }) => {
    localStorage.setItem("hydrocore.ui.state.v1", JSON.stringify({
      page: route.page,
      hardwareSub: route.hardwareSub,
      lang,
    }));
    localStorage.setItem("hydrocore_theme", theme);
  }, { lang: item.lang, theme: item.theme, route: item.route });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(item.route.name === "dashboard" ? 2500 : 1200);

  const shotName = `${safeName(item.viewport.name, item.lang, item.theme, item.route.name)}.png`;
  const shotPath = path.join(OUT_DIR, shotName);
  await page.screenshot({ path: shotPath, fullPage: false });

  const issues = await collectIssues(page);
  if (item.route.name === "dashboard") {
    issues.push(...await collectDashboardIssues(page, item.viewport));
  }
  for (const err of consoleErrors) {
    issues.push({ type: "console-error", text: err.slice(0, 160) });
  }
  await context.close();
  return { ...item, screenshot: shotPath, issues };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const executablePath = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      for (const lang of LANGS) {
        for (const theme of THEMES) {
          for (const route of PAGES) {
            const result = await runCase(browser, { viewport, lang, theme, route });
            results.push(result);
            const label = `${viewport.name} ${lang} ${theme} ${route.name}`;
            if (result.issues.length) {
              console.log(`[FAIL] ${label}`);
              for (const issue of result.issues.slice(0, 12)) {
                console.log(`  - ${issue.type}: ${issue.text}`);
              }
              if (result.issues.length > 12) {
                console.log(`  - ... ${result.issues.length - 12} more`);
              }
              console.log(`  screenshot: ${result.screenshot}`);
            } else {
              console.log(`[PASS] ${label}`);
            }
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    baseUrl: BASE_URL,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    results: results.map((r) => ({
      viewport: r.viewport.name,
      lang: r.lang,
      theme: r.theme,
      page: r.route.name,
      screenshot: r.screenshot,
      issues: r.issues,
    })),
  }, null, 2));

  const failures = results.filter((r) => r.issues.length);
  console.log(`\nScreenshots: ${OUT_DIR}`);
  console.log(`Report: ${reportPath}`);
  if (failures.length) {
    console.log(`Failed cases: ${failures.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`All ${results.length} cases passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
