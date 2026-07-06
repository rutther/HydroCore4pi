import { AC_STATE } from "./store.js";
import {
  deleteActionRule,
  deleteActionSchedule,
  deleteActionTask,
  deleteActionUnit,
  deleteActuator,
  evaluateActionRule,
  executeActionTask,
  executeActionUnit,
  fetchActionLogs,
  fetchActionRules,
  fetchActionSchedules,
  fetchActionSummary,
  fetchActionTasks,
  fetchActionUnits,
  fetchActuators,
  saveActionRule,
  saveActionSchedule,
  saveActionTask,
  saveActionUnit,
  saveActuator,
  saveAutomationConfig,
  startAutomationRuntime,
  stopAutomationRuntime,
  triggerActionSchedule
} from "./api.js";
import { getAcText } from "./text.js";

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text || "";
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html || "";
}

function toggleHidden(id, hidden) {
  const el = $(id);
  if (el) el.hidden = !!hidden;
}

function listOptions(items, getValue, getLabel, selectedValue = "") {
  return items.map((item) => {
    const value = getValue(item);
    const label = getLabel(item);
    const selected = value === selectedValue ? " selected" : "";
    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (ms >= 60000) return `${(ms / 60000).toFixed(ms % 60000 === 0 ? 0 : 1)} ${isZhLang() ? "分钟" : "min"}`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} ${isZhLang() ? "秒" : "s"}`;
  return `${ms} ${isZhLang() ? "毫秒" : "ms"}`;
}

function secondsInputFromMs(value, fallbackMs = 0) {
  const ms = Number.isFinite(Number(value)) ? Number(value) : Number(fallbackMs || 0);
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(2)));
}

function msFromSecondsInput(value, fallbackMs = 0) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return Number(fallbackMs || 0);
  return Math.round(seconds * 1000);
}

function formatSeconds(value) {
  const sec = Number(value || 0);
  if (sec >= 3600) return `${(sec / 3600).toFixed(sec % 3600 === 0 ? 0 : 1)} ${isZhLang() ? "小时" : "h"}`;
  if (sec >= 60) return `${(sec / 60).toFixed(sec % 60 === 0 ? 0 : 1)} ${isZhLang() ? "分钟" : "min"}`;
  return `${sec} ${isZhLang() ? "秒" : "s"}`;
}

function badge(label, tone = "neutral") {
  return `<span class="ac-badge ${tone}">${escapeHtml(label)}</span>`;
}

function makeMeta(summary, badges = []) {
  return { summary, badges };
}

function normalizeMeta(meta) {
  if (typeof meta === "string") return { summary: meta, badges: [] };
  return {
    summary: meta?.summary || "",
    badges: Array.isArray(meta?.badges) ? meta.badges : []
  };
}

function relayOutputs() {
  return AC_STATE.actuators.filter((item) => (item.kind || item.type) === "relay");
}

function findActuator(id) {
  return AC_STATE.actuators.find((item) => item.id === id) || null;
}

function findActionUnit(id) {
  return AC_STATE.actionUnits.find((item) => item.id === id) || null;
}

function findTask(id) {
  return AC_STATE.actionTasks.find((item) => item.id === id) || null;
}

function countUnitsUsingActuator(actuatorId) {
  return AC_STATE.actionUnits.filter((item) => item.output_id === actuatorId).length;
}

function countTasksUsingUnit(unitId) {
  return AC_STATE.actionTasks.filter((task) => (task.steps || []).some((step) => step.action_unit_id === unitId)).length;
}

function tasksUsingUnit(unitId) {
  return AC_STATE.actionTasks.filter((task) => (task.steps || []).some((step) => step.action_unit_id === unitId));
}

function countPlansUsingTask(taskId) {
  const ruleCount = AC_STATE.actionRules.filter((item) => item.task_id === taskId).length;
  const scheduleCount = AC_STATE.actionSchedules.filter((item) => item.task_id === taskId).length;
  return { ruleCount, scheduleCount, total: ruleCount + scheduleCount };
}

function findSchedule(id) {
  return AC_STATE.actionSchedules.find((item) => item.id === id) || null;
}

function isZhLang() {
  return document.documentElement.lang === "zh-CN";
}

function outputKindLabel(item) {
  const kind = item?.kind || item?.type;
  const tx = getAcText();
  if (kind === "pwm") return tx.actuator.pwm;
  return tx.actuator.relay;
}

function taskOptionLabel(task) {
  const name = task?.name || task?.id || "-";
  if (task?.task_type === "sequence") {
    return isZhLang() ? `${name}（多步骤）` : `${name} (multi-step)`;
  }
  return name;
}

function logTargetName(log) {
  if (log.task_id) return findTask(log.task_id)?.name || log.task_id;
  if (log.action_unit_id) return findActionUnit(log.action_unit_id)?.name || log.action_unit_id;
  return "-";
}

function logKindText(kind) {
  if (kind === "task") return isZhLang() ? "任务" : "Task";
  return isZhLang() ? "动作" : "Action";
}

function logSourceLabel(source) {
  if (!source) return "-";
  if (source === "manual") return isZhLang() ? "手动执行" : "Manual";
  if (source.startsWith("schedule-test:")) {
    const scheduleId = source.slice("schedule-test:".length);
    const scheduleName = findSchedule(scheduleId)?.name || scheduleId;
    return isZhLang() ? `计划测试 / ${scheduleName}` : `Schedule test / ${scheduleName}`;
  }
  if (source.startsWith("schedule:")) {
    const scheduleId = source.slice("schedule:".length);
    const scheduleName = findSchedule(scheduleId)?.name || scheduleId;
    return isZhLang() ? `计划触发 / ${scheduleName}` : `Schedule / ${scheduleName}`;
  }
  if (source.startsWith("rule:")) {
    const ruleId = source.slice("rule:".length);
    const ruleName = AC_STATE.actionRules.find((item) => item.id === ruleId)?.name || ruleId;
    return isZhLang() ? `规则触发 / ${ruleName}` : `Rule / ${ruleName}`;
  }
  return source;
}

function logMessageLabel(message) {
  if (!message) return "-";
  const exactMap = isZhLang()
    ? {
      "Dry-run task completed": "模拟执行完成",
      "Real task completed": "实际执行完成",
      "Dry-run action completed": "动作模拟执行完成",
      "Real action completed": "动作实际执行完成",
      "Real GPIO output is blocked until hardware is armed": "硬件总闸未解锁，已阻止真实输出",
      "Task is disabled": "任务已停用",
        "Schedule is disabled": "计划已停用",
        "Rule is disabled": "规则已停用",
        "Task is running": "任务正在运行",
        "No recent data": "没有最近数据",
        "Rule conditions not met": "规则条件未满足",
        "Cooldown is active": "冷却中"
      }
    : {
        "Dry-run task completed": "Dry-run task completed",
        "Real task completed": "Real task completed",
        "Dry-run action completed": "Dry-run action completed",
        "Real action completed": "Real action completed",
        "Real GPIO output is blocked until hardware is armed": "Real GPIO output is blocked until hardware is armed",
        "Task is disabled": "Task is disabled",
        "Schedule is disabled": "Schedule is disabled",
        "Rule is disabled": "Rule is disabled",
        "Task is running": "Task is running",
        "No recent data": "No recent data",
        "Rule conditions not met": "Rule conditions not met",
        "Cooldown is active": "Cooldown is active"
      };
  if (exactMap[message]) return exactMap[message];

  const taskCooldown = message.match(/^Task cooldown is active \((\d+)s\)$/);
  if (taskCooldown) {
    return isZhLang() ? `任务冷却中（${taskCooldown[1]} 秒）` : message;
  }
  return message;
}

function uiCommonText() {
  return getAcText().common;
}

function defaultStatusText() {
  return uiCommonText().ready;
}

function automationDefault() {
  return {
    running: false,
    automation_enabled: false,
    dry_run: true,
    hardware_armed: false,
    tick_sec: 2,
    fresh_data_sec: 180,
    last_tick: "",
    last_error: ""
  };
}

function outputDefault() {
  const lang = document.documentElement.lang === "en-US" ? "en-US" : "zh-CN";
  return {
    id: "new_output",
    name: lang === "en-US" ? "New Output" : "新输出设备",
    kind: "relay",
    gpio_pin: 17,
    active_level: "low",
    safe_state: "off",
    pwm_frequency: 1000,
    safe_duty: 0,
    enabled: true,
    allow_real_output: false,
    description: ""
  };
}

function actionUnitDefault() {
  const output = relayOutputs()[0] || AC_STATE.actuators[0] || { id: "", kind: "relay" };
  const mode = (output.kind || output.type) === "pwm" ? "pwm_run" : "relay_pulse";
  const lang = document.documentElement.lang === "en-US" ? "en-US" : "zh-CN";
  return {
    id: "new_action_unit",
    name: lang === "en-US" ? "New Action Unit" : "新动作单元",
    output_id: output.id,
    mode,
    enabled: true,
    description: "",
    params: {
      duration_ms: 3000,
      command: "on",
      total_duration_ms: 600000,
      cycle_ms: 60000,
      on_duration_ms: 30000,
      duty_percent: 30
    }
  };
}

function taskDefault() {
  const firstUnit = AC_STATE.actionUnits[0];
  return {
    id: "new_task",
    name: "新任务",
    task_type: "single_action",
    cooldown_sec: 0,
    enabled: true,
    description: "",
    steps: firstUnit ? [{ step_type: "run_action_unit", action_unit_id: firstUnit.id }] : []
  };
}

function ruleDefault() {
  const task = AC_STATE.actionTasks[0];
  return {
    id: "new_rule",
    name: "新触发规则",
    enabled: false,
    metric_key: "ph",
    signal_protocol: "lanchang_ph",
    signal_address: 1,
    signal_parameter: "measurement",
    aggregation: "last",
    window_sec: 60,
    operator: ">",
    threshold: 6.8,
    sustain_sec: 30,
    task_id: task?.id || "",
    cooldown_sec: 600,
    max_runs_per_hour: 4,
    requires_fresh_data: true,
    description: ""
  };
}

function scheduleDefault() {
  const task = AC_STATE.actionTasks[0];
  return {
    id: "new_schedule",
    name: "新定时计划",
    enabled: false,
    schedule_type: "daily",
    task_id: task?.id || "",
    time_of_day: "12:00",
    interval_sec: 3600,
    start_at: "",
    end_at: "",
    cooldown_sec: 600,
    skip_if_task_running: true,
    description: ""
  };
}

function outputSummary(item) {
  if (!item) return "";
  const tx = getAcText();
  const kind = item.kind || item.type;
  const base = kind === "pwm"
    ? `GPIO ${item.gpio_pin} / PWM / ${item.pwm_frequency || 1000}Hz`
    : `GPIO ${item.gpio_pin ?? item.pin} / ${tx.actuator.relay} / ${item.active_level === "high" ? tx.actuator.activeHigh : tx.actuator.activeLow}`;
  const unitCount = countUnitsUsingActuator(item.id);
  const usage = isZhLang()
    ? ` | 被 ${unitCount} 个动作单元使用`
    : ` | used by ${unitCount} action units`;
  return `${base}${usage}`;
}

function actuatorTypeHint(kind) {
  const relayText = isZhLang()
    ? "继电器适合简单的开关控制，比如加药泵、排水阀这类通断设备。"
    : "Relay outputs are for simple on/off devices such as dosing pumps or drain valves.";
  const pwmText = isZhLang()
    ? "PWM 适合需要调速或调功率的输出，比如变速泵、风扇或预留调速接口。"
    : "PWM outputs are for devices that need variable speed or power, such as variable pumps or fans.";
  return kind === "pwm" ? pwmText : relayText;
}

function actuatorSummary(item) {
  const data = item || readActuatorForm();
  if (!data) return "";
  const kind = data.kind || data.type || "relay";
  const pin = data.gpio_pin ?? data.pin ?? "-";
  const enabledText = data.enabled === false ? (isZhLang() ? "停用" : "Disabled") : (isZhLang() ? "启用" : "Enabled");
  const unitCount = countUnitsUsingActuator(data.id);
  const usageText = isZhLang()
    ? `，目前被 ${unitCount} 个动作单元引用`
    : `, currently used by ${unitCount} action units`;
  if (kind === "pwm") {
    return isZhLang()
      ? `PWM 输出，GPIO ${pin}，默认频率 ${data.pwm_frequency || 1000} Hz，默认占空比 ${data.safe_duty ?? 0}% ，当前${enabledText}${usageText}`
      : `PWM output on GPIO ${pin}, default ${data.pwm_frequency || 1000} Hz, safe duty ${data.safe_duty ?? 0}%, currently ${enabledText}${usageText}`;
  }
  const activeLevel = data.active_level === "high"
    ? (isZhLang() ? "高电平时打开" : "on when high")
    : (isZhLang() ? "低电平时打开" : "on when low");
  const safeState = data.safe_state === "on"
    ? (isZhLang() ? "上电默认打开" : "starts on")
    : (isZhLang() ? "上电默认关闭" : "starts off");
  return isZhLang()
    ? `继电器输出，GPIO ${pin}，${activeLevel}，${safeState}，当前${enabledText}${usageText}`
    : `Relay output on GPIO ${pin}, ${activeLevel}, ${safeState}, currently ${enabledText}${usageText}`;
}

function actionUnitSummary(item) {
  if (!item) return "";
  if (item.summary) return item.summary;
  const tx = getAcText();
  const output = findActuator(item.output_id);
  const outputName = output?.name || item.output_name || item.output_id || "-";
  const params = item.params || {};
  const taskCount = countTasksUsingUnit(item.id);
  const usage = isZhLang() ? ` | 被 ${taskCount} 个任务引用` : ` | used by ${taskCount} tasks`;
  if (item.mode === "relay_pulse") return `${outputName} ${tx.unit.run} ${formatDurationMs(params.duration_ms)}${usage}`;
  if (item.mode === "relay_state") return `${outputName} -> ${params.command === "on" ? tx.unit.stateOn : tx.unit.stateOff}${usage}`;
  if (item.mode === "relay_pattern") {
    return document.documentElement.lang === "en-US"
      ? `${outputName} ${tx.unit.modes.relayPattern} ${formatDurationMs(params.on_duration_ms)} / ${formatDurationMs(params.cycle_ms)} for ${formatDurationMs(params.total_duration_ms)}${usage}`
      : `${outputName} ${tx.unit.modes.relayPattern} ${formatDurationMs(params.on_duration_ms)} / ${formatDurationMs(params.cycle_ms)}，总时长 ${formatDurationMs(params.total_duration_ms)}${usage}`;
  }
  if (item.mode === "pwm_run") return `${outputName} PWM ${params.duty_percent}% / ${formatDurationMs(params.duration_ms)}${usage}`;
  return "";
}

function actionUnitModeHint(mode) {
  const hints = getAcText().unit.hints || {};
  const keyMap = {
    relay_pulse: "relayPulse",
    relay_state: "relayState",
    relay_pattern: "relayPattern",
    pwm_run: "pwmRun"
  };
  return hints[keyMap[mode] || mode] || "";
}

function taskSummary(item) {
  if (!item) return "";
  const usage = countPlansUsingTask(item.id);
  const usageText = isZhLang()
    ? ` | 被 ${usage.ruleCount} 条条件计划、${usage.scheduleCount} 条时间计划调用`
    : ` | used by ${usage.ruleCount} rules and ${usage.scheduleCount} schedules`;
  if (item.runtime?.last_status) {
    const prefix = item.summary || item.name || item.id || "";
    return `${prefix}${usageText} | ${item.runtime.last_status} @ ${item.runtime.last_ts || "-"} | ${item.runtime.last_source || "-"}`;
  }
  if (item.summary) return item.summary;
  const flow = (item.steps || []).map((step) => {
    if (step.step_type === "wait") return `wait ${Math.round((step.duration_ms || 0) / 1000)}s`;
    return findActionUnit(step.action_unit_id)?.name || step.action_unit_name || step.action_unit_id || "-";
  }).join(" -> ");
  return `${flow}${usageText}`;
}

function taskMeta(item) {
  const badges = [
    badge(item?.enabled === false ? "disabled" : "enabled", item?.enabled === false ? "muted" : "ok")
  ];
  if (item?.runtime?.last_status) {
    const toneMap = { success: "ok", failed: "danger", blocked: "warn" };
    badges.push(badge(item.runtime.last_status, toneMap[item.runtime.last_status] || "neutral"));
  } else {
    badges.push(badge("never run", "neutral"));
  }
  if (item?.runtime?.last_source) {
    badges.push(badge(item.runtime.last_source, "neutral"));
  }
  return makeMeta(taskSummary(item), badges);
}

function ruleSummary(item) {
  if (!item) return "";
  if (item.runtime) {
    const prefix = item.summary || item.name || item.id || "";
    if (!item.runtime.stats?.latest_ts) return `${prefix} | no data`;
    if (!item.runtime.fresh_ok) return `${prefix} | stale`;
    if (item.runtime.would_fire_now) return `${prefix} | ready`;
    if (item.runtime.matched_now) return `${prefix} | matched`;
  }
  if (item.summary) return item.summary;
  const taskName = findTask(item.task_id)?.name || item.task_name || item.task_id || "-";
  const signal = `${item.signal_protocol || "-"}:${item.signal_address ?? "-"}:${item.signal_parameter || item.metric_key || "-"}`;
  return `When ${signal} ${item.aggregation || "last"} ${item.operator || "-"} ${item.threshold ?? "-"} for ${item.sustain_sec || 0}s -> ${taskName}`;
}

function ruleMeta(item) {
  const badges = [
    badge(item?.enabled === false ? "disabled" : "enabled", item?.enabled === false ? "muted" : "ok")
  ];
  if (!item?.runtime?.stats?.latest_ts) {
    badges.push(badge("no data", "neutral"));
  } else if (!item.runtime.fresh_ok) {
    badges.push(badge("stale", "warn"));
  } else if (item.runtime.would_fire_now) {
    badges.push(badge("ready", "ok"));
  } else if (item.runtime.matched_now) {
    badges.push(badge("matched", "accent"));
  } else {
    badges.push(badge("watching", "neutral"));
  }
  if (item?.runtime?.blocked_reason) {
    badges.push(badge(item.runtime.blocked_reason, "warn"));
  }
  return makeMeta(ruleSummary(item), badges);
}

function scheduleSummary(item) {
  if (!item) return "";
  if (item.runtime?.next_run_ts) {
    return `${item.summary || item.name || item.id} | next ${item.runtime.next_run_ts}`;
  }
  if (item.runtime?.blocked_reason) {
    return `${item.summary || item.name || item.id} | ${item.runtime.blocked_reason}`;
  }
  if (item.summary) return item.summary;
  const taskName = findTask(item.task_id)?.name || item.task_name || item.task_id || "-";
  if (item.schedule_type === "once") return `Run ${taskName} once at ${item.start_at || "-"}`;
  if (item.schedule_type === "daily") return `Run ${taskName} daily at ${item.time_of_day || "-"}`;
  return `Run ${taskName} every ${formatSeconds(item.interval_sec || 0)}`;
}

function scheduleMeta(item) {
  const badges = [
    badge(item?.enabled === false ? "disabled" : "enabled", item?.enabled === false ? "muted" : "ok")
  ];
  if (item?.runtime?.next_run_ts) {
    badges.push(badge("scheduled", "ok"));
  } else if (item?.runtime?.blocked_reason) {
    badges.push(badge(item.runtime.blocked_reason, "warn"));
  } else {
    badges.push(badge("idle", "neutral"));
  }
  return makeMeta(scheduleSummary(item), badges);
}

function renderList(containerId, items, selectedId, metaBuilder, onPick) {
  const box = $(containerId);
  if (!box) return;
  if (!items.length) {
    box.innerHTML = `<div class="mini">暂无配置</div>`;
    return;
  }
  box.innerHTML = items.map((item) => {
    const meta = normalizeMeta(metaBuilder(item));
    const title = item.name || item.id;
    const summaryHtml = meta.summary && meta.summary !== title
      ? `<span class="ac-list-sub">${escapeHtml(meta.summary)}</span>`
      : "";
    return `
    <button type="button" class="ac-list-item${item.id === selectedId ? " active" : ""}" data-pick="${escapeHtml(item.id)}">
      <span class="ac-list-head">
        <span class="ac-list-title">${escapeHtml(title)}</span>
        <span class="ac-badge-row">${meta.badges.join("")}</span>
      </span>
      ${summaryHtml}
    </button>
  `;
  }).join("");
  box.querySelectorAll("[data-pick]").forEach((btn) => {
    btn.onclick = () => onPick(btn.getAttribute("data-pick") || "");
  });
}

function populateOutputSelect(selectedValue) {
  const select = $("acUnitOutputId");
  if (!select) return;
  select.innerHTML = listOptions(AC_STATE.actuators, (item) => item.id, (item) => `${item.name}（${outputKindLabel(item)}）`, selectedValue);
}

function populateTaskSelect(selectId, selectedValue) {
  const select = $(selectId);
  if (!select) return;
  select.innerHTML = listOptions(AC_STATE.actionTasks, (item) => item.id, (item) => taskOptionLabel(item), selectedValue);
}

function syncActuatorKindVisibility() {
  const kind = $("acActuatorType")?.value || "relay";
  document.querySelectorAll("[data-kind='relay']").forEach((el) => { el.style.display = kind === "relay" ? "" : "none"; });
  document.querySelectorAll("[data-kind='pwm']").forEach((el) => { el.style.display = kind === "pwm" ? "" : "none"; });
  renderActuatorInsights(readActuatorForm());
}

function normalizeModeForSelectedOutput() {
  const output = findActuator($("acUnitOutputId")?.value);
  const modeEl = $("acUnitMode");
  if (!output || !modeEl) return;
  const kind = output.kind || output.type;
  if (kind === "pwm" && modeEl.value !== "pwm_run") modeEl.value = "pwm_run";
  if (kind === "relay" && modeEl.value === "pwm_run") modeEl.value = "relay_pulse";
}

function syncActionModeVisibility() {
  const mode = $("acUnitMode")?.value || "relay_pulse";
  document.querySelectorAll("[data-mode]").forEach((el) => {
    el.style.display = el.getAttribute("data-mode") === mode ? "" : "none";
  });
}

function syncScheduleVisibility() {
  const type = $("acScheduleType")?.value || "daily";
  document.querySelectorAll("[data-schedule]").forEach((el) => {
    const allow = (el.getAttribute("data-schedule") || "").split(" ").includes(type);
    el.style.display = allow ? "" : "none";
  });
}

function fillAutomationForm(item) {
  const tx = getAcText();
  const data = item || automationDefault();
  $("acAutomationEnabled").checked = data.automation_enabled === true;
  $("acAutomationDryRun").checked = data.dry_run !== false;
  $("acAutomationHardwareArmed").checked = data.hardware_armed === true;
  $("acAutomationTickSec").value = data.tick_sec ?? 2;
  $("acAutomationFreshSec").value = data.fresh_data_sec ?? 180;
  const status = [
    data.running ? tx.overview.values.threadRunning : tx.overview.values.threadStopped,
    data.automation_enabled ? tx.overview.values.automationOn : tx.overview.values.automationOff,
    data.hardware_armed ? tx.overview.values.hardwareArmed : tx.overview.values.hardwareSafe,
    data.last_tick ? `${tx.overview.values.lastTick} ${data.last_tick}` : "",
    data.last_error ? `${tx.overview.values.error}: ${data.last_error}` : ""
  ].filter(Boolean).join(" | ");
  setText("acAutomationStatus", status);
}

function readAutomationForm() {
  return {
    automation_enabled: $("acAutomationEnabled").checked,
    dry_run: $("acAutomationDryRun").checked,
    hardware_armed: $("acAutomationHardwareArmed").checked,
    tick_sec: Number($("acAutomationTickSec").value || 2),
    fresh_data_sec: Number($("acAutomationFreshSec").value || 180)
  };
}

function fillActuatorForm(item) {
  const data = item || outputDefault();
  $("acActuatorId").value = data.id || "";
  $("acActuatorName").value = data.name || "";
  $("acActuatorType").value = data.kind || data.type || "relay";
  $("acActuatorPin").value = data.gpio_pin ?? data.pin ?? "";
  $("acActuatorActiveLevel").value = data.active_level || "low";
  $("acActuatorSafeState").value = data.safe_state || "off";
  $("acActuatorPwmFrequency").value = data.pwm_frequency ?? 1000;
  $("acActuatorSafeDuty").value = data.safe_duty ?? 0;
  $("acActuatorEnabled").checked = data.enabled !== false;
  $("acActuatorAllowReal").checked = (data.allow_real_output ?? data.allow_real) === true;
  $("acActuatorDesc").value = data.description || "";
  syncActuatorKindVisibility();
}

function readActuatorForm() {
  return {
    id: $("acActuatorId").value.trim(),
    name: $("acActuatorName").value.trim(),
    kind: $("acActuatorType").value,
    gpio_pin: Number($("acActuatorPin").value),
    active_level: $("acActuatorActiveLevel").value,
    safe_state: $("acActuatorSafeState").value,
    pwm_frequency: Number($("acActuatorPwmFrequency").value || 1000),
    safe_duty: Number($("acActuatorSafeDuty").value || 0),
    enabled: $("acActuatorEnabled").checked,
    allow_real_output: $("acActuatorAllowReal").checked,
    description: $("acActuatorDesc").value.trim()
  };
}

function fillActionUnitForm(item) {
  const data = item || actionUnitDefault();
  populateOutputSelect(data.output_id || "");
  $("acUnitId").value = data.id || "";
  $("acUnitName").value = data.name || "";
  $("acUnitOutputId").value = data.output_id || "";
  $("acUnitMode").value = data.mode || "relay_pulse";
  $("acUnitEnabled").checked = data.enabled !== false;
  $("acUnitDryRun").checked = true;
  $("acUnitDesc").value = data.description || "";
  const params = data.params || {};
  $("acUnitDurationMs").value = secondsInputFromMs(params.duration_ms, 3000);
  $("acUnitCommand").value = params.command || "on";
  $("acUnitPatternTotalMs").value = secondsInputFromMs(params.total_duration_ms, 600000);
  $("acUnitPatternCycleMs").value = secondsInputFromMs(params.cycle_ms, 60000);
  $("acUnitPatternOnMs").value = secondsInputFromMs(params.on_duration_ms, 30000);
  $("acUnitDutyPercent").value = params.duty_percent ?? 30;
  $("acUnitPwmDurationMs").value = secondsInputFromMs(params.duration_ms, 10000);
  normalizeModeForSelectedOutput();
  syncActionModeVisibility();
  renderActionUnitSummary();
}

function isActuatorDraftMode() {
  return !findActuator(AC_STATE.selectedActuatorId);
}

function isUnitDraftMode() {
  return !findActionUnit(AC_STATE.selectedUnitId);
}

function scrollWorkbenchEditorIntoView(kind) {
  const selector = kind === "actuator"
    ? '[data-tab-panel="actuator"] .ac-editor-card'
    : '[data-tab-panel="unit"] .ac-editor-card';
  const editor = document.querySelector(selector);
  if (editor) editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncActuatorEditorActions() {
  const draftMode = isActuatorDraftMode();
  toggleHidden("btnAcActuatorDelete", draftMode);
  toggleHidden("btnAcActuatorCancel", !draftMode);
}

function syncActionUnitEditorActions() {
  const draftMode = isUnitDraftMode();
  toggleHidden("btnAcUnitDelete", draftMode);
  toggleHidden("btnAcUnitExecute", draftMode);
  toggleHidden("btnAcUnitCancel", !draftMode);
}

function readActionUnitForm() {
  const mode = $("acUnitMode").value;
  const params = {};
  if (mode === "relay_pulse") params.duration_ms = msFromSecondsInput($("acUnitDurationMs").value, 3000);
  if (mode === "relay_state") params.command = $("acUnitCommand").value;
  if (mode === "relay_pattern") {
    params.total_duration_ms = msFromSecondsInput($("acUnitPatternTotalMs").value, 600000);
    params.cycle_ms = msFromSecondsInput($("acUnitPatternCycleMs").value, 60000);
    params.on_duration_ms = msFromSecondsInput($("acUnitPatternOnMs").value, 30000);
  }
  if (mode === "pwm_run") {
    params.duty_percent = Number($("acUnitDutyPercent").value);
    params.duration_ms = msFromSecondsInput($("acUnitPwmDurationMs").value, 10000);
  }
  return {
    id: $("acUnitId").value.trim(),
    name: $("acUnitName").value.trim(),
    output_id: $("acUnitOutputId").value,
    mode,
    enabled: $("acUnitEnabled").checked,
    description: $("acUnitDesc").value.trim(),
    params
  };
}

function renderActionUnitSummary() {
  renderActionUnitInsights(readActionUnitForm());
}

function renderActuatorInsights(item) {
  const draft = item || readActuatorForm();
  const kind = draft.kind || draft.type || "relay";
  const unitRefs = AC_STATE.actionUnits.filter((entry) => entry.output_id === draft.id);
  const linkedTaskNames = Array.from(new Set(
    unitRefs.flatMap((unit) => tasksUsingUnit(unit.id).map((task) => task.name || task.id))
  ));
  const realAllowed = (draft.allow_real_output ?? draft.allow_real) === true;

  setText("acActuatorTypeHint", actuatorTypeHint(kind));
  setText("acActuatorSummary", actuatorSummary(draft));
  setHtml("acActuatorWiring", isZhLang()
    ? `
      <div>当前接线</div>
      <strong>GPIO ${escapeHtml(draft.gpio_pin ?? draft.pin ?? "-")}</strong>
      <div>${escapeHtml(kind === "pwm" ? "PWM 输出" : "继电器输出")}</div>
      <div>${escapeHtml(realAllowed ? "允许人工真实测试" : "默认只做模拟测试")}</div>
    `
    : `
      <div>Current mapping</div>
      <strong>GPIO ${escapeHtml(draft.gpio_pin ?? draft.pin ?? "-")}</strong>
      <div>${escapeHtml(kind === "pwm" ? "PWM output" : "Relay output")}</div>
      <div>${escapeHtml(realAllowed ? "Manual live tests allowed" : "Manual tests stay simulated")}</div>
    `);
  setHtml("acActuatorImpact", isZhLang()
    ? `
      <div>${unitRefs.length ? `被 ${unitRefs.length} 个动作模板使用` : "暂时还没有动作模板使用它"}</div>
      <div>${linkedTaskNames.length ? `继续影响 ${linkedTaskNames.length} 个任务计划：${escapeHtml(linkedTaskNames.join("、"))}` : "现在改它，不会直接影响任务计划。"}</div>
    `
    : `
      <div>${unitRefs.length ? `Used by ${unitRefs.length} action templates` : "No action template uses it yet."}</div>
      <div>${linkedTaskNames.length ? `Those templates are used by ${linkedTaskNames.length} plans: ${escapeHtml(linkedTaskNames.join(", "))}` : "Changing it will not directly affect any plan yet."}</div>
    `);
}

function renderActionUnitInsights(item) {
  const draft = item || readActionUnitForm();
  const summary = actionUnitSummary(draft) || getAcText().unit.summaryPlaceholder;
  const output = findActuator(draft.output_id);
  const usedByTasks = tasksUsingUnit(draft.id);
  const dryRun = $("acUnitDryRun")?.checked !== false;

  setText("acUnitSummary", summary);
  setText("acUnitModeHint", actionUnitModeHint($("acUnitMode")?.value || ""));
  setHtml("acUnitExecutionPreview", isZhLang()
    ? `
      <div>当前模板会执行</div>
      <strong>${escapeHtml(summary)}</strong>
      <div>${escapeHtml(output?.name ? `目标设备：${output.name}` : "请先选择目标设备")}</div>
    `
    : `
      <div>This template will run</div>
      <strong>${escapeHtml(summary)}</strong>
      <div>${escapeHtml(output?.name ? `Target output: ${output.name}` : "Pick a target output first")}</div>
    `);
  setHtml("acUnitUsage", isZhLang()
    ? `
      <div>${usedByTasks.length ? `已被 ${usedByTasks.length} 个任务引用` : "还没有任务引用它"}</div>
      <div>${escapeHtml(usedByTasks.map((task) => task.name || task.id).join("、") || "保存后可在任务计划里直接选择它。")}</div>
    `
    : `
      <div>${usedByTasks.length ? `Used by ${usedByTasks.length} tasks` : "No task uses it yet"}</div>
      <div>${escapeHtml(usedByTasks.map((task) => task.name || task.id).join(", ") || "After saving, plans can call it directly.")}</div>
    `);
  setHtml("acUnitNote", isZhLang()
    ? `<div>${dryRun ? "现在执行时只记录结果，不会真的控制设备。" : "现在执行会真实控制设备，请先确认现场安全。"}</div>`
    : `<div>${dryRun ? "Run Once will only record the result without driving hardware." : "Run Once will drive the real device. Confirm site safety first."}</div>`);
}

function ensureTaskDraftShape() {
  const taskType = $("acTaskType")?.value || "single_action";
  if (taskType === "single_action") {
    const firstAction = AC_STATE.taskDraftSteps.find((step) => step.step_type === "run_action_unit");
    AC_STATE.taskDraftSteps = firstAction
      ? [{ step_type: "run_action_unit", action_unit_id: firstAction.action_unit_id }]
      : (AC_STATE.actionUnits[0] ? [{ step_type: "run_action_unit", action_unit_id: AC_STATE.actionUnits[0].id }] : []);
  }
}

function fillTaskForm(item) {
  const data = item || taskDefault();
  $("acTaskId").value = data.id || "";
  $("acTaskName").value = data.name || "";
  $("acTaskType").value = data.task_type || "single_action";
  $("acTaskCooldownSec").value = data.cooldown_sec ?? 0;
  $("acTaskEnabled").checked = data.enabled !== false;
  $("acTaskDryRun").checked = true;
  $("acTaskDesc").value = data.description || "";
  AC_STATE.taskDraftSteps = (data.steps || []).map((step) => ({ ...step }));
  ensureTaskDraftShape();
  renderTaskSteps();
  renderTaskSummary();
}

function renderTaskSteps() {
  const box = $("acTaskSteps");
  if (!box) return;
  ensureTaskDraftShape();
  const taskType = $("acTaskType").value;
  const actionOptions = listOptions(AC_STATE.actionUnits, (item) => item.id, (item) => item.name);
  box.innerHTML = AC_STATE.taskDraftSteps.map((step, index) => `
    <div class="ac-step-row" data-step-index="${index}">
      <div class="ac-step-index">${index + 1}</div>
      <select class="input ac-step-type">
        <option value="run_action_unit"${step.step_type === "run_action_unit" ? " selected" : ""}>动作单元</option>
        <option value="wait"${step.step_type === "wait" ? " selected" : ""}${taskType === "single_action" ? " disabled" : ""}>等待</option>
      </select>
      <div class="ac-step-fields">
        ${step.step_type === "wait"
          ? `<input class="input ac-step-wait" type="number" min="1" max="3600000" value="${escapeHtml(step.duration_ms ?? 1000)}" />`
          : `<select class="input ac-step-action">${actionOptions}</select>`}
      </div>
      <button class="btn btn-pill ac-step-remove" type="button"${taskType === "single_action" ? " disabled" : ""}>删除</button>
    </div>
  `).join("");

  box.querySelectorAll(".ac-step-row").forEach((row) => {
    const index = Number(row.getAttribute("data-step-index"));
    const typeSelect = row.querySelector(".ac-step-type");
    const actionSelect = row.querySelector(".ac-step-action");
    const waitInput = row.querySelector(".ac-step-wait");
    const removeBtn = row.querySelector(".ac-step-remove");
    if (typeSelect) {
      typeSelect.value = AC_STATE.taskDraftSteps[index].step_type;
      typeSelect.onchange = () => {
        AC_STATE.taskDraftSteps[index] = typeSelect.value === "wait"
          ? { step_type: "wait", duration_ms: 1000 }
          : { step_type: "run_action_unit", action_unit_id: AC_STATE.actionUnits[0]?.id || "" };
        renderTaskSteps();
        renderTaskSummary();
      };
    }
    if (actionSelect) {
      actionSelect.value = AC_STATE.taskDraftSteps[index].action_unit_id || "";
      actionSelect.onchange = () => {
        AC_STATE.taskDraftSteps[index].action_unit_id = actionSelect.value;
        renderTaskSummary();
      };
    }
    if (waitInput) {
      waitInput.oninput = () => {
        AC_STATE.taskDraftSteps[index].duration_ms = Number(waitInput.value || 0);
        renderTaskSummary();
      };
    }
    if (removeBtn) {
      removeBtn.onclick = () => {
        AC_STATE.taskDraftSteps.splice(index, 1);
        if (!AC_STATE.taskDraftSteps.length && AC_STATE.actionUnits[0]) {
          AC_STATE.taskDraftSteps = [{ step_type: "run_action_unit", action_unit_id: AC_STATE.actionUnits[0].id }];
        }
        renderTaskSteps();
        renderTaskSummary();
      };
    }
  });
}

function readTaskForm() {
  ensureTaskDraftShape();
  return {
    id: $("acTaskId").value.trim(),
    name: $("acTaskName").value.trim(),
    task_type: $("acTaskType").value,
    cooldown_sec: Number($("acTaskCooldownSec").value || 0),
    enabled: $("acTaskEnabled").checked,
    description: $("acTaskDesc").value.trim(),
    steps: AC_STATE.taskDraftSteps.map((step) => ({ ...step }))
  };
}

function renderTaskSummary() {
  const box = $("acTaskSummary");
  if (box) box.textContent = taskSummary(readTaskForm()) || "这里会显示任务摘要。";
}

function fillRuleForm(item) {
  const data = item || ruleDefault();
  populateTaskSelect("acRuleTaskId", data.task_id || "");
  $("acRuleId").value = data.id || "";
  $("acRuleName").value = data.name || "";
  $("acRuleMetricKey").value = data.metric_key || "";
  $("acRuleSignalProtocol").value = data.signal_protocol || "";
  $("acRuleSignalAddress").value = data.signal_address ?? 1;
  $("acRuleSignalParameter").value = data.signal_parameter || "";
  $("acRuleAggregation").value = data.aggregation || "last";
  $("acRuleWindowSec").value = data.window_sec ?? 60;
  $("acRuleOperator").value = data.operator || ">";
  $("acRuleThreshold").value = data.threshold ?? "";
  $("acRuleSustainSec").value = data.sustain_sec ?? 30;
  $("acRuleTaskId").value = data.task_id || "";
  $("acRuleCooldownSec").value = data.cooldown_sec ?? 600;
  $("acRuleMaxRunsPerHour").value = data.max_runs_per_hour ?? 4;
  $("acRuleEnabled").checked = data.enabled === true;
  $("acRuleRequiresFreshData").checked = data.requires_fresh_data !== false;
  $("acRuleDesc").value = data.description || "";
  renderRuleSummary();
}

function readRuleForm() {
  return {
    id: $("acRuleId").value.trim(),
    name: $("acRuleName").value.trim(),
    metric_key: $("acRuleMetricKey").value.trim(),
    signal_protocol: $("acRuleSignalProtocol").value.trim(),
    signal_address: Number($("acRuleSignalAddress").value || 0),
    signal_parameter: $("acRuleSignalParameter").value.trim(),
    aggregation: $("acRuleAggregation").value,
    window_sec: Number($("acRuleWindowSec").value || 60),
    operator: $("acRuleOperator").value,
    threshold: Number($("acRuleThreshold").value),
    sustain_sec: Number($("acRuleSustainSec").value || 0),
    task_id: $("acRuleTaskId").value,
    cooldown_sec: Number($("acRuleCooldownSec").value || 0),
    max_runs_per_hour: Number($("acRuleMaxRunsPerHour").value || 0),
    enabled: $("acRuleEnabled").checked,
    requires_fresh_data: $("acRuleRequiresFreshData").checked,
    description: $("acRuleDesc").value.trim()
  };
}

function renderRuleSummary() {
  const box = $("acRuleSummary");
  if (box) box.textContent = ruleSummary(readRuleForm()) || "这里会显示规则摘要。";
}

function fillScheduleForm(item) {
  const data = item || scheduleDefault();
  populateTaskSelect("acScheduleTaskId", data.task_id || "");
  $("acScheduleId").value = data.id || "";
  $("acScheduleName").value = data.name || "";
  $("acScheduleType").value = data.schedule_type || "daily";
  $("acScheduleTaskId").value = data.task_id || "";
  $("acScheduleStartAt").value = data.start_at || "";
  $("acScheduleTimeOfDay").value = data.time_of_day || "12:00";
  $("acScheduleIntervalSec").value = data.interval_sec || 3600;
  $("acScheduleEndAt").value = data.end_at || "";
  $("acScheduleCooldownSec").value = data.cooldown_sec ?? 600;
  $("acScheduleEnabled").checked = data.enabled === true;
  $("acScheduleSkipIfRunning").checked = data.skip_if_task_running !== false;
  $("acScheduleDesc").value = data.description || "";
  syncScheduleVisibility();
  renderScheduleSummary();
}

function readScheduleForm() {
  return {
    id: $("acScheduleId").value.trim(),
    name: $("acScheduleName").value.trim(),
    schedule_type: $("acScheduleType").value,
    task_id: $("acScheduleTaskId").value,
    start_at: $("acScheduleStartAt").value,
    time_of_day: $("acScheduleTimeOfDay").value,
    interval_sec: Number($("acScheduleIntervalSec").value || 0),
    end_at: $("acScheduleEndAt").value,
    cooldown_sec: Number($("acScheduleCooldownSec").value || 0),
    enabled: $("acScheduleEnabled").checked,
    skip_if_task_running: $("acScheduleSkipIfRunning").checked,
    description: $("acScheduleDesc").value.trim()
  };
}

function renderScheduleSummary() {
  const box = $("acScheduleSummary");
  if (box) box.textContent = scheduleSummary(readScheduleForm()) || "这里会显示计划摘要。";
}

function renderLogItem(log) {
  const targetName = logTargetName(log);
  const kindText = logKindText(log.run_kind);
  const toneClass = log.status === "success" ? "ok" : (log.status === "blocked" ? "warn" : "fail");
  return `
    <div class="ac-log-row ${toneClass}">
      <div class="ac-log-head">
        <span class="pill">${escapeHtml(kindText)}</span>
        <strong>${escapeHtml(targetName)}</strong>
        <span>${escapeHtml(log.ts || "")}</span>
        <span class="mini">${escapeHtml(logSourceLabel(log.source))}</span>
      </div>
      <div class="mini">${escapeHtml(logMessageLabel(log.message))}</div>
    </div>
  `;
}

function renderOverviewPanel() {
  const tx = getAcText();
  const grid = $("acOverviewGrid");
  const timeline = $("acOverviewTimeline");
  if (!grid || !timeline) return;
  const summary = AC_STATE.summary;
  fillAutomationForm(AC_STATE.automation || summary?.automation || automationDefault());
  if (!summary) {
    grid.innerHTML = `<div class="mini">${tx.overview.noData}</div>`;
    timeline.innerHTML = "";
    return;
  }
  const driver = summary.driver || {};
  const automation = AC_STATE.automation || summary.automation || automationDefault();
  const cards = [
    { label: tx.overview.cards.driver, value: driver.available ? driver.backend : tx.overview.values.notDetected, tone: driver.available ? "ok" : "warn" },
    { label: tx.overview.cards.thread, value: automation.running ? tx.overview.values.running : tx.overview.values.stopped, tone: automation.running ? "ok" : "warn" },
    { label: tx.overview.cards.hardware, value: automation.hardware_armed ? tx.overview.values.armed : tx.overview.values.safeLock, tone: automation.hardware_armed ? "warn" : "ok" },
    { label: tx.overview.cards.outputs, value: `${summary.outputs?.enabled || 0} / ${summary.outputs?.total || 0}`, tone: "ok" },
    { label: tx.overview.cards.units, value: `${summary.action_units?.enabled || 0} / ${summary.action_units?.total || 0}`, tone: "ok" },
    { label: tx.overview.cards.tasks, value: `${summary.tasks?.enabled || 0} / ${summary.tasks?.total || 0}`, tone: "ok" },
    { label: tx.overview.cards.rules, value: `${summary.rules?.enabled || 0} / ${summary.rules?.total || 0}`, tone: "ok" },
    { label: tx.overview.cards.schedules, value: `${summary.schedules?.enabled || 0} / ${summary.schedules?.total || 0}`, tone: "ok" }
  ];
  grid.innerHTML = cards.map((card) => `
    <div class="ac-stat-card">
      <div class="ac-stat-label">${escapeHtml(card.label)}</div>
      <div class="ac-stat-value">${escapeHtml(card.value)}</div>
      <div class="ac-stat-hint ${card.tone}">${card.tone === "warn" ? tx.overview.needsAttention : tx.overview.healthy}</div>
    </div>
  `).join("");
  const logs = summary.logs || [];
  timeline.innerHTML = logs.length ? logs.map((log) => renderLogItem(log)).join("") : `<div class="mini">${tx.overview.noLogs}</div>`;
}

export function renderActuatorPanel() {
  renderList("acActuatorList", AC_STATE.actuators, AC_STATE.selectedActuatorId, outputSummary, (id) => {
    AC_STATE.selectedActuatorId = id;
    AC_STATE.draftActuatorReturnId = "";
    renderActuatorPanel();
  });
  fillActuatorForm(findActuator(AC_STATE.selectedActuatorId));
  syncActuatorEditorActions();
  renderActuatorInsights(findActuator(AC_STATE.selectedActuatorId) || readActuatorForm());
}

export function renderActionUnitPanel() {
  renderList("acUnitList", AC_STATE.actionUnits, AC_STATE.selectedUnitId, actionUnitSummary, (id) => {
    AC_STATE.selectedUnitId = id;
    AC_STATE.draftUnitReturnId = "";
    renderActionUnitPanel();
  });
  fillActionUnitForm(findActionUnit(AC_STATE.selectedUnitId));
  syncActionUnitEditorActions();
  renderActionUnitInsights(findActionUnit(AC_STATE.selectedUnitId) || readActionUnitForm());
}

export function renderTaskPanel() {
  renderList("acTaskList", AC_STATE.actionTasks, AC_STATE.selectedTaskId, taskMeta, (id) => {
    AC_STATE.selectedTaskId = id;
    renderTaskPanel();
  });
  fillTaskForm(findTask(AC_STATE.selectedTaskId));
}

export function renderRulePanel() {
  renderList("acRuleList", AC_STATE.actionRules, AC_STATE.selectedRuleId, ruleMeta, (id) => {
    AC_STATE.selectedRuleId = id;
    renderRulePanel();
  });
  fillRuleForm(AC_STATE.actionRules.find((item) => item.id === AC_STATE.selectedRuleId) || null);
}

export function renderSchedulePanel() {
  renderList("acScheduleList", AC_STATE.actionSchedules, AC_STATE.selectedScheduleId, scheduleMeta, (id) => {
    AC_STATE.selectedScheduleId = id;
    renderSchedulePanel();
  });
  fillScheduleForm(AC_STATE.actionSchedules.find((item) => item.id === AC_STATE.selectedScheduleId) || null);
}

export function renderLogPanel() {
  const box = $("acLogList");
  if (!box) return;
  box.innerHTML = AC_STATE.actionLogs.length
    ? AC_STATE.actionLogs.map((log) => renderLogItem(log)).join("")
    : `<div class="mini">暂无执行日志</div>`;
}

async function loadSharedRuntimeData() {
  const [actuatorRes, unitRes, taskRes] = await Promise.all([
    fetchActuators(),
    fetchActionUnits(),
    fetchActionTasks()
  ]);
  AC_STATE.actuators = actuatorRes.items || [];
  AC_STATE.actionUnits = unitRes.items || [];
  AC_STATE.actionTasks = taskRes.items || [];
}

export async function refreshActionRuntime(tab = AC_STATE.activeTab) {
  if (tab === "overview") {
    AC_STATE.summary = await fetchActionSummary();
    AC_STATE.automation = AC_STATE.summary.automation || automationDefault();
    renderOverviewPanel();
    return;
  }
  if (tab === "actuator") {
    const res = await fetchActuators();
    AC_STATE.actuators = res.items || [];
    AC_STATE.selectedActuatorId = AC_STATE.selectedActuatorId || AC_STATE.actuators[0]?.id || "";
    renderActuatorPanel();
    return;
  }
  if (tab === "unit") {
    await loadSharedRuntimeData();
    AC_STATE.selectedUnitId = AC_STATE.selectedUnitId || AC_STATE.actionUnits[0]?.id || "";
    renderActionUnitPanel();
    return;
  }
  if (tab === "task") {
    await loadSharedRuntimeData();
    AC_STATE.selectedTaskId = AC_STATE.selectedTaskId || AC_STATE.actionTasks[0]?.id || "";
    renderTaskPanel();
    return;
  }
  if (tab === "rule") {
    await loadSharedRuntimeData();
    const res = await fetchActionRules();
    AC_STATE.actionRules = res.items || [];
    AC_STATE.selectedRuleId = AC_STATE.selectedRuleId || AC_STATE.actionRules[0]?.id || "";
    renderRulePanel();
    return;
  }
  if (tab === "schedule") {
    await loadSharedRuntimeData();
    const res = await fetchActionSchedules();
    AC_STATE.actionSchedules = res.items || [];
    AC_STATE.selectedScheduleId = AC_STATE.selectedScheduleId || AC_STATE.actionSchedules[0]?.id || "";
    renderSchedulePanel();
    return;
  }
  if (tab === "logs") {
    const res = await fetchActionLogs(100);
    AC_STATE.actionLogs = res.items || [];
    renderLogPanel();
  }
}

export function bindRuntimePanels() {
  if ($("btnAcOverviewRefresh")) {
    $("btnAcOverviewRefresh").onclick = async () => {
      await refreshActionRuntime("overview");
    };
  }
  if ($("btnAcAutomationStart")) {
    $("btnAcAutomationStart").onclick = async () => {
      try {
        AC_STATE.automation = await startAutomationRuntime();
        renderOverviewPanel();
      } catch (error) {
        setText("acAutomationStatus", error.message || String(error));
      }
    };
  }
  if ($("btnAcAutomationStop")) {
    $("btnAcAutomationStop").onclick = async () => {
      try {
        AC_STATE.automation = await stopAutomationRuntime();
        renderOverviewPanel();
      } catch (error) {
        setText("acAutomationStatus", error.message || String(error));
      }
    };
  }
  if ($("btnAcAutomationSave")) {
    $("btnAcAutomationSave").onclick = async () => {
      try {
        const draft = readAutomationForm();
        if (draft.hardware_armed && !window.confirm(getAcText().common.confirmRealOutput)) return;
        const res = await saveAutomationConfig(draft);
        AC_STATE.automation = {
          ...(res.config || {}),
          running: res.running,
          last_tick: res.last_tick,
          last_error: res.last_error
        };
        renderOverviewPanel();
      } catch (error) {
        setText("acAutomationStatus", error.message || String(error));
      }
    };
  }

  if ($("acActuatorType")) {
    $("acActuatorType").onchange = syncActuatorKindVisibility;
  }
  ["acActuatorName", "acActuatorPin", "acActuatorActiveLevel", "acActuatorSafeState", "acActuatorPwmFrequency", "acActuatorSafeDuty", "acActuatorDesc"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const eventName = el.tagName === "SELECT" ? "onchange" : "oninput";
    el[eventName] = () => renderActuatorInsights(readActuatorForm());
  });
  ["acActuatorEnabled", "acActuatorAllowReal"].forEach((id) => {
    const el = $(id);
    if (el) el.onchange = () => renderActuatorInsights(readActuatorForm());
  });
  if ($("btnAcActuatorRefresh")) {
    $("btnAcActuatorRefresh").onclick = async () => { await refreshActionRuntime("actuator"); setText("acActuatorStatus", uiCommonText().refreshed); };
  }
  if ($("btnAcActuatorNew")) {
    $("btnAcActuatorNew").onclick = () => {
      AC_STATE.draftActuatorReturnId = AC_STATE.selectedActuatorId || AC_STATE.actuators[0]?.id || "";
      AC_STATE.selectedActuatorId = "";
      fillActuatorForm(outputDefault());
      syncActuatorEditorActions();
      renderActuatorInsights(readActuatorForm());
      setText("acActuatorStatus", uiCommonText().creating);
      scrollWorkbenchEditorIntoView("actuator");
    };
  }
  if ($("btnAcActuatorCancel")) {
    $("btnAcActuatorCancel").onclick = () => {
      AC_STATE.selectedActuatorId = AC_STATE.draftActuatorReturnId || AC_STATE.actuators[0]?.id || "";
      AC_STATE.draftActuatorReturnId = "";
      renderActuatorPanel();
      setText("acActuatorStatus", defaultStatusText());
      scrollWorkbenchEditorIntoView("actuator");
    };
  }
  if ($("btnAcActuatorSave")) {
    $("btnAcActuatorSave").onclick = async () => {
      try {
        const draft = readActuatorForm();
        const previous = findActuator(draft.id);
        if (draft.allow_real_output && previous?.allow_real_output !== true) {
          if (!window.confirm(uiCommonText().confirmRealOutput)) return;
        }
        const res = await saveActuator(draft);
        AC_STATE.selectedActuatorId = res.item.id;
        AC_STATE.draftActuatorReturnId = "";
        await refreshActionRuntime("actuator");
        setText("acActuatorStatus", uiCommonText().saved);
      } catch (error) {
        setText("acActuatorStatus", error.message || String(error));
      }
    };
  }
  if ($("btnAcActuatorDelete")) {
    $("btnAcActuatorDelete").onclick = async () => {
      const id = $("acActuatorId").value.trim();
      if (!id || !window.confirm(`${uiCommonText().confirmDelete} ${id} ?`)) return;
      try {
        await deleteActuator(id);
        AC_STATE.selectedActuatorId = "";
        AC_STATE.draftActuatorReturnId = "";
        await refreshActionRuntime("actuator");
        setText("acActuatorStatus", uiCommonText().deleted);
      } catch (error) {
        setText("acActuatorStatus", error.message || String(error));
      }
    };
  }

  if ($("acUnitMode")) {
    $("acUnitMode").onchange = () => { syncActionModeVisibility(); renderActionUnitSummary(); };
  }
  if ($("acUnitOutputId")) {
    $("acUnitOutputId").onchange = () => { normalizeModeForSelectedOutput(); syncActionModeVisibility(); renderActionUnitSummary(); };
  }
  ["acUnitName", "acUnitDurationMs", "acUnitCommand", "acUnitPatternTotalMs", "acUnitPatternCycleMs", "acUnitPatternOnMs", "acUnitDutyPercent", "acUnitPwmDurationMs"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const eventName = el.tagName === "SELECT" ? "onchange" : "oninput";
    el[eventName] = renderActionUnitSummary;
  });
  ["acUnitDesc"].forEach((id) => {
    const el = $(id);
    if (el) el.oninput = renderActionUnitSummary;
  });
  ["acUnitEnabled", "acUnitDryRun"].forEach((id) => {
    const el = $(id);
    if (el) el.onchange = renderActionUnitSummary;
  });
  if ($("btnAcUnitRefresh")) {
    $("btnAcUnitRefresh").onclick = async () => { await refreshActionRuntime("unit"); setText("acUnitStatus", uiCommonText().refreshed); };
  }
  if ($("btnAcUnitNew")) {
    $("btnAcUnitNew").onclick = () => {
      AC_STATE.draftUnitReturnId = AC_STATE.selectedUnitId || AC_STATE.actionUnits[0]?.id || "";
      AC_STATE.selectedUnitId = "";
      fillActionUnitForm(actionUnitDefault());
      syncActionUnitEditorActions();
      renderActionUnitInsights(readActionUnitForm());
      setText("acUnitStatus", uiCommonText().creating);
      scrollWorkbenchEditorIntoView("unit");
    };
  }
  if ($("btnAcUnitCancel")) {
    $("btnAcUnitCancel").onclick = () => {
      AC_STATE.selectedUnitId = AC_STATE.draftUnitReturnId || AC_STATE.actionUnits[0]?.id || "";
      AC_STATE.draftUnitReturnId = "";
      renderActionUnitPanel();
      setText("acUnitStatus", defaultStatusText());
      scrollWorkbenchEditorIntoView("unit");
    };
  }
  if ($("btnAcUnitSave")) {
    $("btnAcUnitSave").onclick = async () => {
      try {
        const res = await saveActionUnit(readActionUnitForm());
        AC_STATE.selectedUnitId = res.item.id;
        AC_STATE.draftUnitReturnId = "";
        await refreshActionRuntime("unit");
        setText("acUnitStatus", uiCommonText().saved);
      } catch (error) {
        setText("acUnitStatus", error.message || String(error));
      }
    };
  }
  if ($("btnAcUnitDelete")) {
    $("btnAcUnitDelete").onclick = async () => {
      const id = $("acUnitId").value.trim();
      if (!id || !window.confirm(`${uiCommonText().confirmDelete} ${id} ?`)) return;
      try {
        await deleteActionUnit(id);
        AC_STATE.selectedUnitId = "";
        AC_STATE.draftUnitReturnId = "";
        await refreshActionRuntime("unit");
        setText("acUnitStatus", uiCommonText().deleted);
      } catch (error) {
        setText("acUnitStatus", error.message || String(error));
      }
    };
  }
  if ($("btnAcUnitExecute")) {
    $("btnAcUnitExecute").onclick = async () => {
      const id = $("acUnitId").value.trim();
      if (!id) return;
      const dryRun = $("acUnitDryRun").checked;
      if (!dryRun && !window.confirm(getAcText().common.confirmRealOutput)) return;
      try {
        setText("acUnitStatus", dryRun ? uiCommonText().runningDry : uiCommonText().runningLive);
        const res = await executeActionUnit(id, { dryRun, source: "manual" });
        setText("acUnitStatus", `${logMessageLabel(res.message)} | ${uiCommonText().logId} #${res.log_id}`);
      } catch (error) {
        setText("acUnitStatus", error.message || String(error));
      }
    };
  }

  if ($("acActuatorStatus") && !$("acActuatorStatus").textContent.trim()) {
    setText("acActuatorStatus", defaultStatusText());
  }
  if ($("acUnitStatus") && !$("acUnitStatus").textContent.trim()) {
    setText("acUnitStatus", defaultStatusText());
  }
}
