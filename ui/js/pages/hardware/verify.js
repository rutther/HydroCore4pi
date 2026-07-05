// 文件：ui/js/pages/hardware/verify.js
// 职责：设备定义（verify）子页面 - V3（以 poll plan 为唯一事实源）
//
// 功能范围（按你最新决策收敛）：
// - 顶部栏：展示 poll plan 里已有的 address pills；支持两步确认新增地址
// - 上框：编辑当前 address 的 protocol/port/parameters；测试只读回填；提交覆盖写入 poll plan
// - 下框：展示单次测试 raw
//
// 明确不做：
// - 不编辑 __meta__（全局元参数）
// - 不做采样间隔/落库周期（sampling_sec/persist_sec）编辑
// - 不做颜色（留给“数据仪表”）
//
// 依赖后端：
// - GET/PUT /api/v1/poll/plan
// - GET      /api/v1/meta/protocols
// - GET      /api/v1/meta/protocols/:name
// - POST     /api/v1/config/get

import {
  apiPollPlanGet,
  apiPollPlanPut,
  apiMetaProtocolsList,
  apiMetaProtocolGet,
  apiConfigGet,
  ensureSerialAllowed,
} from "../../api.js";






function $(id) { return document.getElementById(id); }
function setText(el, s) { if (el) el.textContent = (s ?? ""); }
function safeArr(v) { return Array.isArray(v) ? v : []; }
function safeObj(v) { return (v && typeof v === "object") ? v : {}; }

function numOrNull(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}
function clampAddr(n) {
  if (!Number.isFinite(n)) return null;
  const x = Math.floor(n);
  if (x < 1 || x > 254) return null;
  return x;
}
function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }

const V = {
  inited: false,
  plan: null,           // {__meta__, plans[]}
  selectedAddr: null,   // number|null

  protoItems: [],       // [{name, source, mtime, size}]
  vendorMap: new Map(), // vendor -> Set(models)
  candidates: [],       // [{key,label,unit}]
};

function getPlans() {
  const plan = safeObj(V.plan);
  return safeArr(plan.plans);
}
function findPlanByAddr(addr) {
  return getPlans().find(p => Number(p.address) === Number(addr)) || null;
}
function ensureUniqueAddresses(plans) {
  const seen = new Set();
  for (const p of plans) {
    const a = Number(p.address);
    if (!Number.isFinite(a)) return { ok: false, error: "存在非法 address（非数字）" };
    if (seen.has(a)) return { ok: false, error: `address 重复：${a}` };
    seen.add(a);
  }
  return { ok: true };
}

function parseVendorModel(protoName) {
  const parts = String(protoName || "").split("_").filter(Boolean);
  if (parts.length <= 1) return { vendor: protoName || "", model: "" };
  return { vendor: parts[0], model: parts.slice(1).join("_") };
}
function buildVendorMap(items) {
  V.vendorMap.clear();
  for (const it of items) {
    const { vendor, model } = parseVendorModel(it.name);
    if (!vendor) continue;
    if (!V.vendorMap.has(vendor)) V.vendorMap.set(vendor, new Set());
    if (model) V.vendorMap.get(vendor).add(model);
  }
}





function protocolParamCandidates(protoJson) {
  const out = [];
  const obj = safeObj(protoJson);

  for (const [k, v] of Object.entries(obj)) {
    if (k === "__meta__") continue;
    if (!v || typeof v !== "object") continue;

    const acc = String(v.access || "");
    const isWriteOnly = acc === "write_only";
    const isRead = acc.includes("read");
    const isBadName =
      k.startsWith("write_") ||
      k === "restore_defaults" ||
      k === "float_order" ||
      k === "temp_compensation_type";

    if (isWriteOnly) continue;
    if (!isRead) continue;
    if (isBadName) continue;

    out.push({
      key: k,
      label: v.label_zh || v.label || k,
      unit: v.unit || "",
    });
  }

  out.sort((a, b) => (a.label.localeCompare(b.label) || a.key.localeCompare(b.key)));
  return out;
}


