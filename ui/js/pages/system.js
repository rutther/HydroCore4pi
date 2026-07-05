// 文件：ui/js/pages/system.js
// 职责：系统设置页（先空壳）

export function renderSystem(ctx) {
  const { contentEl, t } = ctx;
  contentEl.innerHTML = `
    <div class="card">
      <div class="empty-hint">${t("nav.system")}（空页面）</div>
    </div>
  `;
}
