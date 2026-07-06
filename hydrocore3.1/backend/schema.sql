PRAGMA foreign_keys = ON;

-- 扫描任务表
CREATE TABLE IF NOT EXISTS scan_job (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  port          TEXT NOT NULL,
  start_address INTEGER NOT NULL,
  end_address   INTEGER NOT NULL,
  baudrate      INTEGER NOT NULL,
  timeout       REAL    NOT NULL,
  interval      REAL    NOT NULL,
  ts_start      DATETIME NOT NULL,
  ts_end        DATETIME,
  status        TEXT     NOT NULL CHECK(status IN ('running','ok','serial_error','failed')),
  message       TEXT
);

-- 扫描命中表（最小实现只记录 ok=1 的地址）
CREATE TABLE IF NOT EXISTS scan_hit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL,
  address    INTEGER NOT NULL,
  raw_hex    TEXT,
  latency_ms INTEGER,
  ok         INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES scan_job(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_scan_hit_job ON scan_hit(job_id);

-- 采样数据表：时间序列
CREATE TABLE IF NOT EXISTS sensor_data (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        DATETIME NOT NULL,           -- 采样时间
  protocol  TEXT     NOT NULL,           -- 协议名，如 lanchang_ph
  address   INTEGER  NOT NULL,           -- 从机地址
  parameter TEXT     NOT NULL,           -- 参数名（如 measurement / temperature）
  value     REAL,                        -- 数值（float/int 统一存 REAL）
  raw_hex   TEXT                         -- 原始响应 HEX（便于追溯）
);
CREATE INDEX IF NOT EXISTS ix_sensor_data_ts     ON sensor_data(ts);
CREATE INDEX IF NOT EXISTS ix_sensor_data_sensor ON sensor_data(protocol, address);
CREATE INDEX IF NOT EXISTS ix_sensor_data_param  ON sensor_data(parameter);
CREATE INDEX IF NOT EXISTS ix_sensor_data_series_ts ON sensor_data(protocol, address, parameter, ts);

CREATE TABLE IF NOT EXISTS sensor_series_summary (
  protocol  TEXT    NOT NULL,
  address   INTEGER NOT NULL,
  parameter TEXT    NOT NULL,
  first_ts  TEXT,
  last_ts   TEXT,
  n         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(protocol, address, parameter)
);

-- 动作执行日志：动作层第一版先记录手动 / dry-run / 真实执行结果
CREATE TABLE IF NOT EXISTS action_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             DATETIME NOT NULL,
  source         TEXT     NOT NULL,
  action_unit_id TEXT,
  task_id        TEXT,
  run_kind       TEXT     DEFAULT 'action_unit',
  status         TEXT     NOT NULL,
  message        TEXT,
  detail_json    TEXT
);
CREATE INDEX IF NOT EXISTS ix_action_log_ts ON action_log(ts);
CREATE INDEX IF NOT EXISTS ix_action_log_unit ON action_log(action_unit_id);
