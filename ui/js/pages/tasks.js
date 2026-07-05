import {
  deleteActionRule,
  deleteActionSchedule,
  deleteActionTask,
  evaluateActionRule,
  executeActionTask,
  fetchActionLogs,
  fetchActionRules,
  fetchActionSchedules,
  fetchActionSummary,
  fetchActionTasks,
  fetchActionUnits,
  saveActionRule,
  saveActionSchedule,
  saveActionTask,
  saveAutomationConfig,
  startAutomationRuntime,
  stopAutomationRuntime,
  triggerActionSchedule
} from "./action_config/api.js";
import { initActionConfig } from "./action_config/index.js";
import { apiMetaPlanView } from "../api.js";
import { setActivePage } from "../router.js";
import { t } from "../i18n.js";

const TASK_UI_STORAGE_KEY = "hydrocore.tasks.ui.v1";

const TASK_STATE = {
  activeTab: "plans",
  planFilter: "all",
  selectedPlanKind: "schedule",
  draftPlanKind: "",
  draftReturnPlanKind: "",
  draftReturnPlanId: "",
  summary: null,
  tasks: [],
  actionUnits: [],
  rules: [],
  schedules: [],
  planViewEntries: [],
  planSources: [],
  logs: [],
  selectedTaskId: "",
  selectedRuleId: "",
  selectedScheduleId: "",
  taskDraftSteps: [],
  status: {
    tasks: "",
    rules: "",
    schedules: "",
    logs: ""
  },
  statusTone: {
    tasks: "",
    rules: "",
    schedules: "",
    logs: ""
  }
};

function loadTaskUiState() {
  try {
    const raw = localStorage.getItem(TASK_UI_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === "object") {
      if (saved.activeTab === "plans" || saved.activeTab === "logs" || saved.activeTab === "diagnostics") {
        TASK_STATE.activeTab = saved.activeTab;
      }
      if (saved.planFilter === "all" || saved.planFilter === "schedule" || saved.planFilter === "rule" || saved.planFilter === "disabled") {
        TASK_STATE.planFilter = saved.planFilter;
      }
      if (saved.selectedPlanKind === "rule" || saved.selectedPlanKind === "schedule") {
        TASK_STATE.selectedPlanKind = saved.selectedPlanKind;
      }
      if (typeof saved.selectedRuleId === "string") TASK_STATE.selectedRuleId = saved.selectedRuleId;
      if (typeof saved.selectedScheduleId === "string") TASK_STATE.selectedScheduleId = saved.selectedScheduleId;
    }
  } catch (_) {
    // ignore invalid saved task ui state
  }
}

function saveTaskUiState() {
  try {
    localStorage.setItem(TASK_UI_STORAGE_KEY, JSON.stringify({
      activeTab: TASK_STATE.activeTab,
      planFilter: TASK_STATE.planFilter,
      selectedPlanKind: TASK_STATE.selectedPlanKind,
      selectedRuleId: TASK_STATE.selectedRuleId,
      selectedScheduleId: TASK_STATE.selectedScheduleId
    }));
  } catch (_) {
    // ignore storage write failures
  }
}

const DEMO_NAME_MAP = {
  task: {
    task_dose_a_3s: { zh: "加药泵 A 单次加药", en: "Dose pump A once" },
    task_dose_b_3s: { zh: "加药泵 B 单次加药", en: "Dose pump B once" },
    task_drain_20s: { zh: "排水 20 秒", en: "Drain for 20 s" }
  },
  action_unit: {
    dose_a_1s: { zh: "加药泵 A 运行 1 秒", en: "Dose pump A for 1 s" },
    dose_a_3s: { zh: "加药泵 A 运行 3 秒", en: "Dose pump A for 3 s" },
    dose_b_1s: { zh: "加药泵 B 运行 1 秒", en: "Dose pump B for 1 s" },
    dose_b_3s: { zh: "加药泵 B 运行 3 秒", en: "Dose pump B for 3 s" },
    drain_valve_open: { zh: "打开排水阀", en: "Open drain valve" },
    drain_valve_close: { zh: "关闭排水阀", en: "Close drain valve" },
    pwm_30pct_10s: { zh: "PWM 通道 1 30% 运行 10 秒", en: "PWM 1 at 30% for 10 s" },
    pwm_60pct_10s: { zh: "PWM 通道 1 60% 运行 10 秒", en: "PWM 1 at 60% for 10 s" }
  },
  rule: {
    rule_ph_high_dose_a: { zh: "pH 偏高时加药 A", en: "Dose A when pH is high" }
  },
  schedule: {
    schedule_daily_drain_noon: { zh: "每日中午排水", en: "Drain every day at noon" }
  }
};

const PROTOCOL_DISPLAY_MAP = {
  lanchang_ph: { zh: "pH 探头", en: "pH probe" },
  lanchang_ec: { zh: "电导率探头", en: "EC probe" },
  lanchang_cr_huchen: { zh: "腐蚀监测仪", en: "Corrosion monitor" }
};

const PARAMETER_DISPLAY_MAP = {
  "lanchang_ph:measurement": { zh: "pH", en: "pH" },
  "lanchang_ph:temperature": { zh: "温度", en: "Temperature" },
  "lanchang_ph:current_output": { zh: "电流输出", en: "Current output" },
  "lanchang_ph:warning": { zh: "报警", en: "Alarm" },
  "lanchang_ec:ec_value": { zh: "电导率", en: "EC" },
  "lanchang_ec:resistivity_value": { zh: "电阻率", en: "Resistivity" },
  "lanchang_ec:temperature": { zh: "温度", en: "Temperature" },
  "lanchang_ec:tds_value": { zh: "TDS", en: "TDS" },
  "lanchang_ec:salinity": { zh: "盐度", en: "Salinity" },
  "lanchang_cr_huchen:corrosion_rate": { zh: "腐蚀率", en: "Corrosion rate" },
  "lanchang_cr_huchen:mv_value": { zh: "电位", en: "Potential" },
  "lanchang_cr_huchen:offset": { zh: "偏移量", en: "Offset" }
};

function $(id) {
  return document.getElementById(id);
}

function tr(key) {
  return t(key);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badge(label, tone = "neutral") {
  return `<span class="task-badge ${tone}">${escapeHtml(label)}</span>`;
}

function enabledLabel(enabled) {
  return enabled === false ? tr("tasks.state.disabled") : tr("tasks.state.enabled");
}

function statusLabel(status) {
  const map = {
    success: tr("tasks.status.success"),
    failed: tr("tasks.status.failed"),
    blocked: tr("tasks.status.blocked")
  };
  return map[status] || status || "-";
}

function blockedReasonLabel(reason) {
  const map = {
    "Schedule is disabled": tr("tasks.blocked.schedule_disabled"),
    "Rule is disabled": tr("tasks.blocked.rule_disabled"),
    "Task is disabled": tr("tasks.blocked.task_disabled"),
    "Task is running": tr("tasks.blocked.task_running"),
    "No recent data": tr("tasks.blocked.no_recent_data"),
    "Rule conditions not met": tr("tasks.blocked.rule_not_matched"),
    "Cooldown is active": tr("tasks.blocked.cooldown_active"),
    "Outside active window": tr("tasks.window.outside")
  };
  return map[reason] || reason || "-";
}

function logKindLabel(kind) {
  return kind === "task" ? tr("tasks.logs.kind_task") : tr("tasks.logs.kind_action");
}

function isZhLang() {
  return document.documentElement.lang === "zh-CN";
}

function mappedDemoName(kind, id) {
  const entry = DEMO_NAME_MAP[kind]?.[id];
  if (!entry) return "";
  return isZhLang() ? entry.zh : entry.en;
}

function localizedName(kind, id, fallback = "") {
  return mappedDemoName(kind, id) || fallback || id || "-";
}

function protocolDisplayName(protocol) {
  const mapped = PROTOCOL_DISPLAY_MAP[String(protocol || "").trim()];
  if (mapped) return isZhLang() ? mapped.zh : mapped.en;
  return String(protocol || "").trim() || "-";
}

function parameterDisplayName(protocol, parameter, fallback = "") {
  const key = `${String(protocol || "").trim()}:${String(parameter || "").trim()}`;
  const mapped = PARAMETER_DISPLAY_MAP[key];
  if (mapped) return isZhLang() ? mapped.zh : mapped.en;
  return metricLabel(fallback || parameter);
}

function planSourceKey(protocol, address, parameter) {
  return `${protocol || ""}::${address ?? ""}::${parameter || ""}`;
}

function monitoredPointDeviceLabel(protocolLabel, address) {
  return `${protocolLabel} #${address}`;
}

function buildPlanSources(entries = []) {
  const sources = [];
  for (const entry of entries) {
    const protocol = String(entry?.protocol || "").trim();
    const address = Number(entry?.address ?? 0);
    const protocolLabel = protocolDisplayName(protocol);
    const deviceLabel = monitoredPointDeviceLabel(protocolLabel, address);
    for (const parameter of entry?.parameters || []) {
      const field = String(parameter?.name || "").trim();
      if (!protocol || !field) continue;
      const label = String(parameter?.label_zh || parameter?.label || field).trim();
      const unit = String(parameter?.unit || "").trim();
      const displayLabel = parameterDisplayName(protocol, field, label);
      const sameUnit = unit && unit.trim().toLowerCase() === displayLabel.trim().toLowerCase();
      const pointLabel = sameUnit ? displayLabel : (unit ? `${displayLabel} (${unit})` : displayLabel);
      sources.push({
        key: planSourceKey(protocol, address, field),
        protocol,
        address,
        parameter: field,
        protocolLabel,
        metricLabel: displayLabel,
        unit,
        deviceLabel,
        optionLabel: `${pointLabel} · ${deviceLabel}`
      });
    }
  }
  return sources;
}

function firstPlanSource() {
  return TASK_STATE.planSources[0] || null;
}

function findPlanSourceByKey(key) {
  return TASK_STATE.planSources.find((item) => item.key === key) || null;
}

function findPlanSourceForRule(rule) {
  if (!rule) return null;
  const exact = findPlanSourceByKey(planSourceKey(rule.signal_protocol, rule.signal_address, rule.signal_parameter));
  if (exact) return exact;
  const sameProtocol = TASK_STATE.planSources.find((item) => item.protocol === rule.signal_protocol && item.parameter === rule.signal_parameter);
  if (sameProtocol) return sameProtocol;
  return TASK_STATE.planSources.find((item) => item.parameter === rule.signal_parameter) || null;
}

function renderRuleSourceOptions(selectedKey = "") {
  if (!TASK_STATE.planSources.length) {
    return `<option value="">${isZhLang() ? "请先到硬件配置里定义监测点" : "Set up a monitored point in Hardware Config first"}</option>`;
  }
  return TASK_STATE.planSources.map((source) => `
    <option value="${escapeHtml(source.key)}"${source.key === selectedKey ? " selected" : ""}>${escapeHtml(source.optionLabel)}</option>
  `).join("");
}

function syncRuleSourceFields() {
  const sourceSelect = $("ruleFormSourceKey");
  if (!sourceSelect) return null;
  const source = findPlanSourceByKey(sourceSelect.value) || firstPlanSource();
  if (!source) {
    if ($("ruleFormSignalProtocol")) $("ruleFormSignalProtocol").value = "";
    if ($("ruleFormSignalAddress")) $("ruleFormSignalAddress").value = "";
    if ($("ruleFormSignalParameter")) $("ruleFormSignalParameter").value = "";
    if ($("ruleFormMetricKey")) $("ruleFormMetricKey").value = "";
    if ($("ruleFormSourceHint")) $("ruleFormSourceHint").textContent = isZhLang() ? "当前没有可选监测点，请先去硬件配置里完成定义。" : "No monitored point is available yet. Set one up in Hardware Config first.";
    return null;
  }

  sourceSelect.value = source.key;
  if ($("ruleFormSignalProtocol")) $("ruleFormSignalProtocol").value = source.protocol;
  if ($("ruleFormSignalAddress")) $("ruleFormSignalAddress").value = String(source.address);
  if ($("ruleFormSignalParameter")) $("ruleFormSignalParameter").value = source.parameter;
  if ($("ruleFormMetricKey")) $("ruleFormMetricKey").value = source.metricLabel;
  if ($("ruleFormSourceHint")) {
    $("ruleFormSourceHint").textContent = isZhLang()
      ? "来自硬件配置，已包含设备和地址。"
      : "From Hardware Config; device and address are already included.";
  }
  return source;
}

function taskNameById(id) {
  const task = TASK_STATE.tasks.find((item) => item.id === id);
  return localizedName("task", id, task?.name || "");
}

function actionUnitNameById(id) {
  const item = TASK_STATE.actionUnits.find((unit) => unit.id === id);
  return localizedName("action_unit", id, item?.name || "");
}

function planName(kind, item) {
  if (!item) return "-";
  return localizedName(kind, item.id, item.name || "");
}

function logTargetName(log) {
  if (log.task_id) return taskNameById(log.task_id);
  if (log.action_unit_id) return actionUnitNameById(log.action_unit_id);
  return "-";
}

function logSourceLabel(source) {
  if (!source) return "-";
  if (source === "manual") return isZhLang() ? "手动执行" : "Manual";
  if (source === "smoke") return isZhLang() ? "联调测试" : "Smoke test";
  if (source === "verify") return isZhLang() ? "验证测试" : "Verification";
  if (source.startsWith("schedule-test:")) {
    const scheduleId = source.slice("schedule-test:".length);
    const schedule = TASK_STATE.schedules.find((item) => item.id === scheduleId) || null;
    const scheduleName = planName("schedule", schedule || { id: scheduleId, name: scheduleId });
    return isZhLang() ? `计划测试 / ${scheduleName}` : `Schedule test / ${scheduleName}`;
  }
  if (source.startsWith("schedule:")) {
    const scheduleId = source.slice("schedule:".length);
    const schedule = TASK_STATE.schedules.find((item) => item.id === scheduleId) || null;
    const scheduleName = planName("schedule", schedule || { id: scheduleId, name: scheduleId });
    return isZhLang() ? `计划触发 / ${scheduleName}` : `Schedule / ${scheduleName}`;
  }
  if (source.startsWith("rule:")) {
    const ruleId = source.slice("rule:".length);
    const rule = TASK_STATE.rules.find((item) => item.id === ruleId) || null;
    const ruleName = planName("rule", rule || { id: ruleId, name: ruleId });
    return isZhLang() ? `规则触发 / ${ruleName}` : `Rule / ${ruleName}`;
  }
  return source;
}

function logMessageLabel(message) {
  if (!message) return "-";
  const exactMap = isZhLang()
    ? {
        "Dry-run task completed": "模拟执行完成",
        "Dry-run action completed": "动作模拟执行完成",
        "Real task completed": "实际执行完成",
        "Real action completed": "动作实际执行完成",
        "Real GPIO output is blocked until hardware is armed": "还未允许实际控制设备，系统已拦截这次输出",
        "Task is disabled": "任务已停用",
        "Schedule is disabled": "计划已停用",
        "Rule is disabled": "规则已停用",
        "Task is running": "任务正在运行",
        "No recent data": "没有最近数据",
        "Rule conditions not met": "规则条件未满足",
        "Cooldown is active": "还在等待再次执行"
      }
    : {
        "Dry-run task completed": "Dry-run task completed",
        "Dry-run action completed": "Dry-run action completed",
        "Real task completed": "Real task completed",
        "Real action completed": "Real action completed",
        "Real GPIO output is blocked until hardware is armed": "Real output blocked until hardware is armed",
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
    return isZhLang() ? `还要等 ${taskCooldown[1]} 秒才能再执行` : message;
  }
  return message;
}

function selectedTask() {
  return TASK_STATE.tasks.find((item) => item.id === TASK_STATE.selectedTaskId) || null;
}

function selectedRule() {
  return TASK_STATE.rules.find((item) => item.id === TASK_STATE.selectedRuleId) || null;
}

function selectedSchedule() {
  return TASK_STATE.schedules.find((item) => item.id === TASK_STATE.selectedScheduleId) || null;
}

function planKindLabel(kind) {
  if (kind === "rule") return isZhLang() ? "参数" : "Parameter";
  return isZhLang() ? "时间" : "Time";
}

function planKindLongLabelV2(kind) {
  if (kind === "rule") return isZhLang() ? "按参数触发" : "Parameter trigger";
  return isZhLang() ? "按时间执行" : "Time schedule";
}

function planEditorTitle(kind, item) {
  if (item?.name) return planName(kind, item);
  if (kind === "rule") return isZhLang() ? "新建参数触发计划" : "New parameter plan";
  return isZhLang() ? "新建时间计划" : "New time plan";
}

function planEditorKickerV2(kind, item) {
  if (!item) return isZhLang() ? "新建计划" : "New plan";
  return planKindLongLabelV2(kind);
}

function planHeadBadgesV2(kind, item) {
  if (!item) return "";
  return `
    ${badge(planKindLabel(kind), "neutral")}
    ${badge(isZhLang() ? "已保存" : "Saved", "ok")}
  `;
}

function simulationLabel() {
  return isZhLang() ? "\u4ec5\u8bb0\u5f55" : "Record only";
}

function manualTestModeLabel() {
  return isZhLang() ? "\u624b\u52a8\u6d4b\u8bd5\u4e0d\u63a7\u5236\u8bbe\u5907" : "Manual test does not control hardware";
}

function automationToggleLabel() {
  return isZhLang() ? "\u8ba9\u8ba1\u5212\u6309\u8bbe\u5b9a\u81ea\u52a8\u8fd0\u884c" : "Run plans automatically";
}

function outputUnlockLabel() {
  return isZhLang() ? "\u5141\u8bb8\u81ea\u52a8\u63a7\u5236\u8bbe\u5907" : "Allow automatic hardware control";
}

function automationEnabledLabel(automation) {
  return automation?.automation_enabled ? (isZhLang() ? "\u5f00\u542f" : "On") : (isZhLang() ? "\u5173\u95ed" : "Off");
}

function automationModeLabel(automation) {
  if (automation?.dry_run !== false) return simulationLabel();
  if (automation?.hardware_armed) return isZhLang() ? "\u5df2\u5141\u8bb8" : "Allowed";
  return isZhLang() ? "\u672a\u6388\u6743" : "Not armed";
}

function planRunStateLabel(automation) {
  return automation?.automation_enabled ? (isZhLang() ? "\u5f00\u542f" : "On") : (isZhLang() ? "\u5173\u95ed" : "Off");
}

function statusJoin(parts) {
  return parts.filter(Boolean).join(isZhLang() ? "\uff1b" : " | ");
}

function ruleEvaluationStatusText(res) {
  const state = res.can_fire
    ? (isZhLang() ? "当前满足，可以执行" : "Ready to run")
    : (res.matched ? (isZhLang() ? "数值满足，但仍受保护限制" : "Value matched, limited") : (isZhLang() ? "当前不满足" : "Not matched"));
  const valueText = `${isZhLang() ? "当前值" : "Current"} ${res.current_value ?? "-"}`;
  const freshnessText = res.freshness_sec == null
    ? (isZhLang() ? "没有最近数据" : "No recent data")
    : `${isZhLang() ? "数据距今" : "Data age"} ${Math.round(res.freshness_sec)}s`;
  const limitFlags = [];
  if (res.cooldown_ready === false) limitFlags.push(isZhLang() ? "还没到再次执行间隔" : "waiting for run gap");
  if (res.hourly_ready === false) limitFlags.push(isZhLang() ? "已到本小时次数上限" : "hourly limit reached");
  const limitText = limitFlags.length
    ? `${isZhLang() ? "限制：" : "Limits: "}${limitFlags.join(isZhLang() ? "，" : ", ")}`
    : `${isZhLang() ? "保护限制正常" : "Limits OK"}`;
  return statusJoin([state, valueText, freshnessText, limitText]);
}

function planTypeSwitchLabel(kind) {
  return kind === "rule"
    ? (isZhLang() ? "参数" : "Parameter")
    : (isZhLang() ? "时间" : "Time");
}

function actionConfigJumpLabel() {
  return isZhLang() ? "查看动作配置" : "Action config";
}

function helpPopover(text) {
  return `
    <details class="task-help-pop">
      <summary title="${escapeHtml(text)}">?</summary>
      <div class="task-help-body">${escapeHtml(text)}</div>
    </details>
  `;
}

function sectionTitle(label, helpText) {
  return `
    <div class="task-section-head">
      <strong>${escapeHtml(label)}</strong>
      ${helpText ? helpPopover(helpText) : ""}
    </div>
  `;
}

function setPlanSelection(kind, id = "") {
  TASK_STATE.selectedPlanKind = kind;
  TASK_STATE.draftPlanKind = id ? "" : kind;
  if (id) {
    TASK_STATE.status.rules = "";
    TASK_STATE.status.schedules = "";
    TASK_STATE.statusTone.rules = "";
    TASK_STATE.statusTone.schedules = "";
  }
  if (kind === "rule") {
    TASK_STATE.selectedRuleId = id;
    saveTaskUiState();
    return;
  }
  TASK_STATE.selectedScheduleId = id;
  saveTaskUiState();
}

function currentPlanSelection() {
  if (TASK_STATE.draftPlanKind) {
    return { kind: TASK_STATE.draftPlanKind, item: null };
  }
  if (TASK_STATE.selectedPlanKind === "rule") {
    return { kind: "rule", item: selectedRule() };
  }
  return { kind: "schedule", item: selectedSchedule() };
}

function ensurePlanSelection() {
  if (TASK_STATE.draftPlanKind) return;
  const rule = selectedRule();
  const schedule = selectedSchedule();
  if (TASK_STATE.selectedPlanKind === "rule" && rule) {
    saveTaskUiState();
    return;
  }
  if (TASK_STATE.selectedPlanKind === "schedule" && schedule) {
    saveTaskUiState();
    return;
  }
  if (TASK_STATE.selectedPlanKind === "schedule" && TASK_STATE.schedules[0]) {
    TASK_STATE.selectedScheduleId = TASK_STATE.schedules[0].id;
    saveTaskUiState();
    return;
  }
  if (TASK_STATE.selectedPlanKind === "rule" && TASK_STATE.rules[0]) {
    TASK_STATE.selectedRuleId = TASK_STATE.rules[0].id;
    saveTaskUiState();
    return;
  }
  if (TASK_STATE.schedules[0]) {
    TASK_STATE.selectedPlanKind = "schedule";
    TASK_STATE.selectedScheduleId = TASK_STATE.schedules[0].id;
    saveTaskUiState();
    return;
  }
  if (TASK_STATE.rules[0]) {
    TASK_STATE.selectedPlanKind = "rule";
    TASK_STATE.selectedRuleId = TASK_STATE.rules[0].id;
    saveTaskUiState();
  }
}

function cancelPlanDraft(kind) {
  TASK_STATE.draftPlanKind = "";
  const restoreKind = TASK_STATE.draftReturnPlanKind;
  const restoreId = TASK_STATE.draftReturnPlanId;
  TASK_STATE.draftReturnPlanKind = "";
  TASK_STATE.draftReturnPlanId = "";

  if (restoreKind === "rule" && restoreId && TASK_STATE.rules.some((item) => item.id === restoreId)) {
    TASK_STATE.selectedPlanKind = "rule";
    TASK_STATE.selectedRuleId = restoreId;
    TASK_STATE.status.rules = "";
    TASK_STATE.status.schedules = "";
    TASK_STATE.statusTone.rules = "";
    TASK_STATE.statusTone.schedules = "";
    saveTaskUiState();
    return;
  }
  if (restoreKind === "schedule" && restoreId && TASK_STATE.schedules.some((item) => item.id === restoreId)) {
    TASK_STATE.selectedPlanKind = "schedule";
    TASK_STATE.selectedScheduleId = restoreId;
    TASK_STATE.status.rules = "";
    TASK_STATE.status.schedules = "";
    TASK_STATE.statusTone.rules = "";
    TASK_STATE.statusTone.schedules = "";
    saveTaskUiState();
    return;
  }

  if (kind === "rule") {
    TASK_STATE.status.rules = "";
    TASK_STATE.statusTone.rules = "";
    TASK_STATE.selectedRuleId = TASK_STATE.rules[0]?.id || "";
    if (!TASK_STATE.selectedRuleId && TASK_STATE.schedules[0]) {
      TASK_STATE.selectedPlanKind = "schedule";
      TASK_STATE.selectedScheduleId = TASK_STATE.schedules[0].id;
    }
    saveTaskUiState();
    return;
  }
  TASK_STATE.status.schedules = "";
  TASK_STATE.statusTone.schedules = "";
  TASK_STATE.selectedScheduleId = TASK_STATE.schedules[0]?.id || "";
  if (!TASK_STATE.selectedScheduleId && TASK_STATE.rules[0]) {
    TASK_STATE.selectedPlanKind = "rule";
    TASK_STATE.selectedRuleId = TASK_STATE.rules[0].id;
  }
  saveTaskUiState();
}

function planListItems() {
  return [
    ...TASK_STATE.schedules.map((item) => ({
      kind: "schedule",
      id: item.id,
      name: planName("schedule", item),
      summary: compactScheduleSummary(item),
      badges: `${badge(planKindLabel("schedule"), "neutral")}${scheduleStatusBadges(item)}`,
      active: TASK_STATE.selectedPlanKind === "schedule" && item.id === TASK_STATE.selectedScheduleId
    })),
    ...TASK_STATE.rules.map((item) => ({
      kind: "rule",
      id: item.id,
      name: planName("rule", item),
      summary: compactRuleSummary(item),
      badges: `${badge(planKindLabel("rule"), "neutral")}${ruleStatusBadges(item)}`,
      active: TASK_STATE.selectedPlanKind === "rule" && item.id === TASK_STATE.selectedRuleId
    }))
  ];
}

function findActionUnit(id) {
  return TASK_STATE.actionUnits.find((item) => item.id === id) || null;
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (!value) return isZhLang() ? "0 秒" : "0 s";
  if (value >= 3600) return `${(value / 3600).toFixed(value % 3600 === 0 ? 0 : 1)} ${isZhLang() ? "小时" : "h"}`;
  if (value >= 60) return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)} ${isZhLang() ? "分钟" : "min"}`;
  return `${value} ${isZhLang() ? "秒" : "s"}`;
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (!ms) return isZhLang() ? "0 毫秒" : "0 ms";
  if (ms >= 60000) return `${(ms / 60000).toFixed(ms % 60000 === 0 ? 0 : 1)} ${isZhLang() ? "分钟" : "min"}`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} ${isZhLang() ? "秒" : "s"}`;
  return `${ms} ${isZhLang() ? "毫秒" : "ms"}`;
}

