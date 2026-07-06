// 文件：ui/js/api.js
// 职责：调用后端 API（Flask）
// 约定：同源访问（/api/v1/...）
// 说明：
// - GET 也会带 Content-Type 不会导致 Flask 出错；但这里对 GET 单独清空 headers 更干净。

async function httpJson(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  const headers = {
    ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };

  const r = await fetch(url, {
    cache: "no-store",
    ...options,
    method,
    headers,
  });

  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    const msg = (data && data.error) ? data.error : `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** 扫描：POST /api/v1/scan */
export async function apiScanStart(req) {
  return httpJson("/api/v1/scan", {
    method: "POST",
    body: JSON.stringify(req),
  });
}



/** 扫描结果：GET /api/v1/scan/<job_id> */
export async function apiScanGet(jobId) {
  return httpJson(`/api/v1/scan/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });
}


// poller API 和 串口守卫


/** poller 状态：GET /api/v1/poller/status */
export async function apiPollerStatus() {
  return httpJson("/api/v1/poller/status", { method: "GET" });
}

/** poller 启动：POST /api/v1/poller/start */
export async function apiPollerStart() {
  return httpJson("/api/v1/poller/start", { method: "POST" });
}

/** poller 停止：POST /api/v1/poller/stop */
export async function apiPollerStop() {
  return httpJson("/api/v1/poller/stop", { method: "POST" });
}

/**
 * 串口调用前置守卫（前端自律层）
 * - 先问 poller 状态
 * - running=true：抛错，阻止任何串口相关请求继续发出
 */
export async function ensureSerialAllowed() {
  const st = await apiPollerStatus();
  const running = Boolean(st && st.ok === true && st.running === true);

  if (running) {
    const err = new Error("数据采集进行中：串口已被 poller 占用，请先到“数据采集计划”页面停止采集");
    err.status = 409;
    err.data = { ok: false, running: true };
    throw err;
  }
  return { ok: true, running: false };
}

// 



/** 读一次：POST /api/v1/config/get（只读寄存器） */
export async function apiConfigGet(req) {
  return httpJson("/api/v1/config/get", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** 采集计划：GET /api/v1/poll/plan（读取 tasks/config_poll_plan.json） */
export async function apiPollPlanGet() {
  return httpJson("/api/v1/poll/plan", { method: "GET" });
}

/** 采集计划：PUT /api/v1/poll/plan（覆盖写入 plan JSON） */
export async function apiPollPlanPut(planObj) {
  return httpJson("/api/v1/poll/plan", {
    method: "PUT",
    body: JSON.stringify(planObj),
  });
}

/** 计划展示视图：GET /api/v1/meta/plan_view（把 plan “展示化”） */
export async function apiMetaPlanView() {
  return httpJson("/api/v1/meta/plan_view", { method: "GET" });
}

/** 可选：序列清单：GET /api/v1/meta/series（给仪表页用） */
export async function apiMetaSeries() {
  return httpJson("/api/v1/meta/series", { method: "GET" });
}




// ===== 设备定义文件（protocols）管理 =====


/** 列表：GET /api/v1/meta/protocols */
export async function apiProtocolsList() {
  return httpJson("/api/v1/meta/protocols", { method: "GET" });
}

/** 读取：GET /api/v1/meta/protocols/<name> */
export async function apiProtocolGet(name) {
  return httpJson(`/api/v1/meta/protocols/${encodeURIComponent(name)}`, { method: "GET" });
}

/** 上传：POST /api/v1/meta/protocols/upload（multipart/form-data） */
export async function apiProtocolUpload(file) {
  const fd = new FormData();
  fd.append("file", file);

  // 上传不能使用 httpJson（它会加 application/json 的 Content-Type）
  const r = await fetch("/api/v1/meta/protocols/upload", {
    method: "POST",
    body: fd,
    cache: "no-store",
  });

  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!r.ok) {
    const msg = (data && data.error) ? data.error : `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** 删除（用户库）：DELETE /api/v1/meta/protocols/<name> */
export async function apiProtocolDelete(name) {
  return httpJson(`/api/v1/meta/protocols/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}



// 设备定义 关于poll_paln

/** 设备定义文件列表：GET /api/v1/meta/protocols */
export async function apiMetaProtocolsList() {
  return httpJson("/api/v1/meta/protocols", { method: "GET" });
}

/** 读取某个设备定义文件：GET /api/v1/meta/protocols/<name> */
export async function apiMetaProtocolGet(name) {
  return httpJson(`/api/v1/meta/protocols/${encodeURIComponent(name)}`, { method: "GET" });
}




/** 写入：POST /api/v1/config/set（写寄存器） */
export async function apiConfigSet(req) {
  return httpJson("/api/v1/config/set", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// /** poller 状态：GET /api/v1/poller/status */
// export async function apiPollerStatus() {
//   return httpJson("/api/v1/poller/status", { method: "GET" });
// }

// /** poller 启动：POST /api/v1/poller/start */
// export async function apiPollerStart() {
//   return httpJson("/api/v1/poller/start", { method: "POST" });
// }

// /** poller 停止：POST /api/v1/poller/stop */
// export async function apiPollerStop() {
//   return httpJson("/api/v1/poller/stop", { method: "POST" });
// }


// 4.3之前老版本
// /** Poller：GET /api/v1/poller/status */
// export async function apiPollerStatus() {
//   return httpJson("/api/v1/poller/status", { method: "GET" });
// }

// /** Poller：POST /api/v1/poller/start */
// export async function apiPollerStart() {
//   return httpJson("/api/v1/poller/start", { method: "POST" });
// }

// /** Poller：POST /api/v1/poller/stop */
// export async function apiPollerStop() {
//   return httpJson("/api/v1/poller/stop", { method: "POST" });
// }




// 4.2之前老版本
/** poller 状态：GET /api/v1/poller/status */
// export async function apiPollerStatus() {
//   return httpJson("/api/v1/poller/status", { method: "GET" });
// }

// /** poller 启动：POST /api/v1/poller/start */
// export async function apiPollerStart() {
//   return httpJson("/api/v1/poller/start", { method: "POST" });
// }

// /** poller 停止：POST /api/v1/poller/stop */
// export async function apiPollerStop() {
//   return httpJson("/api/v1/poller/stop", { method: "POST" });
// }
