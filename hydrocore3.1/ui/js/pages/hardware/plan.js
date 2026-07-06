// 文件：ui/js/pages/hardware/plan.js
// 职责：数据采集（plan）页面
// - 编辑/保存 __meta__（全局采集/存储参数）
// - 只读概览 plans[]（采集对象列表）
// - 可选展开原始 JSON（调试）
//
// 依赖后端：GET/PUT /api/v1/poll/plan
//
// 约束：
// - 本页不编辑 plans[]（避免与“采集对象/设备定义”页职责冲突）
// - 保存只覆盖写回整个 plan（但仅修改 __meta__ 字段）
// - 表单编辑时做基本合法性校验（数字必须为 >=0，interval 必须 >0）





// import { apiPollPlanGet, apiPollPlanPut } from "../../api.js";
import {
  apiPollPlanGet,
  apiPollPlanPut,
  apiPollerStatus,
  apiPollerStart,
  apiPollerStop
} from "../../api.js";
import { STATE } from "../../state.js";






function $(id) { return document.getElementById(id); }

function safeObj(v) { return (v && typeof v === "object") ? v : {}; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

function pretty(obj) { return JSON.stringify(obj, null, 2); }

function numOrNull(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function mustPos(n) { return Number.isFinite(n) && n > 0; }
function mustNonNeg(n) { return Number.isFinite(n) && n >= 0; }

export function initHardwarePlan() {




  // ===== Poller 控制（新增闭环） =====
  const elPollerPill = $("pollerStatusPill");
  const elPollerText = $("pollerStatusText");
  const btnPollerStart = $("btnPollerStart");
  const btnPollerStop  = $("btnPollerStop");

  function setPollerText(s) {
    if (elPollerText) elPollerText.textContent = s || "";
  }
  function setPollerPill(running) {
    if (!elPollerPill) return;
    if (running === true) {
      elPollerPill.textContent = "RUNNING";
      elPollerPill.className = "pill";       // 亮一点
    } else if (running === false) {
      elPollerPill.textContent = "STOPPED";
      elPollerPill.className = "pill gray";  // 灰一点
    } else {
      elPollerPill.textContent = "UNKNOWN";
      elPollerPill.className = "pill gray";
    }
  }
  function setPollerButtons(running) {
    if (btnPollerStart) btnPollerStart.disabled = (running === true);
    if (btnPollerStop)  btnPollerStop.disabled  = (running === false);
  }

  async function refreshPollerStatus() {
    // 无 DOM 说明 HTML 没加成功：直接返回，不影响 plan 原功能
    if (!elPollerPill || !btnPollerStart || !btnPollerStop) return;

    try {
      const res = await apiPollerStatus();
      const running = Boolean(res && res.running === true);
      setPollerPill(running);
      setPollerButtons(running);
      setPollerText(running ? "采集线程运行中：主应用涉串口操作已被强制阻断" : "采集线程已停止：扫描/测试/写入等涉串口功能可用");
    } catch (e) {
      setPollerPill(null);
      setPollerButtons(null);
      setPollerText(`状态读取失败：${String(e.message || e)}`);
    }
  }

  if (btnPollerStart) {
    btnPollerStart.onclick = async () => {
      btnPollerStart.disabled = true;
      setPollerText("启动中...");
      try {
        await apiPollerStart();
      } catch (e) {
        setPollerText(`启动失败：${String(e.message || e)}`);
      }
      await refreshPollerStatus();
    };
  }

  if (btnPollerStop) {
    btnPollerStop.onclick = async () => {
      btnPollerStop.disabled = true;
      setPollerText("停止中...");
      try {
        await apiPollerStop();
      } catch (e) {
        setPollerText(`停止失败：${String(e.message || e)}`);
      }
      await refreshPollerStatus();
    };
  }

  // 页面初始化时立刻刷新一次，并每 2 秒刷新一次（可视化联动）
  refreshPollerStatus();
  setInterval(refreshPollerStatus, 2000);
  // ===== Poller 控制（新增闭环）END =====





  // 顶部按钮/状态
  const btnRefresh = $("btnPlanMetaRefresh");
  const btnEdit    = $("btnPlanMetaEdit");
  const btnCancel  = $("btnPlanMetaCancel");
  const btnSave    = $("btnPlanMetaSave");
  const status     = $("planMetaStatus");

  // meta inputs
  const elDefSampling = $("metaDefaultSampling");
  const elDefPersist  = $("metaDefaultPersist");
  const elDefRound    = $("metaDefaultRound");
  const elAlignWall   = $("metaAlignWall");
  const elRetention   = $("metaRetentionDays");
  const elMaxDb       = $("metaMaxDbMb");

  // plans list + raw
  const listBox = $("planEntriesList");
  const btnRaw  = $("btnPlanRawToggle");
  const rawBox  = $("planRawBox");
  const rawSt   = $("planRawStatus");

  let plan = null;       // 最新 plan（来自后端）
  let metaSnap = null;   // 进入编辑前的快照，用于取消
  let editing = false;
  let rawOpen = false;



  // 
  // ---- Poller 状态栏（Step1：仅 JS 逻辑；HTML 未加时 DOM 不存在也不报错）----


// 起始
  // let pollerTimer = null;

  // function setPollerHint(s) {
  //   const el = $("pollerStatusText");
  //   if (el) el.textContent = s || "";
  // }

  // function setPollerUiRunning(running) {
  //   const elRun = $("pollerRunningPill");
  //   const btnStart = $("btnPollerStart");
  //   const btnStop = $("btnPollerStop");

  //   if (elRun) {
  //     elRun.textContent = running ? "运行中" : "已停止";
  //     elRun.style.borderColor = running ? "rgba(255,80,80,0.9)" : "rgba(0,255,0,0.75)";
  //   }
  //   if (btnStart) btnStart.disabled = !!running;
  //   if (btnStop) btnStop.disabled = !running;
  // }

  // async function refreshPollerStatus() {
  //   try {
  //     const res = await apiPollerStatus();
  //     const running = Boolean(res && res.ok === true && res.running === true);

  //     STATE.poller.running = running;
  //     STATE.poller.lastCheckTs = Date.now();

  //     setPollerUiRunning(running);
  //     setPollerHint(running ? "采集中：其他串口操作已锁定（请先停止采集）" : "空闲：允许进行扫描/验证/写入等串口操作");
  //     return running;
  //   } catch (e) {
  //     setPollerHint(`poller 状态读取失败：${String(e.message || e)}`);
  //     return null;
  //   }
  // }

  // async function doPollerStart() {
  //   try {
  //     setPollerHint("启动采集中...");
  //     await apiPollerStart();
  //     await refreshPollerStatus();
  //   } catch (e) {
  //     setPollerHint(`启动失败：${String(e.message || e)}`);
  //   }
  // }

  // async function doPollerStop() {
  //   try {
  //     setPollerHint("停止采集中...");
  //     await apiPollerStop();
  //     await refreshPollerStatus();
  //   } catch (e) {
  //     setPollerHint(`停止失败：${String(e.message || e)}`);
  //   }
  // }

  // function bindPollerControlsIfPresent() {
  //   const btnStart = $("btnPollerStart");
  //   const btnStop = $("btnPollerStop");

  //   // Step1 不改 HTML：DOM 不存在就跳过
  //   if (!btnStart || !btnStop) return;

  //   btnStart.onclick = () => doPollerStart();
  //   btnStop.onclick = () => doPollerStop();

  //   if (pollerTimer) clearInterval(pollerTimer);
  //   pollerTimer = setInterval(() => refreshPollerStatus(), 1000);
  // }

  //  截至






  function setStatus(s) {
    if (status) status.textContent = s || "";
  }

  function setEditing(on) {
    editing = !!on;

    // inputs
    const ro = !editing;
    elDefSampling.readOnly = ro;
    elDefPersist.readOnly  = ro;
    elDefRound.readOnly    = ro;
    elRetention.readOnly   = ro;
    elMaxDb.readOnly       = ro;
    elAlignWall.disabled   = ro;

    // buttons
    btnSave.disabled   = !editing;
    btnCancel.disabled = !editing;
    btnEdit.disabled   = editing;

    setStatus(editing ? "编辑中：仅修改全局元参数（__meta__）" : "只读：全局元参数来自当前 plan");
  }

  function getMeta(planObj) {
    const p = safeObj(planObj);
    const m = safeObj(p.__meta__);
    return m;
  }

  function fillMetaForm() {
    const m = getMeta(plan);

    elDefSampling.value = (m.default_sampling_sec ?? "") === "" ? "" : String(m.default_sampling_sec ?? "");
    elDefPersist.value  = (m.default_persist_sec ?? "") === "" ? "" : String(m.default_persist_sec ?? "");
    elDefRound.value    = (m.default_round_to ?? "") === "" ? "" : String(m.default_round_to ?? "");
    elAlignWall.value   = String(Boolean(m.align_persist_to_wall));
    elRetention.value   = (m.retention_days ?? "") === "" ? "" : String(m.retention_days ?? "");
    elMaxDb.value       = (m.max_db_mb ?? "") === "" ? "" : String(m.max_db_mb ?? "");
  }

  function renderPlansOverview() {
    listBox.innerHTML = "";

    const plans = safeArr(plan?.plans)
      .map(p => safeObj(p))
      .filter(p => Number.isFinite(Number(p.address)))
      .sort((a, b) => Number(a.address) - Number(b.address));

    if (!plans.length) {
      const div = document.createElement("div");
      div.className = "mini";
      div.style.opacity = "0.85";
      div.textContent = "暂无 plans[]：请先在“采集对象/设备定义”页添加地址与条目。";
      listBox.appendChild(div);
      return;
    }

    for (const p of plans) {
      const addr = Number(p.address);
      const proto = String(p.protocol ?? "-");
      const port = String(p.port ?? "-");
      const params = safeArr(p.parameters);
      const n = params.length;

      const card = document.createElement("div");
      card.className = "mini-card";

      const title = document.createElement("div");
      title.className = "mini-title";
      title.textContent = `addr=${addr}   protocol=${proto}   port=${port}`;

      const brief = document.createElement("div");
      brief.className = "mini";
      brief.style.opacity = "0.9";

      // 参数名摘要（最多 8 个）
      const names = params
        .map(x => safeObj(x).name)
        .filter(Boolean)
        .map(String);

      const show = names.slice(0, 8).join(", ");
      const more = (names.length > 8) ? ` …(+${names.length - 8})` : "";

      brief.textContent = `条目数：${n}    参数：${show}${more}`;

      card.appendChild(title);
      card.appendChild(brief);

      listBox.appendChild(card);
    }
  }

  function setRawBox() {
    if (!rawBox) return;
    rawBox.textContent = plan ? pretty(plan) : "";
    if (rawSt) rawSt.textContent = plan ? "原始 JSON 来自 GET /api/v1/poll/plan" : "";
  }

  async function load() {
    setStatus("加载中：GET /api/v1/poll/plan ...");
    const res = await apiPollPlanGet();
    if (!res || res.ok !== true) throw new Error("poll plan 返回 ok!=true");

    plan = safeObj(res.plan);
    plan.__meta__ = safeObj(plan.__meta__);
    plan.plans = safeArr(plan.plans);

    fillMetaForm();
    renderPlansOverview();
    setRawBox();
    setEditing(false);
    setStatus("已加载");
  }

  function snapshotMeta() {
    // 深拷贝 __meta__ 快照
    metaSnap = JSON.parse(JSON.stringify(getMeta(plan)));
  }

  function restoreMetaSnap() {
    if (!plan || !metaSnap) return;
    plan.__meta__ = JSON.parse(JSON.stringify(metaSnap));
  }

  function validateMetaFromForm() {
    const ds = numOrNull(elDefSampling.value);
    const dp = numOrNull(elDefPersist.value);
    const dr = numOrNull(elDefRound.value);
    const aw = String(elAlignWall.value) === "true";
    const rd = numOrNull(elRetention.value);
    const mm = numOrNull(elMaxDb.value);

    // 允许为空：表示“不改动该字段”（但这里我们是编辑 __meta__，所以空表示删除字段回退到“未定义”）
    // 为了稳定：你现在文件里都有值，我这里采用：空 => 不允许保存（避免写出缺字段导致别处逻辑不兼容）
    if (ds === null || dp === null || dr === null || rd === null || mm === null) {
      return { ok: false, error: "全局参数不允许为空（必须填数字）。" };
    }

    if (!mustPos(ds)) return { ok: false, error: "默认采样间隔必须 > 0" };
    if (!mustPos(dp)) return { ok: false, error: "默认落库周期必须 > 0" };
    if (!mustNonNeg(dr)) return { ok: false, error: "默认小数位数必须 >= 0" };
    if (!mustNonNeg(rd)) return { ok: false, error: "数据保留天数必须 >= 0" };
    if (!mustPos(mm)) return { ok: false, error: "最大库容量必须 > 0" };

    return {
      ok: true,
      meta: {
        default_sampling_sec: ds,
        default_persist_sec: dp,
        default_round_to: dr,
        align_persist_to_wall: aw,
        retention_days: rd,
        max_db_mb: mm,
      }
    };
  }

  async function saveMeta() {
    if (!plan) return;

    const chk = validateMetaFromForm();
    if (!chk.ok) {
      setStatus(`保存失败：${chk.error}`);
      return;
    }

    // 仅修改 __meta__，plans[] 不动
    plan.__meta__ = safeObj(chk.meta);

    setStatus("保存中：PUT /api/v1/poll/plan ...");
    const res = await apiPollPlanPut(plan);
    if (!res || res.ok !== true) throw new Error("写入失败：后端返回 ok!=true");

    // 回读确认
    await load();
    setStatus(res?.message ? String(res.message) : "已保存");
  }

  // ---- bind events（覆盖式绑定，不叠加） ----
  btnRefresh.onclick = async () => {
    try { await load(); }
    catch (e) { setStatus(`加载失败：${String(e.message || e)}`); }
  };

  btnEdit.onclick = () => {
    if (!plan) {
      setStatus("尚未加载 plan，无法编辑");
      return;
    }
    snapshotMeta();
    setEditing(true);
  };

  btnCancel.onclick = () => {
    if (!plan) return;
    restoreMetaSnap();
    fillMetaForm();
    setEditing(false);
    setStatus("已取消：恢复到进入编辑前的 __meta__");
  };

  btnSave.onclick = async () => {
    try { await saveMeta(); }
    catch (e) { setStatus(`保存失败：${String(e.message || e)}`); }
  };

  btnRaw.onclick = () => {
    rawOpen = !rawOpen;
    rawBox.style.display = rawOpen ? "block" : "none";
    btnRaw.textContent = rawOpen ? "收起原始 JSON" : "展开原始 JSON";
  };



//  初次加载 原版
//   load().catch(e => setStatus(`初始化失败：${String(e.message || e)}`));
// }




  // 初次加载 新版  关于串口状态的检查和 UI 绑定
  load().catch(e => setStatus(`初始化失败：${String(e.message || e)}`));

  // Step1：即使 HTML 未加，也先刷新一次状态并尝试绑定（有则启用，无则跳过）
  refreshPollerStatus().catch(() => {});
  // bindPollerControlsIfPresent();
}

// 兼容 hardware/index.js：提供 renderHardwarePlan 包装
export function renderHardwarePlan(ctx) {
  // 当前项目中页面 DOM 通常由 index.html 预置，这里不负责写 contentEl.innerHTML
  // 只负责绑定与加载逻辑
  initHardwarePlan();
}



