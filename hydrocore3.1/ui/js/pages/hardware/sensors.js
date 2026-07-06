// 文件：ui/js/pages/hardware/sensors.js
// 职责：硬件配置 -> 传感配置子页（第一阶段：设备定义文件管理）
//
// 本阶段目标（你要求的 1~4）：
// 1) 列出当前有几个“设备定义文件”（内置 + 用户）
// 2) 支持导入（上传）用户定义文件
// 3) 支持只读查看 JSON 原文
// 4) 支持表格化查看 JSON 中的字段定义
//
// 依赖后端接口：
// - GET    /api/v1/meta/protocols
// - GET    /api/v1/meta/protocols/<name>
// - POST   /api/v1/meta/protocols/upload  (multipart/form-data)
// - DELETE /api/v1/meta/protocols/<name>  (仅用户库允许)
//
// 注意：
// - 内置（builtin）不可删除；用户（user）可删除
// - 此阶段不做“设备验证/改地址/写寄存器/采集计划编辑”，全部挂起等下一步

import {
  apiProtocolsList,
  apiProtocolGet,
  apiProtocolUpload,
  apiProtocolDelete
} from "../../api.js";

function $(id) { return document.getElementById(id); }

function setText(el, s) { if (el) el.textContent = (s ?? ""); }

