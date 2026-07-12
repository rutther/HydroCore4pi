
---

# HydroCore 3.1 后端 API 文档

---

## 1. 基本信息

* 基础地址（Base URL）

  * 本机：`http://127.0.0.1:5000`
  * 局域网：`http://<设备IP>:5000`
    例子：`http://192.168.0.104:5000`

* 版本前缀：所有业务接口均在 ` /api/v1/...` 之下

* 返回格式：全部为 `application/json`（除 `/api/v1/data/export.csv` 为 `text/csv`）

* 时间与时区：

  * 所有时间戳字段均为文本：`YYYY-MM-DD HH:MM:SS`
  * 使用 SQLite `strftime(...,'now','localtime')`，即本地时区时间

---

## 2. 接口分组概览

### 2.1 元数据与计划相关

| 方法  | 路径                       | 说明                   | 副作用 |
| --- | ------------------------ | -------------------- | --- |
| GET | `/api/v1/meta/plan_raw`  | 获取采集计划原始 JSON        | 无   |
| GET | `/api/v1/meta/plan_view` | 获取展开后的计划视图（带中文、单位）   | 无   |
| GET | `/api/v1/meta/series`    | 获取数据库中已有的时间序列清单      | 无   |
| GET | `/api/v1/data/range`     | 获取指定序列在 DB 中的时间范围与点数 | 无   |

### 2.2 数据查询与导出

| 方法  | 路径                        | 说明                 | 副作用 |
| --- | ------------------------- | ------------------ | --- |
| GET | `/api/v1/data/series`     | 时间序列查询（多序列、多桶、多聚合） | 无   |
| GET | `/api/v1/data/export.csv` | 时间序列导出为 CSV        | 无   |

### 2.3 串口运维操作

| 方法   | 路径                          | 说明          | 副作用        |
| ---- | --------------------------- | ----------- | ---------- |
| POST | `/api/v1/scan`              | 发起一次地址扫描任务  | 读总线 + 写 DB |
| GET  | `/api/v1/scan/<int:job_id>` | 查询扫描任务结果    | 无          |
| POST | `/api/v1/address`           | 一次性批量改从站地址  | 写寄存器       |
| POST | `/api/v1/config/get`        | 一次性读取配置/测量值 | 只读寄存器      |

### 2.4 采集计划管理（poller 使用）

| 方法  | 路径                  | 说明            | 副作用           |
| --- | ------------------- | ------------- | ------------- |
| GET | `/api/v1/poll/plan` | 获取当前采集计划 JSON | 无             |
| PUT | `/api/v1/poll/plan` | 覆盖写入采集计划 JSON | 改写配置文件，影响采集行为 |

### 2.5 前端静态资源（供浏览器 UI 使用）

| 方法  | 路径               | 说明                   |
| --- | ---------------- | -------------------- |
| GET | `/ui/`           | 返回 `ui/index.html`   |
| GET | `/ui/<path>`     | 返回 `ui/` 目录下的静态文件    |
| GET | `/static/<path>` | Flask 默认静态文件目录（如有使用） |

---

## 3. 元数据与计划相关接口

### 3.1 `GET /api/v1/meta/plan_raw`

**用途**
获取采集计划文件 `tasks/config_poll_plan.json` 的原始内容，用于配置比对或编辑器加载。

**请求**

* 方法：GET
* 路径：`/api/v1/meta/plan_raw`
* 参数：无

**响应**

* 结构与文件内容一致，当前为：

```json
{
  "__meta__": {
    "default_sampling_sec": 3,
    "default_persist_sec": 10,
    "default_round_to": 3,
    "align_persist_to_wall": true,
    "retention_days": 400,
    "max_db_mb": 10240
  },
  "plans": [
    {
      "protocol": "lanchang_ec",
      "address": 10,
      "port": "/dev/ttyACM0",
      "sampling_sec": 3,
      "persist_sec": 10,
      "parameters": [
        { "name": "ec_value",          "label": "电导率", "unit": "mS/cm" },
        ...
      ]
    },
    ...
  ]
}
```