// 关于读写，改为允许write_only参数，以便某些需要写才能读的参数也能出现在候选列表
// function protocolParamCandidates(protoJson) {
//   const out = [];
//   const obj = safeObj(protoJson);

//   for (const [k, v] of Object.entries(obj)) {
//     if (k === "__meta__") continue;
//     if (!v || typeof v !== "object") continue;

//     const acc = String(v.access || "");
//     const isBadName =
//       k.startsWith("write_") ||
//       k === "restore_defaults" ||
//       k === "float_order" ||
//       k === "temp_compensation_type";

//     if (isBadName) continue;

//     // 允许 read_only / read_write / write_only
//     // 但如果 access 缺失，按 read_only 处理（更安全）
//     const access = (acc === "read_write" || acc === "write_only" || acc === "read_only")
//       ? acc
//       : "read_only";

//     out.push({
//       key: k,
//       label: v.label_zh || v.label || k,
//       unit: v.unit || "",
//       access,
//       type: v.type || "",
//       length: v.length,
//       addr: v.addr,
//     });
//   }

//   out.sort((a, b) => (a.label.localeCompare(b.label) || a.key.localeCompare(b.key)));
//   return out;
// }





function showAddBox(show) {
  const box = $("defAddrAddBox");
  if (!box) return;
  box.style.display = show ? "" : "none";
  if (show) {
    $("defAddrInput").value = "";
    $("defAddrInput").focus();
  }
}

function renderAddrPills() {
  const wrap = $("defAddrPills");
  const st = $("defAddrStatus");
  if (!wrap) return;

  wrap.innerHTML = "";
  const addrs = getPlans()
    .map(p => Number(p.address))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!addrs.length) {
    const div = document.createElement("div");
    div.className = "mini";
    div.style.opacity = "0.85";
    div.textContent = "暂无配置地址：点击右侧 + 新增一个地址配置。";
    wrap.appendChild(div);
    return;
  }

  for (const a of addrs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill";
    btn.style.cursor = "pointer";
    btn.style.border = "1px solid rgba(0,255,0,0.9)";
    btn.style.background = (V.selectedAddr === a) ? "var(--green2)" : "transparent";
    btn.textContent = String(a);

    btn.onclick = () => {
      V.selectedAddr = a;
      setText(st, `已选择地址：${a}`);
      loadAddrToEditor(a).catch(e => setText(st, `加载失败：${String(e.message || e)}`));
      renderAddrPills();
    };

    wrap.appendChild(btn);
  }
}

async function loadPlan() {
  const st = $("defAddrStatus");
  setText(st, "加载采集计划（poll plan）...");

  const res = await apiPollPlanGet();
  if (!res || res.ok !== true) throw new Error("poll plan 返回 ok!=true");

  const plan = safeObj(res.plan);
  plan.__meta__ = safeObj(plan.__meta__);
  plan.plans = safeArr(plan.plans);

  V.plan = plan;

  const addrs = plan.plans
    .map(p => Number(p.address))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  V.selectedAddr = addrs.length ? addrs[0] : null;

  setText(st, "采集计划已加载");
}

async function loadProtocols() {
  const list = await apiMetaProtocolsList();
  const items = safeArr(list.items);
  V.protoItems = items;
  buildVendorMap(items);
}

async function loadProtocolCandidates(protocolName) {
  const st = $("defProtoStatus");
  setText(st, `加载设备定义：${protocolName} ...`);

  const data = await apiMetaProtocolGet(protocolName);
  const proto = safeObj(data.protocol);

  V.candidates = protocolParamCandidates(proto);
  setText(st, `设备定义已加载：${protocolName}（可选字段 ${V.candidates.length} 个）`);
}

