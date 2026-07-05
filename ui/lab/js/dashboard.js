// 文件：ui/lab/js/dashboard.js
// Lab 迭代3（与新 HTML/CSS 对齐）
// 目标（产品经理）
// 0) 回放模式：允许存在时间范围输入（从/到）；最近模式：不出现时间范围输入
// 1) 左侧 ticker：不管是否选中，都显示当前值；用户看到异常才点进去看曲线
// 2) 左侧变化值：默认显示 24h Δ 与 %，并明确“24h”
// 3) 左侧宽度已在 CSS 做到 300px
// 4) 无 checkbox，无“已选中”文案：点击卡片切换选择状态；边框表示选中
// 5) 单位：先用 JS 内置映射（后续可接 protocols JSON）
// 6) 精度（10s/1m/1h...）与模式（平均/最小/最大/最后）必须保留并生效
// 8) 不显示 lanchang/vendor 等字段：用短标签 PH/EC/Temp/Res + @addr
// 9) tooltip 不要“（对比 xx）”解释；只显示原值+单位
// 10) 最近/回放是两个可展开药丸，互斥展开；切模式不需要“返回最近”按钮
// 11) 不输出“实时/回放”废话提示；只输出操作结果/状态（例如 chartStatus）

function $(id){ return document.getElementById(id); }
function asArray(v){ return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function setText(el, s){ if (el) el.textContent = (s ?? ""); }

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

/* ===== 色板：稳定映射 ===== */
const PALETTE = [
  "#f0b90b", "#0ecb81", "#f6465d", "#4e7fff", "#b277ff",
  "#ff8f1f", "#00bcd4", "#ff5ac8", "#8bc34a", "#c0c0c0",
];
function stableColor(key){
  let h = 2166136261;
  for (let i=0; i<key.length; i++){
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

/* ===== 单位：临时内置映射（后续接 protocols JSON） ===== */
function unitOf(paramLower){
  if (paramLower.includes("temp")) return "°C";
  if (paramLower.includes("ph")) return "";             // pH 无单位
  if (paramLower.includes("conduct")) return "μS/cm";
  if (paramLower.includes("ec")) return "μS/cm";
  if (paramLower.includes("tds")) return "ppm";
  if (paramLower.includes("resist")) return "Ω·cm";
  if (paramLower.includes("orp")) return "mV";
  return "";
}

/* ===== 短标签：隐藏 protocol/vendor（如 lanchang） ===== */
function parseKey(fullKey){
  // fullKey: protocol:address:parameter
  const parts = String(fullKey || "").split(":");
  const protocol = parts[0] || "";
  const address  = parts[1] || "";
  const parameter = parts.slice(2).join(":") || "";
  const p = parameter.toLowerCase();

  let short = parameter;
  if (p.includes("ph")) short = "PH";
  else if (p.includes("conduct") || p.includes("ec")) short = "EC";
  else if (p.includes("temp")) short = "Temp";
  else if (p.includes("resist")) short = "Res";
  else if (p.includes("orp")) short = "ORP";
  else if (p.includes("tds")) short = "TDS";

  const addrStr = address ? `@${address}` : "";
  const unit = unitOf(p);

  return {
    fullKey,
    protocol,
    address,
    parameter,
    shortLabel: `${short}${addrStr}`,
    unit,
  };
}

function seriesKey(it){ return `${it.protocol}:${it.address}:${it.parameter}`; }

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
      if (!parameter || p?.event_only === true) continue;
      const rec = {
        protocol,
        address,
        parameter,
        label: p.label_zh || p.label || p.description || "",
        unit: p.unit || "",
      };
      const key = seriesKey(rec);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(itemFromSeriesRecord(rec));
    }
  }
  return out;
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
  items: [],            // [{ fullKey, shortLabel, unit, searchKey }]
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
  if (!window.echarts) throw new Error("ECharts 未加载：/ui/lab/lib/echarts.min.js");
  if (S.chart) return S.chart;

  const el = $("chart");
  S.chart = window.echarts.init(el, null, { renderer:"canvas", useDirtyRect:true });
  installChartResizeGuard(el);

  S.chart.setOption({
    backgroundColor:"transparent",
    animation:false,
    grid:{ left:54, right:18, top:24, bottom:18 },

    tooltip:{
      trigger:"axis",
      axisPointer:{ type:"cross" },
      backgroundColor:"rgba(18,22,28,0.92)",
      borderColor:"rgba(234,236,239,0.18)",
      textStyle:{ color:"#eaecef", fontSize:12 },

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
          const info = parseKey(fullKey);
          const ts = p?.value?.[0];

          const m = S.rawMapByKey ? S.rawMapByKey.get(fullKey) : null;
          const raw = (m && typeof ts === "number" && m.has(ts)) ? m.get(ts) : null;
          const rawStr = (raw==null) ? "—" : String(raw);
          const unit = info.unit ? ` ${info.unit}` : "";

          // 产品经理要求：不要任何“对比值解释”
          lines.push(`${p.marker} ${info.shortLabel}: ${rawStr}${unit}`);
        }

        return [head, ...lines].join("<br/>");
      }
    },

    legend:{
      top: 2,
      left: 8,
      type: "scroll",
      textStyle:{ color:"rgba(234,236,239,0.78)", fontSize:12, fontWeight:900 },
      pageTextStyle:{ color:"rgba(234,236,239,0.60)" },
      formatter: (name)=> parseKey(name).shortLabel
    },

    xAxis:{
      type:"time",
      axisLabel:{ color:"rgba(234,236,239,0.60)" },
      splitLine:{ lineStyle:{ color:"rgba(234,236,239,0.06)" } },
      axisLine:{ lineStyle:{ color:"rgba(234,236,239,0.10)" } }
    },

    yAxis:{
      type:"value",
      scale:true,
      axisLabel:{ color:"rgba(234,236,239,0.60)" },
      splitLine:{ lineStyle:{ color:"rgba(234,236,239,0.06)" } },
      axisLine:{ lineStyle:{ color:"rgba(234,236,239,0.10)" } }
    },

    dataZoom:[ { type:"inside", xAxisIndex:0 } ],
    series:[]
  }, true);

  window.addEventListener("resize", ()=> scheduleChartResize(10));
  window.addEventListener("orientationchange", ()=> scheduleChartResize(12));
  window.addEventListener("pageshow", ()=> scheduleChartResize(12));
  return S.chart;
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

  const pillRecent = $("pillRecent");
  const pillReplay = $("pillReplay");

  if (mode === "recent"){
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
    if ($("inpFrom")) $("inpFrom").value = fmtDatetimeLocal(from);
    if ($("inpTo")) $("inpTo").value = fmtDatetimeLocal(now);
    setText($("replayHint"), "设置范围后点击“应用”。");
  }

  scheduleChartResize();
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

