async function parseJsonResponse(resp) {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${resp.status}`);
  }
  return data;
}

export async function fetchProfileList() {
  return parseJsonResponse(await fetch("/api/v1/action-profile/list"));
}

export async function fetchProfileDetail(filename) {
  return parseJsonResponse(await fetch(`/api/v1/action-profile/detail?filename=${encodeURIComponent(filename)}`));
}

export async function fetchCurrentProfile() {
  return parseJsonResponse(await fetch("/api/v1/action-profile/current"));
}

export async function confirmCurrentProfile(filename) {
  return parseJsonResponse(await fetch("/api/v1/action-profile/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename })
  }));
}

export async function importProfileFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  return parseJsonResponse(await fetch("/api/v1/action-profile/import", {
    method: "POST",
    body: fd
  }));
}

export async function fetchActionSummary() {
  return parseJsonResponse(await fetch("/api/v1/actions/summary"));
}

export async function fetchAutomationStatus() {
  return parseJsonResponse(await fetch("/api/v1/actions/automation/status"));
}

export async function startAutomationRuntime() {
  return parseJsonResponse(await fetch("/api/v1/actions/automation/start", {
    method: "POST"
  }));
}

export async function stopAutomationRuntime() {
  return parseJsonResponse(await fetch("/api/v1/actions/automation/stop", {
    method: "POST"
  }));
}

export async function stopAllOutputs() {
  return parseJsonResponse(await fetch("/api/v1/actions/output/stop-all", {
    method: "POST"
  }));
}

export async function saveAutomationConfig(item) {
  return parseJsonResponse(await fetch("/api/v1/actions/automation/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  }));
}

export async function fetchActuators() {
  return parseJsonResponse(await fetch("/api/v1/actions/actuators"));
}

export async function saveActuator(item) {
  return parseJsonResponse(await fetch("/api/v1/actions/actuators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  }));
}

export async function deleteActuator(id) {
  return parseJsonResponse(await fetch(`/api/v1/actions/actuators/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }));
}

export async function fetchActionUnits() {
  return parseJsonResponse(await fetch("/api/v1/actions/units"));
}

export async function saveActionUnit(item) {
  return parseJsonResponse(await fetch("/api/v1/actions/units", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  }));
}

export async function deleteActionUnit(id) {
  return parseJsonResponse(await fetch(`/api/v1/actions/units/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }));
}

export async function executeActionUnit(id, { dryRun = false, source = "manual", asyncRun = false } = {}) {
  return parseJsonResponse(await fetch(`/api/v1/actions/units/${encodeURIComponent(id)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: dryRun, source, async: asyncRun })
  }));
}

export async function fetchActionTasks() {
  return parseJsonResponse(await fetch("/api/v1/actions/tasks"));
}

export async function saveActionTask(item) {
  return parseJsonResponse(await fetch("/api/v1/actions/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  }));
}

export async function deleteActionTask(id) {
  return parseJsonResponse(await fetch(`/api/v1/actions/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }));
}

export async function executeActionTask(id, { dryRun = false, source = "manual", asyncRun = false } = {}) {
  return parseJsonResponse(await fetch(`/api/v1/actions/tasks/${encodeURIComponent(id)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: dryRun, source, async: asyncRun })
  }));
}

export async function fetchActionRules() {
  return parseJsonResponse(await fetch("/api/v1/actions/rules"));
}

export async function saveActionRule(item) {
  return parseJsonResponse(await fetch("/api/v1/actions/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  }));
}

export async function deleteActionRule(id) {
  return parseJsonResponse(await fetch(`/api/v1/actions/rules/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }));
}

export async function evaluateActionRule(id, { dryRun = true, executeIfMatch = false, asyncRun = false } = {}) {
  return parseJsonResponse(await fetch(`/api/v1/actions/rules/${encodeURIComponent(id)}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: dryRun, execute_if_match: executeIfMatch, async: asyncRun })
  }));
}

export async function fetchActionSchedules() {
  return parseJsonResponse(await fetch("/api/v1/actions/schedules"));
}

export async function saveActionSchedule(item) {
  return parseJsonResponse(await fetch("/api/v1/actions/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  }));
}

export async function deleteActionSchedule(id) {
  return parseJsonResponse(await fetch(`/api/v1/actions/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }));
}

export async function triggerActionSchedule(id, { dryRun = false, asyncRun = false } = {}) {
  return parseJsonResponse(await fetch(`/api/v1/actions/schedules/${encodeURIComponent(id)}/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: dryRun, async: asyncRun })
  }));
}

export async function fetchActionLogs(limit = 100) {
  return parseJsonResponse(await fetch(`/api/v1/actions/logs?limit=${encodeURIComponent(limit)}`));
}
