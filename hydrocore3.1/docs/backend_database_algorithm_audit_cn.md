# 后端、数据库与控制算法审计报告

日期：2026-07-06

范围：`hydrocore3.1` 后端代码、现场树莓派 SQLite 数据库、采集链路、数据查询链路、任务计划与动作执行链路。

## 一句话结论

这套后端不是乱写的，核心骨架是能工作的：采集、存储、查询、动作、计划已经分层，SQLite 也有关键复合索引。但它现在还处在“能跑的工程原型”阶段，距离工业边缘控制设备的长期稳定运行还差几个关键补丁：

- 数据查询应该从“前端拉曲线再自己算状态”，改成“后端提供轻量状态接口”。
- 状态接口必须按已知参数走索引点查，不能全表分组。
- 动作层的 GPIO 驱动保持逻辑需要硬件级验证，PWM/继电器运行时长存在代码层风险。
- 规则/计划配置必须和采集计划强校验，否则会出现规则指向不存在地址、永远不触发的情况。
- JSON 配置写入、SQLite 并发、生产模式、安全开关还需要工业化加固。

## 1. 当前后端机制

### 1.1 采集链路

代码入口：

- `backend/app.py` 启动 Flask，并通过 `DataCollectorThread` 管理采集线程。
- `backend/tasks/config_poller.py` 读取 `tasks/config_poll_plan.json`。
- `backend/services/config_get_service.py` 通过 Modbus RTU 读取设备寄存器。
- 采集结果写入 SQLite 的 `sensor_data`，并增量更新 `sensor_series_summary`。

当前机制：

- 采样间隔默认 `3s`。
- 落库间隔默认 `10s`。
- 普通连续量在内存窗口内聚合后落库，默认 `avg`。
- 状态/事件量可以用 `agg_mode=last` 和 `event_only` 降低写入量。
- 串口有端口锁，采集线程运行时禁止扫描、读配置、写配置抢串口。

评价：

- 采样和落库分离是对的，不是每个瞬时值都直接写库，这对树莓派和 SD 卡比较友好。
- `sensor_series_summary` 是正确方向，它避免每次打开页面都从 `sensor_data` 聚合全库。
- 但采集读取仍然是逐参数 Modbus 读取，寄存器相邻时没有合并读，串口利用率偏低。

### 1.2 数据存储

核心表：

- `sensor_data(id, ts, protocol, address, parameter, value, raw_hex)`
- `sensor_series_summary(protocol, address, parameter, first_ts, last_ts, n)`
- `action_log(...)`

关键索引：

- `sensor_data(protocol, address, parameter, ts)`
- `sensor_data(ts)`
- `sensor_series_summary` 主键为 `(protocol, address, parameter)`

现场树莓派实测：

| 项目 | 数值 |
|---|---:|
| 数据库文件 | `/home/rp41/app/hydrocore3.1/data/db/hydro.db` |
| 文件大小 | 482 MB |
| `sensor_data` 行数 | 约 1,505,262 |
| `sensor_series_summary` 参数数 | 12 |
| `action_log` 行数 | 13 |
| SQLite journal_mode | `delete` |
| SQLite cache_size | 约 2 MB |

现场数据库存在重复复合索引：

- `idx_series_ts`
- `ix_sensor_data_papt`
- `ix_sensor_data_series_ts`

三者语义上都覆盖 `(protocol,address,parameter,ts)`。这不会导致查询错，但会增加写入维护成本、磁盘占用和迁移复杂度。

### 1.3 数据查询链路

代码入口：

- `backend/api/data_api.py`
- `backend/api/meta_api.py`

现有接口：

- `/api/v1/meta/series`：读取 `sensor_series_summary`，返回每个序列的起止时间和数量。
- `/api/v1/meta/plan_view`：读取采集计划和协议定义，返回前端可用的参数元数据。
- `/api/v1/data/series`：按一个或多个 `s=protocol:address:parameter` 查询曲线，支持 raw 和分桶。

现场性能实测：

| 查询 | 现场耗时 |
|---|---:|
| `/api/v1/meta/plan_view` | 约 22 ms |
| `/api/v1/meta/series` | 约 164 ms |
| 3 个序列、10 分钟桶、两天窗口 | 约 353 ms |
| 12 个序列、10 分钟桶、两天窗口 | 约 1157-1315 ms |
| 12 个参数分别走索引查最新值 | 约 4.7 ms |
| 12 个参数查最新值 + 24h 起点值 | 约 6.1 ms |
| 12 个参数做 24h avg/min/max | 约 254 ms |
| 用窗口函数全表取每组最新值 | 约 34 秒 |

结论：

- 当前曲线查询有索引，短窗口能用。
- 但把仪表盘当前状态建立在曲线接口上，性能不理想。
- 后端聚合接口不是不能做，反而应该做；但必须按“当前采集计划中的已知参数”逐个走索引查询，不能写成全表窗口函数或全表 group by。

### 1.4 任务计划与动作链路

代码入口：

- `backend/services/action_store.py`
- `backend/services/action_scheduler.py`
- `backend/services/action_executor.py`
- `backend/services/gpio_driver.py`