function fillVendorModelSelectsFromCurrent(ent) {
  const selV = $("defVendor");
  const selM = $("defModel");
  if (!selV || !selM) return;

  const vendors = Array.from(V.vendorMap.keys()).sort();
  selV.innerHTML = "";
  for (const v of vendors) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selV.appendChild(opt);
  }

  const protoName = ent?.protocol ? String(ent.protocol) : "";
  let { vendor, model } = parseVendorModel(protoName);

  if (!vendor) vendor = vendors[0] || "";
  selV.value = vendor;

  function refillModels() {
    const models = Array.from(V.vendorMap.get(selV.value) || []).sort();
    selM.innerHTML = "";

    if (!models.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "—";
      selM.appendChild(opt);
      selM.value = "";
      return;
    }

    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      selM.appendChild(opt);
    }

    const pick = model && models.includes(model) ? model : (models[0] || "");
    selM.value = pick;
  }

  refillModels();

  selV.onchange = async () => {
    refillModels();
    await onProtocolChanged();
  };

  selM.onchange = async () => {
    await onProtocolChanged();
  };

  async function onProtocolChanged() {
    const addr = V.selectedAddr;
    if (addr === null) return;
    const e = findPlanByAddr(addr);
    if (!e) return;

    const v = selV.value;
    const m = selM.value;
    const name = m ? `${v}_${m}` : v;

    e.protocol = name;

    // 切协议：清空测试值
    for (const p of safeArr(e.parameters)) p.__test_value = "--";

    await loadProtocolCandidates(name);
    renderRowList(addr);
  }
}

function renderRowList(addr) {
  const wrap = $("defRows");
  wrap.innerHTML = "";

  const ent = findPlanByAddr(addr);
  if (!ent) return;

  const params = safeArr(ent.parameters);
  if (!params.length) {
    const div = document.createElement("div");
    div.className = "mini";
    div.style.opacity = "0.85";
    div.textContent = "当前地址暂无条目。可点击“+ 增加条目”。";
    wrap.appendChild(div);
    return;
  }

  for (let i = 0; i < params.length; i++) {
    const p = safeObj(params[i]);
    wrap.appendChild(buildRowDom(addr, i, p));
  }
}




// 根据 access 限制写入 ,RO 禁写，RW/WO 允许写

function buildRowDom(addr, index, pObj) {
  const row = document.createElement("div");
  row.className = "def-row";

  const lab = document.createElement("div");
  lab.className = "def-label";
  lab.textContent = String(pObj.label ?? pObj.label_zh ?? pObj.name ?? "");

  const sel = document.createElement("select");
  sel.className = "input";
  sel.style.textAlign = "left";
  sel.innerHTML = "";

  for (const c of safeArr(V.candidates)) {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = `${c.label}  (${c.key})`;
    sel.appendChild(opt);
  }
  sel.value = String(pObj.name ?? "");

  const valBox = document.createElement("input");
  valBox.className = "input";
  valBox.value = String(pObj.__test_value ?? "--");
  valBox.readOnly = true;

  const unit = document.createElement("div");
  unit.className = "def-unit";
  unit.textContent = String(pObj.unit ?? "");

  const del = document.createElement("button");
  del.className = "btn btn-pill";
  del.type = "button";
  del.textContent = "删除";
  del.style.height = "36px";
  del.style.borderRadius = "999px";
  del.style.background = "#9b0028";
  del.style.borderColor = "#9b0028";

  del.onclick = () => {
    const ent = findPlanByAddr(addr);
    if (!ent) return;
    const params = safeArr(ent.parameters);
    params.splice(index, 1);
    ent.parameters = params;
    renderRowList(addr);
  };

  sel.onchange = () => {
    const ent = findPlanByAddr(addr);
    if (!ent) return;
    const params = safeArr(ent.parameters);
    if (!params[index]) return;

    const name = sel.value;
    const hit = safeArr(V.candidates).find(x => x.key === name) || null;

    params[index].name = name;
    params[index].label = hit ? hit.label : (params[index].label ?? name);
    params[index].unit = hit ? hit.unit : (params[index].unit ?? "");
    params[index].__test_value = "--";

    ent.parameters = params;
    renderRowList(addr);
  };

  row.appendChild(lab);
  row.appendChild(sel);
  row.appendChild(valBox);
  row.appendChild(unit);
  row.appendChild(del);
  return row;
}

