import { buildActionConfigTemplate } from "./template.js";
import { AC_STATE, resetActionConfigState } from "./store.js";
import {
  fetchProfileList,
  fetchProfileDetail,
  fetchCurrentProfile,
  confirmCurrentProfile,
  importProfileFile
} from "./api.js";
import {
  renderProfilePanel,
  bindProfilePanel,
  renderModuleTabs
} from "./profile-panel.js";
import {
  bindRuntimePanels,
  refreshActionRuntime
} from "./runtime-panel.js";
import { getAcText } from "./text.js";

async function loadListAndCurrent() {
  const listRes = await fetchProfileList();
  AC_STATE.profileItems = listRes.items || [];

  const currentRes = await fetchCurrentProfile();
  AC_STATE.currentProfile = currentRes.current || null;
}

function chooseInitialSelection() {
  if (AC_STATE.currentProfile?.filename) {
    AC_STATE.selectedFilename = AC_STATE.currentProfile.filename;
    AC_STATE.selectedType = AC_STATE.currentProfile.type || "";
    return;
  }

  if (AC_STATE.profileItems.length > 0) {
    AC_STATE.selectedFilename = AC_STATE.profileItems[0].filename;
    AC_STATE.selectedType = AC_STATE.profileItems[0].type;
    return;
  }

  AC_STATE.selectedFilename = "";
  AC_STATE.selectedType = "";
}

async function loadDetailByFilename(filename) {
  if (!filename) {
    AC_STATE.profileDetail = null;
    return;
  }
  const detailRes = await fetchProfileDetail(filename);
  AC_STATE.profileDetail = detailRes.item?.profile || null;
}

async function refreshProfilePanel() {
  await loadListAndCurrent();
  chooseInitialSelection();
  await loadDetailByFilename(AC_STATE.selectedFilename);
  renderProfilePanel();
}

async function handleTypeChange(typeValue) {
  AC_STATE.selectedType = typeValue;
  const items = AC_STATE.profileItems.filter((item) => item.type === typeValue);
  AC_STATE.selectedFilename = items[0]?.filename || "";
  await loadDetailByFilename(AC_STATE.selectedFilename);
  renderProfilePanel();
}

async function handleFilenameChange(filename) {
  AC_STATE.selectedFilename = filename;
  const item = AC_STATE.profileItems.find((entry) => entry.filename === filename);
  AC_STATE.selectedType = item ? item.type : "";
  await loadDetailByFilename(filename);
  renderProfilePanel();
}

async function handleConfirm() {
  const tx = getAcText();
  if (!AC_STATE.selectedFilename) {
    window.alert(tx.common.choosePreset);
    return;
  }

  const res = await confirmCurrentProfile(AC_STATE.selectedFilename);
  AC_STATE.currentProfile = res.current || null;
  renderProfilePanel();
  window.alert(tx.common.confirmed);
}

async function handleImport(file) {
  const tx = getAcText();
  if (!file) return;
  await importProfileFile(file);
  await refreshProfilePanel();
  window.alert(tx.common.imported);
}

async function activateTab(tab) {
  AC_STATE.activeTab = tab;
  renderModuleTabs();
  if (tab !== "profile") {
    await refreshActionRuntime(tab);
  }
}

function bindModuleTabs() {
  const tabButtons = Array.from(document.querySelectorAll(".ac-tab-btn[data-tab]"));
  tabButtons.forEach((btn) => {
    btn.onclick = async () => {
      await activateTab(btn.dataset.tab);
    };
  });
}

export async function initActionConfig(options = {}) {
  const allowedTabs = new Set(["profile", "actuator", "unit"]);
  const initialTab = allowedTabs.has(options.initialTab) ? options.initialTab : "profile";
  const root = document.getElementById("actionConfigRoot");
  if (!root) {
    throw new Error("Missing #actionConfigRoot");
  }

  root.innerHTML = buildActionConfigTemplate();

  bindModuleTabs();
  bindProfilePanel({
    onTypeChange: handleTypeChange,
    onFilenameChange: handleFilenameChange,
    onConfirm: handleConfirm,
    onImport: handleImport
  });
  bindRuntimePanels();

  resetActionConfigState();
  await refreshProfilePanel();
  await activateTab(initialTab);
}
