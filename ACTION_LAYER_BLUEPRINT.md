# HydroCore 3.1 动作层实施蓝图

## 1. 统一名词

为了避免后端、前端、文档三边各说各话，这里把名词固定下来。

### 1.1 输出设备

旧名可兼容：

- 动作器
- actuator

正式含义：

> 一个真实接线到 GPIO 或 PWM 的输出对象。

例子：

- 加药泵 A
- 加药泵 B
- 排水阀
- PWM 通道 1

### 1.2 动作单元

旧名可兼容：

- action unit

正式含义：

> 一个启动后会自行执行完毕的原子动作。

例子：

- 加药泵 A 运行 3 秒
- 排水阀打开
- PWM 通道 1 以 30% 占空比运行 10 秒
- 循环脉冲 10 分钟

### 1.3 任务

正式含义：

> 一个可被手动、规则或定时计划调用的执行对象。

任务有两类：

- 单动作任务：调用一个动作单元
- 顺序任务：顺序调用多个动作单元，中间可等待

### 1.4 触发规则

正式含义：

> 当采集数据满足某种条件时，触发一个任务。

### 1.5 定时计划

正式含义：

> 当时间到达某个点或某个周期时，触发一个任务。

### 1.6 执行日志

正式含义：

> 记录一次任务或动作执行的来源、结果、原因和快照。

## 2. 必须遵守的边界

### 2.1 输出设备只管硬件属性

允许：

- GPIO / PWM 号
- 激活电平
- 安全态
- 是否启用
- 是否允许真实输出

禁止：

- 触发条件
- 定时周期
- 复杂流程

### 2.2 动作单元只管执行过程

允许：

- 开/关
- 持续时长
- PWM 占空比
- 有界脉冲模式

禁止：

- 传感器阈值判断
- cron
- 最近 N 分钟数据统计判断
- 无限循环

### 2.3 任务只管调用和编排

允许：

- 调用单个动作单元
- 顺序调用多个动作单元
- 等待
- 冷却时间

禁止：

- 直接写 GPIO 波形细节
- 直接读传感器

### 2.4 触发规则和定时计划只管“何时调任务”

允许：

- 阈值
- 持续时间
- 冷却时间
- 每日 / 间隔 / 一次性计划

禁止：

- 内联 GPIO 细节
- 内联动作波形

## 3. 数据模型

## 3.1 输出设备

```json
{
  "id": "dose_pump_a",
  "name": "加药泵 A",
  "kind": "relay",
  "gpio_pin": 17,
  "active_level": "low",
  "safe_state": "off",
  "enabled": true,
  "allow_real_output": false,
  "description": ""
}
```

### 3.2 动作单元

#### relay pulse

```json
{
  "id": "dose_a_3s",
  "name": "加药泵 A 运行 3 秒",
  "enabled": true,
  "output_id": "dose_pump_a",
  "mode": "relay_pulse",
  "params": {
    "duration_ms": 3000
  },
  "description": ""
}
```

#### relay state

```json
{
  "id": "drain_valve_open",
  "name": "排水阀打开",
  "enabled": true,
  "output_id": "drain_valve",
  "mode": "relay_state",
  "params": {
    "command": "on"
  },
  "description": ""
}
```

#### relay pattern

```json
{
  "id": "pulse_10m_30s_each_min",
  "name": "10 分钟脉冲运行",
  "enabled": true,
  "output_id": "dose_pump_a",
  "mode": "relay_pattern",
  "params": {
    "total_duration_ms": 600000,
    "cycle_ms": 60000,
    "on_duration_ms": 30000
  },
  "description": ""
}
```

#### pwm run

```json
{
  "id": "pwm_30pct_10s",
  "name": "PWM 30% 运行 10 秒",
  "enabled": true,
  "output_id": "aux_pwm_1",
  "mode": "pwm_run",
  "params": {
    "duty_percent": 30,
    "duration_ms": 10000
  },
  "description": ""
}
```

### 3.3 任务

#### 单动作任务

```json
{
  "id": "task_dose_a_3s",
  "name": "加药泵 A 校正一次",
  "enabled": true,
  "task_type": "single_action",
  "cooldown_sec": 30,
  "steps": [
    {
      "step_type": "run_action_unit",
      "action_unit_id": "dose_a_3s"
    }
  ],
  "description": ""
}
```