**副作用**
无。

---

### 3.2 `GET /api/v1/meta/plan_view`

**用途**
给前端使用的“展开后的计划视图”。在 `plans` 的基础上，扩充各参数的 label（中文名称）、unit（单位）、round_to、agg_mode、event_only 等，前端可以直接用这些字段构建下拉框、多选列表等。

**请求**

* 方法：GET
* 路径：`/api/v1/meta/plan_view`
* 参数：无

**响应**

```json
{
  "entries": [
    {
      "protocol": "lanchang_ec",
      "address": 10,
      "port": "/dev/ttyACM0",
      "parameters": [
        {
          "name": "ec_value",
          "label": "电导率",
          "unit": "mS/cm",
          "round_to": 3,
          "agg_mode": null,
          "event_only": null,
          "axis": "left"
        },
        ...
      ]
    },
    ...
  ]
}
```

其中：

* `entries[*].protocol`：协议名，比如 `lanchang_ec`
* `entries[*].address`：从站地址
* `entries[*].port`：串口路径，如 `/dev/ttyACM0`
* `parameters[*].name`：参数英文标识
* `parameters[*].label`：中文名称
* `parameters[*].unit`：单位（可空）
* `parameters[*].round_to`：服务端保留小数位
* `parameters[*].agg_mode`：

  * `avg`/`last` 等，用于指导聚合逻辑（当前主要在 poller 内部使用）
* `parameters[*].event_only`：

  * `nonzero` / `change` / `nonzero_or_change`
  * 表示是否只在事件发生时写库，例如报警变化

**副作用**
无。

---

### 3.3 `GET /api/v1/meta/series`

**用途**
获取数据库中已经存在数据的时间序列清单，便于前端或运维工具判断“有哪些线可以选”。

**请求**

* 方法：GET
* 路径：`/api/v1/meta/series`
* 参数：无

**响应**

```json
{
  "ok": true,
  "series": [
    {
      "protocol": "lanchang_ec",
      "address": 10,
      "parameter": "ec_value",
      "first_ts": "2025-08-29 04:50:52",
      "last_ts": "2025-11-30 20:26:00",
      "n": 70941
    },
    ...
  ]
}
```

**副作用**
无，仅统计 `sensor_data`。

---

### 3.4 `GET /api/v1/data/range`

**用途**
对一组序列 token 进行时间范围探测，用于自动设定图表查询窗口。

**请求**

* 方法：GET
* 路径：`/api/v1/data/range`
* 参数（query）：

  * `s`（可重复）
    形如 `protocol:address:parameter`
    例如：`s=lanchang_ec:10:ec_value&s=lanchang_ph:9:temperature`

**响应**

```json
{
  "ok": true,
  "overall": {
    "first_ts": "2025-08-29 04:50:52",
    "last_ts":  "2025-11-30 20:26:00"
  },
  "per_series": [
    {
      "protocol": "lanchang_ec",
      "address": 10,
      "parameter": "ec_value",
      "key": "lanchang_ec:10:ec_value",
      "first_ts": "2025-08-29 04:50:52",
      "last_ts":  "2025-11-30 20:26:00",
      "n": 70941
    },
    ...
  ]
}
```

**副作用**
无。

---

## 4. 数据查询与导出接口

### 4.1 `GET /api/v1/data/series`

**用途**
统一的时间序列查询接口。支持多序列、多种时间桶（raw / 秒桶 / 日/周/月）、多种聚合方式。

**请求**

* 方法：GET

* 路径：`/api/v1/data/series`

