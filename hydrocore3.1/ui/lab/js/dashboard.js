// 文件：ui/lab/js/dashboard.js
// Lab 迭代3（与新 HTML/CSS 对齐）
// 目标（产品经理）
// 0) 回放模式：允许存在时间范围输入（从/到）；最近模式：不出现时间范围输入
// 1) 左侧 ticker：不管是否选中，都显示当前值；用户看到异常才点进去看曲线
// 2) 左侧变化值：由 plan_view 元数据 delta_mode 决定是否显示百分比。
// 3) 左侧宽度已在 CSS 做到 300px
// 4) 无 checkbox，无“已选中”文案：点击卡片切换选择状态；边框表示选中
// 5) 单位/名称/参数类型：来自 plan_view；字段名只作最后兜底。
// 6) 精度（10s/1m/1h...）与模式（平均/最小/最大/最后）必须保留并生效
// 8) 不显示 lanchang/vendor 等字段：普通界面用 label + @地址。
// 9) tooltip 不要“（对比 xx）”解释；只显示原值+单位
// 10) 最近/回放是两个可展开药丸，互斥展开；切模式不需要“返回最近”按钮
// 11) 不输出“实时/回放”废话提示；只输出操作结果/状态（例如 chartStatus）

function $(id){ return document.getElementById(id); }
function asArray(v){ return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function setText(el, s){ if (el) el.textContent = (s ?? ""); }

const LAB_LANG = new URLSearchParams(location.search).get("lang") === "en-US" ? "en-US" : "zh-CN";
document.documentElement.lang = LAB_LANG;

const TEXT = {
  "zh-CN": {
    title: "HydroCore · 数据仪表",
    currentParams: "当前计划参数",
    searchPlaceholder: "搜索参数或地址",
    clear: "清空",
    recent: "最近",
    recentWindow: "最近窗口",
    replay: "回放",
    replayRange: "回放范围",
    from: "从",
    to: "到",
    apply: "应用",
    granularity: "间隔",
    auto: "自动",
    sec10: "10秒",
    min1: "1分钟",
    min10: "10分钟",
    hour1: "1小时",
    day1: "1天",
    statistic: "统计",
    avg: "平均",
    min: "最小",
    max: "最大",
    last: "最后",
    refresh: "刷新",
    exportCsv: "导出CSV",
    rangePick: "选区",
    fullscreen: "全屏",
    exitFullscreen: "退出全屏",
    noMatch: "没有匹配的指标。",
    noInput: "无入库",
    inputUnknown: "入库时间未知",
    lastInput: "最后入库 {age}",
    noNewEvent: "无新事件",
    eventValue: "事件值 {value}",
    event: "事件",
    state: "状态",
    lastShort: "上次 {time}",
    unknown: "未知",
    agoSec: "{value}秒前",
    agoMin: "{value}分钟前",
    agoHour: "{value}小时前",
    agoDay: "{value}天前",
    days: "{value}天",
    hours: "{value}小时",
    minutes: "{value}分钟",
    raw: "原始点",
    avgValue: "平均值",
    minValue: "最小值",
    maxValue: "最大值",
    lastValue: "最新值",
    pollerStoppedNoData: "采集程序停止 · 无入库数据",
    latestUnknown: "最新入库未知",
    pollerStoppedLatest: "采集程序停止 · 最新入库{age}",
    pollerRunningLatest: "采集程序运行 · 最新入库{age}",
    pollerUnknown: "采集状态未知",
    loading: "加载中...",
    planParams: "计划参数：{count}",
    rangeInvalid: "时间范围无效",
    rangeInvalidLong: "时间范围无效：请确保“到”晚于“从”。",
    pickInvalid: "选区无效",
    pickDragging: "横向拖动选择时间段",
    pickTooShort: "拖动距离太短",
    picked: "已选中 {duration}",
    replayPicked: "回放 · 已选中 {duration}",
    loadFailed: "加载失败：{msg}",
    replayHint: "设置范围后点击“应用”。",
    applyAfterPick: "选择时间后点应用",
    noMetricSelected: "未选择指标",
    noExportSelection: "请先选择要导出的参数",
    exportInvalidRange: "时间范围无效，不能导出",
    exporting: "正在导出 {count} 项 · {duration} · {bucket} · {agg}",
    modeRecent: "最近",
    modeReplay: "回放",
    chartStatus: "{mode} · {count}项 · {duration} · {bucket} · {agg}",
    fullscreenFailed: "全屏失败：{msg}",
    booting: "启动中...",
    loadingData: "加载数据中...",
    ready: "就绪：左侧点击选择指标；多选自动对比；回放与最近互斥。",
    bootFailed: "启动失败：\n{msg}",
  },
  "en-US": {
    title: "HydroCore · Dashboard",
    currentParams: "Current Parameters",
    searchPlaceholder: "Search parameter or address",
    clear: "Clear",
    recent: "Recent",
    recentWindow: "Recent window",
    replay: "Replay",
    replayRange: "Replay range",
    from: "From",
    to: "To",
    apply: "Apply",
    granularity: "Interval",
    auto: "Auto",
    sec10: "10 sec",
    min1: "1 min",
    min10: "10 min",
    hour1: "1 hour",
    day1: "1 day",
    statistic: "Value",
    avg: "Avg",
    min: "Min",
    max: "Max",
    last: "Last",
    refresh: "Refresh",
    exportCsv: "Export CSV",
    rangePick: "Range",
    fullscreen: "Full",
    exitFullscreen: "Exit",
    noMatch: "No matching parameter.",
    noInput: "No data",
    inputUnknown: "Data time unknown",
    lastInput: "Last data {age}",
    noNewEvent: "No new event",
    eventValue: "Event {value}",
    event: "Event",
    state: "State",
    lastShort: "Last {time}",
    unknown: "Unknown",
    agoSec: "{value}s ago",
    agoMin: "{value}m ago",
    agoHour: "{value}h ago",
    agoDay: "{value}d ago",
    days: "{value}d",
    hours: "{value}h",
    minutes: "{value}min",
    raw: "Raw",
    avgValue: "Average",
    minValue: "Minimum",
    maxValue: "Maximum",
    lastValue: "Latest",
    pollerStoppedNoData: "Collector stopped · no data",
    latestUnknown: "Latest data unknown",
    pollerStoppedLatest: "Collector stopped · latest {age}",
    pollerRunningLatest: "Collector running · latest {age}",
    pollerUnknown: "Collector status unknown",
    loading: "Loading...",
    planParams: "Parameters: {count}",
    rangeInvalid: "Invalid time range",
    rangeInvalidLong: "Invalid time range: To must be later than From.",
    pickInvalid: "Invalid range",
    pickDragging: "Drag horizontally on the chart",
    pickTooShort: "Drag farther to select",
    picked: "Selected {duration}",
    replayPicked: "Replay · selected {duration}",
    loadFailed: "Load failed: {msg}",
    replayHint: "Set a range, then tap Apply.",
    applyAfterPick: "Choose time, then apply",
    noMetricSelected: "No parameter selected",
    noExportSelection: "Select parameters before export",
    exportInvalidRange: "Invalid time range; cannot export",
    exporting: "Exporting {count} items · {duration} · {bucket} · {agg}",
    modeRecent: "Recent",
    modeReplay: "Replay",
    chartStatus: "{mode} · {count} items · {duration} · {bucket} · {agg}",
    fullscreenFailed: "Fullscreen failed: {msg}",
    booting: "Starting...",
    loadingData: "Loading data...",
    ready: "Ready: tap parameters on the left; multiple selections compare automatically.",
    bootFailed: "Startup failed:\n{msg}",
  },
};

function tr(key, vars = {}){
  const dict = TEXT[LAB_LANG] || TEXT["zh-CN"];
  let s = dict[key] ?? TEXT["zh-CN"][key] ?? key;
  for (const [k, v] of Object.entries(vars)){
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

function pad2(n){ return String(n).padStart(2, "0"); }
function fmtDatetimeLocal(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtTsSql(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function parseTsSql(ts){
  const s = String(ts || "").trim();
  if (!s) return null;
  return new Date(s.replace(" ", "T"));
}

async function httpJson(url){
  const r = await fetch(url, { cache:"no-store" });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: text }; }
  if (!r.ok){
    const msg = data?.error ? data.error : `HTTP ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

async function apiMetaSeries(){
  return httpJson("/api/v1/meta/series");
}

async function apiPlanView(){
  return httpJson("/api/v1/meta/plan_view");
}

async function apiPollerStatus(){
  return httpJson("/api/v1/poller/status");
}

async function apiDataSeries(qs){
  return httpJson(`/api/v1/data/series?${qs}`);
}

async function apiDashboardState(){
  return httpJson("/api/v1/dashboard/state?window_sec=86400&cache_sec=3");
}

/* ===== 色板：稳定映射 ===== */
const PALETTE = [
  "#6aa8ff", "#20c7a0", "#b08cff", "#4bc7d9", "#d6a73c",
  "#8aa0b6", "#7ecb71", "#ef7d8b", "#9bb7ff", "#c8d0da",
];
function stableColor(key){
  let h = 2166136261;
  for (let i=0; i<key.length; i++){
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

const DASH = "--";

/* ===== 参数显示：只使用 plan_view 元数据，字段名只做最后兜底 ===== */
function parseKey(fullKey){
  // fullKey: protocol:address:parameter
  const parts = String(fullKey || "").split(":");
  const protocol = parts[0] || "";
  const address  = parts[1] || "";
  const parameter = parts.slice(2).join(":") || "";
  const addrStr = address ? `@${address}` : "";

  return {
    fullKey,
    protocol,
    address,
    parameter,
    shortLabel: `${parameter || (LAB_LANG === "en-US" ? "Parameter" : "参数")}${addrStr}`,
    unit: "",
  };
}

function seriesKey(it){ return `${it.protocol}:${it.address}:${it.parameter}`; }

function itemMeta(fullKey){
  return S.itemByKey ? S.itemByKey.get(fullKey) : null;
}

function displayNameForKey(fullKey){
  const it = itemMeta(fullKey);
  if (it) return it.shortLabel;
  return parseKey(fullKey).shortLabel;
}

function unitForKey(fullKey){
  const it = itemMeta(fullKey);
  return it?.unit || "";
}

function normalizeKind(p){
  if (p?.value_kind) return String(p.value_kind);
  if (p?.event_only) return "event";
  return "unknown";
}

function normalizeDeltaMode(p){
  const mode = p?.delta_mode == null ? "" : String(p.delta_mode);
  if (["absolute_percent", "absolute_only", "none"].includes(mode)) return mode;
  return "none";
}

function itemFromSeriesRecord(it){
  const fullKey = seriesKey(it);
  const info = parseKey(fullKey);
  const label = it.label || it.label_zh || "";
  const unit = (it.unit != null) ? String(it.unit) : info.unit;
  const shortLabel = label
    ? `${label}${it.address ? ` @${it.address}` : ""}`
    : info.shortLabel;
  const searchKey = `${shortLabel} ${info.shortLabel} ${info.parameter} ${info.address} ${info.protocol}`.toLowerCase();
  return {
    fullKey,
    shortLabel,
    unit,
    searchKey,
    protocol: it.protocol,
    address: it.address,
    parameter: it.parameter,
    label,
    valueKind: normalizeKind(it),
    deltaMode: normalizeDeltaMode(it),
    eventOnly: it.event_only || null,
    trendEnabled: it.trend_enabled === false ? false : normalizeKind(it) !== "event",
    firstTs: it.first_ts || null,
    lastTs: it.last_ts || null,
    sampleCount: Number.isFinite(Number(it.n)) ? Number(it.n) : null,
  };
}

function itemsFromPlanView(plan){
  const out = [];
  const seen = new Set();
  for (const ent of asArray(plan?.entries)){
    const protocol = ent?.protocol;
    const address = ent?.address;
    if (!protocol || address == null) continue;
    for (const p of asArray(ent.parameters)){
      const parameter = p?.name;
      if (!parameter) continue;
      const rec = {
        protocol,
        address,
        parameter,
        label: p.label_zh || p.label || p.description || "",
        unit: p.unit || "",
        event_only: p.event_only || null,
        value_kind: p.value_kind,
        delta_mode: p.delta_mode,
        trend_enabled: p.trend_enabled,
      };
      const key = seriesKey(rec);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(itemFromSeriesRecord(rec));
    }
  }
  return out;
}

function mergeSeriesMeta(items, meta){
  const byKey = new Map();
  for (const row of asArray(meta?.series)){
    const key = seriesKey(row);
    byKey.set(key, row);
  }
  return asArray(items).map(it => {
    const row = byKey.get(it.fullKey);
    if (!row) return { ...it, hasSeries: false };
    return {
      ...it,
      hasSeries: true,
      firstTs: row.first_ts || it.firstTs || null,
      lastTs: row.last_ts || it.lastTs || null,
      sampleCount: Number.isFinite(Number(row.n)) ? Number(row.n) : it.sampleCount,
    };
  });
}

function indexItems(items){
  S.itemByKey = new Map();
  for (const it of asArray(items)){
    if (it?.fullKey) S.itemByKey.set(it.fullKey, it);
  }
}

/* ===== 精度（bucket） ===== */
const BUCKET_SEC = { "10s":10, "1m":60, "10m":600, "1h":3600, "1d":86400 };

function pickBucketByRange(from, to){
  if (!from || !to) return "1m";
  const ms = to.getTime() - from.getTime();
  const hours = ms / 3600000;
  if (hours <= 2) return "10s";
  if (hours <= 36) return "1m";
  if (hours <= 7*24) return "10m";
  if (hours <= 40*24) return "1h";
  return "1d";
}

/* ===== 数据线：统一结构 [[tsMs, value], ...] ===== */
function buildLineData(points, bucket){
  const sec = BUCKET_SEC[bucket] || null;

  const arr = [];
  for (const p of asArray(points)){
    const d = parseTsSql(p?.ts);
    if (!d) continue;
    arr.push([d.getTime(), (p && "value" in p) ? p.value : null]);
  }
  arr.sort((a,b)=>a[0]-b[0]);
  if (!arr.length) return [];

  // 固定桶：补齐缺点为 null（断线）
  if (sec){
    const step = sec * 1000;
    const map = new Map();
    const minT = arr[0][0];
    const maxT = arr[arr.length-1][0];
    for (const [t,v] of arr) map.set(t, v);

    const start = Math.floor(minT/step)*step;
    const end   = Math.ceil(maxT/step)*step;

    const out = [];
    for (let t=start; t<=end; t+=step){
      out.push([t, map.has(t) ? map.get(t) : null]);
    }
    return out;
  }

  // raw：按原始点输出，插断点
  const out = [];
  out.push([arr[0][0], arr[0][1]]);

  const deltas=[];
  for (let i=1; i<arr.length && deltas.length<50; i++){
    deltas.push(arr[i][0]-arr[i-1][0]);
  }
  deltas.sort((a,b)=>a-b);
  const median = deltas.length ? deltas[Math.floor(deltas.length/2)] : 0;
  const gapTh = Math.max(median*8, 5*60*1000);

  for (let i=1; i<arr.length; i++){
    const prev=arr[i-1][0], cur=arr[i][0];
    if (cur-prev > gapTh){
      out.push([prev + Math.floor((cur-prev)/2), null]);
    }
    out.push([cur, arr[i][1]]);
  }
  return out;
}

/* 多选对比变换：内部使用（图上不显示刻度数字） */
function toCompareLine(rawLine){
  if (!Array.isArray(rawLine)) return [];
  const arr = [];
  for (const p of rawLine){
    if (!Array.isArray(p) || p.length < 2) continue;
    const t = p[0];
    const v = p[1];
    if (typeof t !== "number") continue;
    const n = Number(v);
    arr.push([t, (v==null || !Number.isFinite(n)) ? null : n]);
  }
  if (!arr.length) return [];

  let min=null, max=null;
  for (const [,v] of arr){
    if (v==null) continue;
    if (min===null || v<min) min=v;
    if (max===null || v>max) max=v;
  }
  if (min===null || max===null) return arr.map(([t,_])=>[t,null]);
  if (max===min) return arr.map(([t,v])=>[t, v==null ? null : 50]);

  return arr.map(([t,v])=>{
    if (v==null) return [t,null];
    const k=(v-min)/(max-min);
    return [t, Math.round(k*10000)/100];
  });
}

function buildRawMap(line){
  const m = new Map();
  for (const p of asArray(line)){
    if (!Array.isArray(p) || p.length < 2) continue;
    const t = p[0];
    if (typeof t === "number") m.set(t, p[1]);
  }
  return m;
}

function firstFiniteValue(line){
  for (const p of asArray(line)){
    if (!Array.isArray(p) || p.length < 2) continue;
    const v = Number(p[1]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}
function lastFiniteValue(line){
  if (!Array.isArray(line) || !line.length) return null;
  for (let i=line.length-1; i>=0; i--){
    const p = line[i];
    if (!Array.isArray(p) || p.length < 2) continue;
    const v = Number(p[1]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/* ===== 状态 ===== */
const S = {
  chart: null,

  // meta
  items: [],            // [{ fullKey, shortLabel, unit, searchKey, valueKind, deltaMode }]
  itemByKey: new Map(),
  selected: new Set(),  // fullKey
  pollerRunning: null,
  latestDataTs: null,
  serverNowTs: null,

  // 模式：recent / replay
  mode: "recent",
  rollingMs: 24*3600*1000,
  rollingTimer: null,

  replayFrom: null,
  replayTo: null,
  rangePickMode: false,

  // 左侧实时数值/变化（24h）：fullKey -> { ok, latest, delta, pct, ts }
  stat24h: new Map(),

  // tooltip 原值映射：fullKey -> Map(ts->raw)
  rawMapByKey: new Map(),

  resizeObserver: null,
  refreshSeq: 0,
  refreshAllPromise: null,
  refreshAllPending: false,
};


// 新版  增加全屏按钮
function isFullscreen(){
  return !!document.fullscreenElement;
}

async function toggleFullscreen(){
  // 尽量让 shell 全屏，效果最好；拿不到就退化到 documentElement
  const target = document.querySelector(".shell") || document.documentElement;

  if (!isFullscreen()){
    try{
      await target.requestFullscreen();
    }catch(e){
      // 有的环境不允许指定元素全屏，退化到 documentElement
      await document.documentElement.requestFullscreen();
    }
  }else{
    await document.exitFullscreen();
  }
}


/* ===== ECharts ===== */
function ensureChart(){
  if (!window.echarts) throw new Error(LAB_LANG === "en-US" ? "ECharts failed to load: /ui/lab/lib/echarts.min.js" : "ECharts 未加载：/ui/lab/lib/echarts.min.js");
  if (S.chart) return S.chart;

  const el = $("chart");
  S.chart = window.echarts.init(el, null, { renderer:"canvas", useDirtyRect:true });
  installChartResizeGuard(el);
  installChartGestureGuard(el);

  S.chart.setOption({
    backgroundColor:"transparent",
    animation:false,
    grid:{ left:54, right:18, top:24, bottom:18 },

    tooltip:{
      trigger:"axis",
      axisPointer:{ type:"cross" },
      backgroundColor:"rgba(13,18,25,0.94)",
      borderColor:"rgba(143,158,178,0.24)",
      textStyle:{ color:"#edf2f7", fontSize:12 },

      formatter: (params)=>{
        const arr = asArray(params);
        if (!arr.length) return "";

        const t0 = arr[0]?.value?.[0];
        const d = (typeof t0 === "number") ? new Date(t0) : null;
        const head = d
          ? `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
          : "";

        const lines = [];
        for (const p of arr){
          const fullKey = p.seriesName || "";
          const ts = p?.value?.[0];

          const m = S.rawMapByKey ? S.rawMapByKey.get(fullKey) : null;
          const raw = (m && typeof ts === "number" && m.has(ts)) ? m.get(ts) : null;
          const rawStr = (raw==null) ? DASH : String(raw);
          const unit = unitForKey(fullKey) ? ` ${unitForKey(fullKey)}` : "";

          // 产品经理要求：不要任何“对比值解释”
          lines.push(`${p.marker} ${displayNameForKey(fullKey)}: ${rawStr}${unit}`);
        }

        return [head, ...lines].join("<br/>");
      }
    },

    legend:{
      top: 2,
      left: 8,
      type: "scroll",
      textStyle:{ color:"rgba(226,232,240,0.80)", fontSize:12, fontWeight:900 },
      pageTextStyle:{ color:"rgba(226,232,240,0.62)" },
      formatter: (name)=> displayNameForKey(name)
    },

    xAxis:{
      type:"time",
      axisLabel:{ color:"rgba(226,232,240,0.58)" },
      splitLine:{ lineStyle:{ color:"rgba(143,158,178,0.10)" } },
      axisLine:{ lineStyle:{ color:"rgba(143,158,178,0.18)" } }
    },

    yAxis:{
      type:"value",
      scale:true,
      axisLabel:{ color:"rgba(226,232,240,0.58)" },
      splitLine:{ lineStyle:{ color:"rgba(143,158,178,0.10)" } },
      axisLine:{ lineStyle:{ color:"rgba(143,158,178,0.18)" } }
    },

    dataZoom:[ {
      id:"dashboard-x-zoom",
      type:"inside",
      xAxisIndex:0,
      zoomOnMouseWheel:true,
      moveOnMouseMove:true,
      moveOnMouseWheel:false,
      preventDefaultMouseMove:true
    } ],
    series:[]
  }, true);

  window.addEventListener("resize", ()=> scheduleChartResize(10));
  window.addEventListener("orientationchange", ()=> scheduleChartResize(12));
  window.addEventListener("pageshow", ()=> scheduleChartResize(12));
  return S.chart;
}

