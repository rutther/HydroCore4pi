// 文件：ui/js/pages/hardware/scan.js
// 职责：硬件扫描页面（可用）
// 功能：
// - 发起扫描（POST /api/v1/scan）
// - 查询结果（GET /api/v1/scan/<job_id>）
// - 展示地址/延迟/可选raw_hex

import { STATE } from "../../state.js";
// 串口问题
// import { apiScanStart, apiScanGet } from "../../api.js";
import { apiScanStart, apiScanGet, ensureSerialAllowed } from "../../api.js";
import { t } from "../../i18n.js";

function num(v, fallback) {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

function renderList(container, devices, showRaw) {
  container.innerHTML = "";

  if (!devices || devices.length === 0) {
    const div = document.createElement("div");
    div.className = "mini";
    div.textContent = t("hardware.scan.noDevices");
    container.appendChild(div);
    return;
  }

  for (const d of devices) {
    const row = document.createElement("div");
    row.className = "device";

    const p1 = document.createElement("div");
    p1.className = "pill";
    p1.textContent = `${t("hardware.scan.addr")}：${d.address}`;

    const p2 = document.createElement("div");
    p2.className = "pill gray";
    p2.textContent = `${t("hardware.scan.latency")}：${d.latency_ms}ms`;

    row.appendChild(p1);
    row.appendChild(p2);

    if (showRaw && d.raw_hex) {
      const raw = document.createElement("div");
      raw.className = "raw";
      raw.textContent = `raw_hex: ${d.raw_hex}`;
      row.appendChild(raw);
    }

    container.appendChild(row);
  }
}

export function initHardwareScan() {
  // 绑定 DOM
  const elPort   = document.getElementById("scanPort");
  const elStart  = document.getElementById("scanStart");
  const elEnd    = document.getElementById("scanEnd");
  const elBaud   = document.getElementById("scanBaud");

  const btnReset = document.getElementById("btnScanReset");
  const btnScan  = document.getElementById("btnScan");

  const elFound  = document.getElementById("scanFound");
  const elStatus = document.getElementById("scanStatus");

  const elJobId  = document.getElementById("scanJobId");
  const btnLoad  = document.getElementById("btnLoadJob");
  const elRange  = document.getElementById("scanTimeRange");
  const elList   = document.getElementById("scanList");
  const btnRaw   = document.getElementById("btnToggleRaw");

  // 默认值（和你实测一致）
  function resetForm() {
    elPort.value  = "/dev/ttyACM0";
    elStart.value = "1";
    elEnd.value   = "20";
    elBaud.value  = "9600";
    elFound.value = "-";
    elStatus.textContent = "";
  }

  async function loadJob(jobId) {
    elStatus.textContent = `${t("hardware.scan.loading")} #${jobId} ...`;

    const data = await apiScanGet(jobId);
    STATE.scan.lastResult = data;

    // job 时间范围
    const job = data.job || {};
    const tsStart = job.ts_start || "-";
    const tsEnd   = job.ts_end   || "-";
    elRange.textContent = `${t("hardware.scan.time")}：${tsStart} → ${tsEnd}`;

    // devices
    const devices = data.devices || [];
    renderList(elList, devices, STATE.scan.showRaw);

    elStatus.textContent = `${t("hardware.scan.loaded")} #${jobId}`;
  }

  btnReset.onclick = () => resetForm();

  btnScan.onclick = async () => {
    btnScan.disabled = true;
    elStatus.textContent = t("hardware.scan.scanning");


    try {

      // 串口守卫：poller 运行时禁止扫描
      await ensureSerialAllowed();


      // 不暴露 timeout，所以这里固定 0.3
      const req = {
        port: elPort.value.trim(),
        start_address: num(elStart.value, 1),
        end_address: num(elEnd.value, 20),
        baudrate: num(elBaud.value, 9600),
        timeout: 0.3
      };

      const res = await apiScanStart(req);





      // 兼容返回结构：found/job_id
      const jobId = res.job_id ?? res.jobId ?? null;
      const found = res.found ?? null;

      if (!jobId) {
        elStatus.textContent = t("hardware.scan.noJobId");
        return;
      }

      STATE.scan.lastJobId = jobId;
      elJobId.value = String(jobId);

      if (found !== null && found !== undefined) {
        elFound.value = String(found);
      } else {
        elFound.value = "-";
      }

      // 自动加载结果
      await loadJob(jobId);

    } catch (e) {
      elStatus.textContent = `${t("hardware.scan.failed")}：${String(e.message || e)}`;
    } finally {
      btnScan.disabled = false;
    }
  };

  btnLoad.onclick = async () => {
    const jobId = elJobId.value.trim();
    if (!jobId || jobId === "-") {
      elStatus.textContent = t("hardware.scan.needJobId");
      return;
    }
    try {
      await loadJob(jobId);
    } catch (e) {
      elStatus.textContent = `${t("hardware.scan.failed")}：${String(e.message || e)}`;
    }
  };

  btnRaw.onclick = () => {
    STATE.scan.showRaw = !STATE.scan.showRaw;
    btnRaw.textContent = STATE.scan.showRaw ? t("hardware.scan.hideRaw") : t("hardware.scan.showRaw");

    const data = STATE.scan.lastResult;
    if (data && data.devices) {
      renderList(elList, data.devices, STATE.scan.showRaw);
    }
  };

  // 初始化按钮文案
  btnReset.textContent = t("hardware.scan.reset");
  btnScan.textContent  = t("hardware.scan.scan");
  btnLoad.textContent  = t("hardware.scan.load");
  btnRaw.textContent   = STATE.scan.showRaw ? t("hardware.scan.hideRaw") : t("hardware.scan.showRaw");

  // 初始化空列表
  renderList(elList, [], STATE.scan.showRaw);

  // 初始表单
  resetForm();
}
