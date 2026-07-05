// 文件：ui/js/pages/hardware/actuators.js
// 职责：动作配置（空壳）

export function renderHardwareActuators(ctx) {
  const { contentEl, t } = ctx;
  contentEl.innerHTML = `
    <div class="card">
      <div class="empty-hint">${t("hw.sub.actuators")}（空页面）</div>
    </div>
  `;
}