function installChartGestureGuard(el){
  if (!el || el.dataset.gestureGuardInstalled === "1") return;
  el.dataset.gestureGuardInstalled = "1";
  el.dataset.pinchZoomInstalled = "1";
  el.dataset.touchPanInstalled = "1";

  let pinch = null;
  let pan = null;
  let select = null;
  let longPressTimer = null;
  const MIN_SPAN = 0.25;
  const MAX_SPAN = 100;
  const PAN_THRESHOLD_PX = 6;
  const SELECT_THRESHOLD_PX = 18;
  const LONG_PRESS_MS = 420;
  const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));
  const touchDistanceX = (touches) => Math.abs(touches[0].clientX - touches[1].clientX);
  const touchCenterX = (touches) => (touches[0].clientX + touches[1].clientX) / 2;
  const prevent = (ev) => {
    if (ev.cancelable) ev.preventDefault();
  };
  const zoomRange = () => {
    const dz = S.chart && S.chart.getOption ? asArray(S.chart.getOption().dataZoom)[0] : null;
    const rawStart = Number(dz && dz.start);
    const rawEnd = Number(dz && dz.end);
    const start = Number.isFinite(rawStart) ? rawStart : 0;
    const end = Number.isFinite(rawEnd) ? rawEnd : 100;
    return {
      start: clampNum(Math.min(start, end), 0, 100),
      end: clampNum(Math.max(start, end), 0, 100),
    };
  };
  const dispatchZoom = (start, end) => {
    if (!S.chart || !S.chart.dispatchAction) return;
    S.chart.dispatchAction({
      type:"dataZoom",
      dataZoomIndex:0,
      start:clampNum(start, 0, 100),
      end:clampNum(end, 0, 100),
    });
  };
  const wrap = el.closest(".chart-wrap");
  const overlay = (() => {
    if (!wrap) return null;
    let node = wrap.querySelector(".chart-select-overlay");
    if (!node) {
      node = document.createElement("div");
      node.className = "chart-select-overlay";
      wrap.appendChild(node);
    }
    return node;
  })();
  const clearLongPress = () => {
    if (!longPressTimer) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  };
  const showSelection = (x1, x2) => {
    if (!wrap || !overlay) return;
    const wr = wrap.getBoundingClientRect();
    const left = clampNum(Math.min(x1, x2) - wr.left, 0, wr.width);
    const right = clampNum(Math.max(x1, x2) - wr.left, 0, wr.width);
    overlay.style.left = `${left}px`;
    overlay.style.width = `${Math.max(1, right - left)}px`;
    wrap.classList.add("selecting");
  };
  const clearSelection = () => {
    select = null;
    clearLongPress();
    if (wrap) wrap.classList.remove("selecting");
    if (overlay) {
      overlay.style.left = "0";
      overlay.style.width = "0";
    }
  };
  const timeAtClientX = (clientX) => {
    const rect = el.getBoundingClientRect();
    const px = clampNum(clientX - rect.left, 0, rect.width);
    if (S.chart && S.chart.convertFromPixel) {
      const val = S.chart.convertFromPixel({ xAxisIndex:0 }, px);
      const ts = Array.isArray(val) ? Number(val[0]) : Number(val);
      if (Number.isFinite(ts)) return ts;
    }
    const range = currentRange();
    if (!range.from || !range.to) return null;
    const from = range.from.getTime();
    const to = range.to.getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    return from + (px / Math.max(1, rect.width)) * (to - from);
  };
  const applySelectedRange = (startX, endX) => {
    const a = timeAtClientX(startX);
    const b = timeAtClientX(endX);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) < 1000) {
      setText($("chartStatus"), tr("pickInvalid"));
      return;
    }
    const from = new Date(Math.min(a, b));
    const to = new Date(Math.max(a, b));
    setMode("replay");
    S.replayFrom = from;
    S.replayTo = to;
    if ($("inpFrom")) $("inpFrom").value = fmtDatetimeLocal(from);
    if ($("inpTo")) $("inpTo").value = fmtDatetimeLocal(to);
    setText($("replayHint"), tr("picked", { duration: durationLabel(from, to) }));
    setText($("chartStatus"), tr("replayPicked", { duration: durationLabel(from, to) }));
    setRangePickMode(false);
    dispatchZoom(0, 100);
    refreshAll().catch(e => setText($("chartStatus"), tr("loadFailed", { msg: String(e.message||e) })));
  };
  const startSelect = (clientX, immediate = false) => {
    clearLongPress();
    pan = null;
    pinch = null;
    select = {
      startX:clientX,
      lastX:clientX,
      immediate,
    };
    showSelection(clientX, clientX);
  };
  const beginLongPressSelect = (ev) => {
    if (!ev.touches || ev.touches.length !== 1 || S.rangePickMode) return;
    const x = ev.touches[0].clientX;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      startSelect(x, false);
      setText($("chartStatus"), tr("pickDragging"));
    }, LONG_PRESS_MS);
  };
  const moveSelect = (ev) => {
    if (!ev.touches || ev.touches.length !== 1 || !select) return;
    prevent(ev);
    const x = ev.touches[0].clientX;
    select.lastX = x;
    showSelection(select.startX, x);
  };
  const endSelect = () => {
    if (!select) return;
    const startX = select.startX;
    const endX = select.lastX;
    const explicitPick = S.rangePickMode;
    clearSelection();
    if (Math.abs(endX - startX) < SELECT_THRESHOLD_PX) {
      if (explicitPick) setText($("chartStatus"), tr("pickTooShort"));
      return;
    }
    applySelectedRange(startX, endX);
  };
  const startPan = (ev) => {
    if (!ev.touches || ev.touches.length !== 1 || !S.chart) return;
    if (S.rangePickMode) {
      prevent(ev);
      startSelect(ev.touches[0].clientX, true);
      return;
    }
    beginLongPressSelect(ev);
    const range = zoomRange();
    const span = range.end - range.start;
    if (span >= 99.8) {
      pan = null;
      return;
    }
    const t = ev.touches[0];
    pan = {
      x:t.clientX,
      y:t.clientY,
      start:range.start,
      end:range.end,
      span,
      dragging:false,
      lastStart:range.start,
      lastEnd:range.end,
    };
  };
  const movePan = (ev) => {
    if (!ev.touches || ev.touches.length !== 1 || !pan) return;
    const t = ev.touches[0];
    const dx = t.clientX - pan.x;
    const dy = t.clientY - pan.y;
    if (Math.abs(dx) > PAN_THRESHOLD_PX || Math.abs(dy) > PAN_THRESHOLD_PX) clearLongPress();
    if (!pan.dragging) {
      if (Math.abs(dx) < PAN_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
      pan.dragging = true;
    }
    prevent(ev);
    const rect = el.getBoundingClientRect();
    const shift = -(dx / Math.max(1, rect.width)) * pan.span;
    let nextStart = pan.start + shift;
    let nextEnd = pan.end + shift;
    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = pan.span;
    }
    if (nextEnd > 100) {
      nextEnd = 100;
      nextStart = 100 - pan.span;
    }
    if (Math.abs(nextStart - pan.lastStart) < 0.03 && Math.abs(nextEnd - pan.lastEnd) < 0.03) return;
    pan.lastStart = nextStart;
    pan.lastEnd = nextEnd;
    dispatchZoom(nextStart, nextEnd);
  };
  const startPinch = (ev) => {
    if (!ev.touches || ev.touches.length !== 2 || !S.chart) return;
    prevent(ev);
    clearSelection();
    pan = null;
    const distance = touchDistanceX(ev.touches);
    if (distance < 24) return;
    const rect = el.getBoundingClientRect();
    const range = zoomRange();
    const span = Math.max(MIN_SPAN, range.end - range.start);
    const center = touchCenterX(ev.touches);
    const anchorRatio = clampNum((center - rect.left) / Math.max(1, rect.width), 0, 1);
    pinch = {
      distance,
      start:range.start,
      end:range.end,
      span,
      anchorRatio,
      lastStart:range.start,
      lastEnd:range.end,
    };
  };
  const movePinch = (ev) => {
    if (!ev.touches || ev.touches.length !== 2) return;
    prevent(ev);
    if (!pinch) {
      startPinch(ev);
      return;
    }
    const distance = touchDistanceX(ev.touches);
    if (distance < 24) return;

    const scale = pinch.distance / distance;
    const nextSpan = clampNum(pinch.span * scale, MIN_SPAN, MAX_SPAN);
    const anchor = pinch.start + pinch.span * pinch.anchorRatio;
    let nextStart = anchor - nextSpan * pinch.anchorRatio;
    let nextEnd = nextStart + nextSpan;

    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = nextSpan;
    }
    if (nextEnd > 100) {
      nextEnd = 100;
      nextStart = 100 - nextSpan;
    }

    if (Math.abs(nextStart - pinch.lastStart) < 0.03 && Math.abs(nextEnd - pinch.lastEnd) < 0.03) return;
    pinch.lastStart = nextStart;
    pinch.lastEnd = nextEnd;
    dispatchZoom(nextStart, nextEnd);
  };
  const endPinch = (ev) => {
    endSelect();
    if (!ev.touches || ev.touches.length < 2) pinch = null;
    if (!ev.touches || ev.touches.length < 1) pan = null;
    if (!ev.touches || ev.touches.length < 1) clearLongPress();
  };

  const activePointers = new Map();
  let pointerPan = null;
  let pointerPinch = null;
  let pointerMode = null;
  const pointerPoint = (ev) => ({ id:ev.pointerId, x:ev.clientX, y:ev.clientY });
  const pointerList = () => Array.from(activePointers.values());
  const pointerDistanceX = (points) => Math.abs(points[0].x - points[1].x);
  const pointerCenterX = (points) => (points[0].x + points[1].x) / 2;
  const stopPointer = (ev) => {
    if (ev.cancelable) ev.preventDefault();
  };
  const startPointerPan = (ev) => {
    if (!S.chart) return;
    pointerPan = null;
    const range = zoomRange();
    const span = range.end - range.start;
    if (span >= 99.8) return;
    pointerPan = {
      id:ev.pointerId,
      x:ev.clientX,
      y:ev.clientY,
      start:range.start,
      end:range.end,
      span,
      dragging:false,
      lastStart:range.start,
      lastEnd:range.end,
    };
  };
  const movePointerPan = (ev) => {
    if (!pointerPan || pointerPan.id !== ev.pointerId) return;
    const dx = ev.clientX - pointerPan.x;
    const dy = ev.clientY - pointerPan.y;
    if (!pointerPan.dragging) {
      if (Math.abs(dx) < PAN_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
      pointerPan.dragging = true;
    }
    stopPointer(ev);
    const rect = el.getBoundingClientRect();
    const shift = -(dx / Math.max(1, rect.width)) * pointerPan.span;
    let nextStart = pointerPan.start + shift;
    let nextEnd = pointerPan.end + shift;
    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = pointerPan.span;
    }
    if (nextEnd > 100) {
      nextEnd = 100;
      nextStart = 100 - pointerPan.span;
    }
    if (Math.abs(nextStart - pointerPan.lastStart) < 0.03 && Math.abs(nextEnd - pointerPan.lastEnd) < 0.03) return;
    pointerPan.lastStart = nextStart;
    pointerPan.lastEnd = nextEnd;
    dispatchZoom(nextStart, nextEnd);
  };
  const startPointerPinch = () => {
    const points = pointerList();
    if (points.length < 2 || !S.chart) return;
    clearSelection();
    pointerPan = null;
    const distance = pointerDistanceX(points);
    if (distance < 24) return;
    const rect = el.getBoundingClientRect();
    const range = zoomRange();
    const span = Math.max(MIN_SPAN, range.end - range.start);
    const center = pointerCenterX(points);
    const anchorRatio = clampNum((center - rect.left) / Math.max(1, rect.width), 0, 1);
    pointerMode = "pinch";
    pointerPinch = {
      distance,
      start:range.start,
      end:range.end,
      span,
      anchorRatio,
      lastStart:range.start,
      lastEnd:range.end,
    };
  };
  const movePointerPinch = (ev) => {
    if (!pointerPinch || pointerMode !== "pinch") return;
    const points = pointerList();
    if (points.length < 2) return;
    stopPointer(ev);
    const distance = pointerDistanceX(points);
    if (distance < 24) return;
    const scale = pointerPinch.distance / distance;
    const nextSpan = clampNum(pointerPinch.span * scale, MIN_SPAN, MAX_SPAN);
    const anchor = pointerPinch.start + pointerPinch.span * pointerPinch.anchorRatio;
    let nextStart = anchor - nextSpan * pointerPinch.anchorRatio;
    let nextEnd = nextStart + nextSpan;
    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = nextSpan;
    }
    if (nextEnd > 100) {
      nextEnd = 100;
      nextStart = 100 - nextSpan;
    }
    if (Math.abs(nextStart - pointerPinch.lastStart) < 0.03 && Math.abs(nextEnd - pointerPinch.lastEnd) < 0.03) return;
    pointerPinch.lastStart = nextStart;
    pointerPinch.lastEnd = nextEnd;
    dispatchZoom(nextStart, nextEnd);
  };
  const onPointerDown = (ev) => {
    if (!S.chart) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    activePointers.set(ev.pointerId, pointerPoint(ev));
    if (el.setPointerCapture) {
      try { el.setPointerCapture(ev.pointerId); } catch {}
    }
    stopPointer(ev);
    clearLongPress();
    if (activePointers.size >= 2) {
      pointerMode = "pinch";
      pointerPan = null;
      startPointerPinch();
      return;
    }
    pointerMode = S.rangePickMode ? "select" : "pan";
    if (S.rangePickMode) {
      startSelect(ev.clientX, true);
      return;
    }
    startPointerPan(ev);
  };
  const onPointerMove = (ev) => {
    if (!activePointers.has(ev.pointerId)) return;
    activePointers.set(ev.pointerId, pointerPoint(ev));
    if (pointerMode === "pinch" || activePointers.size >= 2) {
      movePointerPinch(ev);
      return;
    }
    if (select && pointerMode === "select") {
      stopPointer(ev);
      select.lastX = ev.clientX;
      showSelection(select.startX, ev.clientX);
      return;
    }
    movePointerPan(ev);
  };
  const onPointerUp = (ev) => {
    if (activePointers.has(ev.pointerId)) activePointers.delete(ev.pointerId);
    if (el.releasePointerCapture) {
      try { el.releasePointerCapture(ev.pointerId); } catch {}
    }
    if (pointerMode === "select") endSelect();
    if (activePointers.size < 2) pointerPinch = null;
    if (activePointers.size < 1) {
      pointerPan = null;
      pointerMode = null;
    }
  };

  const stopBrowserZoom = (ev)=>{
    const isPinchTouch = ev.touches && ev.touches.length > 1;
    const isTrackpadPinch = ev.type === "wheel" && ev.ctrlKey;
    if ((isPinchTouch || isTrackpadPinch) && ev.cancelable) {
      ev.preventDefault();
    }
  };
  if (typeof PointerEvent !== "function") {
    el.addEventListener("touchstart", startPan, { passive:false, capture:true });
    el.addEventListener("touchstart", startPinch, { passive:false, capture:true });
    el.addEventListener("touchmove", moveSelect, { passive:false, capture:true });
    el.addEventListener("touchmove", movePan, { passive:false, capture:true });
    el.addEventListener("touchmove", movePinch, { passive:false, capture:true });
    el.addEventListener("touchend", endPinch, { passive:false, capture:true });
    el.addEventListener("touchcancel", endPinch, { passive:false, capture:true });
  }
  el.addEventListener("wheel", stopBrowserZoom, { passive:false, capture:true });
  document.addEventListener("gesturestart", stopBrowserZoom, { passive:false, capture:true });
  document.addEventListener("gesturechange", stopBrowserZoom, { passive:false, capture:true });

  if (typeof PointerEvent === "function") {
    el.addEventListener("pointerdown", onPointerDown, { passive:false, capture:true });
    el.addEventListener("pointermove", onPointerMove, { passive:false, capture:true });
    el.addEventListener("pointerup", onPointerUp, { passive:false, capture:true });
    el.addEventListener("pointercancel", onPointerUp, { passive:false, capture:true });
  }
}

