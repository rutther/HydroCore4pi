const TEXT = {
  "zh-CN": {
    tabs: {
      profile: "设备预设",
      actuator: "输出设备",
      unit: "动作单元"
    },
    profile: {
      title: "设备预设",
      type: "控制板",
      version: "预设文件",
      import: "导入预设文件",
      confirm: "应用此预设",
      selected: "当前选中预设",
      current: "当前已确认预设",
      json: "高级信息",
      empty: "（未选择）",
      notConfirmed: "（尚未确认）",
      loaded: (count) => `已加载 ${count} 个控制板配置`,
      fields: {
        name: "名称",
        description: "说明",
        switchPins: "可用于继电器的 GPIO",
        pwmPins: "可用于 PWM 的 GPIO",
        pwmRange: "PWM 频率范围",
        pwmDefault: "默认 PWM 频率",
        openLevel: "默认继电器触发方式",
        file: "配置来源",
        type: "控制板",
        version: "预设文件"
      },
      levelMap: {
        low: "低电平时打开",
        high: "高电平时打开"
      }
    },
    overview: {
      title: "动作层总览",
      refresh: "刷新",
      runtime: "自动运行",
      start: "启动线程",
      stop: "停止线程",
      enable: "启用自动控制",
      dryRun: "仅模拟运行",
      allowReal: "允许真实输出",
      tickSec: "轮询间隔（秒）",
      freshSec: "数据新鲜窗口（秒）",
      save: "保存自动控制设置",
      noData: "暂无数据",
      noLogs: "暂无执行记录",
      needsAttention: "需要关注",
      healthy: "状态正常",
      cards: {
        driver: "GPIO 驱动",
        thread: "自动线程",
        hardware: "硬件总闸",
        outputs: "输出设备",
        units: "动作单元",
        tasks: "任务",
        rules: "规则",
        schedules: "计划"
      },
      values: {
        notDetected: "未检测到",
        running: "运行中",
        stopped: "已停止",
        armed: "已解锁",
        safeLock: "安全锁定",
        threadRunning: "线程运行中",
        threadStopped: "线程已停止",
        automationOn: "自动控制开启",
        automationOff: "自动控制关闭",
        hardwareArmed: "允许真实输出",
        hardwareSafe: "硬件安全锁定",
        lastTick: "最近轮询",
        error: "错误"
      }
    },
    actuator: {
      title: "输出设备",
      refresh: "刷新",
      new: "新建",
      edit: "编辑输出设备",
      save: "保存输出设备",
      delete: "删除",
      fields: {
        id: "内部编号",
        name: "名称",
        type: "类型",
        pin: "GPIO 引脚",
        activeLevel: "通电方式",
        safeState: "上电默认状态",
        pwmFreq: "PWM 频率",
        safeDuty: "默认占空比（%）",
        enabled: "启用",
        allowReal: "允许实际控制这个设备",
        description: "说明"
      },
      relay: "继电器",
      pwm: "PWM",
      activeLow: "低电平时打开",
      activeHigh: "高电平时打开",
      safeOff: "上电关闭",
      safeOn: "上电打开"
    },
    unit: {
      title: "动作单元",
      refresh: "刷新",
      new: "新建",
      edit: "编辑动作单元",
      save: "保存动作单元",
      run: "立即执行",
      delete: "删除",
      summaryPlaceholder: "这里会显示这条动作的大意。",
      fields: {
        id: "内部编号",
        name: "名称",
        output: "控制哪个设备",
        mode: "怎么控制",
        duration: "持续多久（秒）",
        targetState: "切换成什么状态",
        totalDuration: "总运行时长（秒）",
        cycle: "每轮间隔（秒）",
        onDuration: "每轮打开时长（秒）",
        duty: "PWM 强度（%）",
        enabled: "启用",
        dryRun: "测试时不控制设备",
        description: "说明"
      },
      modes: {
        relayPulse: "打开一段时间后关闭",
        relayState: "直接打开或关闭",
        relayPattern: "按周期打开/关闭",
        pwmRun: "PWM 输出一段时间"
      },
      hints: {
        relayPulse: "把设备打开一段时间，到点自动关闭。适合单次加药、排水这类动作。",
        relayState: "直接切换到打开或关闭，直到后续动作再次改变它。",
        relayPattern: "按照固定节奏反复开关，直到总运行时长结束。",
        pwmRun: "按设定强度运行一段时间，适合需要连续调速的输出。"
      },
      stateOn: "开启",
      stateOff: "关闭"
    },
    common: {
      confirmRealOutput: "这会真实控制继电器/PWM，确认继续？",
      imported: "导入成功",
      confirmed: "当前控制板配置已确认",
      choosePreset: "请先选择一个控制板配置",
      ready: "等待操作",
      refreshed: "列表已刷新",
      creating: "已切换到新建草稿",
      saved: "已保存",
      deleted: "已删除",
      runningDry: "正在演练，不会控制设备...",
      runningLive: "正在控制设备...",
      confirmDelete: "确认删除",
      logId: "日志",
      advanced: "高级信息"
    }
  },
  "en-US": {
    tabs: {
      profile: "Board Presets",
      actuator: "Outputs",
      unit: "Action Units"
    },
    profile: {
      title: "Board Presets",
      type: "Controller",
      version: "Preset File",
      import: "Import Preset File",
      confirm: "Apply Preset",
      selected: "Selected Preset",
      current: "Current Confirmed Preset",
      json: "Advanced Info",
      empty: "(nothing selected)",
      notConfirmed: "(not confirmed yet)",
      loaded: (count) => `Loaded ${count} board presets`,
      fields: {
        name: "Name",
        description: "Description",
        switchPins: "GPIO usable for relays",
        pwmPins: "GPIO usable for PWM",
        pwmRange: "PWM Frequency Range",
        pwmDefault: "Default PWM Frequency",
        openLevel: "Default Relay Trigger",
        file: "Preset Source",
        type: "Controller",
        version: "Preset File"
      },
      levelMap: {
        low: "On when low",
        high: "On when high"
      }
    },
    overview: {
      title: "Action Layer Overview",
      refresh: "Refresh",
      runtime: "Automation Runtime",
      start: "Start Thread",
      stop: "Stop Thread",
      enable: "Enable automation",
      dryRun: "Simulation only",
      allowReal: "Allow real hardware output",
      tickSec: "Tick interval (s)",
      freshSec: "Fresh-data window (s)",
      save: "Save Automation Settings",
      noData: "No data",
      noLogs: "No execution logs",
      needsAttention: "Needs attention",
      healthy: "Healthy",
      cards: {
        driver: "GPIO Driver",
        thread: "Automation Thread",
        hardware: "Hardware Arm",
        outputs: "Outputs",
        units: "Action Units",
        tasks: "Tasks",
        rules: "Rules",
        schedules: "Schedules"
      },
      values: {
        notDetected: "Not detected",
        running: "Running",
        stopped: "Stopped",
        armed: "Armed",
        safeLock: "Safe lock",
        threadRunning: "Thread running",
        threadStopped: "Thread stopped",
        automationOn: "Automation on",
        automationOff: "Automation off",
        hardwareArmed: "Real output allowed",
        hardwareSafe: "Hardware safe-locked",
        lastTick: "Last tick",
        error: "Error"
      }
    },
    actuator: {
      title: "Outputs",
      refresh: "Refresh",
      new: "New",
      edit: "Edit Output",
      save: "Save Output",
      delete: "Delete",
      fields: {
        id: "ID",
        name: "Name",
        type: "Type",
        pin: "GPIO Pin",
        activeLevel: "Output On Level",
        safeState: "Startup Default",
        pwmFreq: "PWM Frequency",
        safeDuty: "Default Duty (%)",
        enabled: "Enabled",
        allowReal: "Allow real control of this device",
        description: "Description"
      },
      relay: "Relay",
      pwm: "PWM",
      activeLow: "On when low",
      activeHigh: "On when high",
      safeOff: "Off on startup",
      safeOn: "On on startup"
    },
    unit: {
      title: "Action Units",
      refresh: "Refresh",
      new: "New",
      edit: "Edit Action Unit",
      save: "Save Action Unit",
      run: "Run Now",
      delete: "Delete",
      summaryPlaceholder: "A plain-language summary of this action appears here.",
      fields: {
        id: "Internal ID",
        name: "Name",
        output: "Device to Control",
        mode: "Control Method",
        duration: "Duration (s)",
        targetState: "Switch To",
        totalDuration: "Total Run Time (s)",
        cycle: "Cycle Interval (s)",
        onDuration: "On Time Per Cycle (s)",
        duty: "PWM Power (%)",
        enabled: "Enabled",
        dryRun: "Test without controlling hardware",
        description: "Description"
      },
      modes: {
        relayPulse: "Turn on for a period, then off",
        relayState: "Switch directly on or off",
        relayPattern: "Repeat on/off in a cycle",
        pwmRun: "Run PWM for a period"
      },
      hints: {
        relayPulse: "Turn the device on for a fixed time, then stop automatically. Good for dosing or draining.",
        relayState: "Switch directly to on or off and keep that state until another action changes it.",
        relayPattern: "Repeat on and off at a fixed rhythm until the total run time ends.",
        pwmRun: "Run the output at a chosen PWM power for a fixed amount of time."
      },
      stateOn: "On",
      stateOff: "Off"
    },
    common: {
      confirmRealOutput: "This will control the relay/PWM hardware. Continue?",
      imported: "Import completed",
      confirmed: "Current board preset confirmed",
      choosePreset: "Choose a board preset first",
      ready: "Waiting",
      refreshed: "List refreshed",
      creating: "Switched to a new draft",
      saved: "Saved",
      deleted: "Deleted",
      runningDry: "Practicing only; hardware will not be controlled...",
      runningLive: "Controlling hardware...",
      confirmDelete: "Delete",
      logId: "Log",
      advanced: "Advanced Info"
    }
  }
};

export function getAcText() {
  const lang = document.documentElement.lang === "en-US" ? "en-US" : "zh-CN";
  return TEXT[lang];
}
