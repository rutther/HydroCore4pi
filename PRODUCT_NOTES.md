# HydroCore / IOT 循环水项目理解笔记

记录时间：2026-06-05

远端项目：`rp41@192.168.0.107:/home/rp41/app/hydrocore3.1`

## 一句话理解

这套软硬件的目标不是单纯做一个水质看板，而是一套运行在树莓派上的循环水现场控制系统：

1. 通过 RS485 / Modbus 接入水质传感器。
2. 识别、配置、校准和管理下位机设备。
3. 按计划长期采集水质数据。
4. 把数据落到本地 SQLite。
5. 在浏览器里查看历史曲线和当前指标。
6. 最终根据阈值、计划或组合条件，驱动继电器 / GPIO / PWM 等执行器，实现自动控制。

也就是说，它的产品闭环应是：

环境与硬件接入 -> 设备发现 -> 设备定义 -> 设备配置 -> 采集计划 -> 数据存储 -> 数据展示 -> 规则判断 -> 动作执行 -> 执行记录。

## 演化线索

### 最早的 hydrocore 骨架

`/home/rp41/app/generate_skeleton.sh` 里已经写出原始产品构想：

- `sensors/`: RS485 传感器基类和具体传感器。
- `controllers/relay_controller.py`: 继电器控制封装。
- `storage/`: 数据库模型和连接。
- `services/sensor_manager.py`: 多路轮询管理。
- `services/data_processor.py`: 原始数据校准和单位转换。
- `services/strategy_engine.py`: 阈值与定时策略。
- `api/data_api.py`: 数据查询和导出。
- `api/control_api.py`: 继电器控制与状态接口。
- `web/`: ECharts 前端首页。

这个骨架说明：产品一开始就想做“采集 + 存储 + 图表 + 策略 + 继电器控制”，不是只做数据显示。

### hydrocore2.1 阶段

`/home/rp41/app/hydrocore2.1/readme.md` 记录了现场目标：

- 电导率地址：10
- PH 地址：9

当时的操作重点是：

- 扫描 USB 串口上的设备。
- 根据地址计划修改传感器地址。
- 根据配置计划读取或写入传感器配置。
- 整理蓝畅 PH / EC 的 Modbus 寄存器文档。

这阶段主要是在把硬件接入和 Modbus 协议跑通。

### hydrocore3.1 阶段

`hydrocore3.1` 是目前主项目，已经把 2.1 的脚本能力整合成 Flask API + 浏览器 UI。

当前可运行地址：

`http://192.168.0.107:5000/ui/`

已验证：

- Flask 入口可导入。
- API 路由可用。
- UI 可打开。
- 数据库完整。
- 历史数据回放能出图。
- 动作配置页第一步可用，但动作执行层未完成。

## 当前硬件对象

当前采集计划 `tasks/config_poll_plan.json` 中有 3 类设备：

| 设备 | 协议 | 地址 | 串口 | 参数 |
| --- | --- | --- | --- | --- |
| 电导率 | `lanchang_ec` | 10 | `/dev/ttyACM0` | 电导率、电阻率、温度、TDS、盐度 |
| PH | `lanchang_ph` | 9 | `/dev/ttyACM0` | pH、温度、电流输出、报警 |
| 腐蚀率 | `lanchang_cr_huchen` | 8 | `/dev/ttyACM0` | 腐蚀率、电位、偏移量 |

树莓派当前识别到串口：

- `/dev/ttyACM0`
- USB 设备：QinHeng Electronics USB Single Serial

## 数据库现状

数据库：

`/home/rp41/app/hydrocore3.1/data/db/hydro.db`

表：

- `scan_job`
- `scan_hit`
- `sensor_data`

关键数据：

- `sensor_data` 总数：1,109,554
- 最早时间：`2025-08-29 04:50:52`
- 最新时间：`2026-03-08 20:00:30`

因此 UI 的“最近 24h / 1M”为空是正常的，因为现在是 2026-06-05，数据库里没有最近数据。使用仪表盘“回放”选择 2026-03-08 附近可以看到曲线。

## 端到端操作路径

### 1. 环境与启动

文档 `flow.md` 记录：

```bash
cd /home/rp41/app/hydrocore3.1
source hy3.1/bin/activate
python -m backend.app
```

当前我用临时方式启动了 Flask：

```bash
cd /home/rp41/app/hydrocore3.1
source hy3.1/bin/activate
python -c "from backend.app import app; app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)"
```

服务监听：

- `http://127.0.0.1:5000`
- `http://192.168.0.107:5000`

### 2. 硬件配置 / 设备扫描

前端位置：

`硬件配置 -> 设备扫描`

作用：

- 输入串口、起始地址、结束地址、波特率。
- 调用 `POST /api/v1/scan`。
- 扫描 Modbus 地址是否有响应。
- 扫描结果写入 `scan_job` / `scan_hit`。
- 再通过 `GET /api/v1/scan/<job_id>` 展示结果。