function chartSize(){
  const el = $("chart");
  if (!el) return { width:0, height:0 };
  const r = el.getBoundingClientRect();
  return { width: Math.floor(r.width), height: Math.floor(r.height) };
}

function resizeChartOnce(){
  if (!S.chart) return false;
  const size = chartSize();
  if (size.width < 80 || size.height < 80) return false;
  try {
    S.chart.resize({ width:size.width, height:size.height, silent:true });
    return true;
  } catch {
    return false;
  }
}

function scheduleChartResize(retries = 6){
  if (!S.chart) return;
  let left = retries;
  const tick = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ok = resizeChartOnce();
        if (!ok && left > 0){
          left -= 1;
          setTimeout(tick, 120);
        }
      });
    });
  };
  tick();
}

function installChartResizeGuard(el){
  if (!el || S.resizeObserver) return;
  if (typeof ResizeObserver === "function"){
    S.resizeObserver = new ResizeObserver(() => scheduleChartResize(4));
    S.resizeObserver.observe(el);
    const wrap = document.querySelector(".chart-wrap");
    if (wrap) S.resizeObserver.observe(wrap);
    const shell = document.querySelector(".shell");
    if (shell) S.resizeObserver.observe(shell);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleChartResize(8);
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resizeChartOnce();
    });
  });
}

