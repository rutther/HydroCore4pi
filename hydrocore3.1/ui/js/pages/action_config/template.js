import { getAcText } from "./text.js?v=system-layout-clean-20260711-2";

function helpBubble(text) {
  return `
    <details class="ac-help">
      <summary title="${text}">?</summary>
      <div class="ac-help-body">${text}</div>
    </details>
  `;
}

export function buildActionConfigTemplate() {
  const tx = getAcText();
  const isZh = document.documentElement.lang !== "en-US";

  const copy = isZh
    ? {
        tabs: {
          profile: "设备预设",
          actuator: "输出设备",
          unit: "动作模板"
        },
        actuator: {
          title: "输出设备",
          new: "新建设备",
          edit: "编辑输出设备",
          intro: "用设备语言描述：它是谁、接在哪个 GPIO、上电后默认是什么状态。",
          base: "基础信息",
          safety: "安全与测试",
          note: "备注",
          name: "设备名称",
          type: "设备类型",
          relay: "继电器（通断型）",
          pwm: "PWM（调速型）",
          pin: "GPIO",
          activeLevel: "触发方式",
          activeLow: "低电平触发",
          activeHigh: "高电平触发",
          safeState: "默认状态",
          safeOff: "上电默认关闭",
          safeOn: "上电默认打开",
          pwmFreq: "PWM 频率（Hz）",
          safeDuty: "默认占空比（%）",
          enabled: "已启用",
          allowReal: "允许人工测试时真实输出",
          fallback: "异常时强制回到安全状态",
          description: "这台设备通常用来做什么",
          save: "保存设备",
          delete: "删除",
          cancel: "取消新建",
          wiringTitle: "接线摘要",
          impactTitle: "影响提醒"
        },
        unit: {
          title: "动作模板",
          new: "新建模板",
          edit: "编辑动作模板",
          intro: "把一次动作定义清楚，之后任务计划只需要调用它，不必重复填写细节。",
          base: "动作内容",
          safety: "执行设置",
          note: "备注",
          name: "模板名称",
          output: "控制哪个设备",
          mode: "怎么动作",
          duration: "持续多久（秒）",
          targetState: "切换成什么状态",
          totalDuration: "总运行时长（秒）",
          cycle: "每轮间隔（秒）",
          onDuration: "每轮打开时长（秒）",
          duty: "PWM 强度（%）",
          enabled: "已启用",
          dryRun: "测试时不控制设备",
          description: "这个模板通常在什么场景下使用",
          relayPulse: "打开一段时间后关闭",
          relayState: "直接打开或关闭",
          relayPattern: "按周期打开 / 关闭",
          pwmRun: "PWM 输出一段时间",
          save: "保存模板",
          run: "执行一次",
          delete: "删除",
          cancel: "取消新建",
          previewTitle: "执行预览",
          usageTitle: "使用情况",
          riskTitle: "提醒"
        },
        advanced: "高级信息"
      }
    : {
        tabs: {
          profile: "Board Presets",
          actuator: "Outputs",
          unit: "Action Templates"
        },
        actuator: {
          title: "Outputs",
          new: "New Output",
          edit: "Edit Output",
          intro: "Describe the real device in plain terms: what it is, which GPIO it uses, and what it should do on startup.",
          base: "Basics",
          safety: "Safety And Test",
          note: "Notes",
          name: "Output Name",
          type: "Output Type",
          relay: "Relay (on/off)",
          pwm: "PWM (variable)",
          pin: "GPIO",
          activeLevel: "Trigger Mode",
          activeLow: "Active low",
          activeHigh: "Active high",
          safeState: "Startup State",
          safeOff: "Start off",
          safeOn: "Start on",
          pwmFreq: "PWM Frequency (Hz)",
          safeDuty: "Default Duty (%)",
          enabled: "Enabled",
          allowReal: "Allow real output during manual tests",
          fallback: "Force back to safe state on failure",
          description: "What this output is usually used for",
          save: "Save Output",
          delete: "Delete",
          cancel: "Cancel Draft",
          wiringTitle: "Wiring Summary",
          impactTitle: "Impact"
        },
        unit: {
          title: "Action Templates",
          new: "New Template",
          edit: "Edit Action Template",
          intro: "Define one reusable action here so plans can call it without repeating the low-level details.",
          base: "Action Setup",
          safety: "Execution Setup",
          note: "Notes",
          name: "Template Name",
          output: "Target Output",
          mode: "Behavior",
          duration: "Duration (s)",
          targetState: "Target State",
          totalDuration: "Total Duration (s)",
          cycle: "Cycle Interval (s)",
          onDuration: "On Time Per Cycle (s)",
          duty: "PWM Power (%)",
          enabled: "Enabled",
          dryRun: "Test without driving hardware",
          description: "Where this template is typically used",
          relayPulse: "Turn on, then auto-off",
          relayState: "Switch directly on or off",
          relayPattern: "Repeat on / off by cycle",
          pwmRun: "Run PWM for a period",
          save: "Save Template",
          run: "Run Once",
          delete: "Delete",
          cancel: "Cancel Draft",
          previewTitle: "Execution Preview",
          usageTitle: "Used By",
          riskTitle: "Notes"
        },
        advanced: "Advanced Info"
      };

  return `
    <div class="ac-root">
      <div class="ac-subtabs">
        <button class="ac-tab-btn active" data-tab="profile" type="button">${copy.tabs.profile}</button>
        <button class="ac-tab-btn" data-tab="actuator" type="button">${copy.tabs.actuator}</button>
        <button class="ac-tab-btn" data-tab="unit" type="button">${copy.tabs.unit}</button>
      </div>

      <div class="ac-panels">
        <section class="ac-panel active" data-tab-panel="profile">
          <div class="card">
            <div class="row ac-toolbar">
              <div class="pill">${tx.profile.type}</div>
              <select id="acProfileType" class="input ac-select"></select>
              <div class="pill">${tx.profile.version}</div>
              <select id="acProfileVersion" class="input ac-select"></select>
              <button class="btn btn-pill" type="button" id="btnAcImport">${tx.profile.import}</button>
              <input id="acProfileFileInput" type="file" accept=".json,application/json" style="display:none;" />
              <button class="btn btn-pill" type="button" id="btnAcConfirm">${tx.profile.confirm}</button>
              <div class="mini" id="acProfileStatus" style="min-height:18px;flex:1;margin:0;"></div>
            </div>
          </div>

          <div class="grid2 ac-grid">
            <div class="card">
              <h3>${tx.profile.selected}</h3>
              <div id="acProfileSummary" class="ac-summary-box">${tx.profile.empty}</div>
              <div class="divider" aria-hidden="true" style="margin:10px 0;"></div>
              <div class="mini" style="opacity:0.9;">${tx.profile.current}</div>
              <div id="acCurrentProfileBox" class="ac-current-box">${tx.profile.notConfirmed}</div>
            </div>
            <details class="card ac-advanced-details">
              <summary>${tx.profile.json}</summary>
              <pre id="acProfileJson" class="ac-json-box">${tx.profile.empty}</pre>
            </details>
          </div>
        </section>

        <section class="ac-panel" data-tab-panel="actuator">
          <div class="ac-workbench">
            <div class="card ac-list-card">
              <div class="row ac-toolbar">
                <h3 style="margin-right:auto;">${copy.actuator.title}</h3>
                <button class="btn btn-pill" type="button" id="btnAcActuatorRefresh">${tx.actuator.refresh}</button>
                <button class="btn btn-pill" type="button" id="btnAcActuatorNew">${copy.actuator.new}</button>
              </div>
              <div id="acActuatorList" class="ac-list"></div>
            </div>

            <div class="card ac-editor-card">
              <div class="ac-editor-head">
                <div>
                  <h3>${copy.actuator.edit}</h3>
                  <div class="ac-inline-note">${copy.actuator.intro}</div>
                </div>
              </div>

              <section class="ac-form-block">
                <div class="ac-section-head">
                  <strong>${copy.actuator.base}</strong>
                  ${helpBubble(isZh ? "先定义这台设备是谁、接在哪个 GPIO，以及上电默认状态。" : "Define the device identity, GPIO mapping, and startup behavior.")}
                </div>
                <div class="ac-field-grid">
                  <label>${copy.actuator.name}<input id="acActuatorName" class="input" /></label>
                  <label>${copy.actuator.type}
                    <select id="acActuatorType" class="input">
                      <option value="relay">${copy.actuator.relay}</option>
                      <option value="pwm">${copy.actuator.pwm}</option>
                    </select>
                  </label>
                  <label>${copy.actuator.pin}<input id="acActuatorPin" class="input" type="number" min="0" max="40" /></label>
                  <label data-kind="relay">${copy.actuator.activeLevel}
                    <select id="acActuatorActiveLevel" class="input">
                      <option value="low">${copy.actuator.activeLow}</option>
                      <option value="high">${copy.actuator.activeHigh}</option>
                    </select>
                  </label>
                  <label data-kind="relay">${copy.actuator.safeState}
                    <select id="acActuatorSafeState" class="input">
                      <option value="off">${copy.actuator.safeOff}</option>
                      <option value="on">${copy.actuator.safeOn}</option>
                    </select>
                  </label>
                  <label data-kind="pwm">${copy.actuator.pwmFreq}
                    <input id="acActuatorPwmFrequency" class="input" type="number" min="1" max="50000" />
                  </label>
                  <label data-kind="pwm">${copy.actuator.safeDuty}
                    <input id="acActuatorSafeDuty" class="input" type="number" min="0" max="100" />
                  </label>
                </div>
              </section>

              <section class="ac-form-block">
                <div class="ac-section-head">
                  <strong>${copy.actuator.safety}</strong>
                  ${helpBubble(isZh ? "停用后，动作模板和任务计划都不能使用这个设备。" : "When disabled, action templates and plans cannot use this device.")}
                </div>
                <div class="ac-toggle-stack">
                  <label class="ac-toggle-row"><span>${copy.actuator.enabled}</span><input id="acActuatorEnabled" type="checkbox" /></label>
                  <label class="ac-toggle-row" data-kind="relay"><span>${copy.actuator.fallback}</span><input id="acActuatorForceSafe" type="checkbox" checked disabled /></label>
                </div>
                <div id="acActuatorTypeHint" class="ac-inline-note"></div>
              </section>

              <section class="ac-form-block">
                <div class="ac-section-head">
                  <strong>${copy.actuator.note}</strong>
                </div>
                <label class="ac-wide">${copy.actuator.description}<textarea id="acActuatorDesc" class="input ac-textarea"></textarea></label>
              </section>

              <details class="ac-advanced-details">
                <summary>${copy.advanced}</summary>
                <div class="ac-field-grid" style="margin-top:12px;">
                  <label>${tx.actuator.fields.id}<input id="acActuatorId" class="input" /></label>
                </div>
              </details>

              <div class="row ac-toolbar">
                <button class="btn btn-pill" type="button" id="btnAcActuatorSave">${copy.actuator.save}</button>
                <button class="btn btn-pill" type="button" id="btnAcActuatorDelete">${copy.actuator.delete}</button>
                <button class="btn btn-pill" type="button" id="btnAcActuatorCancel">${copy.actuator.cancel}</button>
              </div>
              <div class="ac-status-line"><span id="acActuatorStatus" class="mini"></span></div>
            </div>

            <aside class="ac-side-panel">
              <div class="card ac-side-section">
                <h4>${copy.actuator.wiringTitle}</h4>
                <div id="acActuatorSummary" class="ac-side-copy"></div>
                <div id="acActuatorWiring" class="ac-side-copy"></div>
              </div>
              <div class="card ac-side-section">
                <h4>${copy.actuator.impactTitle}</h4>
                <div id="acActuatorImpact" class="ac-side-copy"></div>
              </div>
            </aside>
          </div>
        </section>

        <section class="ac-panel" data-tab-panel="unit">
          <div class="ac-workbench">
            <div class="card ac-list-card">
              <div class="row ac-toolbar">
                <h3 style="margin-right:auto;">${copy.unit.title}</h3>
                <button class="btn btn-pill" type="button" id="btnAcUnitRefresh">${tx.unit.refresh}</button>
                <button class="btn btn-pill" type="button" id="btnAcUnitNew">${copy.unit.new}</button>
              </div>
              <div id="acUnitList" class="ac-list"></div>
            </div>

            <div class="card ac-editor-card">
              <div class="ac-editor-head">
                <div>
                  <h3>${copy.unit.edit}</h3>
                  <div class="ac-inline-note">${copy.unit.intro}</div>
                </div>
              </div>

              <section class="ac-form-block">
                <div class="ac-section-head">
                  <strong>${copy.unit.base}</strong>
                  ${helpBubble(isZh ? "这里决定一条动作模板具体怎么执行。任务计划只会调用这里定义好的模板。" : "This defines how a reusable action actually runs. Plans will call this template later.")}
                </div>
                <div class="ac-field-grid">
                  <label>${copy.unit.name}<input id="acUnitName" class="input" /></label>
                  <label>${copy.unit.output}
                    <select id="acUnitOutputId" class="input"></select>
                  </label>
                  <label>${copy.unit.mode}
                    <select id="acUnitMode" class="input">
                      <option value="relay_pulse">${copy.unit.relayPulse}</option>
                      <option value="relay_state">${copy.unit.relayState}</option>
                      <option value="relay_pattern">${copy.unit.relayPattern}</option>
                      <option value="pwm_run">${copy.unit.pwmRun}</option>
                    </select>
                  </label>
                  <div id="acUnitModeHint" class="ac-inline-note ac-wide"></div>
                  <label data-mode="relay_pulse">${copy.unit.duration}
                    <input id="acUnitDurationMs" class="input" type="number" min="0.1" max="3600" step="0.1" />
                  </label>
                  <label data-mode="relay_state">${copy.unit.targetState}
                    <select id="acUnitCommand" class="input">
                      <option value="on">${tx.unit.stateOn}</option>
                      <option value="off">${tx.unit.stateOff}</option>
                    </select>
                  </label>
                  <label data-mode="relay_pattern">${copy.unit.totalDuration}
                    <input id="acUnitPatternTotalMs" class="input" type="number" min="1" max="43200" step="1" />
                  </label>
                  <label data-mode="relay_pattern">${copy.unit.cycle}
                    <input id="acUnitPatternCycleMs" class="input" type="number" min="1" max="3600" step="1" />
                  </label>
                  <label data-mode="relay_pattern">${copy.unit.onDuration}
                    <input id="acUnitPatternOnMs" class="input" type="number" min="0.1" max="3600" step="0.1" />
                  </label>
                  <label data-mode="pwm_run">${copy.unit.duty}
                    <input id="acUnitDutyPercent" class="input" type="number" min="0" max="100" />
                  </label>
                  <label data-mode="pwm_run">${copy.unit.duration}
                    <input id="acUnitPwmDurationMs" class="input" type="number" min="0.1" max="3600" step="0.1" />
                  </label>
                </div>
              </section>

              <section class="ac-form-block">
                <div class="ac-section-head">
                  <strong>${copy.unit.safety}</strong>
                  ${helpBubble(isZh ? "停用后，这个动作模板不能执行，也不能被任务计划调用。" : "When disabled, this action cannot run or be called by a plan.")}
                </div>
                <div class="ac-toggle-stack">
                  <label class="ac-toggle-row"><span>${copy.unit.enabled}</span><input id="acUnitEnabled" type="checkbox" /></label>
                </div>
              </section>

              <section class="ac-form-block">
                <div class="ac-section-head">
                  <strong>${copy.unit.note}</strong>
                </div>
                <label class="ac-wide">${copy.unit.description}<textarea id="acUnitDesc" class="input ac-textarea"></textarea></label>
              </section>

              <details class="ac-advanced-details">
                <summary>${copy.advanced}</summary>
                <div class="ac-field-grid" style="margin-top:12px;">
                  <label>${tx.unit.fields.id}<input id="acUnitId" class="input" /></label>
                </div>
              </details>

              <div class="row ac-toolbar">
                <button class="btn btn-pill" type="button" id="btnAcUnitSave">${copy.unit.save}</button>
                <button class="btn btn-pill" type="button" id="btnAcUnitExecute">${copy.unit.run}</button>
                <button class="btn btn-pill" type="button" id="btnAcUnitDelete">${copy.unit.delete}</button>
                <button class="btn btn-pill" type="button" id="btnAcUnitCancel">${copy.unit.cancel}</button>
              </div>
              <div class="ac-status-line"><span id="acUnitStatus" class="mini"></span></div>
            </div>

            <aside class="ac-side-panel">
              <div class="card ac-side-section">
                <h4>${copy.unit.previewTitle}</h4>
                <div id="acUnitSummary" class="ac-side-copy"></div>
                <div id="acUnitExecutionPreview" class="ac-side-copy"></div>
              </div>
              <div class="card ac-side-section">
                <h4>${copy.unit.usageTitle}</h4>
                <div id="acUnitUsage" class="ac-side-copy"></div>
              </div>
              <div class="card ac-side-section">
                <h4>${copy.unit.riskTitle}</h4>
                <div id="acUnitNote" class="ac-side-copy"></div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  `;
}
