// 文件：ui/js/pages/system.js
// 职责：系统设置页。本页只处理本机身份、访问方式、运行状态和轻维护入口。

import { STATE } from "../state.js";

const API_STATUS = "/api/v1/system/status";
const API_PROFILE = "/api/v1/system/profile";

const TEXT = {
  "zh-CN": {
    title: "系统设置",
    subtitle: "本机身份、手机访问、运行状态和存储维护。",
    overview: "本机概览",
    menuProfile: "本机信息",
    menuAccess: "手机访问",
    menuServices: "运行状态",
    menuStorage: "存储维护",
    menuUi: "界面偏好",
    menuAdvanced: "高级维护",
    profile: "设备名片",
    deviceName: "本机名称",
    location: "现场位置",
    deviceId: "设备编号",
    logoText: "Logo 标识",
    save: "保存信息",
    saving: "正在保存...",
    saved: "已保存",
    access: "手机访问",
    accessHint: "同一局域网内，手机扫码即可打开控制界面。",
    copy: "复制链接",
    refreshQr: "刷新二维码",
    network: "当前网络",
    hostname: "主机名",
    ip: "IP 地址",
    port: "端口",
    services: "运行状态",
    storageStatus: "存储状态",
    web: "Web 界面",
    collection: "数据采集",
    plan: "任务计划",
    latest: "最近入库",
    storage: "存储空间",
    free: "剩余",
    database: "数据库",
    logs: "日志",
    backups: "备份",
    refresh: "刷新状态",
    advanced: "维护高级项",
    advancedHint: "重启服务、清空数据、恢复默认配置会影响现场运行，后续单独做二次确认流程。",
    running: "运行中",
    stopped: "已停止",
    notRunning: "未运行",
    enabled: "已启用",
    disabled: "未启用",
    noData: "--",
    copied: "已复制访问链接",
    copyFailed: "复制失败，请手动复制",
    loadFailed: "系统状态读取失败",
  },
  "en-US": {
    title: "System Settings",
    subtitle: "Device identity, phone access, runtime status, and storage maintenance.",
    overview: "Overview",
    menuProfile: "Device Info",
    menuAccess: "Phone Access",
    menuServices: "Runtime",
    menuStorage: "Storage",
    menuUi: "UI",
    menuAdvanced: "Advanced",
    profile: "Device Card",
    deviceName: "Device Name",
    location: "Site Location",
    deviceId: "Device ID",
    logoText: "Logo Text",
    save: "Save",
    saving: "Saving...",
    saved: "Saved",
    access: "Phone Access",
    accessHint: "Scan from a phone on the same LAN to open the control screen.",
    copy: "Copy Link",
    refreshQr: "Refresh QR",
    network: "Network",
    hostname: "Hostname",
    ip: "IP Address",
    port: "Port",
    services: "Runtime",
    storageStatus: "Storage Status",
    web: "Web UI",
    collection: "Data Collection",
    plan: "Plans",
    latest: "Latest Data",
    storage: "Storage",
    free: "Free",
    database: "Database",
    logs: "Logs",
    backups: "Backups",
    refresh: "Refresh",
    advanced: "Advanced Maintenance",
    advancedHint: "Restarting services, clearing data, and restoring defaults affect the site. They need a separate confirmation flow.",
    running: "Running",
    stopped: "Stopped",
    notRunning: "Not running",
    enabled: "Enabled",
    disabled: "Disabled",
    noData: "--",
    copied: "Link copied",
    copyFailed: "Copy failed",
    loadFailed: "Failed to read system status",
  },
};

function tx(key) {
  const dict = TEXT[STATE.lang] || TEXT["zh-CN"];
  return dict[key] || key;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function valueOrDash(value) {
  const text = String(value ?? "").trim();
  return text || tx("noData");
}

function boolText(value, on = tx("running"), off = tx("stopped")) {
  return value ? on : off;
}

function stateClass(value) {
  return value ? "ok" : "muted";
}

function setSystemChrome(profile) {
  const logo = document.querySelector(".logo-slot");
  if (!logo || !profile) return;
  logo.textContent = valueOrDash(profile.logo_text || "LOGO").slice(0, 8);
  logo.title = valueOrDash(profile.device_name || "HydroCore");
}

export async function hydrateSystemChrome() {
  try {
    const res = await fetch(API_PROFILE, { cache: "no-store" });
    const data = await res.json();
    if (data && data.ok) setSystemChrome(data.profile);
  } catch (_) {
    // Keep default chrome when the system API is not ready.
  }
}

async function apiJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `${res.status}`);
  }
  return data;
}