相关代码：

- `backend/services/scan_service.py`
- `backend/app.py`
- `ui/js/pages/hardware/scan.js`

### 3. 硬件配置 / 设备定义库

前端位置：

`硬件配置 -> 设备定义库`

作用：

- 管理传感器协议定义文件。
- 内置协议在 `protocols/*.json`。
- 用户上传协议在 `data/protocols_user/*.json`。
- 用户协议优先覆盖内置协议。

协议文件结构不是数组，而是顶层每个参数一个字段，例如：

```json
{
  "__meta__": { "_float_order": "CDAB" },
  "ec_value": {
    "addr": 0,
    "type": "float",
    "length": 2,
    "access": "read_only",
    "label_zh": "电导率",
    "unit": "mS/cm"
  }
}
```

相关代码：

- `backend/services/protocol_loader.py`
- `backend/api/meta_api.py`
- `ui/js/pages/hardware/sensors.js`

### 4. 硬件配置 / 设备定义

前端位置：

`硬件配置 -> 设备定义`

作用：

- 读取传感器协议定义。
- 对指定地址执行一次性读取。
- 对可写参数执行写入。
- 用于现场验证设备定义和校准参数。

相关 API：

- `POST /api/v1/config/get`
- `POST /api/v1/config/set`

相关代码：

- `backend/services/config_get_service.py`
- `backend/services/config_set_service.py`
- `ui/js/pages/hardware/verify.js`

### 5. 硬件配置 / 数据采集

前端位置：

`硬件配置 -> 数据采集`

作用：

- 管理长期采集线程 poller。
- 查看 poller 运行状态。
- 启动 / 停止采集。
- 编辑全局采集参数。
- 展示当前采集对象概览。

采集计划文件：

`tasks/config_poll_plan.json`

关键概念：

- `default_sampling_sec`: 默认采样周期。
- `default_persist_sec`: 默认落库周期。
- `align_persist_to_wall`: 是否对齐整秒 / 整分钟。
- `round_to`: 落库前保留小数。
- `agg_mode`: 连续量用 `avg`，状态量用 `last`。
- `event_only`: 报警等状态量只在非零或变化时写库。

相关代码：

- `backend/tasks/config_poller.py`
- `backend/app.py`
- `ui/js/pages/hardware/plan.js`

### 6. 数据仪表

前端位置：

`数据仪表`

作用：

- 读取数据库已有序列。
- 左侧展示指标列表。
- 支持最近窗口和历史回放。
- 支持聚合精度：10s / 1m / 10m / 1h / 1d。
- 支持聚合模式：平均 / 最小 / 最大 / 最后。
- 支持 CSV 导出。

注意：

- 仪表盘是通过 iframe 加载 `ui/lab/dashboard.html`。
- 默认最近窗口因为当前数据库没有最近数据，所以值为空。
- 历史回放到 `2026-03-08 18:00` 到 `2026-03-08 20:01` 已验证能出图。

相关代码：

- `backend/api/data_api.py`
- `backend/api/meta_api.py`
- `ui/js/pages/dashboard/dashboard.js`
- `ui/lab/js/dashboard.js`

### 7. 动作配置

前端位置：

`动作配置`

当前已完成：

- 顶层页面已接入导航。
- `设备预设` 标签可用。
- 可读取 / 导入 / 确认当前树莓派控制板配置。
- 当前确认配置是 `raspberrypi_4.json`。

当前控制板能力：

- 开关输出 GPIO：4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 22, 23, 24, 25, 26, 27
- PWM 输出 GPIO：12, 13, 18, 19
- PWM 频率范围：50 到 20000 Hz
- 默认 PWM 频率：1000 Hz
- 默认开关打开电平：low

尚未完成：

- `动作器库`: 空壳，显示“动作器库后续接入”。
- `动作单元库`: 空壳，显示“动作单元库后续接入”。
- `执行日志`: 空壳，显示“执行日志后续接入”。

相关代码：

- `backend/api/action_profile_api.py`
- `data/action_profiles/*.json`
- `ui/js/pages/action_config/*`
- `ui/styles/pages/action_config.css`

## 模块地图

### 后端