// function buildRowDom(addr, index, pObj) {
//   const row = document.createElement("div");
//   row.className = "def-row";

//   // 当前候选（用于 access/type/unit/label）
//   const curName = String(pObj.name ?? "");
//   const hit0 = safeArr(V.protoCandidates).find(x => x.key === curName) || null;
//   const access0 = String(pObj.access ?? hit0?.access ?? "read_only");

//   // 标签
//   const lab = document.createElement("div");
//   lab.className = "def-label";
//   lab.textContent = String(pObj.label ?? hit0?.label ?? pObj.name ?? "");

//   // 参数下拉
//   const sel = document.createElement("select");
//   sel.className = "input";
//   sel.style.textAlign = "left";
//   sel.innerHTML = "";

//   for (const c of safeArr(V.protoCandidates)) {
//     const opt = document.createElement("option");
//     opt.value = c.key;

//     // 显示 RO/RW/WO
//     const tag = (c.access === "read_write") ? "RW" : (c.access === "write_only" ? "WO" : "RO");
//     opt.textContent = `${c.label} (${c.key})  [${tag}]`;
//     sel.appendChild(opt);
//   }
//   sel.value = curName;

//   // 读回值（测试后回填）
//   const valBox = document.createElement("input");
//   valBox.className = "input";
//   valBox.value = String(pObj.__test_value ?? "--");
//   valBox.readOnly = true;

//   // unit
//   const unit = document.createElement("div");
//   unit.className = "def-unit";
//   unit.textContent = String(pObj.unit ?? hit0?.unit ?? "");

//   // access badge
//   const badge = document.createElement("div");
//   badge.className = "pill";
//   badge.style.background = "transparent";
//   badge.style.border = "1px solid rgba(0,255,0,0.55)";
//   badge.style.color = "rgba(255,255,255,0.9)";
//   badge.style.height = "34px";
//   badge.style.fontSize = "14px";
//   badge.style.padding = "0 10px";
//   badge.textContent = (access0 === "read_write") ? "RW" : (access0 === "write_only" ? "WO" : "RO");

//   // 写入输入框 + 写入按钮（RO 禁用）
//   const writeBox = document.createElement("input");
//   writeBox.className = "input";
//   writeBox.placeholder = "写入值";
//   writeBox.value = (pObj.__write_value === undefined || pObj.__write_value === null) ? "" : String(pObj.__write_value);

//   const btnWrite = document.createElement("button");
//   btnWrite.className = "btn btn-pill";
//   btnWrite.type = "button";
//   btnWrite.textContent = "写入";
//   btnWrite.style.height = "36px";
//   btnWrite.style.borderRadius = "999px";
//   btnWrite.style.width = "100px";
//   btnWrite.style.paddingLeft = "0";
//   btnWrite.style.paddingRight = "0";

//   function applyAccessUI(access) {
//     const ro = (access === "read_only");
//     badge.textContent = ro ? "RO" : (access === "write_only" ? "WO" : "RW");

//     // RO：禁用写入
//     writeBox.disabled = ro;
//     btnWrite.disabled = ro;

//     if (ro) {
//       btnWrite.style.opacity = "0.45";
//       writeBox.style.opacity = "0.6";
//     } else {
//       btnWrite.style.opacity = "1";
//       writeBox.style.opacity = "1";
//     }
//   }
//   applyAccessUI(access0);

//   // 删除按钮（删条目）
//   const del = document.createElement("button");
//   del.className = "btn btn-pill";
//   del.type = "button";
//   del.textContent = "删除";
//   del.style.height = "36px";
//   del.style.borderRadius = "999px";
//   del.style.background = "#9b0028";
//   del.style.borderColor = "#9b0028";
//   del.style.width = "100px";
//   del.style.paddingLeft = "0";
//   del.style.paddingRight = "0";

