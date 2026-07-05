// 文件：ui/js/router.js
// 职责：页面/子页切换（不使用框架，靠 class=active）

import { STATE, saveUiState } from "./state.js";
import { $all } from "./dom.js";

export function setActivePage(pageKey) {
  STATE.page = pageKey;
  saveUiState();

  // 顶部 tabs
  $all(".tab[data-page]").forEach(t => {
    t.classList.toggle("active", t.dataset.page === pageKey);
  });

  // 页面
  $all(".page[data-page]").forEach(p => {
    p.classList.toggle("active", p.dataset.page === pageKey);
  });
}

export function setActiveHardwareSub(subKey) {
  STATE.hardwareSub = subKey;
  saveUiState();

  // 二级 tabs
  $all(".subtab[data-subpage]").forEach(t => {
    t.classList.toggle("active", t.dataset.subpage === subKey);
  });

  // 子页
  $all(".subpage[data-subpage]").forEach(p => {
    p.classList.toggle("active", p.dataset.subpage === subKey);
  });
}