function scheduleIntervalParts(seconds) {
  const total = Math.max(60, Number(seconds || 3600));
  if (total % 3600 === 0) return { value: String(total / 3600), unit: "hour" };
  if (total % 60 === 0) return { value: String(total / 60), unit: "minute" };
  return { value: String(total), unit: "second" };
}

function scheduleIntervalSeconds(value, unit) {
  const amount = Math.max(1, Number(value || 0));
  if (unit === "hour") return amount * 3600;
  if (unit === "minute") return amount * 60;
  return amount;
}

function ruleWindowParts(seconds) {
  const total = Math.max(1, Number(seconds || 60));
  if (total % 3600 === 0) return { value: String(total / 3600), unit: "hour" };
  if (total % 60 === 0) return { value: String(total / 60), unit: "minute" };
  return { value: String(total), unit: "second" };
}

function ruleWindowSeconds(value, unit) {
  const amount = Math.max(1, Number(value || 0));
  if (unit === "hour") return amount * 3600;
  if (unit === "minute") return amount * 60;
  return amount;
}

function ruleAggregationNeedsWindow(aggregation) {
  return String(aggregation || "last") !== "last";
}

function ruleAggregationOptionLabel(aggregation) {
  const map = {
    last: isZhLang() ? "只看最新一次读数" : "Latest reading only",
    avg: isZhLang() ? "看最近一段时间的平均值" : "Average over a recent period",
    min: isZhLang() ? "看最近一段时间的最低值" : "Lowest value in a recent period",
    max: isZhLang() ? "看最近一段时间的最高值" : "Highest value in a recent period"
  };
  return map[aggregation] || aggregation;
}

function ruleValueModeSummary(rule) {
  const aggregation = String(rule?.aggregation || "last");
  if (!ruleAggregationNeedsWindow(aggregation)) {
    return ruleAggregationOptionLabel(aggregation);
  }
  const durationText = formatDuration(rule?.window_sec || 60);
  if (isZhLang()) return `${ruleAggregationOptionLabel(aggregation)}（最近 ${durationText}）`;
  return `${ruleAggregationOptionLabel(aggregation)} (${durationText})`;
}

function compactRuleValueModeLabel(rule) {
  const aggregation = String(rule?.aggregation || "last");
  if (aggregation === "last") return isZhLang() ? "当前值" : "Latest";
  const durationText = formatDuration(rule?.window_sec || 60);
  const map = {
    avg: isZhLang() ? `${durationText}平均值` : `${durationText} average`,
    min: isZhLang() ? `${durationText}最低值` : `${durationText} minimum`,
    max: isZhLang() ? `${durationText}最高值` : `${durationText} maximum`
  };
  return map[aggregation] || aggregation;
}

function metricLabel(value) {
  const raw = String(value || "").trim();
  const known = {
    ph: "pH",
    ec: "EC",
    tds: "TDS",
    orp: "ORP"
  };
  return known[raw.toLowerCase()] || raw || "-";
}

function taskOptionLabel(task) {
  const name = taskNameById(task?.id || "");
  if (task?.task_type === "sequence") {
    return isZhLang() ? `${name}（${tr("tasks.common.multi_step")}）` : `${name} (${tr("tasks.common.multi_step")})`;
  }
  return name;
}