配置存储：

- 输出设备：`data/actuators/*.json`
- 动作单元：`data/action_units/*.json`
- 动作任务：`data/action_tasks/*.json`
- 参数规则：`data/action_rules/*.json`
- 时间计划：`data/action_schedules/*.json`
- 自动控制总状态：`data/automation/runtime.json`

已有安全机制：

- 自动控制默认关闭。
- 默认 dry-run。
- `hardware_armed=false` 时禁止真实 GPIO 输出。
- 每个输出设备有 `allow_real_output`。
- 每个输出有锁，避免同一继电器/PWM 并发控制。
- 每个任务有锁，避免同一任务重复运行。
- 有 `cooldown_sec` 和 `max_runs_per_hour`。
- 所有动作写入 `action_log`。

主要问题：

- 示例规则 `rule_ph_high_dose_a` 指向 `lanchang_ph` 地址 `1`，但当前采集计划里的 pH 地址是 `9`。这类配置错误不会被保存时拦住，会导致规则永远没有数据。
- 规则预览路径和真实自动执行路径不是同一套状态机。真实路径用 `_rule_holds` 追踪持续满足，预览路径更像窗口统计，容易让 UI 表达和真实行为不一致。
- `skip_if_task_running` 被保存进计划，但调度执行路径没有显式使用它，只是依赖任务锁返回 blocked。
- GPIO 真实驱动每次 `set_relay` / `set_pwm` 都创建设备对象、设置状态、立刻 close。对于“运行 3 秒”或“PWM 运行 10 秒”这种动作，代码层面没有持有 GPIO/PWM 对象贯穿整个运行时长，必须硬件验证；更稳妥的实现应在动作持续期间持有设备对象，并在 `finally` 中回到安全状态。

## 2. 主要风险分级

### 高优先级

1. **GPIO/PWM 动作保持语义不可靠**

   `pwm_run` 当前是设置 PWM 后立刻 close，再 sleep，再设置安全占空比。代码结构上看，PWM 未必真的保持运行。继电器 pulse 也有类似疑点。

   影响：真实设备可能没有按设定时长运行，或者行为依赖 gpiozero/底层 pin 状态，工业控制不可接受。

2. **规则数据源没有强校验**

   现有规则能指向采集计划之外的地址和参数。现场已有例子：规则地址 `1`，实际 pH 地址 `9`。

   影响：规则看起来存在，实际永远不触发；或者以后误触发错误设备数据。

3. **Flask 以 debug 模式监听 `0.0.0.0`**

   `backend/app.py` 里 `app.run(host="0.0.0.0", port=5000, debug=True)`。

   影响：工业边缘设备不应在生产环境开放 debug 模式。

4. **配置 JSON 非原子写入**

   动作、计划、采集配置都直接写 JSON 文件。如果断电或进程中断，可能留下半截文件。

   影响：设备重启后配置损坏，自动控制不可预期。

### 中优先级

1. **仪表盘状态查询方式偏重**

   12 个序列查两天 10 分钟桶需要约 1.2 秒。自动刷新时可用，但不理想。

2. **重复索引增加写入成本**

   现场有 3 个等价复合索引。采集不断写库时，每写一行要维护多份近似索引。

3. **规则算法缺少统一解释器**

   规则保存、预览、实际执行、前端文案各自理解参数。长期会出现“页面说能触发，后台不触发”的问题。

4. **采集读寄存器没有合并**

   相邻寄存器仍逐参数读。当前 12 个参数、3 秒采样还勉强能跑；以后传感器增加会逼近串口吞吐上限。

5. **SQLite 并发参数未显式治理**

   当前是 `journal_mode=delete`、默认连接、未设置 `busy_timeout`。读多写多时可能偶发锁等待或失败。

### 低优先级

1. 后端代码中有较多旧版本注释和重复历史函数，维护时容易误读。
2. 部分返回 message 仍是程序员语言，不适合作为最终 UI 文案来源。
3. action/rule 的英文 summary 还存在，但这主要影响前端展示，不影响底层运行。

## 3. 后端改造方案

### 阶段 0：不改变行为的安全加固

目标：先把明显不安全、不一致的地方收住。

建议任务：

1. 关闭生产 debug 模式。
2. JSON 写入改为原子写：
   - 写入 `*.tmp`
   - flush/fsync
   - `os.replace(tmp, target)`
3. 增加配置校验接口：
   - 规则保存时必须校验 `signal_protocol/address/parameter` 存在于当前采集计划或协议定义。
   - 时间计划保存时必须校验 `task_id` 存在。
   - 动作单元保存时必须校验输出类型和 GPIO 唯一性。
4. 清理重复索引：
   - 保留一个 `(protocol,address,parameter,ts)`。
   - 删除现场重复的旧索引前先备份数据库。
5. 给 SQLite 连接统一设置：
   - `PRAGMA busy_timeout=3000`
   - 评估 `journal_mode=WAL`，通过现场读写压测后再启用。

验收标准：

- 配置写入中断不会破坏原配置。
- 保存指向不存在数据源的规则会失败。
- 现场数据库查询计划仍使用复合索引。
- 自动采集运行时页面读数据不出现锁错误。