function renderMenu(status) {
  const services = status?.services || {};
  const storage = status?.storage || {};
  const network = status?.network || {};
  return `
    <aside class="system-menu">
      <div class="system-menu-title">${tx("overview")}</div>
      <div class="system-menu-item active">
        <span>${tx("menuProfile")}</span><strong>${escapeHtml(status?.profile?.device_name || "")}</strong>
      </div>
      <div class="system-menu-item">
        <span>${tx("menuAccess")}</span><strong>${escapeHtml(network.ip || "")}</strong>
      </div>
      <div class="system-menu-item">
        <span>${tx("menuServices")}</span><strong>${boolText(services.data_collection?.running)}</strong>
      </div>
      <div class="system-menu-item">
        <span>${tx("menuStorage")}</span><strong>${Number(storage.used_percent || 0).toFixed(1)}%</strong>
      </div>
      <div class="system-menu-item">
        <span>${tx("menuUi")}</span><strong>${STATE.lang}</strong>
      </div>
      <div class="system-menu-item danger">
        <span>${tx("menuAdvanced")}</span><strong>${tx("disabled")}</strong>
      </div>
    </aside>
  `;
}

function renderProfilePanel(profile) {
  return `
    <section class="system-panel system-profile-panel">
      <div class="system-panel-head">
        <h3>${tx("profile")}</h3>
        <div class="system-logo-preview" id="systemLogoPreview">${escapeHtml(profile.logo_text || "LOGO")}</div>
      </div>
      <div class="system-form">
        <label>
          <span>${tx("deviceName")}</span>
          <input class="system-input" id="sysDeviceName" maxlength="64" value="${escapeHtml(profile.device_name)}" />
        </label>
        <label>
          <span>${tx("location")}</span>
          <input class="system-input" id="sysLocation" maxlength="80" value="${escapeHtml(profile.site_location)}" />
        </label>
        <label>
          <span>${tx("deviceId")}</span>
          <input class="system-input" id="sysDeviceId" maxlength="64" value="${escapeHtml(profile.device_id)}" />
        </label>
        <label>
          <span>${tx("logoText")}</span>
          <input class="system-input" id="sysLogoText" maxlength="12" value="${escapeHtml(profile.logo_text)}" />
        </label>
      </div>
      <div class="system-actions">
        <button class="system-primary" id="sysSaveProfile" type="button">${tx("save")}</button>
        <span class="system-feedback" id="sysProfileFeedback"></span>
      </div>
    </section>
  `;
}