function listOptions(items, getValue, getLabel, selectedValue = "") {
  return items.map((item) => {
    const value = getValue(item);
    const label = getLabel(item);
    const selected = value === selectedValue ? " selected" : "";
    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function activeDaysDefault() {
  return [0, 1, 2, 3, 4, 5, 6];
}

function activeDayLabels() {
  return isZhLang()
    ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}

function normalizeActiveDays(raw) {
  if (!Array.isArray(raw) || !raw.length) return activeDaysDefault();
  return raw.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6);
}

function renderActiveDayChecks(prefix, activeDays) {
  const selected = new Set(normalizeActiveDays(activeDays));
  return activeDayLabels().map((label, index) => `
    <label class="task-day-check">
      <input id="${prefix}ActiveDay${index}" type="checkbox" value="${index}" ${selected.has(index) ? "checked" : ""} />
      ${label}
    </label>
  `).join("");
}

function readActiveDays(prefix) {
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const el = $(`${prefix}ActiveDay${index}`);
    if (el?.checked) days.push(index);
  }
  return days.length ? days : activeDaysDefault();
}

function activeWindowSummary(item) {
  const days = normalizeActiveDays(item?.active_days);
  const allDays = days.length === 7;
  const labels = activeDayLabels();
  const dayText = allDays
    ? (isZhLang() ? "每天" : "every day")
    : days.map((day) => labels[day]).join(isZhLang() ? "、" : ", ");
  const start = item?.active_start_time || "";
  const end = item?.active_end_time || "";
  if (!start && !end) return isZhLang() ? `${dayText} 全天` : `${dayText}, all day`;
  return isZhLang()
    ? `${dayText} ${start || "00:00"}-${end || "23:59"}`
    : `${dayText}, ${start || "00:00"}-${end || "23:59"}`;
}

function hasCustomActiveWindow(item) {
  const days = normalizeActiveDays(item?.active_days);
  const allDays = days.length === 7;
  const start = String(item?.active_start_time || "").trim();
  const end = String(item?.active_end_time || "").trim();
  return !allDays || !!start || !!end;
}

function compactActiveWindowSuffix(item) {
  if (!hasCustomActiveWindow(item)) return "";
  return isZhLang()
    ? ` · ${activeWindowSummary(item)}`
    : ` · ${activeWindowSummary(item)}`;
}

function scheduleDateLimitSummary(schedule) {
  if (!schedule) return "";
  const startAt = String(schedule.start_at || "").trim();
  const endAt = String(schedule.end_at || "").trim();
  if (!startAt && !endAt) return "";
  const parts = [];
  if (startAt) parts.push(isZhLang() ? `从 ${startAt.replace("T", " ")}` : `from ${startAt.replace("T", " ")}`);
  if (endAt) parts.push(isZhLang() ? `到 ${endAt.replace("T", " ")}` : `until ${endAt.replace("T", " ")}`);
  return parts.join(isZhLang() ? "，" : " ");
}

function planAvailabilitySummary(kind, item) {
  const base = activeWindowSummary(item);
  if (kind !== "schedule") return base;
  const dateLimit = scheduleDateLimitSummary(item);
  return dateLimit ? `${base}${isZhLang() ? "；" : " · "}${dateLimit}` : base;
}

function friendlyActiveWindowSummary(item) {
  const base = activeWindowSummary(item);
  if (!base) return "-";
  return isZhLang() ? `生效时间：${base}` : `Active time: ${base}`;
}

function taskSummary(task) {
  if (task?.runtime?.last_status) {
    const stamp = task.runtime.last_ts || "-";
    const source = task.runtime.last_source || "-";
    return `${task.summary || "-"} | ${statusLabel(task.runtime.last_status)} @ ${stamp} | ${source}`;
  }
  return task?.summary || "-";
}

function taskStatusBadges(task) {
  const badges = [
    badge(enabledLabel(task.enabled), task.enabled === false ? "muted" : "ok")
  ];
  if (task.runtime?.last_status) {
    const toneMap = { success: "ok", failed: "danger", blocked: "warn" };
    badges.push(badge(statusLabel(task.runtime.last_status), toneMap[task.runtime.last_status] || "neutral"));
  } else {
    badges.push(badge(tr("tasks.state.never_run"), "neutral"));
  }
  if (task.runtime?.last_source) {
    badges.push(badge(task.runtime.last_source, "neutral"));
  }
  return badges.join("");
}

function ruleSummary(rule) {
  if (!rule) return "-";
  const metric = metricLabel(rule.metric_key || rule.signal_parameter || "-");
  const operator = operatorLabel(rule.operator || ">");
  const threshold = rule.threshold ?? "-";
  const sustain = Number(rule.sustain_sec || 0);
  const taskName = taskNameById(rule.task_id);
  if (isZhLang()) {
    return `${ruleValueModeSummary(rule)}判断 ${metric} ${operator} ${threshold}${sustain ? `，连续满足 ${formatDuration(sustain)}` : ""}后执行 ${taskName}；${activeWindowSummary(rule)}`;
  }
  return `${ruleValueModeSummary(rule)}: ${metric} ${operator} ${threshold}${sustain ? ` for ${formatDuration(sustain)}` : ""}, run ${taskName}; ${activeWindowSummary(rule)}`;
}

function operatorLabel(operator) {
  const map = {
    ">": isZhLang() ? "高于" : "above",
    ">=": isZhLang() ? "不低于" : "at least",
    "<": isZhLang() ? "低于" : "below",
    "<=": isZhLang() ? "不高于" : "at most"
  };
  return map[operator] || operator;
}

function aggregationLabel(aggregation) {
  const map = {
    last: isZhLang() ? "当前最新值" : "latest reading",
    avg: isZhLang() ? "最近时段平均值" : "average over window",
    min: isZhLang() ? "最近时段最低值" : "minimum over window",
    max: isZhLang() ? "最近时段最高值" : "maximum over window"
  };
  return map[aggregation] || aggregation;
}

function ruleStatusBadges(rule) {
  const badges = [
    badge(enabledLabel(rule.enabled), rule.enabled === false ? "muted" : "ok")
  ];
  if (rule.runtime?.active_window && !rule.runtime.active_window.active_now) {
    badges.push(badge(tr("tasks.window.outside"), "warn"));
  } else if (!rule.runtime?.stats?.latest_ts) {
    badges.push(badge(tr("tasks.rule.no_data"), "neutral"));
  } else if (!rule.runtime?.fresh_ok) {
    badges.push(badge(tr("tasks.rule.stale"), "warn"));
  } else if (rule.runtime?.would_fire_now) {
    badges.push(badge(tr("tasks.rule.ready"), "ok"));
  } else if (rule.runtime?.matched_now) {
    badges.push(badge(tr("tasks.rule.matched"), "accent"));
  } else {
    badges.push(badge(tr("tasks.rule.watching"), "neutral"));
  }
  return badges.join("");
}

function scheduleSummary(schedule) {
  if (!schedule) return "-";
  const taskName = taskNameById(schedule.task_id);
  const windowText = activeWindowSummary(schedule);
  if (schedule.schedule_type === "once") {
    return isZhLang()
      ? `${schedule.start_at || "-"} 执行一次 ${taskName}；${windowText}`
      : `Run ${taskName} once at ${schedule.start_at || "-"}; ${windowText}`;
  }
  if (schedule.schedule_type === "daily") {
    return isZhLang()
      ? `每天 ${schedule.time_of_day || "-"} 执行 ${taskName}；${windowText}`
      : `Run ${taskName} daily at ${schedule.time_of_day || "-"}; ${windowText}`;
  }
  return isZhLang()
    ? `每隔 ${formatDuration(schedule.interval_sec || 0)} 执行 ${taskName}；${windowText}`
    : `Run ${taskName} every ${formatDuration(schedule.interval_sec || 0)}; ${windowText}`;
}

function compactRuleSummary(rule) {
  if (!rule) return "-";
  const metric = metricLabel(rule.metric_key || rule.signal_parameter || "-");
  const operator = operatorLabel(rule.operator || ">");
  const threshold = rule.threshold ?? "-";
  const sustain = Number(rule.sustain_sec || 0);
  const taskName = taskNameById(rule.task_id);
  const valueMode = `${compactRuleValueModeLabel(rule)} `;
  if (isZhLang()) {
    return `${valueMode}${metric} ${operator} ${threshold}${sustain ? `，持续 ${formatDuration(sustain)}` : ""} -> ${taskName}${compactActiveWindowSuffix(rule)}`;
  }
  return `${valueMode}${metric} ${operator} ${threshold}${sustain ? ` for ${formatDuration(sustain)}` : ""} -> ${taskName}${compactActiveWindowSuffix(rule)}`;
}

function compactScheduleSummary(schedule) {
  if (!schedule) return "-";
  const taskName = taskNameById(schedule.task_id);
  const dateLimit = scheduleDateLimitSummary(schedule);
  if (schedule.schedule_type === "once") {
    return isZhLang()
      ? `${schedule.start_at || "-"} 执行一次 -> ${taskName}${compactActiveWindowSuffix(schedule)}`
      : `Run once at ${schedule.start_at || "-"} -> ${taskName}${compactActiveWindowSuffix(schedule)}`;
  }
  if (schedule.schedule_type === "daily") {
    return isZhLang()
      ? `每天 ${schedule.time_of_day || "-"} -> ${taskName}${dateLimit ? ` · ${dateLimit}` : ""}${compactActiveWindowSuffix(schedule)}`
      : `Every day ${schedule.time_of_day || "-"} -> ${taskName}${dateLimit ? ` · ${dateLimit}` : ""}${compactActiveWindowSuffix(schedule)}`;
  }
  return isZhLang()
    ? `每隔 ${formatDuration(schedule.interval_sec || 0)} -> ${taskName}${dateLimit ? ` · ${dateLimit}` : ""}${compactActiveWindowSuffix(schedule)}`
    : `Every ${formatDuration(schedule.interval_sec || 0)} -> ${taskName}${dateLimit ? ` · ${dateLimit}` : ""}${compactActiveWindowSuffix(schedule)}`;
}

function planListSummaryV2(item) {
  if (!item) return "-";
  return item.kind === "rule" ? compactRuleSummary(item) : compactScheduleSummary(item);
}

function taskExecutionSummary(taskId) {
  const task = TASK_STATE.tasks.find((item) => item.id === taskId);
  if (!task) return isZhLang() ? "未选择动作。" : "No action selected.";
  const steps = (task.steps || []).map((step) => {
    if (step.step_type === "wait") return isZhLang() ? `等待 ${formatDurationMs(step.duration_ms)}` : `wait ${formatDurationMs(step.duration_ms)}`;
    return actionUnitNameById(step.action_unit_id || "");
  }).join(" · ");
  const taskName = taskNameById(task.id);
  return isZhLang()
    ? `执行：${taskName}${steps ? ` · ${steps}` : ""}`
    : `Runs: ${taskName}${steps ? ` · ${steps}` : ""}`;
}

function summaryFallbackLabel() {
  return isZhLang() ? "未设置" : "Not set";
}

function planSummaryFact(label, value) {
  return `
    <span class="task-plan-summary-fact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || summaryFallbackLabel())}</strong>
    </span>
  `;
}

function scheduleTimingSummary(schedule) {
  if (schedule.schedule_type === "once") return schedule.start_at || summaryFallbackLabel();
  const dateLimit = scheduleDateLimitSummary(schedule);
  if (schedule.schedule_type === "daily") {
    const base = isZhLang() ? `每天 ${schedule.time_of_day || "-"}` : `Daily ${schedule.time_of_day || "-"}`;
    return dateLimit ? `${base} · ${dateLimit}` : base;
  }
  const base = isZhLang()
    ? `每隔 ${formatDuration(schedule.interval_sec || 0)}`
    : `Every ${formatDuration(schedule.interval_sec || 0)}`;
  return dateLimit ? `${base} · ${dateLimit}` : base;
}

function ruleTriggerSummary(rule) {
  const metric = metricLabel(rule.metric_key || rule.signal_parameter || "-");
  const mode = ruleValueModeSummary(rule);
  const base = `${mode} · ${metric} ${operatorLabel(rule.operator || ">")} ${rule.threshold ?? "-"}`;
  return Number(rule.sustain_sec || 0) > 0
    ? `${base} · ${isZhLang() ? `持续 ${formatDuration(rule.sustain_sec)}` : `hold ${formatDuration(rule.sustain_sec)}`}`
    : base;
}

function renderDraftSummaryHtml(facts) {
  return `<div class="task-plan-summary-strip">${facts.join("")}</div>`;
}

function editorKickerText() {
  return isZhLang() ? "正在编辑" : "Editing";
}

function editorSwitchHintText() {
  return isZhLang() ? "点左侧计划卡可以切换到其他计划" : "Use the plan cards on the left to switch plans";
}

function ruleActionNote() {
  return isZhLang()
    ? "保存只会更新配置，不会立刻执行。现在检查只看当前条件是否满足；手动执行动作会直接运行一次选定动作。"
    : "Save only updates the configuration. Check Now only evaluates the condition; Run Action manually runs the selected action once.";
}

function scheduleActionNote() {
  return isZhLang()
    ? "保存只会更新配置，不会立刻执行。需要临时试一次时，再手动执行一次。"
    : "Save only updates the configuration. Use Run once now when you want to trigger this plan immediately.";
}

function scheduleTypeGuide(type) {
  const currentType = type || "daily";
  if (isZhLang()) {
    if (currentType === "once") return "只执行一次。";
    if (currentType === "interval") return "从起始时间开始，按固定间隔反复执行。";
    return "从起始日期开始，每天在固定时间执行。";
  }
  if (currentType === "once") return "Runs one time only.";
  if (currentType === "interval") return "Repeats at a fixed interval from the chosen start time.";
  return "Runs at a fixed time each day, starting from the chosen date.";
}

function scheduleWindowExamples() {
  return isZhLang()
    ? "留空表示全天；结束早于开始表示跨夜。"
    : "Blank means all day; end earlier than start means overnight.";
}

function scheduleStatusBadges(schedule) {
  const badges = [
    badge(enabledLabel(schedule.enabled), schedule.enabled === false ? "muted" : "ok")
  ];
  if (schedule.runtime?.next_run_ts) {
    badges.push(badge(tr("tasks.schedule.scheduled"), "ok"));
  } else if (schedule.runtime?.blocked_reason) {
    badges.push(badge(blockedReasonLabel(schedule.runtime.blocked_reason), "warn"));
  } else {
    badges.push(badge(tr("tasks.schedule.idle"), "neutral"));
  }
  return badges.join("");
}

function friendlyRuleSummary(rule) {
  if (!rule) return "-";
  const metric = metricLabel(rule.metric_key || rule.signal_parameter || "-");
  const operator = operatorLabel(rule.operator || ">");
  const threshold = rule.threshold ?? "-";
  const sustain = Number(rule.sustain_sec || 0);
  const taskName = taskNameById(rule.task_id);
  if (isZhLang()) {
    return `${ruleValueModeSummary(rule)} · ${metric} ${operator} ${threshold}${sustain ? ` · 持续 ${formatDuration(sustain)}` : ""} · 执行 ${taskName} · ${activeWindowSummary(rule)}`;
  }
  return `${ruleValueModeSummary(rule)} · ${metric} ${operator} ${threshold}${sustain ? ` · hold ${formatDuration(sustain)}` : ""} · run ${taskName} · ${activeWindowSummary(rule)}`;
}

function friendlyScheduleSummary(schedule) {
  if (!schedule) return "-";
  const taskName = taskNameById(schedule.task_id);
  const windowText = activeWindowSummary(schedule);
  const dateLimit = scheduleDateLimitSummary(schedule);
  if (schedule.schedule_type === "once") {
    return isZhLang()
      ? `${schedule.start_at || "-"} · 执行 ${taskName} · ${windowText}`
      : `${schedule.start_at || "-"} · run ${taskName} · ${windowText}`;
  }
  if (schedule.schedule_type === "daily") {
    return isZhLang()
      ? `每天 ${schedule.time_of_day || "-"}${dateLimit ? ` · ${dateLimit}` : ""} · 执行 ${taskName} · ${windowText}`
      : `Every day ${schedule.time_of_day || "-"}${dateLimit ? ` · ${dateLimit}` : ""} · run ${taskName} · ${windowText}`;
  }
  return isZhLang()
    ? `每隔 ${formatDuration(schedule.interval_sec || 0)}${dateLimit ? ` · ${dateLimit}` : ""} · 执行 ${taskName} · ${windowText}`
    : `Every ${formatDuration(schedule.interval_sec || 0)}${dateLimit ? ` · ${dateLimit}` : ""} · run ${taskName} · ${windowText}`;
}

function taskDefault() {
  const firstUnit = TASK_STATE.actionUnits[0];
  return {
    id: "new_task",
    name: tr("tasks.default.task_name"),
    task_type: "single_action",
    cooldown_sec: 0,
    enabled: true,
    description: "",
    steps: firstUnit ? [{ step_type: "run_action_unit", action_unit_id: firstUnit.id }] : []
  };
}

function ruleDefault() {
  const task = TASK_STATE.tasks[0];
  const source = firstPlanSource();
  return {
    id: "new_rule",
    name: isZhLang() ? "新的参数触发计划" : "New parameter plan",
    enabled: false,
    metric_key: source?.metricLabel || "pH",
    signal_protocol: source?.protocol || "",
    signal_address: source?.address ?? 1,
    signal_parameter: source?.parameter || "",
    aggregation: "last",
    window_sec: 60,
    operator: ">",
    threshold: 6.8,
    sustain_sec: 30,
    task_id: task?.id || "",
    cooldown_sec: 600,
    max_runs_per_hour: 4,
    requires_fresh_data: true,
    active_days: activeDaysDefault(),
    active_start_time: "",
    active_end_time: "",
    description: ""
  };
}

function scheduleDefault() {
  const task = TASK_STATE.tasks[0];
  return {
    id: "new_schedule",
    name: isZhLang() ? "新的时间计划" : "New time plan",
    enabled: false,
    schedule_type: "daily",
    task_id: task?.id || "",
    time_of_day: "12:00",
    interval_sec: 3600,
    start_at: "",
    end_at: "",
    cooldown_sec: 600,
    skip_if_task_running: true,
    active_days: activeDaysDefault(),
    active_start_time: "",
    active_end_time: "",
    description: ""
  };
}

function ensureTaskDraftShape() {
  const taskType = $("taskFormType")?.value || "single_action";
  if (taskType === "single_action") {
    const firstAction = TASK_STATE.taskDraftSteps.find((step) => step.step_type === "run_action_unit");
    TASK_STATE.taskDraftSteps = firstAction
      ? [{ step_type: "run_action_unit", action_unit_id: firstAction.action_unit_id }]
      : (TASK_STATE.actionUnits[0] ? [{ step_type: "run_action_unit", action_unit_id: TASK_STATE.actionUnits[0].id }] : []);
  }
}

function fillTaskForm(task) {
  const data = task || taskDefault();
  $("taskFormId").value = data.id || "";
  $("taskFormName").value = data.name || "";
  $("taskFormType").value = data.task_type || "single_action";
  $("taskFormCooldown").value = data.cooldown_sec ?? 0;
  $("taskFormEnabled").checked = data.enabled !== false;
  if ($("taskFormDryRun")) $("taskFormDryRun").checked = true;
  $("taskFormDescription").value = data.description || "";
  TASK_STATE.taskDraftSteps = (data.steps || []).map((step) => ({ ...step }));
  ensureTaskDraftShape();
  renderTaskSteps();
  renderTaskSummaryDraft();
}

function readTaskForm() {
  ensureTaskDraftShape();
  return {
    id: $("taskFormId").value.trim(),
    name: $("taskFormName").value.trim(),
    task_type: $("taskFormType").value,
    cooldown_sec: Number($("taskFormCooldown").value || 0),
    enabled: $("taskFormEnabled").checked,
    description: $("taskFormDescription").value.trim(),
    steps: TASK_STATE.taskDraftSteps.map((step) => ({ ...step }))
  };
}

function renderTaskSteps() {
  const box = $("taskStepList");
  if (!box) return;
  ensureTaskDraftShape();
  const taskType = $("taskFormType").value;
  const actionOptions = listOptions(TASK_STATE.actionUnits, (item) => item.id, (item) => item.name);

  box.innerHTML = TASK_STATE.taskDraftSteps.map((step, index) => `
    <div class="ac-step-row" data-step-index="${index}">
      <div class="ac-step-index">${index + 1}</div>
      <select class="input ac-step-type">
        <option value="run_action_unit"${step.step_type === "run_action_unit" ? " selected" : ""}>${tr("tasks.task.step_action_unit")}</option>
        <option value="wait"${step.step_type === "wait" ? " selected" : ""}${taskType === "single_action" ? " disabled" : ""}>${tr("tasks.task.step_wait")}</option>
      </select>
      <div class="ac-step-fields">
        ${step.step_type === "wait"
          ? `<input class="input ac-step-wait" type="number" min="1" max="3600000" value="${escapeHtml(step.duration_ms ?? 1000)}" />`
          : `<select class="input ac-step-action">${actionOptions}</select>`}
      </div>
      <button class="btn btn-pill ac-step-remove" type="button"${taskType === "single_action" ? " disabled" : ""}>${tr("tasks.common.delete")}</button>
    </div>
  `).join("");

  box.querySelectorAll(".ac-step-row").forEach((row) => {
    const index = Number(row.getAttribute("data-step-index"));
    const typeSelect = row.querySelector(".ac-step-type");
    const actionSelect = row.querySelector(".ac-step-action");
    const waitInput = row.querySelector(".ac-step-wait");
    const removeBtn = row.querySelector(".ac-step-remove");

    if (typeSelect) {
      typeSelect.onchange = () => {
        TASK_STATE.taskDraftSteps[index] = typeSelect.value === "wait"
          ? { step_type: "wait", duration_ms: 1000 }
          : { step_type: "run_action_unit", action_unit_id: TASK_STATE.actionUnits[0]?.id || "" };
        renderTaskSteps();
        renderTaskSummaryDraft();
      };
    }

    if (actionSelect) {
      actionSelect.value = TASK_STATE.taskDraftSteps[index].action_unit_id || "";
      actionSelect.onchange = () => {
        TASK_STATE.taskDraftSteps[index].action_unit_id = actionSelect.value;
        renderTaskSummaryDraft();
      };
    }

    if (waitInput) {
      waitInput.oninput = () => {
        TASK_STATE.taskDraftSteps[index].duration_ms = Number(waitInput.value || 0);
        renderTaskSummaryDraft();
      };
    }

    if (removeBtn) {
      removeBtn.onclick = () => {
        TASK_STATE.taskDraftSteps.splice(index, 1);
        if (!TASK_STATE.taskDraftSteps.length && TASK_STATE.actionUnits[0]) {
          TASK_STATE.taskDraftSteps = [{ step_type: "run_action_unit", action_unit_id: TASK_STATE.actionUnits[0].id }];
        }
        renderTaskSteps();
        renderTaskSummaryDraft();
      };
    }
  });
}

function renderTaskSummaryDraft() {
  const box = $("taskFormSummary");
  if (!box) return;
  const draft = readTaskForm();
  const summary = (draft.steps || []).map((step) => {
    if (step.step_type === "wait") return `${tr("tasks.task.step_wait")} ${formatDurationMs(step.duration_ms)}`;
    return findActionUnit(step.action_unit_id)?.name || step.action_unit_id || "-";
  }).join(" -> ");
  box.textContent = summary || tr("tasks.task.summary_placeholder");
}

function fillRuleForm(rule) {
  const data = rule || ruleDefault();
  const preferredSource = findPlanSourceForRule(data) || firstPlanSource();
  const windowParts = ruleWindowParts(data.window_sec ?? 60);
  $("ruleFormId").value = data.id || "";
  $("ruleFormName").value = planName("rule", data);
  $("ruleFormMetricKey").value = data.metric_key || "";
  $("ruleFormSourceKey").innerHTML = renderRuleSourceOptions(preferredSource?.key || planSourceKey(data.signal_protocol, data.signal_address, data.signal_parameter));
  $("ruleFormAggregation").value = data.aggregation || "last";
  if ($("ruleFormWindowValue")) $("ruleFormWindowValue").value = windowParts.value;
  if ($("ruleFormWindowUnit")) $("ruleFormWindowUnit").value = windowParts.unit;
  if ($("ruleFormWindowSec")) $("ruleFormWindowSec").value = data.window_sec ?? 60;
  $("ruleFormOperator").value = data.operator || ">";
  $("ruleFormThreshold").value = data.threshold ?? "";
  $("ruleFormSustainSec").value = data.sustain_sec ?? 30;
  $("ruleFormTaskId").innerHTML = listOptions(TASK_STATE.tasks, (item) => item.id, (item) => taskOptionLabel(item), data.task_id || "");
  $("ruleFormTaskId").value = data.task_id || "";
  $("ruleFormCooldownSec").value = data.cooldown_sec ?? 600;
  $("ruleFormMaxRunsPerHour").value = data.max_runs_per_hour ?? 4;
  $("ruleFormEnabled").checked = data.enabled === true;
  $("ruleFormFreshData").checked = data.requires_fresh_data !== false;
  if ($("ruleFormDryRun")) $("ruleFormDryRun").checked = true;
  $("ruleFormActiveStart").value = data.active_start_time || "";
  $("ruleFormActiveEnd").value = data.active_end_time || "";
  $("ruleFormDescription").value = data.description || "";
  syncRuleSourceFields();
  syncRuleValueModeUi();
  renderRuleSummaryDraft();
}

function readRuleForm() {
  const source = syncRuleSourceFields();
  return {
    id: $("ruleFormId").value.trim(),
    name: $("ruleFormName").value.trim(),
    metric_key: $("ruleFormMetricKey").value.trim() || source?.metricLabel || $("ruleFormSignalParameter").value.trim(),
    signal_protocol: $("ruleFormSignalProtocol").value.trim(),
    signal_address: Number($("ruleFormSignalAddress").value || 0),
    signal_parameter: $("ruleFormSignalParameter").value.trim(),
    aggregation: $("ruleFormAggregation").value,
    window_sec: $("ruleFormWindowValue") && $("ruleFormWindowUnit")
      ? ruleWindowSeconds($("ruleFormWindowValue").value, $("ruleFormWindowUnit").value)
      : Number($("ruleFormWindowSec")?.value || 60),
    operator: $("ruleFormOperator").value,
    threshold: Number($("ruleFormThreshold").value),
    sustain_sec: Number($("ruleFormSustainSec").value || 0),
    task_id: $("ruleFormTaskId").value,
    cooldown_sec: Number($("ruleFormCooldownSec").value || 0),
    max_runs_per_hour: Number($("ruleFormMaxRunsPerHour").value || 0),
    enabled: $("ruleFormEnabled").checked,
    requires_fresh_data: $("ruleFormFreshData").checked,
    active_days: readActiveDays("rule"),
    active_start_time: $("ruleFormActiveStart").value,
    active_end_time: $("ruleFormActiveEnd").value,
    description: $("ruleFormDescription").value.trim()
  };
}

function syncRuleValueModeUi() {
  const aggregation = $("ruleFormAggregation")?.value || "last";
  const showWindow = ruleAggregationNeedsWindow(aggregation);
  const windowRow = $("ruleFormWindowRow");
  if (windowRow) windowRow.hidden = !showWindow;
  const hint = $("ruleFormValueModeHint");
  if (hint) {
    hint.textContent = showWindow
      ? (isZhLang() ? "按最近这段时间的读数来判断。" : "Uses readings from the recent period.")
      : (isZhLang() ? "只看最新一次读数。" : "Uses the latest reading only.");
  }
}

function renderRuleSummaryDraft() {
  const box = $("ruleFormSummary");
  if (!box) return;
  const draft = readRuleForm();
  box.innerHTML = renderDraftSummaryHtml([
    planSummaryFact(isZhLang() ? "触发" : "Trigger", ruleTriggerSummary(draft)),
    planSummaryFact(isZhLang() ? "动作" : "Action", taskNameById(draft.task_id)),
    planSummaryFact(isZhLang() ? "时段" : "Window", activeWindowSummary(draft))
  ]);
  const taskHint = $("ruleTaskExecutionHint");
  if (taskHint) taskHint.textContent = taskExecutionSummary($("ruleFormTaskId")?.value);
}

function fillScheduleForm(schedule) {
  const data = schedule || scheduleDefault();
  const interval = scheduleIntervalParts(data.interval_sec || 3600);
  $("scheduleFormId").value = data.id || "";
  $("scheduleFormName").value = planName("schedule", data);
  $("scheduleFormType").value = data.schedule_type || "daily";
  $("scheduleFormTaskId").innerHTML = listOptions(TASK_STATE.tasks, (item) => item.id, (item) => taskOptionLabel(item), data.task_id || "");
  $("scheduleFormTaskId").value = data.task_id || "";
  $("scheduleFormStartAt").value = data.schedule_type === "once" ? (data.start_at || "") : "";
  $("scheduleFormStartAtInterval").value = (data.schedule_type === "daily" || data.schedule_type === "interval") ? (data.start_at || "") : "";
  $("scheduleFormTimeOfDay").value = data.time_of_day || "12:00";
  $("scheduleFormIntervalValue").value = interval.value;
  $("scheduleFormIntervalUnit").value = interval.unit;
  $("scheduleFormEndAt").value = data.end_at || "";
  $("scheduleFormCooldownSec").value = data.cooldown_sec ?? 600;
  $("scheduleFormEnabled").checked = data.enabled === true;
  $("scheduleFormSkipIfRunning").checked = data.skip_if_task_running !== false;
  if ($("scheduleFormDryRun")) $("scheduleFormDryRun").checked = true;
  $("scheduleFormActiveStart").value = data.active_start_time || "";
  $("scheduleFormActiveEnd").value = data.active_end_time || "";
  $("scheduleFormDescription").value = data.description || "";
  syncScheduleVisibility();
  renderScheduleSummaryDraft();
}

function readScheduleForm() {
  const scheduleType = $("scheduleFormType").value;
  return {
    id: $("scheduleFormId").value.trim(),
    name: $("scheduleFormName").value.trim(),
    schedule_type: scheduleType,
    task_id: $("scheduleFormTaskId").value,
    start_at: scheduleType === "once"
      ? $("scheduleFormStartAt").value
      : ((scheduleType === "daily" || scheduleType === "interval") ? $("scheduleFormStartAtInterval").value : ""),
    time_of_day: $("scheduleFormTimeOfDay").value,
    interval_sec: scheduleIntervalSeconds($("scheduleFormIntervalValue").value, $("scheduleFormIntervalUnit").value),
    end_at: $("scheduleFormEndAt").value,
    cooldown_sec: Number($("scheduleFormCooldownSec").value || 0),
    enabled: $("scheduleFormEnabled").checked,
    skip_if_task_running: $("scheduleFormSkipIfRunning").checked,
    active_days: readActiveDays("schedule"),
    active_start_time: $("scheduleFormActiveStart").value,
    active_end_time: $("scheduleFormActiveEnd").value,
    description: $("scheduleFormDescription").value.trim()
  };
}

function syncScheduleVisibility() {
  const type = $("scheduleFormType")?.value || "daily";
  document.querySelectorAll("[data-task-schedule]").forEach((el) => {
    const allow = (el.getAttribute("data-task-schedule") || "").split(" ").includes(type);
    el.style.display = allow ? "" : "none";
  });
}

function renderScheduleSummaryDraft() {
  const box = $("scheduleFormSummary");
  if (!box) return;
  const draft = readScheduleForm();
  box.innerHTML = renderDraftSummaryHtml([
    planSummaryFact(isZhLang() ? "启动" : "Start", scheduleTimingSummary(draft)),
    planSummaryFact(isZhLang() ? "动作" : "Action", taskNameById(draft.task_id)),
    planSummaryFact(isZhLang() ? "时段" : "Window", planAvailabilitySummary("schedule", draft))
  ]);
  const guide = $("scheduleTypeGuide");
  if (guide) guide.textContent = scheduleTypeGuide($("scheduleFormType")?.value || "daily");
  const taskHint = $("scheduleTaskExecutionHint");
  if (taskHint) taskHint.textContent = taskExecutionSummary($("scheduleFormTaskId")?.value);
}

function renderSummary() {
  const box = $("taskSummaryGrid");
  if (!box) return;
  const summary = TASK_STATE.summary;
  if (!summary) {
    box.innerHTML = "";
    return;
  }

  const cards = [
    [isZhLang() ? "自动计划" : "Auto plans", automationEnabledLabel(summary.automation), summary.automation?.automation_enabled ? "ok" : "warn"],
    [isZhLang() ? "设备控制" : "Device control", automationModeLabel(summary.automation), summary.automation?.dry_run === false && summary.automation?.hardware_armed ? "ok" : "warn"],
    [isZhLang() ? "时间计划" : "Time plans", `${summary.schedules?.enabled || 0} / ${summary.schedules?.total || 0}`, "neutral"],
    [isZhLang() ? "参数触发计划" : "Parameter plans", `${summary.rules?.enabled || 0} / ${summary.rules?.total || 0}`, "neutral"],
    [isZhLang() ? "最近巡检" : "Last tick", summary.automation?.last_tick || "-", summary.automation?.running ? "ok" : "warn"]
  ];
  box.innerHTML = cards.map(([label, value, tone]) => `
    <div class="task-stat-card ${escapeHtml(tone || "")}">
      <div class="task-stat-label">${escapeHtml(label)}</div>
      <div class="task-stat-value">${escapeHtml(value)}</div>
    </div>
  `).join("");
}

function renderAutomationPanel() {
  const box = $("taskAutomationPanel");
  if (!box) return;
  const automation = TASK_STATE.summary?.automation || {};

  box.innerHTML = `
    <div class="task-automation-quick">
      <label class="task-switch-line">
        <input id="taskAutomationEnabled" type="checkbox" ${automation.automation_enabled ? "checked" : ""} />
        <span>${isZhLang() ? "让计划自动运行" : "Run plans automatically"}</span>
      </label>
      <label class="task-switch-line">
        <input id="taskAutomationArmed" type="checkbox" ${(automation.dry_run === false && automation.hardware_armed) ? "checked" : ""} />
        <span>${isZhLang() ? "允许自动控制设备" : "Allow hardware control"}</span>
      </label>
      <button class="btn btn-pill" type="button" id="btnTaskAutomationSave">${isZhLang() ? "保存开关" : "Save"}</button>
      <button class="btn btn-pill task-secondary-action" type="button" id="btnTaskAutomationPause">${isZhLang() ? "暂停自动" : "Pause auto"}</button>
      <span id="taskAutomationStatus" class="mini">${escapeHtml(automation.last_error || "")}</span>
    </div>
  `;

  $("btnTaskAutomationSave").onclick = async () => {
    const allowHardwareControl = $("taskAutomationArmed").checked;
    const payload = {
      automation_enabled: $("taskAutomationEnabled").checked,
      dry_run: !allowHardwareControl,
      hardware_armed: allowHardwareControl,
      tick_sec: TASK_STATE.summary?.automation?.tick_sec || 2,
      fresh_data_sec: TASK_STATE.summary?.automation?.fresh_data_sec || 180
    };
    if (payload.hardware_armed && !window.confirm(isZhLang() ? "允许自动计划真实控制继电器和 PWM？请确认现场设备安全。" : "Allow automatic plans to control relays and PWM?")) return;
    try {
      await saveAutomationConfig(payload);
      await refreshTasksPage();
    } catch (error) {
      $("taskAutomationStatus").textContent = error.message || String(error);
    }
  };

  $("btnTaskAutomationPause").onclick = async () => {
    try {
      await saveAutomationConfig({
        ...automation,
        automation_enabled: false
      });
      await refreshTasksPage();
    } catch (error) {
      $("taskAutomationStatus").textContent = error.message || String(error);
    }
  };
}

function renderPlanListCard() {
  const items = planListItems();
  return `
    <div class="card">
      <div class="row ac-toolbar">
        <h3 style="margin-right:auto;">${isZhLang() ? "计划列表" : "Plans"}</h3>
        <button class="btn btn-pill" type="button" id="btnPlanNew">${isZhLang() ? "新建计划" : "New plan"}</button>
      </div>
      <div id="planList" class="task-list">
        ${items.length ? items.map((item) => `
          <button type="button" class="task-item${item.active ? " active" : ""}" data-plan-kind="${item.kind}" data-plan-id="${escapeHtml(item.id)}">
            <span class="task-item-head">
              <span class="task-item-title">${escapeHtml(item.name)}</span>
              <span class="task-badge-row">${item.badges}</span>
            </span>
            <span class="task-item-sub">${escapeHtml(item.summary)}</span>
          </button>
        `).join("") : `<div class="empty-hint">${isZhLang() ? "还没有计划，先新建一条。" : "No plans yet."}</div>`}
      </div>
    </div>
  `;
}

function bindPlanListEvents(onRender) {
  document.querySelectorAll("[data-plan-kind][data-plan-id]").forEach((btn) => {
    btn.onclick = () => {
      setPlanSelection(btn.getAttribute("data-plan-kind") || "schedule", btn.getAttribute("data-plan-id") || "");
      TASK_STATE.draftReturnPlanKind = "";
      TASK_STATE.draftReturnPlanId = "";
      onRender();
    };
  });
  $("btnPlanNew").onclick = () => {
    TASK_STATE.draftReturnPlanKind = TASK_STATE.selectedPlanKind;
    TASK_STATE.draftReturnPlanId = TASK_STATE.selectedPlanKind === "rule" ? TASK_STATE.selectedRuleId : TASK_STATE.selectedScheduleId;
    setPlanSelection("schedule", "");
    TASK_STATE.status.schedules = tr("tasks.feedback.creating_schedule");
    onRender();
  };
}

function renderDraftTypeSwitch(kind) {
  return `
    <div class="task-draft-switch">
      <span>${isZhLang() ? "计划类型" : "Plan type"}</span>
      <div class="task-draft-switch-buttons">
        <button class="btn btn-pill${kind === "schedule" ? " active" : ""}" type="button" data-draft-kind="schedule">${planTypeSwitchLabel("schedule")}</button>
        <button class="btn btn-pill${kind === "rule" ? " active" : ""}" type="button" data-draft-kind="rule">${planTypeSwitchLabel("rule")}</button>
      </div>
    </div>
  `;
}

function bindDraftTypeSwitch(onRender) {
  document.querySelectorAll("[data-draft-kind]").forEach((btn) => {
    btn.onclick = () => {
      const nextKind = btn.getAttribute("data-draft-kind") || "schedule";
      if (!TASK_STATE.draftReturnPlanKind) {
        TASK_STATE.draftReturnPlanKind = TASK_STATE.selectedPlanKind;
        TASK_STATE.draftReturnPlanId = TASK_STATE.selectedPlanKind === "rule" ? TASK_STATE.selectedRuleId : TASK_STATE.selectedScheduleId;
      }
      setPlanSelection(nextKind, "");
      if (nextKind === "rule") {
        TASK_STATE.status.rules = tr("tasks.feedback.creating_rule");
      } else {
        TASK_STATE.status.schedules = tr("tasks.feedback.creating_schedule");
      }
      onRender();
    };
  });
}

function renderTaskTabs() {
  const box = $("taskTabBar");
  if (!box) return;
  const tabs = [
    ["plans", isZhLang() ? "任务计划" : "Plans"],
    ["logs", isZhLang() ? "运行记录" : "Logs"],
    ["diagnostics", isZhLang() ? "服务状态" : "Service"]
  ];
  box.innerHTML = tabs.map(([id, label]) => `
    <button type="button" class="ac-tab-btn${TASK_STATE.activeTab === id ? " active" : ""}" data-task-tab="${id}">${label}</button>
  `).join("");

  box.querySelectorAll("[data-task-tab]").forEach((btn) => {
    btn.onclick = async () => {
      TASK_STATE.activeTab = btn.getAttribute("data-task-tab") || "plans";
      saveTaskUiState();
      renderTaskTabs();
      await renderWorkspace();
    };
  });
}

function renderTaskWorkspace() {
  const task = selectedTask();
  const workspace = $("taskWorkspace");
  if (!workspace) return;

  workspace.innerHTML = `
    <div class="grid2 task-grid">
      <div class="card">
        <div class="row ac-toolbar">
          <h3 style="margin-right:auto;">${tr("tasks.tabs.tasks")}</h3>
          <button class="btn btn-pill" type="button" id="btnTaskListRefresh">${tr("tasks.common.refresh")}</button>
          <button class="btn btn-pill" type="button" id="btnTaskListNew">${tr("tasks.common.new")}</button>
        </div>
        <div id="taskList" class="task-list">
          ${TASK_STATE.tasks.length ? TASK_STATE.tasks.map((item) => `
            <button type="button" class="task-item${item.id === TASK_STATE.selectedTaskId ? " active" : ""}" data-task-pick="${escapeHtml(item.id)}">
              <span class="task-item-head">
                <span class="task-item-title">${escapeHtml(item.name || item.id)}</span>
                <span class="task-badge-row">${taskStatusBadges(item)}</span>
              </span>
              <span class="task-item-sub">${escapeHtml(taskSummary(item))}</span>
            </button>
          `).join("") : `<div class="empty-hint">${tr("tasks.empty.tasks")}</div>`}
        </div>
      </div>

      <div class="card">
        <h3>${tr("tasks.edit.task_title")}</h3>
        ${task ? `
          <div class="task-detail-head">
            <div>
              <div class="task-detail-title">${escapeHtml(task.name || task.id)}</div>
              <div class="mini">${escapeHtml(task.id)}</div>
            </div>
            <div class="pill ${task.enabled === false ? "gray" : ""}">${enabledLabel(task.enabled)}</div>
          </div>
        ` : ""}
        <div class="ac-form">
          <label>${tr("tasks.field.id")}<input id="taskFormId" class="input" /></label>
          <label>${tr("tasks.field.name")}<input id="taskFormName" class="input" /></label>
          <label>${tr("tasks.field.task_type")}
            <select id="taskFormType" class="input">
              <option value="single_action">${tr("tasks.task_type.single_action")}</option>
              <option value="sequence">${tr("tasks.task_type.sequence")}</option>
            </select>
          </label>
          <label>${tr("tasks.field.cooldown_sec")}<input id="taskFormCooldown" class="input" type="number" min="0" max="86400" /></label>
          <label class="ac-check"><input id="taskFormEnabled" type="checkbox" /> ${tr("tasks.state.enabled")}</label>
                    <label class="ac-wide">${tr("tasks.field.description")}<textarea id="taskFormDescription" class="input ac-textarea"></textarea></label>
        </div>
        <div class="ac-inline-panel">
          <div class="row ac-toolbar">
            <strong style="margin-right:auto;">${tr("tasks.field.steps")}</strong>
            <button class="btn btn-pill" type="button" id="btnTaskAddAction">${tr("tasks.task.add_action")}</button>
            <button class="btn btn-pill" type="button" id="btnTaskAddWait">${tr("tasks.task.add_wait")}</button>
          </div>
          <div id="taskStepList" class="ac-step-list"></div>
        </div>
        <div class="ac-info-strip" id="taskFormSummary"></div>
        <label class="ac-check task-test-check"><input id="taskFormDryRun" type="checkbox" checked /> ${manualTestModeLabel()}</label>
        <div class="row ac-toolbar">
          <button class="btn btn-pill" type="button" id="btnTaskSave">${tr("tasks.task.save")}</button>
          <button class="btn btn-pill" type="button" id="btnTaskRun">${tr("tasks.task.run")}</button>
          <button class="btn btn-pill" type="button" id="btnTaskDelete">${tr("tasks.common.delete")}</button>
        </div>
        <div class="task-status-line"><span id="taskStatusMessage" class="mini">${escapeHtml(TASK_STATE.status.tasks)}</span></div>
      </div>
    </div>
  `;

  workspace.querySelectorAll("[data-task-pick]").forEach((btn) => {
    btn.onclick = () => {
      TASK_STATE.selectedTaskId = btn.getAttribute("data-task-pick") || "";
      renderTaskWorkspace();
    };
  });

  fillTaskForm(task);

  $("taskFormType").onchange = () => {
    ensureTaskDraftShape();
    renderTaskSteps();
    renderTaskSummaryDraft();
  };

  ["taskFormName", "taskFormCooldown", "taskFormDescription"].forEach((id) => {
    const el = $(id);
    if (el) el.oninput = renderTaskSummaryDraft;
  });

  $("btnTaskAddAction").onclick = () => {
    if ($("taskFormType").value === "single_action") {
      TASK_STATE.taskDraftSteps = [{ step_type: "run_action_unit", action_unit_id: TASK_STATE.actionUnits[0]?.id || "" }];
    } else {
      TASK_STATE.taskDraftSteps.push({ step_type: "run_action_unit", action_unit_id: TASK_STATE.actionUnits[0]?.id || "" });
    }
    renderTaskSteps();
    renderTaskSummaryDraft();
  };

  $("btnTaskAddWait").onclick = () => {
    if ($("taskFormType").value === "single_action") return;
    TASK_STATE.taskDraftSteps.push({ step_type: "wait", duration_ms: 1000 });
    renderTaskSteps();
    renderTaskSummaryDraft();
  };

  $("btnTaskListRefresh").onclick = async () => {
    TASK_STATE.status.tasks = tr("tasks.feedback.tasks_refreshed");
    await refreshTasksPage();
  };

  $("btnTaskListNew").onclick = () => {
    TASK_STATE.selectedTaskId = "";
    TASK_STATE.status.tasks = tr("tasks.feedback.creating_task");
    renderTaskWorkspace();
  };

  $("btnTaskSave").onclick = async () => {
    try {
      const res = await saveActionTask(readTaskForm());
      TASK_STATE.selectedTaskId = res.item.id;
      TASK_STATE.status.tasks = tr("tasks.feedback.task_saved");
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.tasks = error.message || String(error);
      renderTaskWorkspace();
    }
  };

  $("btnTaskDelete").onclick = async () => {
    const id = $("taskFormId").value.trim();
    if (!id || !window.confirm(`${tr("tasks.confirm.delete_task")} ${id} ?`)) return;
    try {
      await deleteActionTask(id);
      TASK_STATE.selectedTaskId = "";
      TASK_STATE.status.tasks = tr("tasks.feedback.task_deleted");
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.tasks = error.message || String(error);
      renderTaskWorkspace();
    }
  };

  $("btnTaskRun").onclick = async () => {
    const id = $("taskFormId").value.trim();
    if (!id) return;
    const dryRun = $("taskFormDryRun").checked;
    if (!dryRun && !window.confirm(tr("tasks.confirm.real_run_task"))) return;
    try {
      TASK_STATE.status.tasks = dryRun ? tr("tasks.feedback.task_running_dry") : tr("tasks.feedback.task_running_live");
      renderTaskWorkspace();
      const res = await executeActionTask(id, { dryRun, source: "manual" });
      TASK_STATE.status.tasks = `${res.message}, ${tr("tasks.logs.log_id")} #${res.log_id}`;
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.tasks = error.message || String(error);
      renderTaskWorkspace();
    }
  };
}

function renderRuleWorkspace() {
  const rule = selectedRule();
  const workspace = $("taskWorkspace");
  if (!workspace) return;

  workspace.innerHTML = `
    <div class="grid2 task-grid">
      ${renderPlanListCard()}

      <div class="card">
        <div class="task-detail-head">
          <div>
            <div class="task-editor-kicker">${isZhLang() ? "参数触发计划" : "Parameter plan"}</div>
            <div class="task-detail-title">${escapeHtml(planEditorTitle("rule", rule))}</div>
          </div>
          <div class="task-badge-row">
            ${badge(planKindLabel("rule"), "neutral")}
            ${rule ? ruleStatusBadges(rule) : ""}
          </div>
        </div>

        <div class="task-form-stack">
          ${rule ? "" : renderDraftTypeSwitch("rule")}
          <input id="ruleFormMetricKey" class="input" type="hidden" />
          <input id="ruleFormSignalProtocol" class="input" type="hidden" />
          <input id="ruleFormSignalAddress" class="input" type="hidden" />
          <input id="ruleFormSignalParameter" class="input" type="hidden" />
          <label>${tr("tasks.field.name")}<input id="ruleFormName" class="input" /></label>

          <section class="task-form-section">
            ${sectionTitle(tr("tasks.rule.section_trigger"), isZhLang() ? "\u8bbe\u7f6e\u4ec0\u4e48\u6307\u6807\u3001\u6309\u4ec0\u4e48\u6761\u4ef6\u6210\u7acb\uff0c\u4ee5\u53ca\u8981\u6301\u7eed\u591a\u4e45\u624d\u89e6\u53d1\u3002" : "Choose what to monitor, how it compares, and how long it must stay true.")}
            <div class="task-section-grid">
              <label class="ac-wide">${isZhLang() ? "监测点" : "Monitored point"}<select id="ruleFormSourceKey" class="input"></select></label>
              <label>${tr("tasks.rule.operator")}
                <select id="ruleFormOperator" class="input">
                  <option value=">">${tr("tasks.rule.op_gt")}</option>
                  <option value=">=">${tr("tasks.rule.op_gte")}</option>
                  <option value="<">${tr("tasks.rule.op_lt")}</option>
                  <option value="<=">${tr("tasks.rule.op_lte")}</option>
                </select>
              </label>
              <label>${tr("tasks.rule.threshold")}<input id="ruleFormThreshold" class="input" type="number" step="0.01" /></label>
              <label>${tr("tasks.rule.sustain_sec")}<input id="ruleFormSustainSec" class="input" type="number" min="0" max="86400" /></label>
            </div>
            <div class="mini" id="ruleFormSourceHint"></div>
          </section>

          <section class="task-form-section">
            ${sectionTitle(tr("tasks.rule.section_data"), isZhLang() ? "\u51b3\u5b9a\u7528\u54ea\u4e00\u4efd\u91c7\u96c6\u503c\u6765\u5224\u65ad\uff0c\u53ef\u76f4\u63a5\u7528\u6700\u65b0\u503c\uff0c\u4e5f\u53ef\u770b\u6700\u8fd1\u4e00\u6bb5\u65f6\u95f4\u7684\u7edf\u8ba1\u503c\u3002" : "Choose which reading to evaluate and whether to use the latest point or a recent aggregate.")}
            <div class="task-section-grid">
              <label>${tr("tasks.rule.aggregation")}
                <select id="ruleFormAggregation" class="input">
                  <option value="last">${tr("tasks.rule.agg_last")}</option>
                  <option value="avg">${tr("tasks.rule.agg_avg")}</option>
                  <option value="min">${tr("tasks.rule.agg_min")}</option>
                  <option value="max">${tr("tasks.rule.agg_max")}</option>
                </select>
              </label>
              <label>${tr("tasks.rule.window_sec")}<input id="ruleFormWindowSec" class="input" type="number" min="1" max="86400" /></label>
              <label class="ac-check task-section-check"><input id="ruleFormFreshData" type="checkbox" checked /> ${tr("tasks.rule.requires_fresh_data")}</label>
            </div>
          </section>

          <section class="task-form-section">
            ${sectionTitle(tr("tasks.rule.section_action"), isZhLang() ? "\u6761\u4ef6\u6210\u7acb\u540e\u6267\u884c\u54ea\u4e2a\u52a8\u4f5c\u5355\u5143\u6216\u4efb\u52a1\u3002" : "Choose what should run when the condition is met.")}
            <div class="task-section-grid">
              <label>${tr("tasks.rule.task_id")}<select id="ruleFormTaskId" class="input"></select></label>
                          </div>
            <div class="mini" id="ruleTaskExecutionHint">${escapeHtml(taskExecutionSummary(rule?.task_id))}</div>
          </section>

          <section class="task-form-section">
            ${sectionTitle(isZhLang() ? "\u9891\u7387\u9650\u5236" : tr("tasks.rule.section_limits"), isZhLang() ? "\u907f\u514d\u521a\u6267\u884c\u5b8c\u53c8\u88ab\u8fde\u7eed\u89e6\u53d1\u3002" : "Limit repeated runs after a recent execution.")}
            <div class="task-section-grid">
              <label>${tr("tasks.rule.cooldown_sec")}<input id="ruleFormCooldownSec" class="input" type="number" min="0" max="86400" /></label>
              <label>${tr("tasks.rule.max_runs_per_hour")}<input id="ruleFormMaxRunsPerHour" class="input" type="number" min="0" max="3600" /></label>
              <label class="ac-check task-section-check"><input id="ruleFormEnabled" type="checkbox" /> ${tr("tasks.state.enabled")}</label>
            </div>
          </section>

          <div class="task-window-panel">
            ${sectionTitle(tr("tasks.window.title"), isZhLang() ? "\u4e0d\u586b\u5c31\u662f\u5168\u5929\u6709\u6548\uff1b\u7ed3\u675f\u65f6\u95f4\u65e9\u4e8e\u5f00\u59cb\u65f6\u95f4\u8868\u793a\u8de8\u591c\u3002" : "Leave blank for all day. End earlier than start means overnight.")}
            <div class="task-day-row">${renderActiveDayChecks("rule", (rule || ruleDefault()).active_days)}</div>
            <div class="task-window-times">
              <label>${tr("tasks.window.start")}<input id="ruleFormActiveStart" class="input" type="time" /></label>
              <label>${tr("tasks.window.end")}<input id="ruleFormActiveEnd" class="input" type="time" /></label>
            </div>
          </div>

          <label>${tr("tasks.field.description")}<textarea id="ruleFormDescription" class="input ac-textarea"></textarea></label>

          <details class="task-advanced-fields">
            <summary>${tr("tasks.diagnostics.advanced_fields")}</summary>
            <div class="task-section-grid" style="margin-top:12px;">
              <label>${tr("tasks.field.id")}<input id="ruleFormId" class="input" /></label>
              <div class="mini ac-wide">${isZhLang() ? "监测点对应的系统绑定信息会自动保存，这里通常不用手动改。" : "The system binding for this monitored point is saved automatically and usually does not need manual changes."}</div>
            </div>
          </details>
        </div>

        <div class="ac-info-strip" id="ruleFormSummary"></div>
        <label class="ac-check task-test-check"><input id="ruleFormDryRun" type="checkbox" checked /> ${manualTestModeLabel()}</label>
        <div class="row ac-toolbar">
          <button class="btn btn-pill" type="button" id="btnRuleSave">${tr("tasks.rule.save")}</button>
          ${rule ? "" : `<button class="btn btn-pill" type="button" id="btnRuleCancel">${isZhLang() ? "\u53d6\u6d88\u65b0\u5efa" : "Cancel"}</button>`}
          <button class="btn btn-pill" type="button" id="btnRuleEvaluate" title="${escapeHtml(isZhLang() ? "\u53ea\u5224\u65ad\u5f53\u524d\u6761\u4ef6\u662f\u5426\u6210\u7acb\uff0c\u4e0d\u6267\u884c\u52a8\u4f5c\u3002" : "Evaluate the condition now without running anything.")}">${isZhLang() ? "\u68c0\u67e5" : "Check"}</button>
          <button class="btn btn-pill" type="button" id="btnRuleRun" title="${escapeHtml(isZhLang() ? "\u5982\u679c\u5f53\u524d\u6761\u4ef6\u6210\u7acb\uff0c\u5c31\u6309\u5f53\u524d\u8bbe\u7f6e\u8bd5\u8fd0\u884c\u4e00\u6b21\u3002" : "If the condition is currently met, try running it once now.")}">${isZhLang() ? "\u8bd5\u8dd1" : "Test run"}</button>
          <button class="btn btn-pill" type="button" id="btnRuleDelete">${tr("tasks.common.delete")}</button>
        </div>
        <div class="task-status-line"><span id="ruleStatusMessage" class="mini">${escapeHtml(TASK_STATE.status.rules)}</span></div>
      </div>
    </div>
  `;

  bindPlanListEvents(renderPlanWorkspace);
  bindDraftTypeSwitch(renderPlanWorkspace);
  fillRuleForm(rule);

  ["ruleFormName", "ruleFormSourceKey", "ruleFormAggregation", "ruleFormWindowSec", "ruleFormThreshold", "ruleFormSustainSec", "ruleFormCooldownSec", "ruleFormMaxRunsPerHour", "ruleFormOperator", "ruleFormTaskId", "ruleFormActiveStart", "ruleFormActiveEnd", "ruleFormDescription"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const eventName = el.tagName === "SELECT" ? "onchange" : "oninput";
    el[eventName] = () => {
      if (id === "ruleFormSourceKey") syncRuleSourceFields();
      renderRuleSummaryDraft();
    };
  });
  $("ruleFormEnabled").onchange = renderRuleSummaryDraft;
  $("ruleFormFreshData").onchange = renderRuleSummaryDraft;
  for (let index = 0; index < 7; index += 1) {
    const el = $(`ruleActiveDay${index}`);
    if (el) el.onchange = renderRuleSummaryDraft;
  }

  if ($("btnRuleCancel")) {
    $("btnRuleCancel").onclick = () => {
      cancelPlanDraft("rule");
      renderPlanWorkspace();
    };
  }

  $("btnRuleSave").onclick = async () => {
    try {
      const res = await saveActionRule(readRuleForm());
      TASK_STATE.draftReturnPlanKind = "";
      TASK_STATE.draftReturnPlanId = "";
      setPlanSelection("rule", res.item.id);
      TASK_STATE.status.rules = tr("tasks.feedback.rule_saved");
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.rules = error.message || String(error);
      renderPlanWorkspace();
    }
  };

  $("btnRuleDelete").onclick = async () => {
    const id = $("ruleFormId").value.trim();
    if (!id || !window.confirm(`${tr("tasks.confirm.delete_rule")} ${id} ?`)) return;
    try {
      await deleteActionRule(id);
      TASK_STATE.selectedRuleId = "";
      TASK_STATE.status.rules = tr("tasks.feedback.rule_deleted");
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.rules = error.message || String(error);
      renderPlanWorkspace();
    }
  };

  $("btnRuleEvaluate").onclick = async () => {
    const id = $("ruleFormId").value.trim();
    if (!id) return;
    try {
      const res = await evaluateActionRule(id, {
        dryRun: $("ruleFormDryRun").checked,
        executeIfMatch: false
      });
      TASK_STATE.status.rules = ruleEvaluationStatusText(res);
      renderPlanWorkspace();
    } catch (error) {
      TASK_STATE.status.rules = error.message || String(error);
      renderPlanWorkspace();
    }
  };

  $("btnRuleRun").onclick = async () => {
    const id = $("ruleFormId").value.trim();
    if (!id) return;
    const dryRun = $("ruleFormDryRun").checked;
    if (!dryRun && !window.confirm(tr("tasks.confirm.real_run_rule"))) return;
    try {
      const res = await evaluateActionRule(id, { dryRun, executeIfMatch: true });
      if (res.task_result) {
        TASK_STATE.status.rules = `${res.message} | ${tr("tasks.logs.log_id")} #${res.task_result.log_id ?? "-"}`;
      } else {
        TASK_STATE.status.rules = `${res.matched ? tr("tasks.rule.matched") : tr("tasks.rule.not_matched")} | ${res.message || tr("tasks.feedback.task_not_executed")}`;
      }
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.rules = error.message || String(error);
      renderPlanWorkspace();
    }
  };
}