function durationLabel(from, to){
  const minutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  if (minutes >= 2880 && minutes % 1440 === 0) return `${minutes / 1440}天`;
  if (minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes}分钟`;
}

function bucketLabel(bucket){
  const map = {
    raw: "原始点",
    "10s": "10秒",
    "1m": "1分钟",
    "10m": "10分钟",
    "1h": "1小时",
    "1d": "1天",
  };
  return map[bucket] || String(bucket || "");
}

function aggLabel(agg){
  const map = {
    avg: "平均值",
    min: "最小值",
    max: "最大值",
    last: "最新值",
  };
  return map[agg] || String(agg || "");
}

function normalizeDashboardCopy(){
  const search = $("inpSearch");
  if (search) search.placeholder = "搜索指标、地址";

  const agg = $("selAgg");
  const aggTag = agg?.parentElement?.querySelector(".tag");
  if (aggTag) aggTag.textContent = "统计";

  const gran = $("selGranularity");
  const granTag = gran?.parentElement?.querySelector(".tag");
  if (granTag) granTag.textContent = "间隔";
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
  if (!Number.isFinite(ms) || ms < 0) return "未知";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 48) return `${hour}小时前`;
  const day = Math.floor(hour / 24);
  return `${day}天前`;
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
    setText(el, S.pollerRunning === false ? "采集停止 · 无数据" : "采集状态未知");
    setFreshnessClass("warn");
    return;
  }

  const nowMs = S.serverNowTs ? S.serverNowTs.getTime() : Date.now();
  const ageMs = nowMs - latest.getTime();
  const age = ageText(ageMs);
  if (S.pollerRunning === false){
    setText(el, `采集停止 · 最新${age}`);
    setFreshnessClass("bad");
    return;
  }

  if (ageMs > 3 * 60 * 1000){
    setText(el, `采集中 · 数据${age}未更新`);
    setFreshnessClass("warn");
    return;
  }

  setText(el, `采集中 · ${age}`);
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
    setText($("freshnessStatus"), "采集状态未知");
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

function renderList(){
  const wrap = $("seriesList");
  if (!wrap) return;
  wrap.innerHTML = "";

  const list = filteredItems();

  if (!list.length){
    const div = document.createElement("div");
    div.className = "mini";
    div.style.opacity = "0.85";
    div.textContent = "没有匹配的指标。";
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
    if (!st || st.ok !== true){
      v.textContent = "—";
      d.classList.add("muted");
      d.textContent = "—";
    } else {
      v.textContent = (st.latest == null) ? "—" : String(st.latest);

      const up = st.delta >= 0;
      d.classList.add(up ? "up" : "down");
      const sign = up ? "+" : "";
      const pctStr = (st.pct==null) ? "" : ` (${sign}${st.pct.toFixed(2)}%)`;
      d.textContent = `${sign}${st.delta.toFixed(3)}${pctStr}`;
    }

    mid.appendChild(v);
    mid.appendChild(d);
    card.appendChild(mid);

    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent = "24h";
    card.appendChild(sub);

    // 点击卡片切换选中状态
    card.onclick = ()=>{
      if (S.selected.has(fullKey)) S.selected.delete(fullKey);
      else S.selected.add(fullKey);

      renderList();
      refreshChartOnly().catch(e => setText($("labStatus"), `失败：${String(e.message||e)}`));
    };

    wrap.appendChild(card);
  }
}

/* ===== Meta & 左侧统计（24h） ===== */
async function loadMeta(){
  setText($("seriesStatus"), "加载中...");
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
  if (!meta || meta.ok !== true) throw new Error("meta/series 返回 ok!=true");

  const arr = Array.isArray(meta.series) ? meta.series : [];
  items = arr.map(it=>{
    const fullKey = seriesKey(it);
    const info = parseKey(fullKey);
    const searchKey = `${info.shortLabel} ${info.parameter} ${info.address}`.toLowerCase();
    return {
      fullKey,
      shortLabel: info.shortLabel,
      unit: info.unit,
      searchKey,
    };
  });
  }

  S.items = items;

  setText($("seriesStatus"), `指标数：${S.items.length}`);
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

async function refreshLeftStats(){
  // 防止请求风暴：每轮最多刷新 30 个 + 选中项优先
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
    setText($("chartStatus"), `加载失败：${String(e.message||e)}`);
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
    lineStyle:{ width:1.4, color: stableColor(r.fullKey) },
    emphasis:{ focus:"series" },
  }));

  chart.setOption(
    {
      legend:{ data: keys, formatter:(name)=>parseKey(name).shortLabel },
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

  const modeTxt = (S.mode === "recent") ? "最近" : "回放";
  setText($("chartStatus"), `${modeTxt} · ${keys.length}项 · ${durationLabel(from, to)} · ${bucketLabel(bucket)} · ${aggLabel(agg)}`);

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
    setText($("chartStatus"), "未选择指标");
    return;
  }

  const { from, to } = currentRange();
  if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from){
    setText($("chartStatus"), "时间范围无效");
    return;
  }

  const gran = $("selGranularity") ? $("selGranularity").value : "auto";
  const bucket = (gran === "auto") ? pickBucketByRange(from, to) : gran;

  const agg = $("selAgg") ? $("selAgg").value : "avg";
  setText($("chartStatus"), "加载中...");
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
    setText($("replayHint"), "时间范围无效：请确保“到”晚于“从”。");
    return;
  }

  S.replayFrom = from;
  S.replayTo = to;
  setText($("replayHint"), "已应用。");
  refreshAll().catch(e => setText($("labStatus"), `失败：${String(e.message||e)}`));
  scheduleChartResize();
}

/* 导出 */
function exportCsv(){
  const keys = Array.from(S.selected);
  if (!keys.length) return;

  const fullKey = keys[0];
  const [proto, addr, ...rest] = String(fullKey).split(":");
  const param = rest.join(":");

  const { from, to } = currentRange();
  if (!from || !to) return;

  const gran = $("selGranularity") ? $("selGranularity").value : "auto";
  const bucket = (gran === "auto") ? pickBucketByRange(from, to) : gran;

  const agg = $("selAgg") ? $("selAgg").value : "avg";

  const qs = new URLSearchParams();
  qs.append("s", `${proto}:${addr}:${param}`);
  qs.append("bucket", bucket);
  if (bucket !== "raw") qs.append("agg", agg);
  qs.append("round", "3");
  qs.append("from", fmtTsSql(from));
  qs.append("to", fmtTsSql(to));

  window.location.href = `/api/v1/data/export.csv?${qs.toString()}`;
}


// 新版 增加全屏按钮
  // 全屏
  const btnFs = $("btnFullscreen");
  if (btnFs){
    btnFs.onclick = ()=> {
      toggleFullscreen().catch(e=>{
        setText($("labStatus"), `全屏失败：${String(e.message||e)}`);
      });
    };

    // 监听全屏状态变化，更新按钮文案
    document.addEventListener("fullscreenchange", ()=>{
      btnFs.textContent = isFullscreen() ? "退出全屏" : "全屏";
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

  // 精度/模式
  $("selGranularity").onchange = ()=> refreshChartOnly().catch(()=>{});
  $("selAgg").onchange = ()=> refreshChartOnly().catch(()=>{});

  // 顶部动作
  $("btnRefresh").onclick = ()=> refreshAll().catch(e=>setText($("labStatus"), String(e.message||e)));
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
  setText($("labStatus"), "启动中...");
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

  setText($("labStatus"), "加载数据中...");
  await refreshAll();

  startRollingTimer();

  setText($("labStatus"), "就绪：左侧点击选择指标；多选自动对比；回放与最近互斥。");
}

main().catch(e=>{
  try { console.error(e); } catch {}
  const msg = (e && e.stack) ? String(e.stack) : String(e && (e.message||e) || e);
  const lines = msg.split("\n").slice(0, 10).join("\n");
  setText($("labStatus"), `启动失败：\n${lines}`);
});