/* ===== 模式切换：互斥展开（由 CSS .active 决定显示） ===== */
function setMode(mode){
  S.mode = mode;

  const modeSwitch = $("modeSwitch");
  const pillRecent = $("pillRecent");
  const pillReplay = $("pillReplay");
  const tabRecent = $("tabRecent");
  const tabReplay = $("tabReplay");
  const isRecent = mode === "recent";

  if (modeSwitch){
    modeSwitch.classList.toggle("mode-recent", isRecent);
    modeSwitch.classList.toggle("mode-replay", !isRecent);
  }
  if (tabRecent) tabRecent.setAttribute("aria-pressed", isRecent ? "true" : "false");
  if (tabReplay) tabReplay.setAttribute("aria-pressed", isRecent ? "false" : "true");

  if (isRecent){
    pillRecent.classList.add("active");
    pillReplay.classList.remove("active");
    setText($("replayHint"), "");
    startRollingTimer();
  } else {
    pillRecent.classList.remove("active");
    pillReplay.classList.add("active");
    stopRollingTimer();

    // 预填回放时间：用当前最近窗口范围作为编辑起点
    const now = new Date();
    const from = new Date(now.getTime() - S.rollingMs);
    S.replayFrom = from;
    S.replayTo = now;
    if ($("inpFrom")) $("inpFrom").value = fmtDatetimeLocal(from);
    if ($("inpTo")) $("inpTo").value = fmtDatetimeLocal(now);
    setText($("replayHint"), tr("replayHint"));
    setText($("chartStatus"), tr("applyAfterPick"));
  }

  scheduleChartResize();
}