function renderScheduleWorkspace() {
  const schedule = selectedSchedule();
  const workspace = $("taskWorkspace");
  if (!workspace) return;

  workspace.innerHTML = `
    <div class="grid2 task-grid">
      ${renderPlanListCard()}

      <div class="card">
        <div class="task-detail-head">
          <div>
            <div class="task-editor-kicker">${isZhLang() ? "\u65f6\u95f4\u8ba1\u5212" : "Time plan"}</div>
            <div class="task-detail-title">${escapeHtml(planEditorTitle("schedule", schedule))}</div>
          </div>
          <div class="task-badge-row">
            ${badge(planKindLabel("schedule"), "neutral")}
            ${schedule ? scheduleStatusBadges(schedule) : ""}
          </div>
        </div>

        <div class="task-form-stack">
          ${schedule ? "" : renderDraftTypeSwitch("schedule")}
          <label>${tr("tasks.field.name")}<input id="scheduleFormName" class="input" /></label>

          <section class="task-form-section">
            ${sectionTitle(tr("tasks.schedule.section_when"), isZhLang() ? "\u9009\u62e9\u4e00\u6b21\u6027\u3001\u6bcf\u5929\u56fa\u5b9a\u65f6\u95f4\uff0c\u6216\u6309\u56fa\u5b9a\u95f4\u9694\u6267\u884c\u3002" : "Choose a one-time run, a daily time, or a repeating interval.")}
            <div class="task-section-grid">
              <label>${tr("tasks.schedule.type")}
                <select id="scheduleFormType" class="input">
                  <option value="once">${tr("tasks.schedule.type_once")}</option>
                  <option value="daily">${tr("tasks.schedule.type_daily")}</option>
                  <option value="interval">${tr("tasks.schedule.type_interval")}</option>
                </select>
              </label>
              <label data-task-schedule="once">${tr("tasks.schedule.start_at")}<input id="scheduleFormStartAt" class="input" type="datetime-local" /></label>
              <label data-task-schedule="daily">${tr("tasks.schedule.time_of_day")}<input id="scheduleFormTimeOfDay" class="input" type="time" /></label>
              <label data-task-schedule="interval">${isZhLang() ? "每隔多久" : "Repeat every"}
                <span class="task-inline-pair">
                  <input id="scheduleFormIntervalValue" class="input" type="number" min="1" max="9999" />
                  <select id="scheduleFormIntervalUnit" class="input">
                    <option value="minute">${isZhLang() ? "分钟" : "minutes"}</option>
                    <option value="hour">${isZhLang() ? "小时" : "hours"}</option>
                    <option value="second">${isZhLang() ? "秒" : "seconds"}</option>
                  </select>
                </span>
              </label>
            </div>
          </section>

          <section class="task-form-section">
            ${sectionTitle(tr("tasks.schedule.section_action"), isZhLang() ? "\u5230\u70b9\u540e\u6267\u884c\u54ea\u4e2a\u52a8\u4f5c\u5355\u5143\u6216\u4efb\u52a1\u3002" : "Choose what should run when the schedule fires.")}
            <div class="task-section-grid">
              <label>${tr("tasks.schedule.task_id")}<select id="scheduleFormTaskId" class="input"></select></label>
                          </div>
            <div class="mini" id="scheduleTaskExecutionHint">${escapeHtml(taskExecutionSummary(schedule?.task_id))}</div>
          </section>

          <section class="task-form-section">
            ${sectionTitle(isZhLang() ? "\u9891\u7387\u9650\u5236" : tr("tasks.schedule.section_limits"), isZhLang() ? "\u907f\u514d\u4efb\u52a1\u8fd8\u6ca1\u8dd1\u5b8c\u5c31\u518d\u6b21\u89e6\u53d1\u3002" : "Avoid starting a new run while the previous one is still active.")}
            <div class="task-section-grid">
              <label>${tr("tasks.schedule.cooldown_sec")}<input id="scheduleFormCooldownSec" class="input" type="number" min="0" max="86400" /></label>
              <label class="ac-check task-section-check"><input id="scheduleFormSkipIfRunning" type="checkbox" checked /> ${tr("tasks.schedule.skip_if_running")}</label>
              <label class="ac-check task-section-check"><input id="scheduleFormEnabled" type="checkbox" /> ${tr("tasks.state.enabled")}</label>
            </div>
          </section>

          <div class="task-window-panel">
            ${sectionTitle(tr("tasks.window.title"), isZhLang() ? "\u53ef\u9650\u5b9a\u5de5\u4f5c\u65e5\u6216\u8425\u4e1a\u65f6\u6bb5\uff1b\u4e0d\u586b\u5c31\u662f\u5168\u5929\u6709\u6548\u3002" : "Optional active days or time range. Leave blank for all day.")}
            <div class="task-day-row">${renderActiveDayChecks("schedule", (schedule || scheduleDefault()).active_days)}</div>
            <div class="task-window-times">
              <label>${tr("tasks.window.start")}<input id="scheduleFormActiveStart" class="input" type="time" /></label>
              <label>${tr("tasks.window.end")}<input id="scheduleFormActiveEnd" class="input" type="time" /></label>
            </div>
          </div>

          <label>${tr("tasks.field.description")}<textarea id="scheduleFormDescription" class="input ac-textarea"></textarea></label>

          <details class="task-advanced-fields">
            <summary>${tr("tasks.diagnostics.advanced_fields")}</summary>
            <div class="task-section-grid" style="margin-top:12px;">
              <label>${tr("tasks.field.id")}<input id="scheduleFormId" class="input" /></label>
              <label data-task-schedule="daily interval">${tr("tasks.schedule.end_at")}<input id="scheduleFormEndAt" class="input" type="datetime-local" /></label>
            </div>
          </details>
        </div>

        <div class="ac-info-strip" id="scheduleFormSummary"></div>
        <label class="ac-check task-test-check"><input id="scheduleFormDryRun" type="checkbox" checked /> ${manualTestModeLabel()}</label>
        <div class="row ac-toolbar">
          <button class="btn btn-pill" type="button" id="btnScheduleSave">${tr("tasks.schedule.save")}</button>
          ${schedule ? "" : `<button class="btn btn-pill" type="button" id="btnScheduleCancel">${isZhLang() ? "\u53d6\u6d88\u65b0\u5efa" : "Cancel"}</button>`}
          <button class="btn btn-pill" type="button" id="btnScheduleRun" title="${escapeHtml(isZhLang() ? "\u7acb\u5373\u8ba9\u8fd9\u6761\u65f6\u95f4\u8ba1\u5212\u6267\u884c\u4e00\u6b21\u3002" : "Run this schedule once right now.")}">${isZhLang() ? "\u6267\u884c\u4e00\u6b21" : "Run once"}</button>
          <button class="btn btn-pill" type="button" id="btnScheduleDelete">${tr("tasks.common.delete")}</button>
        </div>
        <div class="task-status-line"><span id="scheduleStatusMessage" class="mini">${escapeHtml(TASK_STATE.status.schedules)}</span></div>
      </div>
    </div>
  `;

  bindPlanListEvents(renderPlanWorkspace);
  bindDraftTypeSwitch(renderPlanWorkspace);
  fillScheduleForm(schedule);

  $("scheduleFormType").onchange = () => {
    syncScheduleVisibility();
    renderScheduleSummaryDraft();
  };
  ["scheduleFormName", "scheduleFormTaskId", "scheduleFormStartAt", "scheduleFormTimeOfDay", "scheduleFormIntervalValue", "scheduleFormIntervalUnit", "scheduleFormEndAt", "scheduleFormCooldownSec", "scheduleFormActiveStart", "scheduleFormActiveEnd", "scheduleFormDescription"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const eventName = el.tagName === "SELECT" ? "onchange" : "oninput";
    el[eventName] = renderScheduleSummaryDraft;
  });
  $("scheduleFormEnabled").onchange = renderScheduleSummaryDraft;
  $("scheduleFormSkipIfRunning").onchange = renderScheduleSummaryDraft;
  for (let index = 0; index < 7; index += 1) {
    const el = $(`scheduleActiveDay${index}`);
    if (el) el.onchange = renderScheduleSummaryDraft;
  }

  if ($("btnScheduleCancel")) {
    $("btnScheduleCancel").onclick = () => {
      cancelPlanDraft("schedule");
      renderPlanWorkspace();
    };
  }

  $("btnScheduleSave").onclick = async () => {
    try {
      const res = await saveActionSchedule(readScheduleForm());
      TASK_STATE.draftReturnPlanKind = "";
      TASK_STATE.draftReturnPlanId = "";
      setPlanSelection("schedule", res.item.id);
      TASK_STATE.status.schedules = tr("tasks.feedback.schedule_saved");
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.schedules = error.message || String(error);
      renderPlanWorkspace();
    }
  };

  $("btnScheduleDelete").onclick = async () => {
    const id = $("scheduleFormId").value.trim();
    if (!id || !window.confirm(`${tr("tasks.confirm.delete_schedule")} ${id} ?`)) return;
    try {
      await deleteActionSchedule(id);
      TASK_STATE.selectedScheduleId = "";
      TASK_STATE.status.schedules = tr("tasks.feedback.schedule_deleted");
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.schedules = error.message || String(error);
      renderPlanWorkspace();
    }
  };

  $("btnScheduleRun").onclick = async () => {
    const id = $("scheduleFormId").value.trim();
    if (!id) return;
    const dryRun = $("scheduleFormDryRun").checked;
    if (!dryRun && !window.confirm(tr("tasks.confirm.real_run_schedule"))) return;
    try {
      const res = await triggerActionSchedule(id, { dryRun });
      const nextText = res.preview?.next_run_ts
        ? `${tr("tasks.schedule.next_run")} ${res.preview.next_run_ts}`
        : (blockedReasonLabel(res.preview?.blocked_reason) || tr("tasks.schedule.no_next_run"));
      TASK_STATE.status.schedules = `${res.message} | ${tr("tasks.logs.log_id")} #${res.task_result?.log_id ?? "-"} | ${nextText}`;
      await refreshTasksPage();
    } catch (error) {
      TASK_STATE.status.schedules = error.message || String(error);
      renderPlanWorkspace();
    }
  };
}

