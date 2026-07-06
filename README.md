# HydroCore 3.1 - AI 重制版

HydroCore 3.1 是循环水处理边缘控制端软件，面向树莓派等 Debian 系硬件运行。

## 功能范围

- 传感器扫描、配置读取和采集计划
- SQLite 本地数据存储
- 数据仪表前端
- GPIO / PWM 输出设备配置
- 动作单元、任务计划和自动控制框架
- 系统设置、本机信息、手机访问二维码

## 本地运行

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python3 -m backend.app
```

访问：

```text
http://127.0.0.1:5000/ui/
```

## 重要环境变量

开发模式默认使用项目内目录。打包安装后由 `/etc/hydrocore/hydrocore.env` 覆盖。

```text
HYDROCORE_HOST=0.0.0.0
HYDROCORE_PORT=5000
HYDROCORE_DATA_DIR=/var/lib/hydrocore
HYDROCORE_CONFIG_DIR=/etc/hydrocore
HYDROCORE_DEFAULTS_DIR=/usr/share/hydrocore/defaults
HYDROCORE_PROTOCOL_DIR=/opt/hydrocore/protocols
HYDROCORE_USER_PROTOCOL_DIR=/var/lib/hydrocore/protocols_user
HYDROCORE_POLL_PLAN_FILE=/var/lib/hydrocore/config_poll_plan.json
```

## deb 打包

```bash
python3 tools/build_deb.py
```

输出目录：

```text
dist/
```

安装后：

```bash
sudo apt install ./dist/hydrocore-ai_*.deb
systemctl status hydrocore
systemctl status hydrocore-kiosk
```

安装后默认形态：

- `hydrocore.service` 使用 gunicorn 在后台运行核心服务。
- `hydrocore-kiosk.service` 是可选的本机屏幕显示层；只有检测到 `cage` 和 Chromium 时才启用，占据本机 tty1 显示屏并打开 `http://127.0.0.1:5000/ui/`。
- 系统默认启动目标切到 `multi-user.target`，不依赖完整桌面环境。
- `hydrocore-watchdog.timer` 每分钟检查本机 HTTP 状态，失败时重启核心服务。

如果设备没有本机屏幕，可以关闭 kiosk：

```bash
sudo systemctl disable --now hydrocore-kiosk
```

纯无屏边缘端可以安装时跳过推荐包，核心服务不依赖浏览器：

```bash
sudo apt install --no-install-recommends ./dist/hydrocore-ai_*.deb
```

## 数据保留策略

`.deb` 安装包只在目标文件不存在时初始化默认数据。已有现场配置、数据库、动作配置、用户协议文件不会被覆盖。
