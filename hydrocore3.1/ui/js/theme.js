// 文件：ui/js/theme.js
// 职责：主题（Theme，样式主题）管理：初始化 + 切换
// 约定：主题 CSS 放在 /ui/styles/themes/*.css
// 当前内置：green-cyber.css / blue-cyber.css

const STORAGE_KEY = "hydrocore_theme";

const THEMES = {
  "green-cyber": "/ui/styles/themes/green-cyber.css?v=industrial-ui-16",
  "blue-cyber": "/ui/styles/themes/blue-cyber.css?v=industrial-ui-16",
};

function ensureThemeLinkEl() {
  // 统一使用一个 <link> 来挂载主题 CSS，避免重复插入
  let link = document.getElementById("themeStylesheet");
  if (!link) {
    link = document.createElement("link");
    link.id = "themeStylesheet";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  return link;
}

export function initTheme() {
  // 启动时应用主题：localStorage > 默认
  const saved = localStorage.getItem(STORAGE_KEY);
  const name = (saved && THEMES[saved]) ? saved : "green-cyber";
  applyTheme(name);
}

export function toggleTheme() {
  const current = localStorage.getItem(STORAGE_KEY);
  const next = current === "blue-cyber" ? "green-cyber" : "blue-cyber";
  applyTheme(next);
}

export function applyTheme(name) {
  const themeName = THEMES[name] ? name : "green-cyber";
  const href = THEMES[themeName];

  const link = ensureThemeLinkEl();
  link.href = href;

  // 给 DOM 挂一个标记（以后你想按主题做细节微调会很方便）
  document.documentElement.dataset.theme = themeName;

  localStorage.setItem(STORAGE_KEY, themeName);
}

export function getTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return (saved && THEMES[saved]) ? saved : "green-cyber";
}
