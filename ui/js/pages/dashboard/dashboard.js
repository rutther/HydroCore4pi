// 文件：ui/js/pages/dashboard/dashboard.js
// 职责：主 UI 的 Dashboard 子页（止血版）
// 方案：用 iframe 嵌入一个“独立可访问”的 dashboard 页面，彻底隔离 CSS/JS，避免夺舍
// 依赖：/ui/lab/dashboard.html 已可独立访问且功能正常

const DASH_URL = "/ui/lab/dashboard.html?v=dashboard-calendar-lineicon-10";

let mounted = false;
let iframeEl = null;

export function initDashboard() {
  const mount = document.getElementById("dashboardRoot");
  if (!mount) return;

  // 重复进入 dashboard：不要反复创建 iframe（避免闪烁/重复加载）
  if (mounted && iframeEl && iframeEl.isConnected) return;

  mounted = true;
  mount.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.src = DASH_URL;

  // 新版  iframe支持全屏
  iframe.allowFullscreen = true;
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
}
