// 文件：ui/js/pages/hardware/index.js
// 职责：硬件配置页容器（渲染 sub-tabs 并分发到子页）
// 说明：此处只做 UI 壳；真正调用后端在 scan.js/plan.js 等子页后续接入。

import { renderHardwareScan } from "./scan.js";
import { renderHardwareActuators } from "./actuators.js";
import { renderHardwareSensors } from "./sensors.js";
import { renderHardwarePlan } from "./plan.js";

export function renderHardware(ctx) {
  const { route, subTabsEl, contentEl, t, setRoute } = ctx;

  // 显示 sub-tabs
  subTabsEl.style.display = "flex";
  subTabsEl.innerHTML = "";

  const subs = [
    { key: "scan",      label: t("hw.sub.scan") },
    { key: "actuators", label: t("hw.sub.actuators") },
    { key: "sensors",   label: t("hw.sub.sensors") },
    { key: "plan",      label: t("hw.sub.plan") },
  ];

  const active = route.sub || "scan";

  for (const it of subs) {
    const b = document.createElement("div");
    b.className = "subtab" + (it.key === active ? " active" : "");
    b.textContent = it.label;
    b.tabIndex = 0;

    b.onclick = () => setRoute("hardware", it.key);
    b.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); }
    };

    subTabsEl.appendChild(b);
  }

  // 内容区分发
  if (active === "scan")      { renderHardwareScan(ctx); return; }
  if (active === "actuators") { renderHardwareActuators(ctx); return; }
  if (active === "sensors")   { renderHardwareSensors(ctx); return; }
  if (active === "plan")      { renderHardwarePlan(ctx); return; }

  contentEl.innerHTML = `<div class="empty-hint">unknown hardware sub: ${active}</div>`;
}