* 参数（query）：

  1. 序列选择（两种方式，推荐第一种）：

     * 推荐方式：

       * `s`（可重复）：`protocol:address:parameter`
       * 例子：`s=lanchang_ec:10:ec_value&s=lanchang_ph:9:temperature`

     * 兼容方式（仅单序列）：

       * `protocol`
       * `address`
       * `parameter`

  2. 时间范围：

     * `from`：起始时刻，`YYYY-MM-DD HH:MM:SS`
     * `to`：结束时刻，`YYYY-MM-DD HH:MM:SS`
     * 若未提供，内部会以当前时间为基准设最近 24 小时窗口。

  3. 桶参数 `bucket`：

     * `"raw"`：不分桶，返回原始采样点
     * 秒桶（内部换算成固定秒数）：

       * `"10s"、"1m"、"3m"、"10m"、"30m"、"1h"、"3h"、"6h"、"8h"、"12h"`
     * 日历桶：

       * `"1d"`：按自然日
       * `"1w"`：按周（周一为第一天）
       * `"1mo"`：按自然月

  4. 聚合方式 `agg`（bucket != raw 时有效）：

     * `"avg"`：平均值
     * `"min"`：最小值
     * `"max"`：最大值
     * `"last"`：桶内最后一个点
     * `"ohlc"`：开高低收（open/high/low/close），用于 K 线等

  5. 其它参数：

     * `round`：0–8，服务端小数位控制（SQLite `ROUND(value, round)`）
     * `limit`：单序列最大点数：

       * 默认 20000，上限 20000

**响应**

* `bucket = raw` 情况：

```json
{
  "ok": true,
  "meta": {
    "bucket": "raw",
    "agg": null,
    "round": 3,
    "from": "2025-08-29 04:50:52",
    "to":   "2025-11-30 20:26:00"
  },
  "series": [
    {
      "key": "lanchang_ec:10:ec_value",
      "protocol": "lanchang_ec",
      "address": 10,
      "parameter": "ec_value",
      "points": [
        { "ts": "2025-11-30 20:20:20", "value": 1.263 },
        ...
      ]
    },
    ...
  ]
}
```

* `bucket = 1h, agg = avg` 情况类似，只是 points 会按 1 小时桶汇总。

* `agg = ohlc` 时，`points[*]` 为：

```json
{
  "ts": "2025-11-30 20:00:00",
  "ohlc": {
    "open": 1.20,
    "high": 1.30,
    "low":  1.10,
    "close":1.26
  }
}
```

**副作用**
无。

---

### 4.2 `GET /api/v1/data/export.csv`

**用途**
将时间序列数据导出为 CSV，便于 Excel / 其它系统按文件方式导入。

**请求**

* 方法：GET

* 路径：`/api/v1/data/export.csv`

* 参数与 `/api/v1/data/series` 大体相同：

  1. 序列选择：

     * `s` 可重复
     * 或 `protocol`+`address`+`parameter`（单序列）

  2. 时间范围：`from` / `to`

  3. `bucket` / `agg`：

     * `bucket=raw` 时：逐点输出
     * 对分桶导出，仅当：

       * `bucket` 为秒桶或日历桶
       * `agg` 为 `avg`/`min`/`max`/`last`
     * `agg=ohlc` 当前只用于 `/series` 图表接口，CSV 导出不支持

  4. `round` / `limit`：

     * `round`：数字四舍五入位
     * `limit`：行数上限，默认 1,000,000

**响应**

* 内容类型：`text/csv`

  * 响应头：`Content-Disposition` 带 `filename="..."`

  * 单序列时：`<protocol>-<address>-<parameter>-<bucket>[-<agg>].csv`
  * 多序列时：`hydrocore-series-<count>-<bucket>[-<agg>].csv`

* CSV 内容结构：

```csv
ts,protocol,address,parameter,value
2025-11-30 20:20:20,lanchang_ec,10,ec_value,1.263
...
```

**副作用**
无（大导出会占用 IO 和 CPU）。

---

## 5. 串口运维接口

### 5.1 `POST /api/v1/scan`

**用途**
扫描一个串口上的地址区间，看看哪些从站有响应。结果写入 DB（scan_job / scan_hit），供后续查询。

**请求**

* 方法：POST
* 路径：`/api/v1/scan`
* 请求体 `Content-Type: application/json`：

```json
{
  "port": "/dev/ttyACM0",
  "start_address": 1,
  "end_address": 20,
  "baudrate": 9600,
  "timeout": 0.5
}
```

