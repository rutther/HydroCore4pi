// 文件：ui/js/state.js
// 职责：集中保存UI状态（页面/子页/主题/语言/扫描任务结果等）

export const STATE = {
  page: "hardware",          // dashboard | hardware | tasks | system
  hardwareSub: "scan",       // actuators | sensors | plan | scan

  lang: "zh-CN",             // zh-CN | en-US
  theme: "green",            // green | blue

  poller: {
    running: false,
    lastCheckTs: 0,
  },

  scan: {
    lastJobId: null,
    showRaw: false,
    lastResult: null,
  }
};

const UI_STATE_STORAGE_KEY = "hydrocore.ui.state.v1";

export function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === "object") {
      if (typeof saved.page === "string") STATE.page = saved.page;
      if (typeof saved.hardwareSub === "string") STATE.hardwareSub = saved.hardwareSub;
      if (saved.lang === "zh-CN" || saved.lang === "en-US") STATE.lang = saved.lang;
    }
  } catch (_) {
    // ignore invalid saved UI state
  }
}

export function saveUiState() {
  try {
    localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({
      page: STATE.page,
      hardwareSub: STATE.hardwareSub,
      lang: STATE.lang
    }));
  } catch (_) {
    // ignore storage write failures
  }
}