function cleanEnabledLabel(enabled) {
  return enabled === false ? (isZhLang() ? "停用" : "Off") : (isZhLang() ? "运行" : "On");
}

function scheduleTypeLabel(type) {
  const labels = {
    once: isZhLang() ? "单次" : "Once",
    daily: isZhLang() ? "每天" : "Daily",
    interval: isZhLang() ? "间隔" : "Interval"
  };
  return labels[type] || labels.daily;
}

function planStatusBadge(kind, item) {
  if (!item) return badge(isZhLang() ? "新建" : "New", "accent");
  const enabled = cleanEnabledLabel(item.enabled);
  return badge(enabled, item.enabled === false ? "muted" : "ok") + badge(planKindLabel(kind), "neutral");
}

function cleanPlanItems() {
  const schedules = TASK_STATE.schedules.map((item) => ({
    ...item,
    kind: "schedule",
    id: item.id,
    name: planName("schedule", item),
    summary: scheduleSummary(item),
    enabled: item.enabled !== false,
    active: TASK_STATE.selectedPlanKind === "schedule" && item.id === TASK_STATE.selectedScheduleId
  }));
  const rules = TASK_STATE.rules.map((item) => ({
    ...item,
    kind: "rule",
    id: item.id,
    name: planName("rule", item),
    summary: ruleSummary(item),
    enabled: item.enabled !== false,
    active: TASK_STATE.selectedPlanKind === "rule" && item.id === TASK_STATE.selectedRuleId
  }));
  return [...schedules, ...rules].sort((a, b) => Number(b.enabled) - Number(a.enabled));
}

function triggerSummary(kind, item) {
  if (!item) return kind === "rule" ? (isZhLang() ? "按参数触发" : "Parameter trigger") : (isZhLang() ? "按时间执行" : "Time based");
  if (kind === "rule") {
    const metric = metricLabel(item.metric_key || item.signal_parameter || "-");
    return `${metric} ${operatorLabel(item.operator || ">")} ${item.threshold ?? "-"}`;
  }
  if (item.schedule_type === "once") return isZhLang() ? `单次 ${item.start_at || "-"}` : `Once ${item.start_at || "-"}`;
  if (item.schedule_type === "interval") return isZhLang() ? `每隔 ${formatDuration(item.interval_sec || 0)}` : `Every ${formatDuration(item.interval_sec || 0)}`;
  return isZhLang() ? `每天 ${item.time_of_day || "-"}` : `Daily ${item.time_of_day || "-"}`;
}

function actionSummaryForPlan(item) {
  return taskNameById(item?.task_id);
}

function limitSummaryForPlan(kind, item) {
  if (!item) return isZhLang() ? "保存后生效" : "Applies after save";
  const parts = [];
  if (kind === "rule" && Number(item.max_runs_per_hour || 0) > 0) {
    parts.push(isZhLang() ? `每小时最多 ${item.max_runs_per_hour} 次` : `Max ${item.max_runs_per_hour}/h`);
  }
  if (Number(item.cooldown_sec || 0) > 0) {
    parts.push(isZhLang() ? `间隔 ${formatDuration(item.cooldown_sec)}` : `Gap ${formatDuration(item.cooldown_sec)}`);
  }
  if (kind === "schedule" && item.skip_if_task_running !== false) {
    parts.push(isZhLang() ? "运行中不重复启动" : "Skip if running");
  }
  return parts.length ? parts.join(isZhLang() ? "；" : " | ") : (isZhLang() ? "无限制" : "No limit");
}

function planStatusMessage(kind) {
  return kind === "rule" ? TASK_STATE.status.rules : TASK_STATE.status.schedules;
}

function planStatusTone(kind) {
  return kind === "rule" ? TASK_STATE.statusTone.rules : TASK_STATE.statusTone.schedules;
}

function setPlanStatus(kind, message, tone = "info") {
  if (kind === "rule") TASK_STATE.status.rules = message;
  else TASK_STATE.status.schedules = message;
  if (kind === "rule") TASK_STATE.statusTone.rules = message ? tone : "";
  else TASK_STATE.statusTone.schedules = message ? tone : "";
}

function planSavedStatusText(item) {
  const enabled = item?.enabled !== false;
  if (isZhLang()) return enabled ? "计划已保存并启用。" : "计划已保存，但当前处于停用状态。";
  return enabled ? "Plan saved and enabled." : "Plan saved, but it is currently disabled.";
}

function scheduleCheckStatusText(item) {
  const runtime = item?.runtime || {};
  if (item?.enabled === false) return isZhLang() ? "当前处于停用状态，不会自动执行。" : "This plan is disabled and will not run automatically.";
  if (runtime.next_run_ts) return isZhLang() ? `下次执行：${runtime.next_run_ts}` : `Next run: ${runtime.next_run_ts}`;
  if (runtime.blocked_reason) return isZhLang()
    ? `当前未排到执行：${blockedReasonLabel(runtime.blocked_reason)}`
    : `No run scheduled: ${blockedReasonLabel(runtime.blocked_reason)}`;
  return isZhLang() ? "当前没有排到下一次执行时间。" : "No next run is currently scheduled.";
}

function planToggleDraftStatusText(enabled) {
  if (isZhLang()) return enabled ? "已设为启用，保存后开始生效。" : "已设为停用，保存后开始生效。";
  return enabled ? "Set to enabled. Save to apply." : "Set to disabled. Save to apply.";
}