字段说明：

* `port`：串口设备路径
* `start_address` / `end_address`：扫描地址区间（整型）
* `baudrate`：波特率，缺省使用默认值
* `timeout`：每个请求的超时时间，单位秒

**响应**

来自 `start_scan_job(...)`，结构大致为：

```json
{
  "ok": true,
  "status": "ok",
  "job_id": 1,
  "message": "..."
}
```

合并了内部的字段，具体可以通过 `/api/v1/scan/<job_id>` 查看详情。

**副作用**

* 会在给定地址范围内大量发起 0x03/0x01 一类读请求；
* 不写寄存器，不改地址；
* 会在 DB 中写入 scan_job 与 scan_hit。

---

### 5.2 `GET /api/v1/scan/<int:job_id>`

**用途**
查看一次扫描任务的结果，包括任务信息与命中的设备列表。

**请求**

* 方法：GET
* 路径：`/api/v1/scan/<job_id>`
* 参数：`job_id` 为整数

**响应**

```json
{
  "ok": true,
  "job": {
    "id": 1,
    "port": "/dev/ttyACM0",
    "start_address": 1,
    "end_address": 20,
    "created_at": "2025-11-30 20:00:00"
  },
  "devices": [
    {
      "address": 9,
      "raw_hex": "0903...",
      "latency_ms": 25
    },
    ...
  ]
}
```

**副作用**
无。

---

### 5.3 `POST /api/v1/address`（批量改从站地址）

> 这是一个具有硬件副作用的接口，需要谨慎使用。
> 内部通过 `addr_writer_service.build_write_cmd` 构造 Modbus 0x06 写寄存器命令，更改从站地址寄存器。

**请求**

* 方法：POST
* 路径：`/api/v1/address`
* 请求体（JSON）：

```json
{
  "port": "/dev/ttyACM0",
  "baudrate": 9600,
  "timeout": 0.5,
  "items": [
    {
      "current_addr": 1,
      "new_addr": 9,
      "protocol": "lanchang_ph",
      "description": "备注信息"
    }
  ]
}
```

字段说明：

* `port`：串口
* `items`：要执行改址的条目数组

  * 每个 entry：

    * `current_addr`：当前地址（旧地址）
    * `new_addr`：目标地址（新地址）
    * `protocol`：协议名，用于在 `protocols/*.json` 中找到地址寄存器的 Register 地址
    * `description`：备注，可选

**响应**

```json
{
  "status": "ok",
  "results": [
    {
      "timestamp": "2025-11-30 20:10:40",
      "port": "/dev/ttyACM0",
      "from": 1,
      "to": 9,
      "protocol": "lanchang_ph",
      "description": "备注信息",
      "status": "success",
      "request_hex": "010600...XXXX",
      "response_hex": "010600...XXXX"
      // 出错时会有 "error" 字段
    }
  ]
}
```

**副作用**

* 真实发起 0x06 写寄存器命令，修改从站地址；
* 使用前需要事先确认硬件协议与 wiring 正确；
* 不写数据库，只返回一次性结果。

---

### 5.4 `POST /api/v1/config/get`（单次配置/测量值读取）

**用途**
一次性从一个串口上读多组 `protocol/address/parameters` 的值。内部调用 `config_get_service.start_config_get`，使用 0x03 读保持寄存器；这是 poller 的底层读操作。

**请求**

* 方法：POST
* 路径：`/api/v1/config/get`
* 请求体（JSON）：

```json
{
  "port": "/dev/ttyACM0",
  "baudrate": 9600,
  "timeout": 0.5,
  "items": [
    {
      "protocol": "lanchang_ec",
      "address": 10,
      "parameters": ["ec_value", "temperature"]
    }
  ]
}
```

字段说明：

* `port`：串口设备路径
* `baudrate`：波特率
* `timeout`：超时
* `items`：

  * 每个元素包含：

    * `protocol`：协议名，例如 `lanchang_ec`
    * `address`：从站地址
    * `parameters`：要读取的参数名列表，对应 `protocols/*.json` 中定义的寄存器

