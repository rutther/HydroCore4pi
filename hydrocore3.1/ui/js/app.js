// 文件：ui/js/app.js
// 职责：启动 UI（渲染 top-tabs/sub-tabs；绑定语言/主题；切换页面；初始化各页面模块）

import { STATE, loadUiState } from "./state.js";
import { initI18n, toggleLang, t, applyI18nToDom } from "./i18n.js";
import { initTheme, toggleTheme, getTheme } from "./theme.js?v=physical-execution-20260711-2";
import { startClock } from "./time.js";
import { setActivePage, setActiveHardwareSub } from "./router.js";

import { initHardwareScan } from "./pages/hardware/scan.js";
import { initHardwareSensors } from "./pages/hardware/sensors.js";
import { initHardwareVerify } from "./pages/hardware/verify.js";
import { initHardwarePlan } from "./pages/hardware/plan.js";
import { initDashboard } from "./pages/dashboard/dashboard.js?v=physical-execution-20260711-2";
import { initActionConfig } from "./pages/action_config/index.js?v=physical-execution-20260711-2";
import { initTasksPage } from "./pages/tasks.js?v=physical-execution-20260711-2";
import { initSystemPage, hydrateSystemChrome } from "./pages/system.js?v=physical-execution-20260711-2";

function renderTopTabs() {
  const top = document.getElementById("topTabs");
  top.innerHTML = "";

  const tabs = [
    { key: "dashboard",     labelKey: "nav.dashboard" },
    { key: "hardware",      labelKey: "nav.hardware" },
    { key: "action_config", labelKey: "nav.action_config" },
    { key: "tasks",         labelKey: "nav.tasks" },
    { key: "system",        labelKey: "nav.system" },
  ];

  function syncTopTabScroll(activeKey = STATE.page) {
    const active = top.querySelector(`.tab[data-page="${activeKey}"]`);
    if (!active) return;

    requestAnimationFrame(() => {
      if (window.matchMedia && window.matchMedia("(max-width: 879px)").matches) {
        const index = tabs.findIndex(x => x.key === activeKey);
        const targetLeft = index >= 4 ? Math.max(0, top.scrollWidth - top.clientWidth) : 0;
        top.scrollTo({ left: targetLeft, behavior: "auto" });
        return;
      }

      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  for (const it of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab" + (STATE.page === it.key ? " active" : "");
    btn.textContent = t(it.labelKey);
    btn.dataset.page = it.key;

    btn.onclick = async () => {
      setActivePage(it.key);
      syncTopTabScroll(it.key);

      if (it.key === "hardware") {
        setActiveHardwareSub(STATE.hardwareSub);
      } else if (it.key === "dashboard") {
        initDashboard();
      } else if (it.key === "action_config") {
        await initActionConfig();
      } else if (it.key === "tasks") {
        await initTasksPage();
      } else if (it.key === "system") {
        await initSystemPage();
      }
    };

    top.appendChild(btn);
  }

  syncTopTabScroll();
}

function renderHardwareSubTabs() {
  const wrap = document.getElementById("subTabs-hardware");
  const tabs = Array.from(wrap.querySelectorAll(".subtab[data-subpage]"));

  const map = {
    sensors: "hardware.sensors",
    verify:  "hardware.verify",
    plan:    "hardware.plan",
    scan:    "hardware.scan",
  };

  for (const btn of tabs) {
    const k = btn.dataset.subpage;
    btn.textContent = t(map[k]);

    btn.onclick = () => {
      setActiveHardwareSub(k);

      // 子页初始化/刷新：切到哪个子页就初始化哪个模块
      // 说明：这些 init 都是“覆盖式绑定 onclick”，重复调用不会叠加事件
      initActiveHardwareSub().catch(err => console.error(err));
    };
  }
}

async function initActiveHardwareSub() {
  if (STATE.hardwareSub === "scan") {
    initHardwareScan();
  } else if (STATE.hardwareSub === "sensors") {
    initHardwareSensors();
  } else if (STATE.hardwareSub === "verify") {
    await initHardwareVerify();
  } else if (STATE.hardwareSub === "plan") {
    initHardwarePlan();
  }
}

function applyStaticLabels() {
  // 扫描页固定标签（支持 i18n 切换）
  document.getElementById("scanTitleLeft").textContent  = t("hardware.scan.titleLeft");
  document.getElementById("scanTitleRight").textContent = t("hardware.scan.titleRight");

  document.getElementById("lblPort").textContent      = t("hardware.scan.port");
  document.getElementById("lblStartAddr").textContent = t("hardware.scan.startAddr");
  document.getElementById("lblEndAddr").textContent   = t("hardware.scan.endAddr");
  document.getElementById("lblBaud").textContent      = t("hardware.scan.baud");
  document.getElementById("lblFound").textContent     = t("hardware.scan.found");
  document.getElementById("lblJobId").textContent     = t("hardware.scan.jobId");
}

function bindGlobalButtons() {
  const btnLang = document.getElementById("btnTranslate");
  const btnTheme = document.getElementById("btnTheme");

  function updateThemeButton() {
    const theme = getTheme();
    const isBlue = theme === "blue-cyber";
    const isZh = STATE.lang === "zh-CN";
    btnTheme.textContent = isBlue ? (isZh ? "蓝" : "B") : (isZh ? "绿" : "G");
    btnTheme.title = isBlue
      ? (isZh ? "当前蓝色配色，点击切换为绿色" : "Current blue theme, switch to green")
      : (isZh ? "当前绿色配色，点击切换为蓝色" : "Current green theme, switch to blue");
    btnTheme.setAttribute("aria-label", btnTheme.title);
  }

  btnLang.onclick = async () => {
    await toggleLang();

    // 语言切换后：重绘 tabs 文案
    renderTopTabs();
    renderHardwareSubTabs();
    applyStaticLabels();
    applyI18nToDom();

    btnLang.textContent = (STATE.lang === "zh-CN") ? "中" : "EN";
    btnLang.title = (STATE.lang === "zh-CN") ? "当前中文，点击切换英文" : "Current English, switch to Chinese";
    btnLang.setAttribute("aria-label", btnLang.title);
    updateThemeButton();

    // 当前硬件子页也要随语言变化重绘，避免外壳已切换、页面正文仍停留在旧语言。
    if (STATE.page === "hardware") {
      await initActiveHardwareSub();
    }

    if (STATE.page === "dashboard") {
      initDashboard();
    }

    // 当前页如果是动作配置，则重绘动作配置页面
    if (STATE.page === "action_config") {
      await initActionConfig();
    }
    if (STATE.page === "tasks") {
      await initTasksPage();
    }
    if (STATE.page === "system") {
      await initSystemPage();
    }
  };

  btnTheme.onclick = () => {
    toggleTheme();
    updateThemeButton();
  };

  // 初始化显示
  btnLang.textContent = (STATE.lang === "zh-CN") ? "中" : "EN";
  btnLang.title = (STATE.lang === "zh-CN") ? "当前中文，点击切换英文" : "Current English, switch to Chinese";
  btnLang.setAttribute("aria-label", btnLang.title);
  updateThemeButton();
}

async function main() {
  loadUiState();
  initTheme();
  await initI18n();
  hydrateSystemChrome();

  // 空态文案
  applyI18nToDom();

  // 渲染导航
  renderTopTabs();
  renderHardwareSubTabs();
  applyStaticLabels();

  // 默认激活：硬件配置 + 硬件扫描
  setActivePage(STATE.page || "hardware");
  setActiveHardwareSub(STATE.hardwareSub || "scan");

  // 如果将来默认页改为 dashboard / action_config，这里也能初始化
  if (STATE.page === "dashboard") {
    initDashboard();
  } else if (STATE.page === "action_config") {
    await initActionConfig();
  } else if (STATE.page === "tasks") {
    await initTasksPage();
  } else if (STATE.page === "system") {
    await initSystemPage();
  } else if (STATE.page === "hardware") {
    await initActiveHardwareSub();
  }

  // 绑定全局按钮
  bindGlobalButtons();

  // 启动时间条
  startClock(document.getElementById("statusTime"));

  // 初始化硬件扫描页逻辑
}

main().catch(err => {
  console.error(err);
  const pageArea = document.getElementById("pageArea");
  pageArea.innerHTML = `<div class="empty-hint">启动失败：${String(err)}</div>`;
});