//   del.onclick = () => {
//     const ent = findPlanByAddr(addr);
//     if (!ent) return;
//     const params = safeArr(ent.parameters);
//     params.splice(index, 1);
//     ent.parameters = params;
//     renderRowListFromCurrentPlan(addr);
//   };

//   // 下拉切换：更新 name/label/unit/access 并清空测试值
//   sel.onchange = () => {
//     const ent = findPlanByAddr(addr);
//     if (!ent) return;
//     const params = safeArr(ent.parameters);
//     if (!params[index]) return;

//     const name = sel.value;
//     const hit = safeArr(V.protoCandidates).find(x => x.key === name) || null;

//     params[index].name = name;
//     params[index].label = hit ? hit.label : (params[index].label ?? name);
//     params[index].unit = hit ? (hit.unit ?? "") : (params[index].unit ?? "");
//     params[index].access = hit ? hit.access : "read_only";

//     params[index].__test_value = "--";
//     params[index].__write_value = "";

//     ent.parameters = params;
//     renderRowListFromCurrentPlan(addr);
//   };

//   // 写入：把 writeBox 写回 ent.parameters[index].__write_value，调用后端 /config/set
//   btnWrite.onclick = async () => {
//     const st = $("defAddrStatus");
//     const ent = findPlanByAddr(addr);
//     if (!ent) return;

//     const params = safeArr(ent.parameters);
//     const cur = params[index];
//     if (!cur) return;

//     const access = String(cur.access ?? "read_only");
//     if (access === "read_only") {
//       setText(st, "只读参数不可写入");
//       return;
//     }

//     const v = String(writeBox.value ?? "").trim();
//     if (!v) {
//       setText(st, "写入失败：写入值为空");
//       return;
//     }

//     // 保存到内存（不落盘；你后面决定策略）
//     cur.__write_value = v;
//     ent.parameters = params;

//     // 发请求
//     try {
//       setText(st, `写入中：${cur.name} = ${v} ...`);
//       const req = {
//         port: String(ent.port || "/dev/ttyACM0"),
//         baudrate: 9600,
//         timeout: 0.5,
//         items: [{
//           protocol: String(ent.protocol || ""),
//           address: Number(ent.address),
//           writes: { [String(cur.name)]: v }
//         }]
//       };

//       // 这里调用 api.js 新增的 apiConfigSet
//       const res = await apiConfigSet(req);

//       // 简单回显
//       setText(st, "写入完成（请按需要再点一次“测试”回读确认）");
//       $("defTestRaw").textContent = JSON.stringify(res, null, 2);

//     } catch (e) {
//       setText(st, `写入失败：${String(e.message || e)}`);
//       $("defTestRaw").textContent = JSON.stringify(e?.data || { error: String(e.message || e) }, null, 2);
//     }
//   };

//   // 组装行
//   row.appendChild(lab);
//   row.appendChild(sel);
//   row.appendChild(valBox);
//   row.appendChild(unit);
//   row.appendChild(badge);
//   row.appendChild(writeBox);
//   row.appendChild(btnWrite);
//   row.appendChild(del);

//   return row;
// }






async function loadAddrToEditor(addr) {
  const ent = findPlanByAddr(addr);
  const st = $("defAddrStatus");

  if (!ent) {
    setText(st, `未找到 address=${addr} 的配置`);
    return;
  }

  $("defAddrCurrent").value = String(ent.address ?? "");
  $("defPort").value = String(ent.port ?? "/dev/ttyACM0");

  fillVendorModelSelectsFromCurrent(ent);

  const proto = String(ent.protocol || "");
  if (proto) await loadProtocolCandidates(proto);

  renderRowList(addr);
  setText(st, `正在编辑 address=${addr}`);
}