| 模块 | 职责 |
| --- | --- |
| `backend/app.py` | Flask 入口，注册蓝图，提供扫描、改址、配置读写、poller 控制、UI 静态文件 |
| `backend/db.py` | SQLite 连接和初始化 |
| `backend/schema.sql` | 表结构 |
| `backend/api/data_api.py` | 时间序列查询和 CSV 导出 |
| `backend/api/meta_api.py` | 采集计划视图、协议文件管理、序列元数据 |
| `backend/api/action_profile_api.py` | 动作控制板配置文件管理 |
| `backend/services/scan_service.py` | Modbus 地址扫描 |
| `backend/services/addr_writer_service.py` | 修改从站地址 |
| `backend/services/config_get_service.py` | 单次读取协议参数 |
| `backend/services/config_set_service.py` | 单次写入协议参数 |
| `backend/services/protocol_loader.py` | 加载内置 / 用户协议 JSON |
| `backend/tasks/config_poller.py` | 长期采集、聚合、落库、热重载计划 |
| `backend/utils/locks.py` | 串口互斥锁 |
| `backend/services/poller_guard.py` | poller 运行时禁止短期串口操作 |

### 前端

| 模块 | 职责 |
| --- | --- |
| `ui/index.html` | 主页面骨架 |
| `ui/js/app.js` | 顶层导航、主题、语言、页面初始化 |
| `ui/js/api.js` | 通用后端 API 调用 |
| `ui/js/pages/hardware/scan.js` | 设备扫描页 |
| `ui/js/pages/hardware/sensors.js` | 设备定义库页 |
| `ui/js/pages/hardware/verify.js` | 设备定义读写验证页 |
| `ui/js/pages/hardware/plan.js` | 数据采集计划和 poller 控制页 |
| `ui/js/pages/dashboard/dashboard.js` | 挂载 lab 仪表盘 iframe |
| `ui/lab/js/dashboard.js` | 数据仪表盘主体 |
| `ui/js/pages/action_config/*` | 动作配置页，当前只完成设备预设 |

## 现在的软件到底想干什么

我的理解：

这是一套“面向循环水系统的树莓派本地边缘控制软件”。

它不是云平台，也不是通用 IoT 平台。它更像现场工程盒子里的本地控制台：

- 工程人员接上传感器。
- 扫描总线，确认哪些地址有设备。
- 导入或选择设备协议。
- 读取设备配置，必要时修改地址、波特率、校准参数。
- 配置长期采集计划。
- 启动采集，让树莓派持续把水质数据写到本地库。
- 浏览器打开局域网地址看曲线和历史数据。
- 最终配置动作器和策略，让系统能在满足条件时打开 / 关闭继电器，比如控制泵、阀、加药、报警或其他执行设备。

## 当前完成度判断

### 已成型

- Flask 后端入口。
- SQLite 数据库。
- Modbus 设备扫描。
- 传感器协议文件体系。
- 单次读配置。
- 单次写配置。
- 采集计划文件。
- poller 采集线程。
- 时间序列查询和导出。
- 数据仪表盘回放。
- 控制板预设选择。

### 半成品

- 采集计划前端只编辑全局 meta，不编辑具体 plans。
- 设备定义页实际承担了 plans[] 编辑职责：以 poll plan 为唯一事实源，按 address 编辑 protocol / port / parameters，并可做一次性读取测试。
- 数据仪表最近窗口没有“数据已停采”的提示，只显示空。
- 动作配置页只完成控制板预设。
- action profile API 只管理板卡能力，不管理具体执行器。

### 未完成

- 继电器 / GPIO 实际控制服务。
- 动作器库。
- 动作单元库。
- 触发器 / 策略计划。
- 执行日志。
- 开机自启动 / systemd 服务。
- GPIO 安全状态恢复。

## 活代码与废弃残留

### 当前活跃入口

- 后端入口：`backend/app.py`
- 前端入口：`ui/index.html`
- 前端启动：`ui/js/app.js`
- 仪表盘入口：`ui/lab/dashboard.html`
- 仪表盘挂载：`ui/js/pages/dashboard/dashboard.js`

### 明确过期的记录

`hydrocore3.1/code_tree.txt` 和 `code_files_only.txt` 是旧导出，不能完全相信。它们提到的一些文件当前不存在：

- `backend/api/meta_api1.py`
- `ui/app.js`
- `ui/app1.1.js`
- `ui/app1s.js`
- `ui/index1s.html`
- `ui/styles/app1s.css`
- `ui/views/admin.js`
- `ui/views/config.js`
- `ui/views/dashboard.js`
- `ui/views/tasks.js`
- `ui/vendor/vue.global.prod.js`
- `ui/vendor/echarts.min.js`

当前真实的 ECharts 文件在：

- `ui/lab/lib/echarts.min.js`

### 可能残留但未被主入口使用

- `ui/js/pages/hardware/index.js`
- `ui/js/pages/hardware/actuators.js`

这两个文件看起来属于旧版“硬件页统一路由容器”。当前 `ui/js/app.js` 直接初始化 `scan/sensors/verify/plan`，并且动作配置已经改成顶层 `action_config` 页面，所以旧的 `hardware/actuators.js` 只是空壳残留。

## 触发器计划的合理位置

目前不建议把触发器计划混进 `tasks/config_poll_plan.json`。