function setRangePickMode(enabled){
  S.rangePickMode = !!enabled;
  const btn = $("btnRangePick");
  if (btn) btn.classList.toggle("active", S.rangePickMode);
  if (S.rangePickMode) {
    setText($("chartStatus"), tr("pickDragging"));
  }
}




/* 最近窗口按钮高亮 */
function setRecentMs(ms){
  S.rollingMs = ms;

  const map = {
    btn1h: 1*3600*1000,
    btn3h: 3*3600*1000,
    btn12h: 12*3600*1000,
    btn24h: 24*3600*1000,
    btn7d: 7*24*3600*1000,
    btn30d: 30*24*3600*1000,
    btn1mo: 30*24*3600*1000, // 1M 按照 30D 算
  };

  for (const id of Object.keys(map)){
    const el = $(id);
    if (!el) continue;
    el.classList.toggle("active", map[id] === ms);
  }

  // === 关键：窗口改变后，最近模式要按新窗口换挡刷新频率 ===
  if (S.mode === "recent"){
    startRollingTimer();
  }

}



/* 时间范围 */
function currentRange(){
  if (S.mode === "recent"){
    const to = new Date();
    const from = new Date(to.getTime() - S.rollingMs);
    return { from, to };
  }
  return { from: S.replayFrom, to: S.replayTo };
}

function currentVisibleRange(){
  const range = currentRange();
  const fromMs = range.from?.getTime?.();
  const toMs = range.to?.getTime?.();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return range;
  if (!S.chart?.getOption) return range;

  const dz = asArray(S.chart.getOption().dataZoom)[0];
  const rawStart = Number(dz?.start);
  const rawEnd = Number(dz?.end);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return range;
  const start = Math.max(0, Math.min(rawStart, rawEnd));
  const end = Math.min(100, Math.max(rawStart, rawEnd));
  if (end - start >= 99.8) return range;

  const span = toMs - fromMs;
  return {
    from: new Date(fromMs + span * (start / 100)),
    to: new Date(fromMs + span * (end / 100)),
  };
}

function durationLabel(from, to){
  const minutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  if (minutes >= 2880 && minutes % 1440 === 0) return tr("days", { value: minutes / 1440 });
  if (minutes % 60 === 0) return tr("hours", { value: minutes / 60 });
  return tr("minutes", { value: minutes });
}

function bucketLabel(bucket){
  const map = {
    raw: tr("raw"),
    "10s": tr("sec10"),
    "1m": tr("min1"),
    "10m": tr("min10"),
    "1h": tr("hour1"),
    "1d": tr("day1"),
  };
  return map[bucket] || String(bucket || "");
}

function aggLabel(agg){
  const map = {
    avg: tr("avgValue"),
    min: tr("minValue"),
    max: tr("maxValue"),
    last: tr("lastValue"),
  };
  return map[agg] || String(agg || "");
}