function applyEditorToCurrentPlan() {
  const addr = V.selectedAddr;
  if (addr === null) return { ok: false, error: "未选择地址" };

  const ent = findPlanByAddr(addr);
  if (!ent) return { ok: false, error: "未找到当前地址配置" };

  // address 可编辑：必须合法且唯一
  const newAddrRaw = numOrNull($("defAddrCurrent").value);
  const newAddr = clampAddr(newAddrRaw);
  if (!newAddr) return { ok: false, error: "地址无效：必须是 1~254 的整数" };

  const plans = getPlans();
  const exists = plans.some(p => Number(p.address) === newAddr && Number(p.address) !== Number(addr));
  if (exists) return { ok: false, error: `地址冲突：${newAddr} 已存在` };

  ent.address = newAddr;
  V.selectedAddr = newAddr;

  // port
  ent.port = String($("defPort").value || "/dev/ttyACM0").trim() || "/dev/ttyACM0";

  // protocol 已由下拉 onchange 写回 ent.protocol；这里不强行覆盖

  // parameters 校验
  const params = safeArr(ent.parameters);
  for (const item of params) {
    const o = safeObj(item);
    if (!o.name) return { ok: false, error: "存在条目未选择参数（name 为空）" };
    if (!o.label) o.label = String(o.name);
    if (o.unit === undefined) o.unit = "";
  }
  ent.parameters = params;

  return { ok: true };
}

async function submitPlan() {
  const st = $("defAddrStatus");

  const r1 = applyEditorToCurrentPlan();
  if (!r1.ok) {
    setText(st, `提交前校验失败：${r1.error}`);
    return;
  }

  const chk = ensureUniqueAddresses(getPlans());
  if (!chk.ok) {
    setText(st, `提交失败：${chk.error}`);
    return;
  }

  if (!confirm("确认提交配置？将覆盖写入 tasks/config_poll_plan.json")) {
    setText(st, "已取消提交");
    return;
  }

  setText(st, "提交中（PUT /api/v1/poll/plan）...");
  const res = await apiPollPlanPut(V.plan);
  if (!res || res.ok !== true) {
    setText(st, "提交失败：后端返回 ok!=true");
    return;
  }
  setText(st, "提交成功");
}

async function doTestOnce() {
  const st = $("defAddrStatus");
  const rawBox = $("defTestRaw");

  const r1 = applyEditorToCurrentPlan();
  if (!r1.ok) {
    setText(st, `测试前校验失败：${r1.error}`);
    return;
  }

  const addr = V.selectedAddr;
  const ent = findPlanByAddr(addr);
  if (!ent) {
    setText(st, "测试失败：未找到当前地址配置");
    return;
  }

  const port = String(ent.port || "/dev/ttyACM0");
  const proto = String(ent.protocol || "");
  const baudrate = 9600;
  const timeout = 0.5;

  const params = safeArr(ent.parameters).map(x => String(x.name || "")).filter(Boolean);
  if (!params.length) {
    setText(st, "测试失败：当前地址没有任何条目参数");
    return;
  }

  // 重置显示值为 --
  for (const p of safeArr(ent.parameters)) p.__test_value = "--";
  renderRowList(addr);

  setText(st, `测试中：${proto} addr=${addr} ...`);
  rawBox.textContent = "（测试中...）";




  const req = {
    port,
    baudrate,
    timeout,
    items: [{ protocol: proto, address: addr, parameters: params }],
  };




  try {

    // 增加 串口守卫：poller 运行时禁止测试读数
    await ensureSerialAllowed();

    const res = await apiConfigGet(req);
    const results = safeArr(res?.results);



    const map = new Map();
    for (const r of results) map.set(String(r.parameter || ""), r);

    for (const p of safeArr(ent.parameters)) {
      const name = String(p.name || "");
      const rr = map.get(name);
      if (!rr) continue;
      if (rr.status === "success") {
        p.__test_value = (rr.value === undefined || rr.value === null) ? "--" : String(rr.value);
      } else {
        p.__test_value = "ERR";
      }
    }

    renderRowList(addr);
    rawBox.textContent = JSON.stringify(res, null, 2);
    setText(st, "测试完成（数值已回填；失败项显示 ERR）");
  } catch (e) {
    rawBox.textContent = JSON.stringify(e?.data || { error: String(e.message || e) }, null, 2);
    setText(st, `测试失败：${String(e.message || e)}`);
  }
}

