// 文件：ui/js/i18n.js
// 职责：最小i18n（internationalization，多语言）
// 机制：加载 /ui/i18n/xx.json，使用 data-i18n 或 JS 直接 t("key")

import { STATE, saveUiState } from "./state.js";

export const I18N = {
  dict: {},
};

export async function initI18n() {
  // 初始语言：跟随 HTML lang，默认 zh-CN
  const htmlLang = document.documentElement.lang || "zh-CN";
  if (STATE.lang !== "zh-CN" && STATE.lang !== "en-US") {
    STATE.lang = (htmlLang === "en-US") ? "en-US" : "zh-CN";
  }
  document.documentElement.lang = STATE.lang;
  await loadLang(STATE.lang);
}

export async function loadLang(lang) {
  const url = `/ui/i18n/${lang}.json`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`加载语言失败: ${lang} (${r.status})`);
  I18N.dict = await r.json();
}

export function t(key) {
  return I18N.dict[key] ?? key;
}

export function applyI18nToDom() {
  // 1) 通用 data-i18n
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const k = el.getAttribute("data-i18n");
    el.textContent = t(k);
  });

  // 2) 顶部 tabs / sub-tabs 文案（由 app.js 负责渲染时填充）
}

export async function toggleLang() {
  STATE.lang = (STATE.lang === "zh-CN") ? "en-US" : "zh-CN";
  document.documentElement.lang = STATE.lang;
  await loadLang(STATE.lang);
  applyI18nToDom();
  saveUiState();
}