function normalizeDashboardCopy(){
  const compact = document.documentElement.dataset.shellMode === "phone" || window.matchMedia("(max-width: 879px)").matches;
  const compactActionLabel = (key) => {
    if (!compact) return tr(key);
    const zh = {
      refresh: "刷新",
      exportCsv: "导出",
      rangePick: "选区",
      fullscreen: "全屏",
      exitFullscreen: "退出",
    };
    const en = {
      refresh: "Refresh",
      exportCsv: "CSV",
      rangePick: "Range",
      fullscreen: "Full",
      exitFullscreen: "Exit",
    };
    const labels = LAB_LANG === "en-US" ? en : zh;
    return labels[key] || tr(key);
  };

  document.title = tr("title");
  const leftTitle = document.querySelector(".left-title");
  if (leftTitle) leftTitle.textContent = tr("currentParams");

  const search = $("inpSearch");
  if (search) search.placeholder = tr("searchPlaceholder");
  setText($("btnClearSearch"), tr("clear"));
  setText($("tabRecent"), tr("recent"));
  setText($("tabReplay"), tr("replay"));
  const panelRecent = $("panelRecent");
  if (panelRecent) panelRecent.setAttribute("aria-label", tr("recentWindow"));
  const panelReplay = $("panelReplay");
  if (panelReplay) panelReplay.setAttribute("aria-label", tr("replayRange"));
  const rangeTags = document.querySelectorAll("#panelReplay .range-item .tag");
  if (rangeTags[0]) rangeTags[0].textContent = tr("from");
  if (rangeTags[1]) rangeTags[1].textContent = tr("to");
  setText($("btnApplyReplay"), tr("apply"));

  const agg = $("selAgg");
  const aggTag = agg?.parentElement?.querySelector(".tag");
  if (aggTag) aggTag.textContent = tr("statistic");
  if (agg){
    const labels = { avg: tr("avg"), min: tr("min"), max: tr("max"), last: tr("last") };
    for (const opt of agg.options) opt.textContent = labels[opt.value] || opt.textContent;
  }

  const gran = $("selGranularity");
  const granTag = gran?.parentElement?.querySelector(".tag");
  if (granTag) granTag.textContent = tr("granularity");
  if (gran){
    const labels = {
      auto: tr("auto"),
      "10s": tr("sec10"),
      "1m": tr("min1"),
      "10m": tr("min10"),
      "1h": tr("hour1"),
      "1d": tr("day1"),
    };
    for (const opt of gran.options) opt.textContent = labels[opt.value] || opt.textContent;
  }

  setText($("btnRefresh"), compactActionLabel("refresh"));
  setText($("btnExport"), compactActionLabel("exportCsv"));
  setText($("btnRangePick"), compactActionLabel("rangePick"));
  setText($("btnFullscreen"), isFullscreen() ? compactActionLabel("exitFullscreen") : compactActionLabel("fullscreen"));
}