function fmtTime(sec) {
  // mtime 你后端返回的是 epoch 秒（你实测是整数）
  if (!sec) return "-";
  const d = new Date(Number(sec) * 1000);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderProtoList(container, items, onPick) {
  container.innerHTML = "";

  if (!items.length) {
    const div = document.createElement("div");
    div.className = "mini";
    div.textContent = "（空）";
    container.appendChild(div);
    return;
  }

  for (const it of items) {
    // 复用 scan 页的“device row”视觉：pill + pill gray
    const row = document.createElement("div");
    row.className = "device";
    row.style.cursor = "pointer";

    const pillName = document.createElement("div");
    pillName.className = "pill";
    pillName.textContent = it.name;

    const pillMeta = document.createElement("div");
    pillMeta.className = "pill gray";
    const size = (it.size ?? 0);
    pillMeta.textContent = `size=${size}B  mtime=${fmtTime(it.mtime)}`;

    row.appendChild(pillName);
    row.appendChild(pillMeta);

    row.onclick = () => onPick(it);

    container.appendChild(row);
  }
}

function renderProtoTable(container, protocolObj) {
  container.innerHTML = "";

  if (!protocolObj || typeof protocolObj !== "object") {
    const div = document.createElement("div");
    div.className = "mini";
    div.textContent = "（无数据）";
    container.appendChild(div);
    return;
  }

  // protocolObj 结构：{ "__meta__": {...}, "ec_value": {...}, ... }
  const keys = Object.keys(protocolObj)
    .filter(k => k !== "__meta__")
    .sort((a,b) => a.localeCompare(b));

  if (!keys.length) {
    const div = document.createElement("div");
    div.className = "mini";
    div.textContent = "（没有字段项）";
    container.appendChild(div);
    return;
  }

  // 用原生 table：避免额外 CSS 依赖
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "14px";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");

  const headers = ["name", "addr", "type", "length", "access", "label_zh", "unit", "description"];
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    th.style.textAlign = "left";
    th.style.padding = "6px 8px";
    th.style.borderBottom = "1px solid rgba(0,255,0,0.35)";
    th.style.color = "rgba(255,255,255,0.9)";
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const k of keys) {
    const v = protocolObj[k];
    if (!v || typeof v !== "object") continue;

    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

    const cols = [
      k,
      v.addr,
      v.type,
      v.length,
      v.access,
      v.label_zh,
      v.unit,
      v.description
    ];

    for (const c of cols) {
      const td = document.createElement("td");
      td.textContent = (c === undefined || c === null) ? "" : String(c);
      td.style.padding = "6px 8px";
      td.style.verticalAlign = "top";
      td.style.color = "rgba(255,255,255,0.85)";
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

export function initHardwareSensors() {
  // DOM（左）
  const btnRefresh = $("btnProtoRefresh");
  const btnUpload = $("btnProtoUpload");
  const fileInput = $("protoFileInput");
  const elStatus = $("protoStatus");
  const listBuiltin = $("protoListBuiltin");
  const listUser = $("protoListUser");

  // DOM（右）
  const elName = $("protoName");
  const elSourcePill = $("protoSourcePill");
  const btnDelete = $("btnProtoDelete");
  const elJson = $("protoJson");
  const elTable = $("protoTable");

  // 防御：如果 DOM 没有（说明 index.html 没替换成功），直接退出
  if (!btnRefresh || !btnUpload || !fileInput || !listBuiltin || !listUser ||
      !elName || !elSourcePill || !btnDelete || !elJson || !elTable) {
    console.error("[sensors] missing dom nodes, check ui/index.html sensors subpage");
    return;
  }

  let current = null; // {name, source, ...}
  let currentJson = null;

  function setStatus(s) { setText(elStatus, s); }

  async function loadList(autoPickFirst = true) {
    setStatus("加载列表中...");
    const data = await apiProtocolsList();
    const items = Array.isArray(data?.items) ? data.items : [];

    const builtin = items.filter(x => x.source === "builtin");
    const user = items.filter(x => x.source === "user");

    renderProtoList(listBuiltin, builtin, onPick);
    renderProtoList(listUser, user, onPick);

    setStatus(`共 ${items.length} 个：内置 ${builtin.length}，用户 ${user.length}`);

    if (autoPickFirst) {
      // 若当前没选中，则优先选中用户第一条，否则选内置第一条
      if (!current) {
        const first = user[0] || builtin[0] || null;
        if (first) await onPick(first);
      }
    }
  }

  async function onPick(item) {
    current = item;
    currentJson = null;

    setText(elName, item.name);
    setText(elSourcePill, `来源：${item.source === "builtin" ? "内置" : "用户"}`);

    // 删除按钮只对用户显示
    btnDelete.style.display = (item.source === "user") ? "inline-flex" : "none";

    setText(elJson, "加载中...");
    elTable.innerHTML = "";

    const data = await apiProtocolGet(item.name);
    currentJson = data?.protocol || null;

    // JSON 展示（只读）
    setText(elJson, JSON.stringify(currentJson, null, 2));

    // 表格化展示
    renderProtoTable(elTable, currentJson);
  }

  btnRefresh.onclick = async () => {
    try { await loadList(false); }
    catch (e) { setStatus(`刷新失败：${String(e.message || e)}`); }
  };

  btnUpload.onclick = () => {
    // 触发选择文件
    fileInput.value = "";
    fileInput.click();
  };

  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;

    // 基础校验：扩展名
    if (!f.name.toLowerCase().endsWith(".json")) {
      setStatus("只允许上传 .json 文件");
      return;
    }

    try {
      setStatus(`上传中：${f.name} ...`);
      const res = await apiProtocolUpload(f);
      setStatus(`上传成功：${res?.name || f.name}`);
      // 上传后刷新列表，并选中该文件
      await loadList(false);

      // 尝试选中上传后的 name
      const name = res?.name || f.name.replace(/\.json$/i, "");
      // 直接 get 一次（不用遍历 DOM）
      await onPick({ name, source: "user" });
    } catch (e) {
      setStatus(`上传失败：${String(e.message || e)}`);
    }
  };

  btnDelete.onclick = async () => {
    if (!current || current.source !== "user") return;

    const ok = window.confirm(`确定删除用户定义文件：${current.name} ?`);
    if (!ok) return;

    try {
      setStatus(`删除中：${current.name} ...`);
      await apiProtocolDelete(current.name);
      setStatus(`已删除：${current.name}`);

      // 清空右侧
      current = null;
      currentJson = null;
      setText(elName, "-");
      setText(elSourcePill, "来源：-");
      btnDelete.style.display = "none";
      setText(elJson, "（未选择）");
      elTable.innerHTML = "";

      // 刷新列表
      await loadList(true);
    } catch (e) {
      setStatus(`删除失败：${String(e.message || e)}`);
    }
  };

  // 初始化：加载列表
  loadList(true).catch(e => setStatus(`加载失败：${String(e.message || e)}`));
}
