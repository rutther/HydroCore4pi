# Action Layer Implementation

## Final boundary

- `输出设备`:
  Owns GPIO/PWM wiring, active level, safe state, and whether real output is allowed.
- `动作单元`:
  Describes how one output behaves after start.
- `任务`:
  Reuses one or more action units and defines an executable sequence.
- `触发规则`:
  Decides when a task should run based on sensor data.
- `定时计划`:
  Decides when a task should run based on clock time.
- `自动运行线程`:
  Periodically evaluates rules and schedules, then dispatches tasks.

## Current implementation

### Backend

- CRUD:
  - actuators
  - action units
  - tasks
  - rules
  - schedules
- Execution:
  - manual action unit execution
  - manual task execution
  - execution logs in SQLite
- Automation:
  - background automation thread starts with Flask
- persisted runtime config in `hydrocore3.1/data/automation/runtime.json`
- dry-run default
- global automation enable switch default off
- global hardware arm switch default off

### Frontend

- Action config workspace now has:
  - `设备预设`
  - `总览`
  - `输出设备`
  - `动作单元`
  - `任务管理`
  - `触发规则`
  - `定时计划`
  - `执行日志`
- Overview now includes:
  - automation thread start/stop
  - automation config
  - runtime status
- Rule editor now includes explicit sensor binding:
  - `signal_protocol`
  - `signal_address`
  - `signal_parameter`
  - `aggregation`
  - `window_sec`

## Rule model

Rule fields are intentionally split into three groups.

### 1. Signal binding

- `metric_key`
- `signal_protocol`
- `signal_address`
- `signal_parameter`

`metric_key` is now a label/alias. Real evaluation uses the explicit signal binding.

### 2. Condition

- `aggregation`: `last | avg | min | max`
- `window_sec`
- `operator`
- `threshold`
- `sustain_sec`
- `requires_fresh_data`

This lets us express:

- instant threshold:
  `last > X`
- recent average:
  `avg over 60s > X`
- stable exceedance:
  `min over 60s > X`

That last pattern is the safe answer for:

`最近 1 分钟统计细粒度下，连续 10 分钟都大于 X`

Use:

- `aggregation = min`
- `window_sec = 60`
- `sustain_sec = 600`

### 3. Dispatch control

- `task_id`
- `cooldown_sec`
- `max_runs_per_hour`

## Schedule model

- `once`
- `daily`
- `interval`

Each schedule points to one task and adds its own cooldown.

## Automation runtime config

Stored in:

- `hydrocore3.1/data/automation/runtime.json`

Fields:

- `automation_enabled`
- `dry_run`
- `hardware_armed`
- `tick_sec`
- `fresh_data_sec`

## API additions

- `GET /api/v1/actions/automation/status`
- `POST /api/v1/actions/automation/start`
- `POST /api/v1/actions/automation/stop`
- `PUT /api/v1/actions/automation/config`

Summary endpoint now also returns automation status:

- `GET /api/v1/actions/summary`

## Safety defaults

- global automation disabled by default
- automation dry-run enabled by default
- real GPIO also requires global `hardware_armed = true`
- per-output real GPIO still requires explicit allow flag
- task cooldown still applies even when invoked by rule/schedule

## Known gaps

- no dedicated “global hardware arm” switch separate from dry-run yet
- no rule/schedule execution preview page
- no dependency checks before deleting referenced outputs/tasks
- no automatic UI smoke test yet because in-app browser policy blocked this LAN target

## Suggested next build step

1. Add “test rule now” / “simulate schedule now”.
2. Add clearer dashboard surfacing of automation state and last trigger reason.
3. Add stronger hardware arming workflow such as timed arming or dual confirmation.