function latestTsFromSeries(series){
  let latest = null;
  for (const it of asArray(series)){
    const d = parseTsSql(it?.last_ts);
    if (!d || !Number.isFinite(d.getTime())) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

function ageText(ms){
  if (!Number.isFinite(ms) || ms < 0) return tr("unknown");
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return tr("agoSec", { value: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return tr("agoMin", { value: min });
  const hour = Math.floor(min / 60);
  if (hour < 48) return tr("agoHour", { value: hour });
  const day = Math.floor(hour / 24);
  return tr("agoDay", { value: day });
}

function setFreshnessClass(level){
  const el = $("freshnessStatus");
  if (!el) return;
  el.classList.remove("ok", "warn", "bad");
  if (level) el.classList.add(level);
}

function renderFreshness(){
  const el = $("freshnessStatus");
  if (!el) return;

  const latest = S.latestDataTs;
  if (!latest){
    setText(el, S.pollerRunning === false ? tr("pollerStoppedNoData") : tr("latestUnknown"));
    setFreshnessClass("warn");
    return;
  }

  const nowMs = S.serverNowTs ? S.serverNowTs.getTime() : Date.now();
  const ageMs = nowMs - latest.getTime();
  const age = ageText(ageMs);
  if (S.pollerRunning === false){
    setText(el, tr("pollerStoppedLatest", { age }));
    setFreshnessClass("bad");
    return;
  }

  if (ageMs > 3 * 60 * 1000){
    setText(el, tr("pollerRunningLatest", { age }));
    setFreshnessClass("warn");
    return;
  }

  setText(el, tr("pollerRunningLatest", { age }));
  setFreshnessClass("ok");
}

async function refreshFreshnessStatus(){
  try{
    const [status, meta] = await Promise.all([
      apiPollerStatus().catch(()=>null),
      apiMetaSeries().catch(()=>null),
    ]);
    if (status && status.ok === true) S.pollerRunning = !!status.running;
    if (meta && meta.ok === true){
      S.latestDataTs = latestTsFromSeries(meta.series);
      S.serverNowTs = parseTsSql(meta.server_ts);
    }
    renderFreshness();
  }catch{
    setText($("freshnessStatus"), tr("pollerUnknown"));
    setFreshnessClass("warn");
  }
}

// 增加刷新控制
function recentRefreshIntervalMs(){
  const h = 3600 * 1000;
  const d = 24 * h;
  const w = Number(S.rollingMs || 24*h);

  // 最近 1h：10s 刷新
  if (w <= 1*h) return 10 * 1000;

  // 最近 1h-12h：25s 刷新
  if (w <= 12*h) return 25 * 1000;

  // 最近 24h：60s 刷新
  if (w <= 24*h) return 60 * 1000;

  // 最近 7d：1h 刷新
  if (w <= 7*d) return 1 * h;

  // 最近 30d / 1mo：3h 刷新
  return 3 * h;
}




/* 最近模式自动刷新 */
function startRollingTimer(){
  stopRollingTimer();
  if (S.mode !== "recent") return;

  const interval = recentRefreshIntervalMs();

  S.rollingTimer = setInterval(()=>{
    if (document.hidden) return;
    refreshAll().catch(()=>{});
  }, interval);
}
function stopRollingTimer(){
  if (S.rollingTimer){
    clearInterval(S.rollingTimer);
    S.rollingTimer = null;
  }
}

/* ===== 左侧列表：永远显示当前值与24h变化 ===== */
function filteredItems(){
  const q = String($("inpSearch")?.value || "").trim().toLowerCase();
  return S.items.filter(it => !q || it.searchKey.includes(q));
}

function shortTime(ts){
  const d = parseTsSql(ts);
  if (!d || !Number.isFinite(d.getTime())) return DASH;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function itemAgeText(it){
  if (!it?.lastTs) return tr("noInput");
  const d = parseTsSql(it.lastTs);
  const nowMs = S.serverNowTs ? S.serverNowTs.getTime() : Date.now();
  if (!d || !Number.isFinite(d.getTime())) return tr("inputUnknown");
  return tr("lastInput", { age: ageText(nowMs - d.getTime()) });
}

function eventValueText(st){
  if (!st || st.ok !== true || st.latest == null) return tr("noNewEvent");
  const v = Number(st.latest);
  if (!Number.isFinite(v) || v === 0) return tr("noNewEvent");
  return tr("eventValue", { value: v });
}

function formatDelta(st, it){
  if (!st || st.ok !== true) return { text: DASH, cls: "muted" };
  if (it.deltaMode === "none") return { text: DASH, cls: "muted" };
  if (st.delta == null) return { text: DASH, cls: "muted" };
  const delta = Number(st.delta);
  if (!Number.isFinite(delta)) return { text: DASH, cls: "muted" };
  const up = delta >= 0;
  const sign = up ? "+" : "";
  let text = `${sign}${delta.toFixed(3)}`;
  if (it.deltaMode === "absolute_percent" && Number.isFinite(Number(st.pct))){
    text += ` (${sign}${Number(st.pct).toFixed(2)}%)`;
  }
  return { text, cls: up ? "up" : "down" };
}

function renderList(){
  const wrap = $("seriesList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const list = filteredItems();

  if (!list.length){
    const div = document.createElement("div");
    div.className = "mini";
    div.style.opacity = "0.85";
    div.textContent = tr("noMatch");
    wrap.appendChild(div);
    return;
  }

  for (const it of list){
    const fullKey = it.fullKey;
    const active = S.selected.has(fullKey);

    const card = document.createElement("div");
    card.className = "item" + (active ? " active" : "");

    const top = document.createElement("div");
    top.className = "item-top";

    const left = document.createElement("div");
    left.className = "item-left";

    const dot = document.createElement("div");
    dot.className = "dot";
    dot.style.background = stableColor(fullKey);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = it.shortLabel;

    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = it.unit ? it.unit : "";

    left.appendChild(dot);
    left.appendChild(name);
    left.appendChild(unit);
    top.appendChild(left);
    card.appendChild(top);

    const mid = document.createElement("div");
    mid.className = "item-mid";

    const v = document.createElement("div");
    v.className = "val";

    const d = document.createElement("div");
    d.className = "delta";

    const st = S.stat24h.get(fullKey);
    if (it.valueKind === "event"){
      v.textContent = eventValueText(st);
      d.classList.add("muted");
      d.textContent = it.lastTs ? tr("lastShort", { time: shortTime(it.lastTs) }) : DASH;
    } else if (!st || st.ok !== true){
      v.textContent = DASH;
      d.classList.add("muted");
      d.textContent = DASH;
    } else {
      v.textContent = (st.latest == null) ? DASH : String(st.latest);
      const delta = formatDelta(st, it);
      d.classList.add(delta.cls);
      d.textContent = delta.text;
    }

    mid.appendChild(v);
    mid.appendChild(d);
    card.appendChild(mid);

    const sub = document.createElement("div");
    sub.className = "item-sub";
    if (it.valueKind === "event") sub.textContent = `${tr("event")} · ${itemAgeText(it)}`;
    else if (it.valueKind === "state") sub.textContent = `${tr("state")} · ${itemAgeText(it)}`;
    else sub.textContent = itemAgeText(it);
    card.appendChild(sub);

    // 点击卡片切换选中状态
    card.onclick = ()=>{
      if (S.selected.has(fullKey)) S.selected.delete(fullKey);
      else S.selected.add(fullKey);

      renderList();
      refreshChartOnly().catch(e => setText($("labStatus"), tr("loadFailed", { msg: String(e.message||e) })));
    };

    wrap.appendChild(card);
  }
}

/* ===== Meta & 左侧统计（24h） ===== */
async function loadMeta(){
  setText($("seriesStatus"), tr("loading"));
  let items = [];
  let meta = null;

  try{
    const plan = await apiPlanView();
    if (plan && plan.ok === true) items = itemsFromPlanView(plan);
  }catch{}

  try{
    meta = await apiMetaSeries();
    if (meta && meta.ok === true){
      S.latestDataTs = latestTsFromSeries(meta.series);
      S.serverNowTs = parseTsSql(meta.server_ts);
    }
  }catch{}

  if (!items.length){
    if (!meta) meta = await apiMetaSeries();
    if (!meta || meta.ok !== true) throw new Error(LAB_LANG === "en-US" ? "meta/series returned ok!=true" : "meta/series 返回 ok!=true");

    const arr = Array.isArray(meta.series) ? meta.series : [];
    items = arr.map(it=>{
      const fullKey = seriesKey(it);
      const info = parseKey(fullKey);
      const searchKey = `${info.shortLabel} ${info.parameter} ${info.address}`.toLowerCase();
      return {
        fullKey,
        shortLabel: info.shortLabel,
        unit: "",
        searchKey,
        protocol: it.protocol,
        address: it.address,
        parameter: it.parameter,
        valueKind: "unknown",
        deltaMode: "none",
        eventOnly: null,
        trendEnabled: true,
        firstTs: it.first_ts || null,
        lastTs: it.last_ts || null,
        sampleCount: Number.isFinite(Number(it.n)) ? Number(it.n) : null,
        hasSeries: true,
      };
    });
  } else if (meta && meta.ok === true){
    items = mergeSeriesMeta(items, meta);
  }

  S.items = items;
  indexItems(S.items);

  setText($("seriesStatus"), tr("planParams", { count: S.items.length }));
  await refreshFreshnessStatus();

  // 默认选第一条，保证图上有内容
  if (S.items.length && S.selected.size === 0){
    S.selected.add(S.items[0].fullKey);
  }
}

async function load24hStatForKey(fullKey){
  const now = new Date();
  const from = new Date(now.getTime() - 24*3600*1000);

  const [proto, addr, ...rest] = String(fullKey).split(":");
  const param = rest.join(":");

  const qs = new URLSearchParams();
  qs.append("s", `${proto}:${addr}:${param}`);
  qs.append("bucket", "raw");
  qs.append("round", "3");
  qs.append("from", fmtTsSql(from));
  qs.append("to", fmtTsSql(now));

  try{
    const data = await apiDataSeries(qs.toString());
    if (!data || data.ok !== true) throw new Error("data/series ok!=true");
    const one = (data.series && data.series[0]) ? data.series[0] : null;
    const pts = one ? (one.points || []) : [];

    const rawLine = buildLineData(pts, "raw");
    const first = firstFiniteValue(rawLine);
    const last = lastFiniteValue(rawLine);
    if (first == null || last == null){
      S.stat24h.set(fullKey, { ok:false, ts:Date.now(), msg:"no-data" });
      return;
    }

    const delta = Number(last) - Number(first);
    const pct = (Number(first) === 0) ? null : (delta / Number(first) * 100);
    S.stat24h.set(fullKey, {
      ok:true,
      latest: Number(last),
      delta,
      pct,
      ts: Date.now()
    });
  }catch(e){
    S.stat24h.set(fullKey, { ok:false, ts:Date.now(), msg:String(e.message||e) });
  }
}

async function load24hStatsForKeys(keys){
  const unique = Array.from(new Set(asArray(keys))).filter(Boolean);
  if (!unique.length) return;

  const now = new Date();
  const from = new Date(now.getTime() - 24*3600*1000);

  const qs = new URLSearchParams();
  for (const fullKey of unique) qs.append("s", fullKey);
  qs.append("bucket", "10m");
  qs.append("agg", "last");
  qs.append("round", "3");
  qs.append("limit", "2000");
  qs.append("from", fmtTsSql(from));
  qs.append("to", fmtTsSql(now));

  try{
    const data = await apiDataSeries(qs.toString());
    if (!data || data.ok !== true) throw new Error("data/series ok!=true");
    const seen = new Set();

    for (const one of asArray(data.series)){
      const fullKey = one?.key || seriesKey(one || {});
      if (!fullKey) continue;
      seen.add(fullKey);

      const rawLine = buildLineData(one?.points || [], "10m");
      const first = firstFiniteValue(rawLine);
      const last = lastFiniteValue(rawLine);
      if (first == null || last == null){
        S.stat24h.set(fullKey, { ok:false, ts:Date.now(), msg:"no-data" });
        continue;
      }

      const delta = Number(last) - Number(first);
      const pct = (Number(first) === 0) ? null : (delta / Number(first) * 100);
      S.stat24h.set(fullKey, { ok:true, latest:Number(last), delta, pct, ts:Date.now() });
    }

    for (const fullKey of unique){
      if (!seen.has(fullKey)) S.stat24h.set(fullKey, { ok:false, ts:Date.now(), msg:"no-data" });
    }
  }catch(e){
    for (const fullKey of unique){
      S.stat24h.set(fullKey, { ok:false, ts:Date.now(), msg:String(e.message||e) });
    }
  }
}

function applyDashboardState(data){
  if (!data || data.ok !== true) throw new Error(LAB_LANG === "en-US" ? "dashboard/state returned ok!=true" : "dashboard/state 返回 ok!=true");
  if (data.server_ts) S.serverNowTs = parseTsSql(data.server_ts);

  let latestTs = null;
  for (const row of asArray(data.items)){
    const fullKey = row?.key || seriesKey(row || {});
    if (!fullKey) continue;

    const it = S.itemByKey.get(fullKey);
    if (it){
      if (row.latest_ts) it.lastTs = row.latest_ts;
      if (row.summary_first_ts) it.firstTs = row.summary_first_ts;
      if (row.sample_count != null) it.sampleCount = Number(row.sample_count);
      if (row.value_kind) it.valueKind = String(row.value_kind);
      if (row.delta_mode) it.deltaMode = String(row.delta_mode);
      if (row.trend_enabled != null) it.trendEnabled = !!row.trend_enabled;
    }

    if (row.latest_ts){
      const d = parseTsSql(row.latest_ts);
      if (d && Number.isFinite(d.getTime()) && (!latestTs || d > latestTs)) latestTs = d;
    }

    const latest = Number(row.latest_value);
    const delta = Number(row.delta);
    const pct = Number(row.delta_percent);
    if (row.latest_value == null || !Number.isFinite(latest)){
      S.stat24h.set(fullKey, { ok:false, ts:Date.now(), msg:row.data_status || "no-data" });
    } else {
      S.stat24h.set(fullKey, {
        ok:true,
        latest,
        delta: Number.isFinite(delta) ? delta : null,
        pct: Number.isFinite(pct) ? pct : null,
        ts: Date.now(),
        dataStatus: row.data_status || "",
      });
    }
  }
  if (latestTs) S.latestDataTs = latestTs;
}

async function refreshLeftStats(){
  try{
    const data = await apiDashboardState();
    applyDashboardState(data);
    renderFreshness();
    renderList();
    return;
  }catch(e){
    // 兼容旧后端：状态接口不可用时，退回曲线接口计算左侧状态。
    const visible = filteredItems();
    const MAX = 30;
    const keys = [];
    for (const k of S.selected) keys.push(k);
    for (const it of visible){
      if (keys.length >= MAX) break;
      if (!keys.includes(it.fullKey)) keys.push(it.fullKey);
    }
    await load24hStatsForKeys(keys);
    renderList();
  }
}

/* ===== 图表刷新：只拉选中项 ===== */
async function refreshChartOnlyBatch(keys, chart, from, to, bucket, agg){
  const seq = ++S.refreshSeq;
  const qs = new URLSearchParams();
  for (const fullKey of keys) qs.append("s", fullKey);
  qs.append("bucket", bucket);
  if (bucket !== "raw") qs.append("agg", agg);
  qs.append("round", "3");
  qs.append("from", fmtTsSql(from));
  qs.append("to", fmtTsSql(to));

  let res = [];
  try{
    const data = await apiDataSeries(qs.toString());
    if (seq !== S.refreshSeq) return;
    if (!data || data.ok !== true) throw new Error("data/series ok!=true");

    const byKey = new Map();
    for (const one of asArray(data.series)){
      const fullKey = one?.key || seriesKey(one || {});
      if (fullKey) byKey.set(fullKey, one);
    }

    res = keys.map(fullKey => {
      const one = byKey.get(fullKey) || {};
      const pts = one.points || [];
      const rawLine = buildLineData(pts, bucket);
      const compareMode = (keys.length > 1);
      const dispLine = compareMode ? toCompareLine(rawLine) : rawLine;
      return { fullKey, rawLine, dispLine };
    });
  }catch(e){
    setText($("chartStatus"), tr("loadFailed", { msg: String(e.message||e) }));
    return;
  }

  S.rawMapByKey = new Map();
  for (const r of res){
    S.rawMapByKey.set(r.fullKey, buildRawMap(r.rawLine));
  }

  const compareMode = (keys.length > 1);
  const series = res.map(r => ({
    id: r.fullKey,
    type:"line",
    name: r.fullKey,
    showSymbol:false,
    connectNulls:false,
    data: r.dispLine,
    lineStyle:{ width:1.55, color: stableColor(r.fullKey) },
    emphasis:{ focus:"series" },
  }));

  chart.setOption(
    {
      legend:{ data: keys, formatter:(name)=>displayNameForKey(name) },
      yAxis:{
        type:"value",
        scale:true,
        axisLabel:{ show: !compareMode },
        name:""
      },
      series
    },
    { notMerge:false, replaceMerge:["series"], lazyUpdate:true }
  );

  const modeTxt = (S.mode === "recent") ? tr("modeRecent") : tr("modeReplay");
  setText($("chartStatus"), tr("chartStatus", {
    mode: modeTxt,
    count: keys.length,
    duration: durationLabel(from, to),
    bucket: bucketLabel(bucket),
    agg: aggLabel(agg),
  }));

  scheduleChartResize();
}

async function refreshChartOnly(){
  const keys = Array.from(S.selected);
  const chart = ensureChart();

  if (!keys.length){
    chart.setOption(
      { legend:{ data: [] }, series: [] },
      { notMerge:false, replaceMerge:["series"], lazyUpdate:true }
    );
    setText($("chartStatus"), tr("noMetricSelected"));
    return;
  }

  const { from, to } = currentRange();
  if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from){
    setText($("chartStatus"), tr("rangeInvalid"));
    return;
  }

  const gran = $("selGranularity") ? $("selGranularity").value : "auto";
  const bucket = (gran === "auto") ? pickBucketByRange(from, to) : gran;

  const agg = $("selAgg") ? $("selAgg").value : "avg";
  setText($("chartStatus"), tr("loading"));
  return refreshChartOnlyBatch(keys, chart, from, to, bucket, agg);
}

/* 全量刷新（左侧 + 图） */
async function refreshAll(){
  if (S.refreshAllPromise){
    S.refreshAllPending = true;
    return S.refreshAllPromise;
  }

  S.refreshAllPromise = (async () => {
    try{
      do{
        S.refreshAllPending = false;
        await Promise.all([
          refreshFreshnessStatus(),
          refreshLeftStats(),
        ]);
        await refreshChartOnly();
      }while(S.refreshAllPending && !document.hidden);
    }finally{
      S.refreshAllPromise = null;
      S.refreshAllPending = false;
    }
  })();

  return S.refreshAllPromise;
}

/* 回放应用 */
function applyReplay(){
  const from = $("inpFrom")?.value ? new Date($("inpFrom").value) : null;
  const to = $("inpTo")?.value ? new Date($("inpTo").value) : null;

  if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from){
    setText($("replayHint"), tr("rangeInvalidLong"));
    return;
  }

  S.replayFrom = from;
  S.replayTo = to;
  setText($("replayHint"), tr("apply"));
  refreshAll().catch(e => setText($("labStatus"), tr("loadFailed", { msg: String(e.message||e) })));
  scheduleChartResize();
}

/* 导出 */
function exportCsv(){
  const keys = Array.from(S.selected);
  if (!keys.length){
    setText($("chartStatus"), tr("noExportSelection"));
    return;
  }

  const { from, to } = currentVisibleRange();
  if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from){
    setText($("chartStatus"), tr("exportInvalidRange"));
    return;
  }

  const gran = $("selGranularity") ? $("selGranularity").value : "auto";
  const bucket = (gran === "auto") ? pickBucketByRange(from, to) : gran;
  const agg = $("selAgg") ? $("selAgg").value : "avg";

  const qs = new URLSearchParams();
  for (const fullKey of keys) qs.append("s", fullKey);
  qs.append("bucket", bucket);
  if (bucket !== "raw") qs.append("agg", agg);
  qs.append("round", "3");
  qs.append("from", fmtTsSql(from));
  qs.append("to", fmtTsSql(to));

  setText($("chartStatus"), tr("exporting", {
    count: keys.length,
    duration: durationLabel(from, to),
    bucket: bucketLabel(bucket),
    agg: aggLabel(agg),
  }));
  window.location.assign(`/api/v1/data/export.csv?${qs.toString()}`);
}


// 新版 增加全屏按钮
  // 全屏
  const btnFs = $("btnFullscreen");
  if (btnFs){
    btnFs.onclick = ()=> {
      toggleFullscreen().catch(e=>{
        setText($("labStatus"), tr("fullscreenFailed", { msg: String(e.message||e) }));
      });
    };

    // 监听全屏状态变化，更新按钮文案
    document.addEventListener("fullscreenchange", ()=>{
      normalizeDashboardCopy();
      scheduleChartResize(); // 全屏切换后图表需要 resize
    });
  }



/* ===== UI 绑定（对齐新 HTML 结构） ===== */
function bindUi(){
  // 模式切换（互斥展开）
  $("tabRecent").onclick = ()=>{
    setMode("recent");
    refreshAll().catch(e=>setText($("labStatus"), String(e.message||e)));
  };
  $("tabReplay").onclick = ()=>{
    setMode("replay");
    // 回放模式：不自动更新，先只刷新图（用旧 replayFrom/to 则提示无效；用预填则等待用户应用）
    refreshChartOnly().catch(()=>{});
  };

  // 最近窗口 pills
  $("btn1h").onclick  = ()=>{ setRecentMs(1*3600*1000);  if (S.mode==="recent"){ refreshAll().catch(()=>{}); } };
  $("btn3h").onclick  = ()=>{ setRecentMs(3*3600*1000);  if (S.mode==="recent"){ refreshAll().catch(()=>{}); } };
  $("btn12h").onclick = ()=>{ setRecentMs(12*3600*1000); if (S.mode==="recent"){ refreshAll().catch(()=>{}); } };
  $("btn24h").onclick = ()=>{ setRecentMs(24*3600*1000); if (S.mode==="recent"){ refreshAll().catch(()=>{}); } };
  $("btn7d").onclick  = ()=>{ setRecentMs(7*24*3600*1000);  if (S.mode==="recent"){ refreshAll().catch(()=>{}); } };
  $("btn30d").onclick = ()=>{ setRecentMs(30*24*3600*1000); if (S.mode==="recent"){ refreshAll().catch(()=>{}); } };
  $("btn1mo").onclick = ()=>{ setRecentMs(30*24*3600*1000); if (S.mode==="recent"){ refreshAll().catch(()=>{}); } };

  // 回放应用
  $("btnApplyReplay").onclick = ()=> applyReplay();
  $("btnRangePick").onclick = ()=> setRangePickMode(!S.rangePickMode);

  // 精度/模式
  $("selGranularity").onchange = ()=> refreshChartOnly().catch(()=>{});
  $("selAgg").onchange = ()=> refreshChartOnly().catch(()=>{});

  // 顶部动作
  $("btnRefresh").onclick = ()=> refreshAll().catch(e=>setText($("labStatus"), tr("loadFailed", { msg: String(e.message||e) })));
  $("btnExport").onclick = ()=> exportCsv();

  // 搜索
  $("inpSearch").oninput = ()=> renderList();
  $("btnClearSearch").onclick = ()=> { $("inpSearch").value=""; renderList(); };

  // 前台恢复
  document.addEventListener("visibilitychange", ()=>{
    if (document.hidden) return;
    if (S.mode === "recent"){
      refreshAll().catch(()=>{});
    }
  });
}

/* ===== 启动 ===== */
async function main(){
  setText($("labStatus"), tr("booting"));
  ensureChart();
  bindUi();
  normalizeDashboardCopy();

  // 默认：最近 + 24H（最近药丸展开）
  setMode("recent");
  setRecentMs(24*3600*1000);

  // hint 文案放第三行
  // setText($("tuneHint"), "精度影响毛刺/波动观感；模式影响聚合方式。");

  await loadMeta();
  renderList();

  setText($("labStatus"), tr("loadingData"));
  await refreshAll();

  startRollingTimer();

  setText($("labStatus"), tr("ready"));
}

main().catch(e=>{
  try { console.error(e); } catch {}
  const msg = (e && e.stack) ? String(e.stack) : String(e && (e.message||e) || e);
  const lines = msg.split("\n").slice(0, 10).join("\n");
  setText($("labStatus"), tr("bootFailed", { msg: lines }));
});