function renderAccessPanel(status) {
  const network = status.network || {};
  const accessUrl = network.access_url || "";
  const qrSrc = `/api/v1/system/qr.svg?text=${encodeURIComponent(accessUrl)}&v=${Date.now()}`;
  return `
    <section class="system-panel system-access-panel">
      <div class="system-panel-head">
        <h3>${tx("access")}</h3>
        <span class="system-mini">${tx("accessHint")}</span>
      </div>
      <div class="system-access-grid">
        <div class="system-qr-box">
          <img id="systemQr" alt="${tx("access")}" src="${qrSrc}" />
        </div>
        <div class="system-access-info">
          <div class="system-url" id="systemAccessUrl">${escapeHtml(accessUrl)}</div>
          <div class="system-kv">
            <span>${tx("hostname")}</span><strong>${escapeHtml(valueOrDash(network.hostname))}</strong>
            <span>${tx("ip")}</span><strong>${escapeHtml(valueOrDash(network.ip))}</strong>
            <span>${tx("port")}</span><strong>${escapeHtml(valueOrDash(network.port))}</strong>
          </div>
          <div class="system-actions">
            <button class="system-secondary" id="sysCopyUrl" type="button">${tx("copy")}</button>
            <button class="system-secondary" id="sysRefreshQr" type="button">${tx("refreshQr")}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderStatusPanel(status) {
  const services = status.services || {};
  return `
    <section class="system-panel system-service-panel">
      <div class="system-panel-head">
        <h3>${tx("services")}</h3>
        <button class="system-secondary" id="sysRefreshStatus" type="button">${tx("refresh")}</button>
      </div>
      <div class="system-status-list">
        <div class="system-row">
          <span><i class="system-dot ok"></i>${tx("web")}</span>
          <strong>${tx("running")}</strong>
        </div>
        <div class="system-row">
          <span><i class="system-dot ${stateClass(services.data_collection?.running)}"></i>${tx("collection")}</span>
          <strong>${boolText(services.data_collection?.running)}</strong>
        </div>
        <div class="system-row">
          <span><i class="system-dot ${stateClass(services.automation?.running)}"></i>${tx("plan")}</span>
          <strong>${services.automation?.enabled ? tx("enabled") : boolText(services.automation?.running, tx("running"), tx("notRunning"))}</strong>
        </div>
        <div class="system-row">
          <span>${tx("latest")}</span>
          <strong>${escapeHtml(valueOrDash(services.latest_data_ts))}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderStoragePanel(status) {
  const storage = status.storage || {};
  const used = Math.max(0, Math.min(100, Number(storage.used_percent || 0)));
  return `
    <section class="system-panel system-storage-panel">
      <div class="system-panel-head">
        <h3>${tx("storageStatus")}</h3>
        <strong class="system-storage-percent">${used.toFixed(1)}%</strong>
      </div>
      <div class="system-storage-main">
        <div class="system-storage-head">
          <span>${tx("storage")}</span>
          <strong>${tx("free")} ${escapeHtml(storage.free_text || "--")}</strong>
        </div>
        <div class="system-storage-bar"><i style="width:${used}%"></i></div>
        <div class="system-kv compact">
          <span>${tx("database")}</span><strong>${escapeHtml(storage.db_text || "--")}</strong>
          <span>${tx("logs")}</span><strong>${escapeHtml(storage.log_text || "--")}</strong>
          <span>${tx("backups")}</span><strong>${Number(storage.backup_count || 0)}</strong>
        </div>
      </div>
    </section>
  `;
}

function render(status, message = "") {
  const root = document.getElementById("systemRoot");
  if (!root) return;
  const profile = status?.profile || {};
  root.innerHTML = `
    <div class="system-page">
      ${renderMenu(status)}
      <main class="system-main">
        <div class="system-title-row">
          <div>
            <h2>${tx("title")}</h2>
            <p>${tx("subtitle")}</p>
          </div>
          <div class="system-current-time">${escapeHtml(status?.server_ts || "")}</div>
        </div>
        <div class="system-grid">
          ${renderProfilePanel(profile)}
          ${renderAccessPanel(status)}
          ${renderStatusPanel(status)}
          ${renderStoragePanel(status)}
        </div>
        <div class="system-page-feedback" id="sysPageFeedback">${escapeHtml(message)}</div>
      </main>
    </div>
  `;
  bindEvents(status);
}

function collectProfile() {
  return {
    device_name: document.getElementById("sysDeviceName")?.value || "",
    site_location: document.getElementById("sysLocation")?.value || "",
    device_id: document.getElementById("sysDeviceId")?.value || "",
    logo_text: document.getElementById("sysLogoText")?.value || "",
  };
}

function bindEvents(status) {
  const logoInput = document.getElementById("sysLogoText");
  const logoPreview = document.getElementById("systemLogoPreview");
  if (logoInput && logoPreview) {
    logoInput.oninput = () => {
      logoPreview.textContent = valueOrDash(logoInput.value || "LOGO").slice(0, 8);
    };
  }

  const saveBtn = document.getElementById("sysSaveProfile");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const feedback = document.getElementById("sysProfileFeedback");
      saveBtn.disabled = true;
      if (feedback) feedback.textContent = tx("saving");
      try {
        const data = await apiJson(API_PROFILE, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(collectProfile()),
        });
        setSystemChrome(data.profile);
        await initSystemPage(tx("saved"));
      } catch (err) {
        if (feedback) feedback.textContent = String(err.message || err);
      } finally {
        saveBtn.disabled = false;
      }
    };
  }

  const copyBtn = document.getElementById("sysCopyUrl");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const url = status?.network?.access_url || document.getElementById("systemAccessUrl")?.textContent || "";
      const feedback = document.getElementById("sysPageFeedback");
      try {
        await navigator.clipboard.writeText(url);
        if (feedback) feedback.textContent = tx("copied");
      } catch (_) {
        if (feedback) feedback.textContent = tx("copyFailed");
      }
    };
  }

  const refreshQr = document.getElementById("sysRefreshQr");
  if (refreshQr) {
    refreshQr.onclick = () => {
      const img = document.getElementById("systemQr");
      const url = status?.network?.access_url || "";
      if (img && url) img.src = `/api/v1/system/qr.svg?text=${encodeURIComponent(url)}&v=${Date.now()}`;
    };
  }

  const refreshStatus = document.getElementById("sysRefreshStatus");
  if (refreshStatus) {
    refreshStatus.onclick = () => initSystemPage();
  }
}

export async function initSystemPage(message = "") {
  const root = document.getElementById("systemRoot");
  if (!root) return;
  if (!root.innerHTML.trim()) {
    root.innerHTML = `<div class="system-loading">${tx("title")}...</div>`;
  }
  try {
    const status = await apiJson(API_STATUS, { cache: "no-store" });
    setSystemChrome(status.profile);
    render(status, message);
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="empty-hint">${tx("loadFailed")}：${escapeHtml(err.message || err)}</div></div>`;
  }
}

export function renderSystem(ctx) {
  const { contentEl } = ctx;
  contentEl.innerHTML = `<div id="systemRoot"></div>`;
  initSystemPage();
}