function renderPlanDecisionStrip(kind, item) {
  const cells = [
    [isZhLang() ? "触发方式" : "Trigger", triggerSummary(kind, item)],
    [isZhLang() ? "执行动作" : "Action", actionSummaryForPlan(item)],
    [isZhLang() ? "生效时间" : "Active time", item ? planAvailabilitySummary(kind, item) : (isZhLang() ? "每天 全天" : "Every day, all day")],
    [isZhLang() ? "保护限制" : "Limits", limitSummaryForPlan(kind, item)]
  ];
  return `
    <div class="task-decision-strip">
      ${cells.map(([label, value]) => `
        <div class="task-decision-cell">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || "-")}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderUnifiedPlanList() {
  const items = cleanPlanItems();
  return `
    <div class="card task-plan-list-card">
      <div class="row ac-toolbar task-plan-list-head">
        <h3 style="margin-right:auto;">${isZhLang() ? "任务库" : "Plan library"}</h3>
        <button class="btn btn-pill" type="button" id="btnPlanNewSchedule">${isZhLang() ? "新建时间" : "New time"}</button>
        <button class="btn btn-pill" type="button" id="btnPlanNewRule">${isZhLang() ? "新建参数计划" : "New parameter plan"}</button>
      </div>
      <div id="planList" class="task-plan-list">
        ${items.length ? items.map((item) => `
          <button type="button" class="task-plan-item${item.active ? " active" : ""}" data-plan-kind="${item.kind}" data-plan-id="${escapeHtml(item.id)}">
            <span class="task-plan-item-main">
              <span class="task-item-title">${escapeHtml(item.name)}</span>
              <span class="task-badge-row">${planStatusBadge(item.kind, item)}</span>
            </span>
            <span class="task-item-sub">${escapeHtml(item.summary)}</span>
          </button>
        `).join("") : `<div class="empty-hint">${isZhLang() ? "还没有计划。先新建一条时间计划或参数触发计划。" : "No plans yet."}</div>`}
      </div>
    </div>
  `;
}

function renderSchedulePlanEditor(schedule) {
  const data = schedule || scheduleDefault();
  return `
    <div class="task-form-stack task-plan-editor-form">
      <input id="scheduleFormId" class="input" type="hidden" />
      <input id="scheduleFormEndAt" class="input" type="hidden" />
      ${schedule ? "" : renderDraftTypeSwitch("schedule")}
      <label>${isZhLang() ? "计划名称" : "Name"}<input id="scheduleFormName" class="input" /></label>
      <section class="task-form-section">
        ${sectionTitle(isZhLang() ? "1. 什么时候执行" : "1. When", isZhLang() ? "选择单次、每天固定时刻，或按固定间隔循环。" : "Choose once, daily, or interval.")}
        <div class="task-section-grid">
          <label>${isZhLang() ? "时间方式" : "Time mode"}
            <select id="scheduleFormType" class="input">
              <option value="once">${isZhLang() ? "只执行一次" : "Once"}</option>
              <option value="daily">${isZhLang() ? "每天固定时间" : "Daily"}</option>
              <option value="interval">${isZhLang() ? "每隔一段时间" : "Interval"}</option>
            </select>
          </label>
          <label data-task-schedule="once">${isZhLang() ? "执行时间" : "Run at"}<input id="scheduleFormStartAt" class="input" type="datetime-local" /></label>
          <label data-task-schedule="daily">${isZhLang() ? "每天几点" : "Time of day"}<input id="scheduleFormTimeOfDay" class="input" type="time" /></label>
          <label data-task-schedule="interval">${isZhLang() ? "每隔多久" : "Repeat every"}
            <span class="task-inline-pair">
              <input id="scheduleFormIntervalValue" class="input" type="number" min="1" max="9999" />
              <select id="scheduleFormIntervalUnit" class="input">
                <option value="minute">${isZhLang() ? "分钟" : "minutes"}</option>
                <option value="hour">${isZhLang() ? "小时" : "hours"}</option>
                <option value="second">${isZhLang() ? "秒" : "seconds"}</option>
              </select>
            </span>
          </label>
        </div>
      </section>
      <section class="task-form-section">
        ${sectionTitle(isZhLang() ? "2. 做什么" : "2. Action", isZhLang() ? "动作内容在“动作配置”里维护，这里只选择要执行哪一个。" : "Actions are edited in Action Config.")}
        <label>${isZhLang() ? "执行内容" : "Action"}<select id="scheduleFormTaskId" class="input"></select></label>
        <div class="task-inline-note" id="scheduleTaskExecutionHint">${escapeHtml(taskExecutionSummary(data.task_id))}</div>
      </section>
      <section class="task-form-section">
        ${sectionTitle(isZhLang() ? "3. 生效时间和保护" : "3. Active time and limits", isZhLang() ? "可设置工作日、营业时段、夜间停用等边界。" : "Use days and time windows as operating boundaries.")}
        <div class="task-day-row">${renderActiveDayChecks("schedule", data.active_days)}</div>
        <div class="task-window-times">
          <label>${isZhLang() ? "每天从" : "From"}<input id="scheduleFormActiveStart" class="input" type="time" /></label>
          <label>${isZhLang() ? "到" : "To"}<input id="scheduleFormActiveEnd" class="input" type="time" /></label>
        </div>
        <div class="task-section-grid">
          <label>${isZhLang() ? "两次至少间隔秒数" : "Minimum gap seconds"}<input id="scheduleFormCooldownSec" class="input" type="number" min="0" max="86400" /></label>
          <label class="ac-check task-section-check"><input id="scheduleFormSkipIfRunning" type="checkbox" checked /> ${isZhLang() ? "上一次没结束就不重复启动" : "Do not overlap runs"}</label>
          <label class="ac-check task-section-check"><input id="scheduleFormEnabled" type="checkbox" /> ${isZhLang() ? "启用这条计划" : "Enable this plan"}</label>
        </div>
      </section>
      <label>${isZhLang() ? "备注" : "Notes"}<textarea id="scheduleFormDescription" class="input ac-textarea"></textarea></label>
      <div class="ac-info-strip" id="scheduleFormSummary"></div>
    </div>
  `;
}

function renderRulePlanEditor(rule) {
  const data = rule || ruleDefault();
  return `
    <div class="task-form-stack task-plan-editor-form">
      <input id="ruleFormId" class="input" type="hidden" />
      <input id="ruleFormMetricKey" class="input" type="hidden" />
      <input id="ruleFormSignalProtocol" class="input" type="hidden" />
      <input id="ruleFormSignalAddress" class="input" type="hidden" />
      <input id="ruleFormSignalParameter" class="input" type="hidden" />
      ${rule ? "" : renderDraftTypeSwitch("rule")}
      <label>${isZhLang() ? "计划名称" : "Name"}<input id="ruleFormName" class="input" /></label>
      <section class="task-form-section">
        ${sectionTitle(isZhLang() ? "1. 哪个参数达到设定值" : "1. Parameter trigger", isZhLang() ? "例如 pH 高于 6.8 并持续 30 秒。" : "For example pH above 6.8 for 30 seconds.")}
        <div class="task-section-grid">
          <label class="ac-wide">${isZhLang() ? "监测点" : "Monitored point"}<select id="ruleFormSourceKey" class="input"></select></label>
          <label>${isZhLang() ? "判断方式" : "Compare"}
            <select id="ruleFormOperator" class="input">
              <option value=">">${isZhLang() ? "高于" : "above"}</option>
              <option value=">=">${isZhLang() ? "不低于" : "at least"}</option>
              <option value="<">${isZhLang() ? "低于" : "below"}</option>
              <option value="<=">${isZhLang() ? "不高于" : "at most"}</option>
            </select>
          </label>
          <label>${isZhLang() ? "设定值" : "Value"}<input id="ruleFormThreshold" class="input" type="number" step="0.01" /></label>
          <label>${isZhLang() ? "持续秒数" : "Hold seconds"}<input id="ruleFormSustainSec" class="input" type="number" min="0" max="86400" /></label>
        </div>
        <div class="task-inline-note" id="ruleFormSourceHint"></div>
      </section>
      <section class="task-form-section">
        ${sectionTitle(isZhLang() ? "2. 做什么" : "2. Action", isZhLang() ? "条件成立后执行哪个动作。" : "Choose what runs when the condition is met.")}
        <label>${isZhLang() ? "执行内容" : "Action"}<select id="ruleFormTaskId" class="input"></select></label>
        <div class="task-inline-note" id="ruleTaskExecutionHint">${escapeHtml(taskExecutionSummary(data.task_id))}</div>
      </section>
      <section class="task-form-section">
        ${sectionTitle(isZhLang() ? "3. 生效时间和保护" : "3. Active time and limits", isZhLang() ? "限制运行时段和重复触发频率。" : "Limit operating hours and repeated triggers.")}
        <div class="task-day-row">${renderActiveDayChecks("rule", data.active_days)}</div>
        <div class="task-window-times">
          <label>${isZhLang() ? "每天从" : "From"}<input id="ruleFormActiveStart" class="input" type="time" /></label>
          <label>${isZhLang() ? "到" : "To"}<input id="ruleFormActiveEnd" class="input" type="time" /></label>
        </div>
        <div class="task-section-grid">
          <label>${isZhLang() ? "两次至少间隔秒数" : "Minimum gap seconds"}<input id="ruleFormCooldownSec" class="input" type="number" min="0" max="86400" /></label>
          <label>${isZhLang() ? "每小时最多执行" : "Max runs per hour"}<input id="ruleFormMaxRunsPerHour" class="input" type="number" min="0" max="3600" /></label>
          <label class="ac-check task-section-check"><input id="ruleFormFreshData" type="checkbox" checked /> ${isZhLang() ? "只使用最近采集的数据" : "Require recent data"}</label>
          <label class="ac-check task-section-check"><input id="ruleFormEnabled" type="checkbox" /> ${isZhLang() ? "启用这条计划" : "Enable this plan"}</label>
        </div>
      </section>
      <details class="task-advanced-fields">
        <summary>${isZhLang() ? "数据读取设置" : "Data settings"}</summary>
        <div class="task-section-grid" style="margin-top:12px;">
          <label>${isZhLang() ? "统计方式" : "Statistic"}
            <select id="ruleFormAggregation" class="input">
              <option value="last">${isZhLang() ? "最新值" : "Latest"}</option>
              <option value="avg">${isZhLang() ? "平均值" : "Average"}</option>
              <option value="min">${isZhLang() ? "最低值" : "Minimum"}</option>
              <option value="max">${isZhLang() ? "最高值" : "Maximum"}</option>
            </select>
          </label>
          <label>${isZhLang() ? "统计窗口秒数" : "Window seconds"}<input id="ruleFormWindowSec" class="input" type="number" min="1" max="86400" /></label>
          <div class="mini ac-wide">${isZhLang() ? "监测点对应的系统绑定信息会自动带入，这里通常不用手动填写。" : "The system binding for this monitored point is filled in automatically and usually does not need manual entry."}</div>
        </div>
      </details>
      <label>${isZhLang() ? "备注" : "Notes"}<textarea id="ruleFormDescription" class="input ac-textarea"></textarea></label>
      <div class="ac-info-strip" id="ruleFormSummary"></div>
    </div>
  `;
}

function planFilterLabelV2(filter) {
  const labels = {
    all: isZhLang() ? "全部" : "All",
    schedule: isZhLang() ? "时间" : "Time",
    rule: isZhLang() ? "参数" : "Parameter",
    disabled: isZhLang() ? "已停用" : "Disabled"
  };
  return labels[filter] || labels.all;
}

function visiblePlanItemsV2() {
  const filter = TASK_STATE.planFilter || "all";
  const items = cleanPlanItems();
  if (filter === "all") return items;
  if (filter === "disabled") return items.filter((item) => item.enabled === false);
  return items.filter((item) => item.kind === filter);
}

