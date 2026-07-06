# 动作层外部方案调研

更新时间：2026-06-05

## 1. 这次主要查了什么

这次不是只看“怎么写代码”，而是看行业里怎么切边界：

- 工业自动化怎么分“设备控制”和“过程/配方/调度”
- 自动化平台怎么分“动作”和“触发器/规则”
- 嵌入式系统怎么处理“状态机”“定时器”“长动作”

## 2. 工业自动化：ISA-88 的核心思想

参考资料：

- [Siemens: Batch processes with PCS 7 along ISA-88 models](https://cache.industry.siemens.com/dl/files/331/109784331/att_1052440/v3/109784331_Batch_processes_PCS_7_ISA_88_Docu_V1_en.pdf)
- [Rockwell: Logix 5000 Controllers Design Considerations](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm094_-en-p.pdf)

关键信号：

1. ISA-88 明确区分了：
   - physical model：设备/硬件
   - procedural control model：过程/步骤/配方

2. Siemens 文档里直接写了：
   - procedural control 和 equipment control 是分开的
   - equipment entity 执行 procedural element 定义的功能

3. Siemens 对 physical model 的拆分很像我们现在要做的：
   - control module：直接连 I/O 的传感器/执行器
   - equipment module：围绕某类工艺能力组织的小模块，例如 dosing

4. Rockwell 也强调：
   - procedural control 和 process/equipment control 要分离
   - operator 手动模式和自动模式都应有明确定义
   - phase/state/command 要有一致状态机

### 对我们最有用的启发

工业界主流不是“调度层直连 I/O”，而是：

`过程/规则/配方 -> 设备能力单元 -> 底层控制`

映射到这个项目，可以理解成：

- `动作器` 接近 control module
- `动作单元` 接近 equipment capability / phase
- `任务管理/规则/计划` 接近 procedural control

所以“任务管理调用动作单元，而不是直接碰 GPIO”，是符合成熟工业思路的。

## 3. 自动化平台：Home Assistant 的拆法

参考资料：

- [Home Assistant: Understanding automations](https://www.home-assistant.io/docs/automation/basics/)
- [Home Assistant: Automation triggers](https://www.home-assistant.io/docs/automation/trigger/)
- [Home Assistant: Scripts](https://www.home-assistant.io/integrations/script/)

关键信号：

1. Home Assistant 把自动化拆成：
   - trigger
   - condition
   - action

2. 它又把 script 单独抽出来，作为“可复用动作序列”。

3. automation 可以调用 script。

4. trigger 里可以表达：
   - 指定时间
   - 时间模式
   - 数值条件
   - 连续满足多久（`for`）

### 对我们最有用的启发

这和我们眼前的问题几乎一一对应：

- `动作单元` 很像 script
- `任务管理/触发器/定时计划` 很像 automation

也就是说，现代自动化平台的常见做法不是把“触发条件”和“动作内容”写在一层里，而是：

- 一层负责“何时触发”
- 一层负责“触发后执行什么”

这也支持我们把边界定成：

- 动作单元：执行内容
- 任务管理：触发和调度

## 4. 嵌入式实时系统：定时器不等于流程引擎

参考资料：

- [FreeRTOS: Software timers](https://docs.aws.amazon.com/freertos/latest/userguide/software-timers.html)
- [Mastering the FreeRTOS Real Time Kernel](https://www.freertos.org/media/2018/161204_Mastering_the_FreeRTOS_Real_Time_Kernel-A_Hands-On_Tutorial_Guide.pdf)

关键信号：

1. FreeRTOS 软件定时器是“到时间执行回调”。

2. 所有 timer callback 都跑在同一个 daemon task 里。

3. 官方明确说 callback 应该短，不能阻塞。

### 对我们最有用的启发

如果以后动作层落到更底的 RTOS 或更严格的实时线程模型里：

- 定时器适合“唤醒/触发”
- 不适合承载一大段会等待、会睡眠、会串动作的长流程

所以：

- “每小时开始一次任务”很适合由调度器/定时器决定
- “启动后连续跑 10 分钟、每分钟前 30 秒开”更适合是动作单元内部的执行逻辑

换句话说，**定时器负责叫醒，不负责讲完整故事**。

## 5. 嵌入式控制流：状态机是主流整理方式

参考资料：

- [Zephyr: State Machine Framework](https://docs.zephyrproject.org/latest/services/smf/index.html)
- [Microchip: State Machine Design Pattern](https://onlinedocs.microchip.com/oxy/GUID-7CE1AEE9-2487-4E7B-B26B-93A577BA154E-en-US-2/GUID-325850C6-AE1E-45EF-A13F-45A05C5461B2.html)
- [ST: STM32 embedded software architecture overview](https://www.st.com/en/embedded-software/mcu-and-mpu-embedded-software.html)

关键信号：

1. Zephyr 直接提供通用状态机框架，强调 entry / run / exit。

2. Microchip 把 state machine 描述成：
   - 每个应用任务有自己的控制循环
   - 状态迁移由内部或外部事件驱动

3. ST 强调分层软件架构：
   - HAL / LL
   - middleware
   - application layer

### 对我们最有用的启发

动作层最稳的落法，不是堆 if/else，而是有明确状态：

- idle
- queued
- running
- cooling_down
- blocked
- failed

尤其是“动作单元执行器”和“任务调度器”，都很适合状态机化。

## 6. 这些资料综合下来，边界应该怎么切

我现在更确认，最稳的边界是：

### 6.1 动作器

管：

- GPIO / PWM 绑定
- 高低电平
- 安全态
- enable / allow_real_output

不管：

- 定时触发
- 传感器阈值
- 复合流程

### 6.2 动作单元

管：

- 一旦启动后，设备怎么执行
- 持续多久
- 固定节拍模式
- PWM 占空比 / 时长

可以允许：

- 有界的 sequence / pattern

不该允许：

- 读传感器
- cron
- 长期日历调度
- “最近 10 分钟都高于 X”这类触发判断

### 6.3 任务管理

管：

- 什么时候调用动作单元
- 为什么调用动作单元
- 调用来源是手动 / 规则 / 定时
- 是否允许重入
- 冲突跳过还是排队

任务管理下面再分两类来源：

- 数据触发规则
- 时间计划

## 7. 我们原来的想法到底错没错

结论：

### 对的部分

- 不让上层直接碰 GPIO
- 希望保留可复用动作单元
- 允许任务层重复调用动作单元

这些都很对，而且和工业自动化、现代自动化平台的做法一致。

### 容易出问题的部分

- 如果动作单元也能写触发条件
- 如果任务管理也能写详细 GPIO 波形
- 如果“时间语义”同时在动作单元和任务管理出现

这就会边界打架。

## 8. 对这个项目的最终建议

最适合当前项目体量的结构，不是万能引擎，而是下面这套：

`动作器 -> 动作单元 -> 任务 -> 规则/定时计划 -> 执行日志`

其中：

- 动作单元负责“怎么动”
- 任务负责“调哪个动作单元”
- 规则/定时计划负责“什么时候调任务”

如果继续用你原来的术语，也完全成立：

- 动作器库
- 动作单元库
- 任务管理
  - 触发任务
  - 定时任务
- 执行日志

这已经不是我们自己瞎想出来的结构了，外部成熟方案基本都在支持这个方向。