原因：

- `config_poll_plan.json` 的职责是“采集谁、多久采一次、多久落库一次”。
- 触发器的职责是“看哪些数据、满足什么条件、持续多久、冷却多久、执行什么动作”。
- 二者生命周期不同，出错影响面也不同。

更合理的拆分：

- `tasks/config_poll_plan.json`: 数据采集计划。
- `data/action_profiles/*.json`: 板卡能力。
- `data/actuators/*.json`: 具体动作器实例，例如继电器 1、泵 1、阀门 1。
- `data/action_units/*.json`: 可执行动作单元，例如打开泵 10 秒、关闭阀门、PWM 60%。
- `data/trigger_plans/*.json`: 条件和调度规则，例如 pH 超限、温度过高、每天定时。
- `data/action_logs` 或数据库表：执行日志。

## 后续补完动作层的最小产品闭环

第一阶段只做可靠闭环，不急着做复杂策略：

1. 动作器库
   - 定义 GPIO 继电器输出。
   - 字段：名称、GPIO pin、常开/常闭、打开电平、默认安全状态、启用状态。

2. 动作单元库
   - 定义一个或多个动作步骤。
   - 例如：打开继电器 1 -> 等待 10 秒 -> 关闭继电器 1。

3. 手动执行
   - 前端按钮触发动作单元。
   - 后端执行 GPIO。
   - 写执行日志。

4. 触发器计划
   - 从数据库或最新缓存读取指标。
   - 支持阈值、持续时间、滞回、冷却时间。
   - 满足条件后调用动作单元。

5. 安全机制
   - poller 和 GPIO 控制互不抢串口，但动作执行要有自己的锁。
   - 程序启动时恢复所有动作器到安全状态。
   - 执行失败要记录日志。

## 动作层第一版已落地

落地时间：2026-06-05

第一版范围：

- 动作器库：可列出、新建、编辑、删除 JSON 动作器。
- 动作单元库：可列出、新建、编辑、删除 JSON 动作单元。
- 手动执行：支持执行动作单元。
- 默认 dry-run：页面默认勾选 dry-run，不会真实拉动 GPIO。
- 真实执行保护：每个动作器有 `allow_real` 开关；未允许真实执行时，即使用户取消 dry-run，后端也会阻断。
- 执行日志：新增 `action_log` 表，记录成功、失败、阻断和详细步骤。

新增后端文件：

- `backend/api/action_api.py`
- `backend/services/action_store.py`
- `backend/services/action_executor.py`
- `backend/services/gpio_driver.py`

新增前端文件：

- `ui/js/pages/action_config/runtime-panel.js`

修改文件：

- `backend/app.py`
- `backend/schema.sql`
- `ui/js/pages/action_config/api.js`
- `ui/js/pages/action_config/store.js`
- `ui/js/pages/action_config/template.js`
- `ui/js/pages/action_config/index.js`
- `ui/styles/pages/action_config.css`

新增默认配置：

- `data/actuators/demo_relay_1.json`
- `data/action_units/demo_relay_pulse.json`

已验证：

- `GET /api/v1/actions/summary` 可返回动作器、动作单元和日志。
- `POST /api/v1/actions/units/demo_relay_pulse/execute` dry-run 成功。
- 浏览器里 `动作配置 -> 动作单元库 -> 执行` dry-run 成功。
- `动作配置 -> 执行日志` 可看到执行记录。

当前 GPIO 现实状态：

- 树莓派 Python 环境未安装 `gpiozero` / `RPi.GPIO` / `lgpio` / `gpiod`。
- 因此第一版真实 GPIO 执行不会启用，只能 dry-run。
- 后续确认硬件接线和 GPIO 库后，再打开具体动作器的 `allow_real`。

## 已发现的风险点

1. `config_set_service.py` 目前不像 `config_get_service.py` 那样使用 `try_port_lock`，如果并发写入或与其他串口操作重叠，可能抢串口。
2. `app.py` 的 poller 是进程内线程，服务重启后不会自动恢复采集状态。
3. `debug=True` 的默认 `main()` 可能触发 Flask reloader 双进程；正式运行应关闭 debug/reloader 或用 systemd。
4. 数据库已有生产数据，后续不能随意迁移或清库。
5. Git 只有初始提交，当前大量未提交改动，继续开发前应先做安全提交或备份。
6. `__pycache__` 和 `hydro.db` 被 Git 标记修改，说明 `.gitignore` 或版本管理边界需要整理。

## 当前工作区关键事实

- `root` SSH 直登失败。
- `rp41` 可登录且在 sudo 组。
- 当前 Flask 临时后台进程 PID：`2924`。
- 当前服务日志：`/tmp/hydrocore-codex.log`。
- 当前 UI：`http://192.168.0.107:5000/ui/`。
- 当前 poller 状态：停止。