function parseLocalStampV2(ts) {
  if (!ts) return null;
  const date = new Date(String(ts).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClockV2(ts, withSeconds = false) {
  const date = parseLocalStampV2(ts);
  if (!date) return "--:--";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (!withSeconds) return `${hh}:${mm}`;
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function addSecondsV2(ts, seconds) {
  const date = parseLocalStampV2(ts);
  if (!date) return "";
  date.setSeconds(date.getSeconds() + Number(seconds || 0));
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function nextRuleCheckV2() {
  const automation = TASK_STATE.summary?.automation || {};
  if (!automation.running || !automation.automation_enabled || !automation.last_tick) return "";
  return addSecondsV2(automation.last_tick, automation.tick_sec || 2);
}

function planCardToneV2(kind, item) {
  if (!item) return "neutral";
  if (item.enabled === false) return "muted";
  if (kind === "schedule") {
    if (item.runtime?.next_run_ts) return "ok";
    if (item.runtime?.blocked_reason) return "warn";
    return "neutral";
  }
  if (item.runtime?.would_fire_now) return "ok";
  if (item.runtime?.matched_now) return "warn";
  if (!item.runtime?.stats?.latest_ts || item.runtime?.fresh_ok === false) return "warn";
  return "neutral";
}

function scheduleStateTextV2(item) {
  if (!item) return "-";
  if (item.enabled === false) return isZhLang() ? "计划已停用" : "Plan disabled";
  if (!item.runtime?.active_window?.active_now) return isZhLang() ? "当前不在生效时段" : "Outside active time";
  if (item.runtime?.blocked_reason === "Task is running") return isZhLang() ? "上一次还没结束" : "Previous run still active";
  if (item.runtime?.blocked_reason === "Cooldown is active") return isZhLang() ? "仍在最少间隔内" : "Still in cooldown";
  if (item.runtime?.next_run_ts) return isZhLang() ? "等待到达执行时间" : "Waiting for scheduled time";
  return blockedReasonLabel(item.runtime?.blocked_reason) || (isZhLang() ? "当前未安排执行" : "No upcoming run");
}

function ruleStateTextV2(item) {
  if (!item) return "-";
  const metric = metricLabel(item.metric_key || item.signal_parameter || "-");
  if (item.enabled === false) return isZhLang() ? "计划已停用" : "Plan disabled";
  if (!item.runtime?.active_window?.active_now) return isZhLang() ? "当前不在生效时段" : "Outside active time";
  if (!item.runtime?.stats?.latest_ts) return isZhLang() ? "等待最近数据" : "Waiting for recent data";
  if (item.runtime?.fresh_ok === false) return isZhLang() ? "数据已过期" : "Data is stale";
  if (item.runtime?.would_fire_now) return isZhLang() ? "条件已满足，可自动执行" : "Ready to run";
  if (item.runtime?.matched_now) return isZhLang() ? "条件满足，但被保护限制拦住" : "Matched but limited";
  if (item.runtime?.current_value != null) {
    return isZhLang()
      ? `${metric} ${item.runtime.current_value}，未到 ${item.threshold ?? "-"}`
      : `${metric} is ${item.runtime.current_value}, below trigger`;
  }
  return isZhLang() ? "条件未满足" : "Condition not met";
}

function planStateTextV2(kind, item) {
  return kind === "rule" ? ruleStateTextV2(item) : scheduleStateTextV2(item);
}

function planNextInfoV2(kind, item) {
  if (kind === "schedule") {
    if (item?.enabled === false) {
      return {
        label: isZhLang() ? "当前状态" : "Status",
        value: isZhLang() ? "已停用" : "Disabled"
      };
    }
    if (item?.runtime?.active_window && item.runtime.active_window.active_now === false) {
      return {
        label: isZhLang() ? "当前状态" : "Status",
        value: isZhLang() ? "等待生效时段" : "Waiting for active time"
      };
    }
    if (item?.runtime?.blocked_reason === "Task is running") {
      return {
        label: isZhLang() ? "当前状态" : "Status",
        value: isZhLang() ? "上次还没结束" : "Previous run active"
      };
    }
    if (item?.runtime?.blocked_reason === "Cooldown is active" || item?.runtime?.cooldown_ready === false) {
      return {
        label: isZhLang() ? "当前状态" : "Status",
        value: isZhLang() ? "等待间隔结束" : "Waiting for gap"
      };
    }
    return {
      label: isZhLang() ? "下次执行" : "Next run",
      value: item?.runtime?.next_run_ts ? formatClockV2(item.runtime.next_run_ts) : (isZhLang() ? "未安排" : "Not scheduled")
    };
  }
  if (item?.enabled === false) {
    return {
      label: isZhLang() ? "当前状态" : "Status",
      value: isZhLang() ? "已停用" : "Disabled"
    };
  }
  if (item?.runtime?.active_window && item.runtime.active_window.active_now === false) {
    return {
      label: isZhLang() ? "当前状态" : "Status",
      value: isZhLang() ? "等待生效时段" : "Waiting for active time"
    };
  }
  if (!item?.runtime?.stats?.latest_ts) {
    return {
      label: isZhLang() ? "当前状态" : "Status",
      value: isZhLang() ? "等待数据" : "Waiting for data"
    };
  }
  if (item?.runtime?.fresh_ok === false) {
    return {
      label: isZhLang() ? "当前状态" : "Status",
      value: isZhLang() ? "数据过期" : "Data stale"
    };
  }
  if (item?.runtime?.would_fire_now) {
    return {
      label: isZhLang() ? "当前状态" : "Status",
      value: isZhLang() ? "条件已满足" : "Condition met"
    };
  }
  if (item?.runtime?.matched_now) {
    return {
      label: isZhLang() ? "当前状态" : "Status",
      value: isZhLang() ? "已满足但受限" : "Matched but limited"
    };
  }
  if (item?.runtime?.current_value != null) {
    return {
      label: isZhLang() ? "当前状态" : "Status",
      value: isZhLang() ? "条件未满足" : "Condition not met"
    };
  }
  const nextCheck = nextRuleCheckV2();
  return {
    label: isZhLang() ? "下次检查" : "Next check",
    value: nextCheck ? formatClockV2(nextCheck) : (isZhLang() ? "未启动" : "Stopped")
  };
}

function planReasonListV2(kind, item) {
  const reasons = [];
  if (!item) return reasons;
  if (item.enabled === false) return [isZhLang() ? "计划已停用" : "Plan disabled"];
  if (!item.runtime?.active_window?.active_now) return [isZhLang() ? "当前不在生效时段" : "Outside active time"];

  if (kind === "rule") {
    if (!item.runtime?.stats?.latest_ts) reasons.push(isZhLang() ? "还没有最近数据" : "No recent data");
    else if (item.runtime?.fresh_ok === false) reasons.push(isZhLang() ? "数据已过期" : "Data is stale");
    else if (item.runtime?.would_fire_now) reasons.push(isZhLang() ? "条件已经满足" : "Condition is met");
    else if (item.runtime?.matched_now) reasons.push(isZhLang() ? "条件满足，但仍受限制" : "Matched but limited");
    else if (item.runtime?.current_value != null) reasons.push(isZhLang() ? `${metricLabel(item.metric_key || item.signal_parameter || "-")} 当前 ${item.runtime.current_value}` : `${metricLabel(item.metric_key || item.signal_parameter || "-")} now ${item.runtime.current_value}`);
    if (item.runtime?.cooldown_ready === false) reasons.push(isZhLang() ? "还在最少间隔内" : "Cooldown active");
    if (item.runtime?.hourly_ready === false) reasons.push(isZhLang() ? "已到每小时上限" : "Hourly limit reached");
  } else {
    if (item.runtime?.next_run_ts) reasons.push(isZhLang() ? `已排到 ${formatClockV2(item.runtime.next_run_ts)}` : `Scheduled for ${formatClockV2(item.runtime.next_run_ts)}`);
    else if (item.runtime?.blocked_reason === "Task is running") reasons.push(isZhLang() ? "上次动作还没结束" : "Previous run is still active");
    else if (item.runtime?.blocked_reason === "Cooldown is active" || item.runtime?.cooldown_ready === false) reasons.push(isZhLang() ? "还在等待再次执行间隔" : "Still waiting for the restart gap");
    else if (item.runtime?.blocked_reason) reasons.push(blockedReasonLabel(item.runtime.blocked_reason));
  }

  const automation = TASK_STATE.summary?.automation || {};
  if (automation.dry_run !== false || !automation.hardware_armed) {
    reasons.push(isZhLang() ? "当前不控制设备" : "No hardware output");
  }
  return Array.from(new Set(reasons.filter(Boolean))).slice(0, 3);
}

function planExplanationTextV2(kind, item) {
  if (!item) return isZhLang() ? "保存后，系统会按这条计划的设置来判断是否执行。" : "After you save, the system will evaluate this plan using the settings below.";
  const automation = TASK_STATE.summary?.automation || {};
  if (item.enabled === false) {
    return isZhLang() ? "这条计划目前已停用，所以系统不会自动执行它。" : "This plan is currently disabled, so it will not run automatically.";
  }
  if (!item.runtime?.active_window?.active_now) {
    return isZhLang() ? "当前时间不在这条计划的生效时段内，所以系统先不会执行它。" : "The current time is outside this plan's allowed time window, so it will not run yet.";
  }
  if (automation.dry_run !== false || !automation.hardware_armed) {
    return isZhLang() ? "计划系统现在处于不控制设备的状态，所以就算满足条件，也只会记录，不会真正输出。" : "Hardware output is currently locked, so even if the plan is ready, the system will only record it and will not drive the device.";
  }
  if (kind === "schedule") {
    if (item.runtime?.blocked_reason === "Task is running") {
      return isZhLang() ? "上一次执行还没有结束，这条计划会先跳过，避免重复启动同一个动作。" : "The previous run is still active, so this plan will wait instead of starting the same action again.";
    }
    if (item.runtime?.blocked_reason === "Cooldown is active" || item.runtime?.cooldown_ready === false) {
      return isZhLang() ? "这条计划还在等待再次启动的最少间隔，所以现在不会重复执行。" : "This plan is still inside its minimum restart gap, so it will not run again yet.";
    }
    if (item.runtime?.next_run_ts) {
      return isZhLang() ? `系统已经排好了下一次执行时间：${formatClockV2(item.runtime.next_run_ts)}。到点后会自动执行。` : `The next run is already scheduled for ${formatClockV2(item.runtime.next_run_ts)} and will run automatically when that time arrives.`;
    }
    return isZhLang() ? "这条时间计划当前还没有排到下一次执行时间，请检查启动方式和生效时段。" : "This time plan does not currently have a next run scheduled. Check its schedule type and allowed time window.";
  }
  if (!item.runtime?.stats?.latest_ts) {
    return isZhLang() ? "系统最近还没有拿到这项监测点的数据，所以现在不能按条件判断。" : "The system does not have recent data for this monitored point yet, so it cannot evaluate the condition now.";
  }
  if (item.runtime?.fresh_ok === false) {
    return isZhLang() ? "这项监测点的数据已经过期，系统会先等到新的有效数据再判断。" : "The monitored data is stale, so the system will wait for fresh data before evaluating the condition again.";
  }
  if (item.runtime?.would_fire_now) {
    return isZhLang() ? "这条参数触发计划现在已经满足，系统允许时就会自动执行。" : "This parameter plan is currently satisfied and will run automatically when hardware output is allowed.";
  }
  if (item.runtime?.matched_now) {
    return isZhLang() ? "数值条件已经碰到了，但还被频率限制拦着，所以当前不会重复执行。" : "The value condition is met, but a run limit is still blocking another execution right now.";
  }
  if (item.runtime?.current_value != null) {
    return isZhLang() ? `当前监测值是 ${item.runtime.current_value}，还没有达到这条计划的触发条件。` : `The current monitored value is ${item.runtime.current_value}, which has not reached this plan's trigger condition yet.`;
  }
  return isZhLang() ? "系统会持续巡检这条计划，等条件满足后再决定是否执行。" : "The system will keep checking this plan and decide whether to run it when the condition becomes true.";
}

function renderPlanStatusBannerV2(kind, item) {
  const next = planNextInfoV2(kind, item);
  const reasons = planReasonListV2(kind, item);
  const explanation = planExplanationTextV2(kind, item);
  let title = isZhLang() ? "现在不会自动执行" : "Will not run now";
  let tone = "warn";

  if (item) {
    if (kind === "schedule" && item.enabled !== false && item.runtime?.next_run_ts) {
      title = isZhLang() ? "已排好下次执行" : "Next run is scheduled";
      tone = "ok";
    }
    if (kind === "rule" && item.enabled !== false && item.runtime?.would_fire_now) {
      const automation = TASK_STATE.summary?.automation || {};
      if (automation.dry_run !== false || !automation.hardware_armed) {
        title = isZhLang() ? "条件已满足，但当前不控制设备" : "Matched, no hardware output";
      } else {
        title = isZhLang() ? "条件已满足，执行已就绪" : "Condition met, ready to run";
        tone = "ok";
      }
    } else if (kind === "rule" && item.enabled !== false && item.runtime?.matched_now) {
      title = isZhLang() ? "条件已满足，但当前受限" : "Condition met, but limited";
    }
  }

  return `
    <div class="task-plan-banner ${tone}">
      <div class="task-plan-banner-main">
        <div class="task-plan-banner-title">${escapeHtml(title)}</div>
        <div class="task-plan-banner-copy">${escapeHtml(explanation)}</div>
        <div class="task-plan-banner-reasons">
          ${reasons.length ? reasons.map((reason) => `<span class="task-plan-reason">${escapeHtml(reason)}</span>`).join("") : `<span class="task-plan-reason">${escapeHtml(isZhLang() ? "保存后按设定运行" : "Applies after save")}</span>`}
        </div>
      </div>
      <div class="task-plan-banner-side">
        <span>${escapeHtml(next.label)}</span>
        <strong>${escapeHtml(next.value)}</strong>
        <small>${escapeHtml(actionSummaryForPlan(item) || "-")}</small>
      </div>
    </div>
  `;
}

function renderUnifiedPlanListV2() {
  const items = visiblePlanItemsV2();
  const total = cleanPlanItems().length;
  const filters = ["all", "schedule", "rule", "disabled"];
  return `
    <div class="card task-plan-list-card task-plan-list-card-v2">
      <div class="task-plan-list-head">
        <h3>${isZhLang() ? `计划列表 (${total})` : `Plans (${total})`}</h3>
        <button class="btn btn-pill" type="button" id="btnPlanNew">${isZhLang() ? "新建计划" : "New plan"}</button>
      </div>
      <div class="task-plan-filters">
        ${filters.map((filter) => `
          <button type="button" class="task-filter-pill${TASK_STATE.planFilter === filter ? " active" : ""}" data-plan-filter="${filter}">${escapeHtml(planFilterLabelV2(filter))}</button>
        `).join("")}
      </div>
      <div id="planList" class="task-plan-list">
        ${items.length ? items.map((item) => {
          const nextInfo = planNextInfoV2(item.kind, item);
          const compactSummary = planListSummaryV2(item);
          return `
            <button type="button" class="task-plan-item${item.active ? " active" : ""}" data-plan-kind="${item.kind}" data-plan-id="${escapeHtml(item.id)}">
              <span class="task-plan-item-icon ${item.kind} ${planCardToneV2(item.kind, item)}"></span>
              <span class="task-plan-item-main">
                <span class="task-plan-item-top">
                  <span class="task-item-title">${escapeHtml(item.name)}</span>
                  <span class="task-badge-row">${planStatusBadge(item.kind, item)}</span>
                </span>
                <span class="task-plan-item-summary">${escapeHtml(compactSummary)}</span>
                <span class="task-plan-item-subline">
                  <span>${escapeHtml(nextInfo.label)}</span>
                  <strong>${escapeHtml(nextInfo.value)}</strong>
                </span>
              </span>
              <span class="task-plan-chevron" aria-hidden="true">›</span>
            </button>
          `;
        }).join("") : `<div class="empty-hint">${isZhLang() ? "当前筛选下还没有计划。" : "No plans in this filter."}</div>`}
      </div>
      <div class="task-plan-list-foot mini">${isZhLang() ? `共 ${items.length} 条` : `${items.length} shown`}</div>
    </div>
  `;
}

function renderSchedulePlanEditorV2(schedule) {
  const data = schedule || scheduleDefault();
  const type = data.schedule_type || "daily";
  return `
    <div class="task-form-stack task-plan-editor-form task-plan-editor-form-v2">
      <input id="scheduleFormId" class="input" type="hidden" />
      <label class="task-plan-name-field">${isZhLang() ? "计划名称" : "Plan name"}<input id="scheduleFormName" class="input" /></label>
      <div class="task-plan-section-cluster task-plan-section-cluster-schedule">
        <section class="task-form-section task-plan-panel task-span-2">
          ${sectionTitle(isZhLang() ? "1. 怎么安排时间" : "1. How it is scheduled", isZhLang() ? "选择只执行一次、每天固定时间，或按固定间隔反复执行。" : "Choose once, daily, or a repeating interval.")}
          <div class="task-section-grid task-plan-grid-when">
            <label>${isZhLang() ? "安排方式" : "Schedule type"}
              <select id="scheduleFormType" class="input">
                <option value="once">${isZhLang() ? "只执行一次" : "Once"}</option>
                <option value="daily">${isZhLang() ? "每天固定时间" : "Daily"}</option>
                <option value="interval">${isZhLang() ? "按固定间隔" : "Interval"}</option>
              </select>
            </label>
            <label data-task-schedule="once">${isZhLang() ? "执行时间" : "Run at"}<input id="scheduleFormStartAt" class="input" type="datetime-local" /></label>
            <label data-task-schedule="daily">${isZhLang() ? "每天在" : "Time of day"}<input id="scheduleFormTimeOfDay" class="input" type="time" /></label>
            <label data-task-schedule="interval">${isZhLang() ? "多久执行一次" : "Repeat every"}
              <span class="task-inline-pair">
                <input id="scheduleFormIntervalValue" class="input" type="number" min="1" max="9999" />
                <select id="scheduleFormIntervalUnit" class="input">
                  <option value="minute">${isZhLang() ? "分钟" : "minutes"}</option>
                  <option value="hour">${isZhLang() ? "小时" : "hours"}</option>
                  <option value="second">${isZhLang() ? "秒" : "seconds"}</option>
                </select>
              </span>
            </label>
          </div>
        </section>
        <section class="task-form-section task-plan-panel">
          ${sectionTitle(isZhLang() ? "2. 哪些日期和时段有效" : "2. Active dates and hours", isZhLang() ? "限制开始日期、结束日期、工作日或营业时段。" : "Limit start date, end date, days, or operating hours.")}
          <div class="task-window-times task-date-window-times">
            <label data-task-schedule="daily interval">${isZhLang() ? "从哪天开始" : "Start from"}<input id="scheduleFormStartAtInterval" class="input" type="datetime-local" /></label>
            <label data-task-schedule="daily interval">${isZhLang() ? "到哪天结束" : "End at"}<input id="scheduleFormEndAt" class="input" type="datetime-local" /></label>
          </div>
          <div class="task-day-row">${renderActiveDayChecks("schedule", data.active_days)}</div>
          <div class="task-window-times">
            <label>${isZhLang() ? "每天从" : "From"}<input id="scheduleFormActiveStart" class="input" type="time" /></label>
            <label>${isZhLang() ? "到" : "To"}<input id="scheduleFormActiveEnd" class="input" type="time" /></label>
          </div>
        </section>
        <section class="task-form-section task-plan-panel">
          ${sectionTitle(isZhLang() ? "3. 到时执行什么" : "3. What it runs", isZhLang() ? "选择要执行的动作。" : "Choose what runs when the time arrives.")}
          <div class="task-section-grid task-plan-grid-action">
            <label class="ac-wide">${isZhLang() ? "执行动作" : "Action"}<select id="scheduleFormTaskId" class="input"></select></label>
          </div>
          <div class="task-inline-note" id="scheduleTaskExecutionHint">${escapeHtml(taskExecutionSummary(data.task_id))}</div>
          <button class="task-inline-link" type="button" id="btnPlanOpenActionConfig">${isZhLang() ? "查看动作详情" : "View action details"}</button>
          <details class="task-advanced-fields">
            <summary>${isZhLang() ? "执行保护（可选）" : "Run protection (optional)"}</summary>
            <div class="task-section-grid" style="margin-top:12px;">
              <label>${isZhLang() ? "同一计划至少间隔（秒）" : "Minimum gap (s)"}<input id="scheduleFormCooldownSec" class="input" type="number" min="0" max="86400" /></label>
              <label class="ac-check task-section-check ac-wide"><input id="scheduleFormSkipIfRunning" type="checkbox" checked /> ${isZhLang() ? "上次还没结束，这次先跳过" : "Skip this run if the previous one is still active"}</label>
            </div>
          </details>
        </section>
      </div>
      <details class="task-plan-note-panel">
        <summary>${isZhLang() ? "备注（可选）" : "Notes (optional)"}</summary>
        <label>${isZhLang() ? "备注" : "Notes"}<textarea id="scheduleFormDescription" class="input ac-textarea"></textarea></label>
      </details>
      <div class="ac-info-strip" id="scheduleFormSummary"></div>
    </div>
  `;
}

function renderRulePlanEditorV2(rule) {
  const data = rule || ruleDefault();
  return `
    <div class="task-form-stack task-plan-editor-form task-plan-editor-form-v2">
      <input id="ruleFormId" class="input" type="hidden" />
      <input id="ruleFormMetricKey" class="input" type="hidden" />
      <input id="ruleFormSignalProtocol" class="input" type="hidden" />
      <input id="ruleFormSignalAddress" class="input" type="hidden" />
      <input id="ruleFormSignalParameter" class="input" type="hidden" />
      <label class="task-plan-name-field">${isZhLang() ? "计划名称" : "Plan name"}<input id="ruleFormName" class="input" /></label>
      <div class="task-plan-section-cluster task-plan-section-cluster-rule">
        <section class="task-form-section task-plan-panel task-span-2">
          ${sectionTitle(
            isZhLang() ? "1. 什么情况下触发" : "1. What triggers it",
            isZhLang()
              ? "选择一个监测点，设定数值达到什么程度、持续多久才执行。"
              : "Choose one monitored point, set the value it must reach, and how long it must hold."
          )}
          <div class="task-section-grid task-plan-grid-trigger">
            <label class="ac-wide">${isZhLang() ? "监测点" : "Monitored point"}<select id="ruleFormSourceKey" class="input"></select></label>
            <label>${isZhLang() ? "比较方式" : "Compare"}
              <select id="ruleFormOperator" class="input">
                <option value=">">${isZhLang() ? "大于" : "above"}</option>
                <option value=">=">${isZhLang() ? "大于等于" : "at least"}</option>
                <option value="<">${isZhLang() ? "小于" : "below"}</option>
                <option value="<=">${isZhLang() ? "小于等于" : "at most"}</option>
              </select>
            </label>
            <label>${isZhLang() ? "设定值" : "Set value"}<input id="ruleFormThreshold" class="input" type="number" step="0.01" /></label>
            <label>${isZhLang() ? "需要持续多久（秒）" : "Hold for (s)"}<input id="ruleFormSustainSec" class="input" type="number" min="0" max="86400" /></label>
          </div>
          <div class="task-section-grid task-plan-grid-trigger task-plan-grid-trigger-secondary">
            <label>${isZhLang() ? "判断方式" : "Reading mode"}
              <select id="ruleFormAggregation" class="input">
                <option value="last">${isZhLang() ? "只看最新一次读数" : "Latest reading only"}</option>
                <option value="avg">${isZhLang() ? "看最近一段时间的平均值" : "Average over a recent period"}</option>
                <option value="min">${isZhLang() ? "看最近一段时间的最低值" : "Lowest value in a recent period"}</option>
                <option value="max">${isZhLang() ? "看最近一段时间的最高值" : "Highest value in a recent period"}</option>
              </select>
            </label>
            <label id="ruleFormWindowRow">${isZhLang() ? "最近多久" : "Recent period"}
              <div class="task-inline-duration">
                <input id="ruleFormWindowValue" class="input" type="number" min="1" max="86400" />
                <select id="ruleFormWindowUnit" class="input">
                  <option value="second">${isZhLang() ? "秒" : "Seconds"}</option>
                  <option value="minute">${isZhLang() ? "分钟" : "Minutes"}</option>
                  <option value="hour">${isZhLang() ? "小时" : "Hours"}</option>
                </select>
              </div>
            </label>
            <label class="ac-check task-section-check"><input id="ruleFormFreshData" type="checkbox" checked /> ${isZhLang() ? "没新数据就不执行" : "Do not run without fresh data"}</label>
          </div>
          <div class="task-inline-note" id="ruleFormSourceHint"></div>
          <div class="task-inline-note" id="ruleFormValueModeHint"></div>
        </section>
        <section class="task-form-section task-plan-panel">
          ${sectionTitle(isZhLang() ? "2. 哪些时段允许触发" : "2. Allowed trigger window", isZhLang() ? "限制工作日、营业时段，或夜间停用区间。" : "Limit the rule to specific days or operating hours.")}
          <div class="task-day-row">${renderActiveDayChecks("rule", data.active_days)}</div>
          <div class="task-window-times">
            <label>${isZhLang() ? "每天从" : "From"}<input id="ruleFormActiveStart" class="input" type="time" /></label>
            <label>${isZhLang() ? "到" : "To"}<input id="ruleFormActiveEnd" class="input" type="time" /></label>
          </div>
        </section>
        <section class="task-form-section task-plan-panel">
          ${sectionTitle(isZhLang() ? "3. 满足后执行什么" : "3. What it runs", isZhLang() ? "选择执行动作，并补充频率保护。" : "Choose the action and add safety limits.")}
          <div class="task-section-grid task-plan-grid-action">
            <label class="ac-wide">${isZhLang() ? "执行动作" : "Action"}<select id="ruleFormTaskId" class="input"></select></label>
            <label>${isZhLang() ? "两次执行至少间隔（秒）" : "Minimum gap between runs (s)"}<input id="ruleFormCooldownSec" class="input" type="number" min="0" max="86400" /></label>
            <label>${isZhLang() ? "每小时最多执行几次" : "Maximum runs per hour"}<input id="ruleFormMaxRunsPerHour" class="input" type="number" min="0" max="3600" /></label>
          </div>
          <div class="task-inline-note" id="ruleTaskExecutionHint">${escapeHtml(taskExecutionSummary(data.task_id))}</div>
          <button class="task-inline-link" type="button" id="btnPlanOpenActionConfig">${isZhLang() ? "查看动作详情" : "View action details"}</button>
        </section>
      </div>
      <details class="task-plan-note-panel">
        <summary>${isZhLang() ? "备注（可选）" : "Notes (optional)"}</summary>
        <label>${isZhLang() ? "备注" : "Notes"}<textarea id="ruleFormDescription" class="input ac-textarea"></textarea></label>
      </details>
      <div class="ac-info-strip" id="ruleFormSummary"></div>
    </div>
  `;
}

function renderTaskRuntimePanelV2() {
  const box = $("taskRuntimePanel");
  if (!box) return;
  const summary = TASK_STATE.summary || {};
  const automation = summary.automation || {};
  const autoValue = !automation.running
    ? (isZhLang() ? "计划服务未启动" : "Service stopped")
    : automation.automation_enabled
      ? (isZhLang() ? "自动运行中" : "Running automatically")
      : (isZhLang() ? "自动运行已暂停" : "Automation paused");
  const autoTone = automation.running && automation.automation_enabled ? "ok" : "warn";
  const hardwareValue = (automation.dry_run === false && automation.hardware_armed)
    ? (isZhLang() ? "已接管" : "Under control")
    : (isZhLang() ? "未接管" : "Not controlled");
  const lastTickValue = automation.last_tick ? formatClockV2(automation.last_tick, true) : "--:--:--";
  const autoActionLabel = automation.automation_enabled
    ? (isZhLang() ? "暂停自动计划" : "Pause automation")
    : (isZhLang() ? "恢复自动计划" : "Resume automation");
  const hardwareActionLabel = (automation.dry_run === false && automation.hardware_armed)
    ? (isZhLang() ? "锁定现场设备" : "Lock field devices")
    : (isZhLang() ? "接管现场设备" : "Take control");

  box.innerHTML = `
    <div class="task-runtime-strip">
      <div class="task-runtime-metrics">
        <div class="task-runtime-metric">
          <span class="task-runtime-dot ${autoTone}"></span>
          <div>
            <span>${isZhLang() ? "计划运行" : "Plan runtime"}</span>
            <strong>${escapeHtml(autoValue)}</strong>
          </div>
        </div>
        <div class="task-runtime-metric">
          <span class="task-runtime-dot ${automation.dry_run === false && automation.hardware_armed ? "ok" : "warn"}"></span>
          <div>
            <span>${isZhLang() ? "现场设备" : "Field devices"}</span>
            <strong>${escapeHtml(hardwareValue)}</strong>
          </div>
        </div>
        <div class="task-runtime-metric">
          <span class="task-runtime-dot neutral"></span>
          <div>
            <span>${isZhLang() ? "最近巡检" : "Last check"}</span>
            <strong>${escapeHtml(lastTickValue)}</strong>
          </div>
        </div>
      </div>
      <div class="task-runtime-actions">
        <button class="btn btn-pill task-secondary-action" type="button" id="btnTaskRuntimeRefresh">${isZhLang() ? "刷新状态" : "Refresh"}</button>
        <button class="btn btn-pill" type="button" id="btnTaskRuntimeAuto">${escapeHtml(autoActionLabel)}</button>
        <button class="btn btn-pill task-secondary-action" type="button" id="btnTaskRuntimeHardware">${escapeHtml(hardwareActionLabel)}</button>
        <button class="btn btn-pill task-danger-action" type="button" id="btnTaskRuntimeStopAll">${isZhLang() ? "全部暂停并锁定" : "Pause all & lock"}</button>
      </div>
    </div>
  `;

  const basePayload = () => ({
    automation_enabled: automation.automation_enabled === true,
    dry_run: automation.dry_run !== false,
    hardware_armed: automation.hardware_armed === true,
    tick_sec: automation.tick_sec || 2,
    fresh_data_sec: automation.fresh_data_sec || 180
  });

  $("btnTaskRuntimeRefresh").onclick = async () => {
    await refreshTasksPage();
  };

  $("btnTaskRuntimeAuto").onclick = async () => {
    await saveAutomationConfig({
      ...basePayload(),
      automation_enabled: !automation.automation_enabled
    });
    await refreshTasksPage();
  };

  $("btnTaskRuntimeHardware").onclick = async () => {
    const enabling = !(automation.dry_run === false && automation.hardware_armed);
    if (enabling && !window.confirm(isZhLang() ? "确认让计划接管现场设备？请先确认设备与工况安全。" : "Allow plans to take control of field devices?")) return;
    await saveAutomationConfig({
      ...basePayload(),
      dry_run: !enabling,
      hardware_armed: enabling
    });
    await refreshTasksPage();
  };

  $("btnTaskRuntimeStopAll").onclick = async () => {
    if (!window.confirm(isZhLang() ? "确认停止全部计划并锁定现场设备？" : "Stop all plans and lock field devices?")) return;
    await saveAutomationConfig({
      ...basePayload(),
      automation_enabled: false,
      dry_run: true,
      hardware_armed: false
    });
    await refreshTasksPage();
  };
}

function bindPlanEditorInputs(kind) {
  if (kind === "rule") {
    ["ruleFormName", "ruleFormSourceKey", "ruleFormAggregation", "ruleFormWindowValue", "ruleFormWindowUnit", "ruleFormWindowSec", "ruleFormThreshold", "ruleFormSustainSec", "ruleFormCooldownSec", "ruleFormMaxRunsPerHour", "ruleFormOperator", "ruleFormTaskId", "ruleFormActiveStart", "ruleFormActiveEnd", "ruleFormDescription"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      const eventName = el.tagName === "SELECT" ? "onchange" : "oninput";
      el[eventName] = () => {
        if (id === "ruleFormSourceKey") syncRuleSourceFields();
        if (id === "ruleFormAggregation") syncRuleValueModeUi();
        renderRuleSummaryDraft();
      };
    });
    ["ruleFormEnabled", "ruleFormFreshData"].forEach((id) => {
      const el = $(id);
      if (el) el.onchange = renderRuleSummaryDraft;
    });
    for (let index = 0; index < 7; index += 1) {
      const el = $(`ruleActiveDay${index}`);
      if (el) el.onchange = renderRuleSummaryDraft;
    }
    return;
  }

  $("scheduleFormType").onchange = () => {
    syncScheduleVisibility();
    renderScheduleSummaryDraft();
  };
  ["scheduleFormName", "scheduleFormTaskId", "scheduleFormStartAt", "scheduleFormStartAtInterval", "scheduleFormTimeOfDay", "scheduleFormIntervalValue", "scheduleFormIntervalUnit", "scheduleFormEndAt", "scheduleFormCooldownSec", "scheduleFormActiveStart", "scheduleFormActiveEnd", "scheduleFormDescription"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const eventName = el.tagName === "SELECT" ? "onchange" : "oninput";
    el[eventName] = renderScheduleSummaryDraft;
  });
  ["scheduleFormEnabled", "scheduleFormSkipIfRunning"].forEach((id) => {
    const el = $(id);
    if (el) el.onchange = renderScheduleSummaryDraft;
  });
  for (let index = 0; index < 7; index += 1) {
    const el = $(`scheduleActiveDay${index}`);
    if (el) el.onchange = renderScheduleSummaryDraft;
  }
}

function bindUnifiedPlanWorkspace(kind, item) {
  document.querySelectorAll("[data-plan-kind][data-plan-id]").forEach((btn) => {
    btn.onclick = () => {
      setPlanSelection(btn.getAttribute("data-plan-kind") || "schedule", btn.getAttribute("data-plan-id") || "");
      TASK_STATE.draftReturnPlanKind = "";
      TASK_STATE.draftReturnPlanId = "";
      renderPlanWorkspace();
    };
  });

  document.querySelectorAll("[data-plan-filter]").forEach((btn) => {
    btn.onclick = () => {
      TASK_STATE.planFilter = btn.getAttribute("data-plan-filter") || "all";
      saveTaskUiState();
      renderPlanWorkspace();
    };
  });

  const startDraft = (nextKind) => {
    TASK_STATE.draftReturnPlanKind = TASK_STATE.selectedPlanKind;
    TASK_STATE.draftReturnPlanId = TASK_STATE.selectedPlanKind === "rule" ? TASK_STATE.selectedRuleId : TASK_STATE.selectedScheduleId;
    setPlanSelection(nextKind, "");
    setPlanStatus(nextKind, isZhLang() ? "正在新建，保存后才会生效。" : "Creating. Save to apply.", "info");
    renderPlanWorkspace();
  };

  if ($("btnPlanNew")) {
    $("btnPlanNew").onclick = () => startDraft(TASK_STATE.selectedPlanKind || "schedule");
  }

  bindDraftTypeSwitch(renderPlanWorkspace);
  bindPlanEditorInputs(kind);
  const enableId = kind === "rule" ? "ruleFormEnabled" : "scheduleFormEnabled";
  if ($(enableId)) {
    $(enableId).onchange = () => {
      setPlanStatus(kind, planToggleDraftStatusText($(enableId).checked), "warn");
      if ($("planStatusMessage")) {
        $("planStatusMessage").textContent = planStatusMessage(kind);
        $("planStatusMessage").className = `mini task-status-pill ${planStatusTone(kind) || "info"}`;
      }
    };
  }

  if ($("btnPlanOpenActionConfig")) {
    $("btnPlanOpenActionConfig").onclick = async () => {
      setActivePage("action_config");
      await initActionConfig({ initialTab: "unit" });
    };
  }

  if ($("btnPlanCancel")) {
    $("btnPlanCancel").onclick = () => {
      cancelPlanDraft(kind);
      renderPlanWorkspace();
    };
  }

  $("btnPlanSave").onclick = async () => {
    try {
      const res = kind === "rule"
        ? await saveActionRule(readRuleForm())
        : await saveActionSchedule(readScheduleForm());
      TASK_STATE.draftReturnPlanKind = "";
      TASK_STATE.draftReturnPlanId = "";
      setPlanSelection(kind, res.item.id);
      setPlanStatus(kind, planSavedStatusText(res.item), "ok");
      await refreshTasksPage();
    } catch (error) {
      setPlanStatus(kind, error.message || String(error), "danger");
      renderPlanWorkspace();
    }
  };

  if ($("btnPlanDelete")) {
    $("btnPlanDelete").onclick = async () => {
      const id = kind === "rule" ? $("ruleFormId").value.trim() : $("scheduleFormId").value.trim();
      if (!id || id.startsWith("new_")) return;
      const confirmText = isZhLang() ? `确定删除计划 ${id}？` : `Delete plan ${id}?`;
      if (!window.confirm(confirmText)) return;
      try {
        if (kind === "rule") {
          await deleteActionRule(id);
          TASK_STATE.selectedRuleId = "";
        } else {
          await deleteActionSchedule(id);
          TASK_STATE.selectedScheduleId = "";
        }
        setPlanStatus(kind, isZhLang() ? "计划已删除。" : "Plan deleted.", "warn");
        await refreshTasksPage();
      } catch (error) {
        setPlanStatus(kind, error.message || String(error), "danger");
        renderPlanWorkspace();
      }
    };
  }

  $("btnPlanCheck").onclick = async () => {
    const id = kind === "rule" ? $("ruleFormId").value.trim() : $("scheduleFormId").value.trim();
    if (!id || id.startsWith("new_")) {
      setPlanStatus(kind, isZhLang() ? "请先保存计划，再检查配置。" : "Save the plan before checking.", "warn");
      renderPlanWorkspace();
      return;
    }
    try {
      if (kind === "rule") {
        const res = await evaluateActionRule(id, { dryRun: true, executeIfMatch: false });
        setPlanStatus(kind, ruleEvaluationStatusText(res), res.can_fire ? "ok" : (res.matched ? "warn" : "info"));
      } else {
        setPlanStatus(kind, scheduleCheckStatusText(selectedSchedule()), "info");
      }
      renderPlanWorkspace();
    } catch (error) {
      setPlanStatus(kind, error.message || String(error), "danger");
      renderPlanWorkspace();
    }
  };

  $("btnPlanRunOnce").onclick = async () => {
    const taskId = kind === "rule" ? $("ruleFormTaskId").value : $("scheduleFormTaskId").value;
    const id = kind === "rule" ? $("ruleFormId").value.trim() : $("scheduleFormId").value.trim();
    if (!taskId) return;
    const name = taskNameById(taskId);
    const confirmText = kind === "rule"
      ? (isZhLang()
          ? `将手动执行一次“${name}”，不会先判断当前条件。请确认现场设备安全。`
          : `Run "${name}" once now without checking the current condition first?`)
      : (isZhLang()
          ? `将立刻执行一次“${name}”。请确认现场设备安全。`
          : `Run "${name}" now with real hardware output?`);
    if (!window.confirm(confirmText)) return;
    try {
      const res = kind === "schedule" && id && !id.startsWith("new_")
        ? await triggerActionSchedule(id, { dryRun: false })
        : await executeActionTask(taskId, { dryRun: false, source: `manual-plan:${id || kind}` });
      setPlanStatus(kind, `${logMessageLabel(res.message)} | ${isZhLang() ? "记录" : "Log"} #${res.task_result?.log_id ?? res.log_id ?? "-"}`, "ok");
      await refreshTasksPage();
    } catch (error) {
      setPlanStatus(kind, error.message || String(error), "danger");
      renderPlanWorkspace();
    }
  };
}

function renderUnifiedPlanWorkspace() {
  const current = currentPlanSelection();
  const kind = current.kind || "schedule";
  const item = current.item;
  const workspace = $("taskWorkspace");
  if (!workspace) return;

  const enableId = kind === "rule" ? "ruleFormEnabled" : "scheduleFormEnabled";
  const editor = kind === "rule" ? renderRulePlanEditorV2(item) : renderSchedulePlanEditorV2(item);
  const checkLabel = kind === "rule"
    ? (isZhLang() ? "现在检查" : "Check now")
    : (isZhLang() ? "预览下次执行" : "Preview next run");
  const runLabel = kind === "rule"
    ? (isZhLang() ? "手动执行动作" : "Run action")
    : (isZhLang() ? "现在执行一次" : "Run now");
  const lastActionLabel = item
    ? (isZhLang() ? "删除计划" : "Delete plan")
    : (isZhLang() ? "取消新建" : "Cancel");
  const statusText = planStatusMessage(kind);
  const statusTone = planStatusTone(kind) || "info";

  workspace.innerHTML = `
    <div class="task-workbench task-workbench-v2">
      ${renderUnifiedPlanListV2()}
      <div class="card task-plan-detail-card task-plan-detail-card-v2">
        <div class="task-plan-editor-head">
          <div>
            <div class="task-editor-kicker">${escapeHtml(planEditorKickerV2(kind, item))}</div>
            <div class="task-detail-title">${escapeHtml(planEditorTitle(kind, item))}</div>
          </div>
          <div class="task-plan-head-side">
            <div class="task-plan-kind-wrap">
              ${item ? `<div class="task-badge-row">${planHeadBadgesV2(kind, item)}</div>` : renderDraftTypeSwitch(kind)}
            </div>
            <label class="task-inline-toggle">
              <span>${isZhLang() ? "启用" : "Enabled"}</span>
              <input id="${enableId}" type="checkbox" />
              <span class="task-inline-toggle-ui"></span>
            </label>
          </div>
        </div>
        <div class="task-plan-detail-scroll">
          ${renderPlanStatusBannerV2(kind, item)}
          ${editor}
          <div class="task-status-line">${statusText ? `<span id="planStatusMessage" class="mini task-status-pill ${escapeHtml(statusTone)}">${escapeHtml(statusText)}</span>` : ""}</div>
        </div>
        <div class="task-action-bar task-action-bar-v2">
          <button class="btn btn-pill" type="button" id="btnPlanSave">${isZhLang() ? "保存计划" : "Save plan"}</button>
          <button class="btn btn-pill task-secondary-action" type="button" id="btnPlanCheck"${item ? "" : " disabled"}>${escapeHtml(checkLabel)}</button>
          <button class="btn btn-pill" type="button" id="btnPlanRunOnce">${escapeHtml(runLabel)}</button>
          ${item ? `<button class="btn btn-pill task-danger-action" type="button" id="btnPlanDelete">${escapeHtml(lastActionLabel)}</button>` : `<button class="btn btn-pill task-secondary-action" type="button" id="btnPlanCancel">${escapeHtml(lastActionLabel)}</button>`}
        </div>
      </div>
    </div>
  `;

  if (kind === "rule") fillRuleForm(item);
  else fillScheduleForm(item);
  bindUnifiedPlanWorkspace(kind, item);
}

function renderPlanWorkspace() {
  ensurePlanSelection();
  renderUnifiedPlanWorkspace();
}

function renderLogWorkspace() {
  const workspace = $("taskWorkspace");
  if (!workspace) return;
  workspace.innerHTML = `
    <div class="card">
      <div class="row ac-toolbar">
        <h3 style="margin-right:auto;">${tr("tasks.tabs.logs")}</h3>
        <button class="btn btn-pill" type="button" id="btnTaskLogsRefresh">${tr("tasks.common.refresh")}</button>
        <span id="taskLogsStatus" class="mini">${escapeHtml(TASK_STATE.status.logs)}</span>
      </div>
      <div id="taskLogList" class="task-log-list">
        ${TASK_STATE.logs.length ? TASK_STATE.logs.map((log) => {
          const name = logTargetName(log);
          return `
            <div class="task-log-row ${escapeHtml(log.status || "")}">
              <div class="task-log-head">
                <span class="pill">${escapeHtml(logKindLabel(log.run_kind))}</span>
                <strong>${escapeHtml(name)}</strong>
                <span>${escapeHtml(log.ts || "")}</span>
                <span>${escapeHtml(logSourceLabel(log.source))}</span>
              </div>
              <div class="mini">${escapeHtml(logMessageLabel(log.message))}</div>
            </div>
          `;
        }).join("") : `<div class="empty-hint">${tr("tasks.empty.logs")}</div>`}
      </div>
    </div>
  `;

  $("btnTaskLogsRefresh").onclick = async () => {
    TASK_STATE.status.logs = tr("tasks.feedback.logs_refreshed");
    await refreshTasksPage();
  };
}

function renderDiagnosticsWorkspace() {
  const workspace = $("taskWorkspace");
  if (!workspace) return;
  const automation = TASK_STATE.summary?.automation || {};
  const driver = TASK_STATE.summary?.driver || {};

  workspace.innerHTML = `
    <div class="grid2 task-grid">
      <div class="card">
        <h3>${tr("tasks.diagnostics.title")}</h3>
        <div class="task-inline-note">${tr("tasks.diagnostics.intro")}</div>
        <div class="ac-summary-box">
          <div class="ac-summary-row">
            <div class="ac-summary-key">${tr("tasks.summary.service")}</div>
            <div class="ac-summary-val">${escapeHtml(automation.running ? tr("tasks.summary.running") : tr("tasks.summary.stopped"))}</div>
          </div>
          <div class="ac-summary-row">
            <div class="ac-summary-key">${tr("tasks.summary.hardware_arm")}</div>
            <div class="ac-summary-val">${escapeHtml(automation.hardware_armed ? tr("tasks.summary.armed") : tr("tasks.summary.safe_lock"))}</div>
          </div>
          <div class="ac-summary-row">
            <div class="ac-summary-key">${tr("tasks.summary.gpio_driver")}</div>
            <div class="ac-summary-val">${escapeHtml(driver.available ? driver.backend : tr("tasks.summary.not_detected"))}</div>
          </div>
          <div class="ac-summary-row">
            <div class="ac-summary-key">${tr("tasks.automation.last_tick")}</div>
            <div class="ac-summary-val">${escapeHtml(automation.last_tick || "-")}</div>
          </div>
          <div class="ac-summary-row">
            <div class="ac-summary-key">${tr("tasks.diagnostics.backend_objects")}</div>
            <div class="ac-summary-val">${escapeHtml(`${tr("tasks.tabs.schedules")} ${TASK_STATE.schedules.length} / ${tr("tasks.tabs.rules")} ${TASK_STATE.rules.length} / ${tr("tasks.tabs.tasks")} ${TASK_STATE.tasks.length}`)}</div>
          </div>
          <div class="ac-summary-row">
            <div class="ac-summary-key">${tr("tasks.diagnostics.last_error")}</div>
            <div class="ac-summary-val">${escapeHtml(automation.last_error || tr("tasks.diagnostics.none"))}</div>
          </div>
        </div>
        <div class="row ac-toolbar" style="margin-top:12px;">
          <button class="btn btn-pill" type="button" id="btnTaskRuntimeStart">${tr("tasks.automation.restart_service")}</button>
          <button class="btn btn-pill" type="button" id="btnTaskRuntimeStop">${tr("tasks.automation.pause_service")}</button>
          <span id="taskDiagnosticStatus" class="mini"></span>
        </div>
      </div>

      <div class="card">
        <h3>${tr("tasks.diagnostics.combo_title")}</h3>
        <div class="mini" style="margin-bottom:12px;">${tr("tasks.diagnostics.combo_intro")}</div>
        <button class="btn btn-pill" type="button" id="btnOpenComboEditor">${tr("tasks.diagnostics.open_combo")}</button>
      </div>
    </div>
  `;

  $("btnTaskRuntimeStart").onclick = async () => {
    try {
      await startAutomationRuntime();
      await refreshTasksPage();
    } catch (error) {
      $("taskDiagnosticStatus").textContent = error.message || String(error);
    }
  };
  $("btnTaskRuntimeStop").onclick = async () => {
    try {
      await stopAutomationRuntime();
      await refreshTasksPage();
    } catch (error) {
      $("taskDiagnosticStatus").textContent = error.message || String(error);
    }
  };
  $("btnOpenComboEditor").onclick = () => renderTaskWorkspace();
}

async function renderWorkspace() {
  if (TASK_STATE.activeTab === "plans") {
    renderPlanWorkspace();
    return;
  }
  if (TASK_STATE.activeTab === "logs") {
    renderLogWorkspace();
    return;
  }
  renderDiagnosticsWorkspace();
}

async function loadAllTaskData() {
  const [summary, tasksRes, unitsRes, rulesRes, schedulesRes, logsRes, planViewRes] = await Promise.all([
    fetchActionSummary(),
    fetchActionTasks(),
    fetchActionUnits(),
    fetchActionRules(),
    fetchActionSchedules(),
    fetchActionLogs(40),
    apiMetaPlanView().catch(() => ({ ok: false, entries: [] }))
  ]);

  TASK_STATE.summary = summary;
  TASK_STATE.tasks = tasksRes.items || [];
  TASK_STATE.actionUnits = unitsRes.items || [];
  TASK_STATE.rules = rulesRes.items || [];
  TASK_STATE.schedules = schedulesRes.items || [];
  TASK_STATE.planViewEntries = planViewRes.entries || [];
  TASK_STATE.planSources = buildPlanSources(TASK_STATE.planViewEntries);
  TASK_STATE.logs = logsRes.items || [];

  if (TASK_STATE.selectedTaskId && !TASK_STATE.tasks.some((item) => item.id === TASK_STATE.selectedTaskId)) {
    TASK_STATE.selectedTaskId = "";
  }
  if (TASK_STATE.selectedRuleId && !TASK_STATE.rules.some((item) => item.id === TASK_STATE.selectedRuleId)) {
    TASK_STATE.selectedRuleId = "";
  }
  if (TASK_STATE.selectedScheduleId && !TASK_STATE.schedules.some((item) => item.id === TASK_STATE.selectedScheduleId)) {
    TASK_STATE.selectedScheduleId = "";
  }
  if (TASK_STATE.draftPlanKind === "rule" && TASK_STATE.selectedRuleId) {
    TASK_STATE.draftPlanKind = "";
  }
  if (TASK_STATE.draftPlanKind === "schedule" && TASK_STATE.selectedScheduleId) {
    TASK_STATE.draftPlanKind = "";
  }

  TASK_STATE.selectedTaskId = TASK_STATE.selectedTaskId || TASK_STATE.tasks[0]?.id || "";
  TASK_STATE.selectedRuleId = TASK_STATE.selectedRuleId || TASK_STATE.rules[0]?.id || "";
  TASK_STATE.selectedScheduleId = TASK_STATE.selectedScheduleId || TASK_STATE.schedules[0]?.id || "";
  ensurePlanSelection();
}

export async function refreshTasksPage() {
  await loadAllTaskData();
  renderTaskRuntimePanelV2();
  renderTaskTabs();
  await renderWorkspace();
}

export async function initTasksPage() {
  const root = $("taskPageRoot");
  if (!root) return;
  loadTaskUiState();

  root.innerHTML = `
    <div class="task-page task-page-v2">
      <div id="taskRuntimePanel" class="card task-runtime-card"></div>
      <div id="taskTabBar" class="ac-subtabs task-subtabs"></div>
      <div id="taskWorkspace"></div>
    </div>
  `;

  await refreshTasksPage();
}


