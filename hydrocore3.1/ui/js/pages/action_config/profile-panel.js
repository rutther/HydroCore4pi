import { AC_STATE } from "./store.js";
import { getAcText } from "./text.js?v=system-layout-clean-20260711-2";

function uniqueTypes(items) {
  return [...new Set(items.map((x) => x.type))];
}

function versionsByType(items, type) {
  return items.filter((x) => x.type === type);
}

function boardTypeLabel(type) {
  return type || "-";
}

function boardPresetLabel(itemOrVersion) {
  if (typeof itemOrVersion === "object") {
    return itemOrVersion?.filename || itemOrVersion?.version || "-";
  }
  return itemOrVersion ? String(itemOrVersion) : "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openLevelText(value) {
  const tx = getAcText();
  return tx.profile.levelMap[value] || value || "-";
}

export function renderModuleTabs() {
  const tabButtons = Array.from(document.querySelectorAll(".ac-tab-btn[data-tab]"));
  const panels = Array.from(document.querySelectorAll(".ac-panel[data-tab-panel]"));

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === AC_STATE.activeTab);
  });

  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === AC_STATE.activeTab);
  });
}

export function renderProfilePanel() {
  const tx = getAcText();
  const typeSelect = document.getElementById("acProfileType");
  const versionSelect = document.getElementById("acProfileVersion");
  const statusBox = document.getElementById("acProfileStatus");
  const summaryBox = document.getElementById("acProfileSummary");
  const jsonBox = document.getElementById("acProfileJson");
  const currentBox = document.getElementById("acCurrentProfileBox");

  if (!typeSelect || !versionSelect || !statusBox || !summaryBox || !jsonBox || !currentBox) {
    return;
  }

  const types = uniqueTypes(AC_STATE.profileItems);
  typeSelect.innerHTML = "";
  for (const type of types) {
    const op = document.createElement("option");
    op.value = type;
    op.textContent = boardTypeLabel(type);
    typeSelect.appendChild(op);
  }

  if (AC_STATE.selectedType && types.includes(AC_STATE.selectedType)) {
    typeSelect.value = AC_STATE.selectedType;
  } else if (types.length > 0) {
    AC_STATE.selectedType = types[0];
    typeSelect.value = types[0];
  }

  const versions = versionsByType(AC_STATE.profileItems, AC_STATE.selectedType);
  versionSelect.innerHTML = "";
  for (const item of versions) {
    const op = document.createElement("option");
    op.value = item.filename;
    op.textContent = boardPresetLabel(item);
    versionSelect.appendChild(op);
  }

  if (AC_STATE.selectedFilename && versions.some((x) => x.filename === AC_STATE.selectedFilename)) {
    versionSelect.value = AC_STATE.selectedFilename;
  } else if (versions.length > 0) {
    AC_STATE.selectedFilename = versions[0].filename;
    versionSelect.value = versions[0].filename;
  } else {
    AC_STATE.selectedFilename = "";
  }

  statusBox.textContent = AC_STATE.profileItems.length > 0
    ? tx.profile.loaded(AC_STATE.profileItems.length)
    : tx.profile.empty;

  const profile = AC_STATE.profileDetail;
  if (!profile) {
    summaryBox.innerHTML = tx.profile.empty;
    jsonBox.textContent = tx.profile.empty;
  } else {
    const switchPins = (profile.capabilities?.switch_output_pins || []).join(", ");
    const pwmPins = (profile.capabilities?.pwm_output_pins || []).join(", ");
    const range = profile.capabilities?.pwm_freq_hz_range || ["-", "-"];
    const defaultFreq = profile.capabilities?.pwm_default_freq_hz ?? "-";
    const openLevel = profile.defaults?.switch_open_level || "-";
    const f = tx.profile.fields;
    summaryBox.innerHTML = `
      <div class="ac-summary-row"><div class="ac-summary-key">${f.name}</div><div class="ac-summary-val">${escapeHtml(profile.name || "-")}</div></div>
      <div class="ac-summary-row"><div class="ac-summary-key">${f.description}</div><div class="ac-summary-val">${escapeHtml(profile.description || "-")}</div></div>
      <div class="ac-summary-row"><div class="ac-summary-key">${f.switchPins}</div><div class="ac-summary-val">${escapeHtml(switchPins || "-")}</div></div>
      <div class="ac-summary-row"><div class="ac-summary-key">${f.pwmPins}</div><div class="ac-summary-val">${escapeHtml(pwmPins || "-")}</div></div>
      <div class="ac-summary-row"><div class="ac-summary-key">${f.pwmRange}</div><div class="ac-summary-val">${escapeHtml(`${range[0]} ~ ${range[1]} Hz`)}</div></div>
      <div class="ac-summary-row"><div class="ac-summary-key">${f.pwmDefault}</div><div class="ac-summary-val">${escapeHtml(String(defaultFreq))}</div></div>
      <div class="ac-summary-row"><div class="ac-summary-key">${f.openLevel}</div><div class="ac-summary-val">${escapeHtml(openLevelText(openLevel))}</div></div>
    `;
    jsonBox.textContent = JSON.stringify(profile, null, 2);
  }

  const current = AC_STATE.currentProfile;
  if (!current) {
    currentBox.textContent = tx.profile.notConfirmed;
  } else {
    const f = tx.profile.fields;
    const currentName = current.profile?.name || current.filename || "-";
    const currentDesc = current.profile?.description || "";
    currentBox.innerHTML = `
      <div class="ac-current-row"><span class="ac-current-key">${f.name}</span><span class="ac-current-val">${escapeHtml(currentName)}</span></div>
      <div class="ac-current-row"><span class="ac-current-key">${f.type}</span><span class="ac-current-val">${escapeHtml(boardTypeLabel(current.type))}</span></div>
      <div class="ac-current-row"><span class="ac-current-key">${f.version}</span><span class="ac-current-val">${escapeHtml(boardPresetLabel(current))}</span></div>
      ${currentDesc ? `<div class="ac-current-row ac-current-row-muted"><span class="ac-current-key">${f.description}</span><span class="ac-current-val">${escapeHtml(currentDesc)}</span></div>` : ""}
    `;
  }
}

export function bindProfilePanel({ onTypeChange, onFilenameChange, onConfirm, onImport }) {
  const typeSelect = document.getElementById("acProfileType");
  const versionSelect = document.getElementById("acProfileVersion");
  const btnConfirm = document.getElementById("btnAcConfirm");
  const btnImport = document.getElementById("btnAcImport");
  const fileInput = document.getElementById("acProfileFileInput");

  if (typeSelect) {
    typeSelect.onchange = async () => {
      await onTypeChange(typeSelect.value);
    };
  }

  if (versionSelect) {
    versionSelect.onchange = async () => {
      await onFilenameChange(versionSelect.value);
    };
  }

  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      await onConfirm();
    };
  }

  if (btnImport && fileInput) {
    btnImport.onclick = () => {
      fileInput.click();
    };

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      await onImport(file);
      fileInput.value = "";
    };
  }
}