function bindEvents() {
  const st = $("defAddrStatus");

  $("defAddrPlus").onclick = () => {
    showAddBox(true);
    setText(st, "");
  };
  $("defAddrCancel").onclick = () => {
    showAddBox(false);
    setText(st, "");
  };
  $("defAddrConfirm").onclick = () => {
    const n = clampAddr(numOrNull($("defAddrInput").value));
    if (!n) {
      setText(st, "新增失败：地址必须是 1~254 的整数");
      return;
    }
    const plans = getPlans();
    if (plans.some(p => Number(p.address) === n)) {
      setText(st, `新增失败：地址 ${n} 已存在`);
      return;
    }

    plans.push({
      protocol: "lanchang_ec",
      address: n,
      port: "/dev/ttyACM0",
      parameters: [],
    });
    V.plan.plans = plans;
    V.selectedAddr = n;

    showAddBox(false);
    setText(st, `已新增地址：${n}`);
    renderAddrPills();
    loadAddrToEditor(n).catch(e => setText(st, `加载失败：${String(e.message || e)}`));
  };

  $("defAddrRemove").onclick = () => {
    const addr = V.selectedAddr;
    if (addr === null) {
      setText(st, "未选择地址");
      return;
    }
    if (!confirm(`确认删除地址 ${addr} 的整组配置？`)) {
      setText(st, "已取消删除");
      return;
    }

    const plans = getPlans().filter(p => Number(p.address) !== Number(addr));
    V.plan.plans = plans;

    const addrs = plans.map(p => Number(p.address)).filter(Number.isFinite).sort((a,b)=>a-b);
    V.selectedAddr = addrs.length ? addrs[0] : null;

    setText(st, `已删除地址：${addr}`);
    renderAddrPills();

    if (V.selectedAddr !== null) {
      loadAddrToEditor(V.selectedAddr).catch(e => setText(st, `加载失败：${String(e.message || e)}`));
    } else {
      $("defAddrCurrent").value = "";
      $("defPort").value = "/dev/ttyACM0";
      $("defRows").innerHTML = "";
      $("defTestRaw").textContent = "（暂无）";
    }
  };

  $("defRowAdd").onclick = () => {
    const addr = V.selectedAddr;
    if (addr === null) {
      setText(st, "请先选择一个地址");
      return;
    }
    const ent = findPlanByAddr(addr);
    if (!ent) {
      setText(st, "未找到当前地址配置");
      return;
    }
    if (!safeArr(V.candidates).length) {
      setText(st, "当前协议未加载字段列表，无法增加条目");
      return;
    }

    const c0 = V.candidates[0];
    ent.parameters = safeArr(ent.parameters);
    ent.parameters.push({
      name: c0.key,
      label: c0.label,
      unit: c0.unit,
      __test_value: "--",
    });

    renderRowList(addr);
    setText(st, "已增加条目");
  };

  $("defTest").onclick = () => doTestOnce();
  $("defSubmit").onclick = () => submitPlan();
}

export async function initHardwareVerify() {
  const root = $("subpage-verify");
  if (!root) return;

  const st = $("defAddrStatus");
  setText(st, "");

  try {
    await loadPlan();
    await loadProtocols();

    renderAddrPills();
    bindEvents();

    $("defTestRaw").textContent = "（暂无）";

    if (V.selectedAddr !== null) {
      await loadAddrToEditor(V.selectedAddr);
    } else {
      setText(st, "暂无配置地址：点击 + 新增一个地址配置。");
    }
  } catch (e) {
    setText(st, `初始化失败：${String(e.message || e)}`);
  }
}
