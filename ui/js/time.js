// 文件：ui/js/time.js
// 职责：状态栏时间显示（startClock）
// 说明：
// - 默认找 #statusTime 元素写入时间字符串
// - 1s 刷新
// - 返回 stop() 用于停止计时（以后页面销毁时可用）

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatLocalDateTime(d = new Date()) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}-${m}-${day}  ${hh}:${mm}:${ss}`;
}

export function startClock(opts = {}) {
  const {
    elementId = "statusTime",
    intervalMs = 1000,
  } = opts;

  const el = document.getElementById(elementId);

  // 不让整个 UI 因为时间节点不存在而直接崩
  if (!el) {
    console.error(`[time] element #${elementId} not found; clock not started`);
    return () => {};
  }

  function tick() {
    el.textContent = formatLocalDateTime(new Date());
  }

  tick();
  const timer = setInterval(tick, intervalMs);

  return function stop() {
    clearInterval(timer);
  };
}