#### 顺序任务

```json
{
  "id": "task_drain_20s",
  "name": "排水 20 秒",
  "enabled": true,
  "task_type": "sequence",
  "cooldown_sec": 60,
  "steps": [
    {
      "step_type": "run_action_unit",
      "action_unit_id": "drain_valve_open"
    },
    {
      "step_type": "wait",
      "duration_ms": 20000
    },
    {
      "step_type": "run_action_unit",
      "action_unit_id": "drain_valve_close"
    }
  ],
  "description": ""
}
```

### 3.4 触发规则

```json
{
  "id": "rule_ph_high_dose_a",
  "name": "pH 高时执行 A 泵校正",
  "enabled": false,
  "metric_key": "ph",
  "operator": ">",
  "threshold": 6.8,
  "sustain_sec": 30,
  "task_id": "task_dose_a_3s",
  "cooldown_sec": 600,
  "max_runs_per_hour": 4,
  "requires_fresh_data": true,
  "description": ""
}
```

### 3.5 定时计划

```json
{
  "id": "schedule_daily_drain_noon",
  "name": "每天中午排水 20 秒",
  "enabled": false,
  "schedule_type": "daily",
  "task_id": "task_drain_20s",
  "time_of_day": "12:00",
  "cooldown_sec": 600,
  "skip_if_task_running": true,
  "description": ""
}
```

## 4. 首版前端导航

动作层页内建议固定为 6 个标签：

1. `总览`
2. `输出设备`
3. `动作单元`
4. `任务管理`
5. `自动规则`
6. `执行日志`

定时计划可以并入 `任务管理` 的二级区域，也可以作为第 7 个标签；第一版建议并入任务管理，降低导航复杂度。

## 5. 每个页面必须服务什么操作

### 5.1 总览

用户进入就能看到：

- 真实 GPIO 驱动是否存在
- 当前是否全局 dry-run
- 输出设备数量
- 动作单元数量
- 任务数量
- 启用规则数量
- 最近执行记录

### 5.2 输出设备

安装者必须能完成：

- 建立输出设备
- 设 GPIO 号
- 设激活电平
- 设安全态
- 做安全测试

### 5.3 动作单元

运营者必须能完成：

- 给某输出定义“运行 3 秒”
- 给某输出定义“打开/关闭”
- 给某输出定义“脉冲模式”
- 立即 dry-run 执行
- 真实执行前确认

### 5.4 任务管理

用户必须能完成：

- 把一个动作单元包装成任务
- 把多个动作单元串成任务
- 配置每日/间隔计划

### 5.5 自动规则

用户必须能用一句话配置：

`当 [指标] [比较符] [阈值] 且持续 [N 秒] 时，执行 [任务]，冷却 [N 分钟]`

### 5.6 执行日志

维护者必须能看出：

- 谁触发的
- 执行了哪个动作/任务
- 成功还是失败
- 失败原因

## 6. 开发顺序

### 阶段 A

- 输出设备
- 动作单元 typed form
- 执行器重构

### 阶段 B

- 任务 CRUD
- 任务执行
- 日志补充 task 维度

### 阶段 C

- 规则 CRUD
- 计划 CRUD
- 调度器骨架

### 阶段 D

- 总览页
- 状态高亮
- 引用完整性校验

## 7. 第一版必须接受的约束

为了避免再一次长成过度抽象系统，第一版明确不做：

- 脚本语言
- cron 表达式
- 多条件 AND/OR
- 动作单元内读传感器
- 并行步骤
- 无限循环动作

## 8. 成功标准

第一版完成后，应满足这几个问题都能回答“是”：

1. 用户能不用接触 JSON 完成一条继电器动作配置吗？
2. 用户能看懂“动作单元”和“任务”的区别吗？
3. 用户能定义一个“排水 20 秒，每天 12 点执行”的完整链路吗？
4. 用户能看日志知道这次动作是手动、规则还是定时触发的吗？
5. 默认状态下，系统是否仍然安全，不会误拉 GPIO？