### 阶段 1：新增轻量仪表盘状态接口

目标：降低前端自动刷新成本，同时让状态语义由后端负责。

新增接口建议：

`GET /api/v1/dashboard/state?window_sec=86400`

返回每个当前采集参数：

- `key`
- `label`
- `unit`
- `value_kind`
- `trend_enabled`
- `delta_mode`
- `latest_ts`
- `latest_value`
- `age_sec`
- `window_first_ts`
- `window_first_value`
- `delta`
- `delta_percent`
- `data_status`

关键算法：

- 从 `meta/plan_view` 得到当前采集点，不扫描全库。
- 对每个采集点用复合索引：
  - 最新值：`ORDER BY ts DESC LIMIT 1`
  - 窗口起点值：`ts >= from ORDER BY ts ASC LIMIT 1`
- 普通状态刷新不要算曲线桶。
- 结果缓存 3-5 秒，避免多个前端页面重复打数据库。

现场依据：

- 12 个参数最新值 + 24h 起点值实测约 6.1 ms。
- 现在前端拉 12 条 10m 桶曲线约 1.2 秒。

这说明轻量状态接口不仅可行，而且应该明显减轻树莓派压力。

### 阶段 2：采集与存储优化

目标：让传感器增加以后仍能跑。

建议任务：

1. Modbus 读取合并：
   - 按设备和协议分组。
   - 对相邻寄存器合并成一次读。
   - 在内存中拆回各参数。
2. 增加 `sensor_latest` 表：
   - 每次落库时同步 upsert 最新值。
   - 仪表盘、规则判断优先读 `sensor_latest`。
3. 增加 `sensor_quality` 或状态字段：
   - 最近读取成功时间。
   - 最近错误。
   - 连续失败次数。
4. 留存策略收紧：
   - 树莓派建议按容量和业务价值设置，比如 180-400 天原始聚合数据。
   - 如果未来采样点增多，增加日/小时 rollup，不要无限保留高频数据。

### 阶段 3：规则与计划引擎重构

目标：把“什么时候执行什么”做成可解释、可验证的控制状态机。

建议模型：

任务计划只保留一个概念：**计划**。

一个计划包含：

- 触发条件：
  - 时间触发
  - 参数触发
  - 时间窗口 + 参数触发
- 执行动作：
  - 引用动作任务
- 保护条件：
  - 最小间隔
  - 每小时最多次数
  - 运行时段
  - 数据新鲜度
  - 输出冲突策略

参数触发应支持：

- 单条件
- 多条件 AND/OR
- 每个条件独立窗口、聚合方式、阈值
- 持续满足时长
- 可选回差/死区，避免阈值附近反复触发

优先级建议：

- 不建议用“上方覆盖下方”作为核心规则，因为工业系统需要可审计。
- 建议显式定义：
  - 禁止类计划优先级最高。
  - 同一输出冲突时，按输出锁和优先级处理。
  - 被抑制的计划必须写日志，说明被谁抑制。

### 阶段 4：动作执行硬化

目标：真实 GPIO 输出必须可证明。

建议任务：

1. 重写 `RealGpioDriver`：
   - 对 pulse/PWM 持有设备对象贯穿运行时长。
   - `finally` 中强制回到安全状态。
2. 执行前做硬件许可检查：
   - 自动控制启用。
   - 硬件已解锁。
   - 输出允许真实控制。
   - 当前输出没有被其他任务占用。
3. 执行中记录状态：
   - running
   - success
   - failed
   - blocked
   - aborted
4. 增加上电安全策略：
   - 服务启动时所有输出置安全态。
   - 服务退出时所有输出置安全态。
   - 异常时写日志并安全释放。

## 4. 建议优先级

第一批马上做：

1. 规则数据源校验。
2. 生产关闭 debug。
3. JSON 原子写。
4. 轻量 dashboard state 接口。
5. GPIO/PWM 持续输出逻辑硬件验证与修正。

第二批再做：

1. 清理重复索引。
2. SQLite busy_timeout / WAL 压测。
3. `sensor_latest` 表。
4. 规则解释器统一。

第三批做增强：

1. Modbus 合并读取。
2. 多条件规则。
3. 计划优先级与抑制日志。
4. 长周期 rollup 表。

## 5. 对“后端性能能不能吃得消”的回答

能吃得消，但前提是按正确算法做。

不能做：

- 每次刷新全表 group by。
- 每次刷新所有曲线桶。
- 为了一个当前值拉 24 小时曲线回前端。

应该做：

- 当前状态：后端按采集计划列出 12 个 key，然后逐个走复合索引查最新值和窗口起点值。
- 曲线：只在用户选中参数时查，而且按合理 bucket 限制点数。
- 规则：实时线程只查自己需要的参数，不扫所有参数。
- 缓存：状态接口 3-5 秒短缓存。

现场数据证明：

- 错误写法：全表窗口函数取各组最新值约 34 秒。
- 正确写法：12 个参数最新值 + 24h 起点值约 6ms。

所以问题不是“后端不能做”，而是“后端必须按数据库索引算法做”。

