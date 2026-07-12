// 文件：ui/js/pages/dashboard/dashboard.js
// 职责：主 UI 的 Dashboard 子页（止血版）
// 方案：用 iframe 嵌入一个“独立可访问”的 dashboard 页面，彻底隔离 CSS/JS，避免夺舍
// 依赖：/ui/lab/dashboard.html 已可独立访问且功能正常

import { STATE } from "../../state.js";

const DASH_URL = "/ui/lab/dashboard.html?v=task-plan-final-20260711-5";

let mounted = false;
let iframeEl = null;
let iframeMode = "";
let iframeLang = "";
let resizeBound = false;
let resizeTimer = 0;

function dashboardUrlForShell() {
  const mode = window.innerWidth < 880 ? "phone" : "panel";
  const lang = STATE.lang === "en-US" ? "en-US" : "zh-CN";
  const sep = DASH_URL.includes("?") ? "&" : "?";
  return {
    mode,
    lang,
    src: `${DASH_URL}${sep}shellMode=${mode}&lang=${lang}`,
  };
}

function syncDashboardFrame() {
  if (!mounted || !iframeEl || !iframeEl.isConnected) return;
  const next = dashboardUrlForShell();
  if (iframeMode === next.mode && iframeLang === next.lang) return;
  iframeMode = next.mode;
  iframeLang = next.lang;
  iframeEl.src = next.src;
}

function bindDashboardResize() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(syncDashboardFrame, 120);
  }, { passive: true });
  window.addEventListener("orientationchange", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(syncDashboardFrame, 180);
  }, { passive: true });
}

export function initDashboard() {
  const mount = document.getElementById("dashboardRoot");
  if (!mount) return;
  bindDashboardResize();

  const next = dashboardUrlForShell();

  // 重复进入 dashboard：不要反复创建 iframe（避免闪烁/重复加载）
  if (mounted && iframeEl && iframeEl.isConnected) {
    if (iframeMode !== next.mode || iframeLang !== next.lang) {
      iframeMode = next.mode;
      iframeLang = next.lang;
      iframeEl.src = next.src;
    }
    return;
  }

  mounted = true;
  iframeMode = next.mode;
  iframeLang = next.lang;
  mount.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.src = next.src;

  // 允许仪表 iframe 使用全屏能力。
  iframe.setAttribute("allow", "fullscreen");

  iframe.style.width = "100%";
  iframe.style.height = "100%";          // 建议由父容器用 flex/高度撑满
  iframe.style.border = "0";
  iframe.style.borderRadius = "0";
  iframe.style.background = "transparent";

  // 让 iframe 不抢滚动条（可选，看你页面布局）
  iframe.setAttribute("scrolling", "no");

  iframeEl = iframe;
  mount.appendChild(iframe);
}

// 如果你的路由有“离开页面”的生命周期回调，就调用它做清理（可选，但更干净）
export function destroyDashboard() {
  mounted = false;
  if (iframeEl && iframeEl.parentNode) {
    iframeEl.parentNode.removeChild(iframeEl);
  }
  iframeEl = null;
  iframeMode = "";
  iframeLang = "";
}