**响应**

你刚刚的实际响应结构：

```json
{
  "results": [
    {
      "address": 10,
      "description": "电导率测量值",
      "parameter": "ec_value",
      "request_hex": "0A0300000002C570",
      "response_hex": "0A030415A93FA14497",
      "sensor": "lanchang_ec",
      "status": "success",
      "timestamp": "2025-11-30 20:10:40",
      "value": 1.258473515510559
    }
  ],
  "status": "ok"
}
```

**副作用**

* 对设备为只读操作：Modbus 0x03 读寄存器；
* 不写 DB。

---

## 6. 采集计划管理接口

### 6.1 `GET /api/v1/poll/plan`

**用途**
读取当前 poller 使用的采集计划 JSON，直接从 `tasks/config_poll_plan.json` 读出。

**请求**

* 方法：GET
* 路径：`/api/v1/poll/plan`
* 参数：无

**响应**

```json
{
  "ok": true,
  "plan": {
    "__meta__": { ... },
    "plans": [ ... ]
  }
}
```

**副作用**
无。

---

### 6.2 `PUT /api/v1/poll/plan`

**用途**
覆盖写入采集计划配置文件 `tasks/config_poll_plan.json`。轮询器在检测到文件 `mtime` 变化后会自动热重载。

**请求**

* 方法：PUT
* 路径：`/api/v1/poll/plan`
* 请求体：一个完整的 JSON 对象，结构与当前 `config_poll_plan.json` 一致，例如：

```json
{
  "__meta__": {
    "default_sampling_sec": 3,
    "default_persist_sec": 10,
    "default_round_to": 3,
    "align_persist_to_wall": true,
    "retention_days": 400,
    "max_db_mb": 10240
  },
  "plans": [
    {
      "protocol": "lanchang_ec",
      "address": 10,
      "port": "/dev/ttyACM0",
      "sampling_sec": 3,
      "persist_sec": 10,
      "parameters": [
        { "name": "ec_value", "label": "电导率", "unit": "mS/cm" },
        ...
      ]
    },
    ...
  ]
}
```

**响应**

```json
{
  "ok": true,
  "message": "已写入，采集器将自动重载"
}
```

**副作用**

* 覆盖写入 JSON 文件；
* 后续 poller 行为将按新计划执行；
* 在切换前，poller 会尝试把已有窗口的数据 flush 一次（按代码逻辑）。

---

## 7. 前端资源相关接口（简单列出）

### 7.1 `GET /ui/`

返回 `ui/index.html`，用于浏览器入口。

### 7.2 `GET /ui/<path>`

返回 `ui/` 目录下的静态资源，例如：

* `/ui/app.js`
* `/ui/styles/app.css`
* `/ui/vendor/vue.global.prod.js`
* `/ui/vendor/echarts.min.js` 等

### 7.3 `GET /static/<path>`

Flask 内建静态目录对应路径，如项目中使用到的话，这里会返回静态文件。

---

## 8. REST 风格说明

从 API 样式上看：

* 版本统一：`/api/v1/...`
* GET 用于查询/读取；POST 用于“动作类/创建类”；PUT 用于覆盖更新（采集计划）
* `meta/plan_view`,`meta/series`,`data/series` 等接口，更接近 REST 的资源风格；
* `scan`、`address`、`config/get` 类接口，更接近“动作型 RPC”。

对于独立前端 UI 或其它系统，这套接口已经可以作为稳定的“后端契约”使用，无需额外适配层即可完成：

* 参数选择与计划展示（`meta/plan_view` / `meta/series`）
* 自动设定查询时间窗（`data/range`）
* 折线/柱状/K 线图数据拉取（`data/series`）
* CSV 导出（`data/export.csv`）
* 即时读取设备配置/测量值（`config/get`）
* 管理采集计划（`poll/plan`）
* 硬件运维：扫描与改地址（`scan` / `address`）

