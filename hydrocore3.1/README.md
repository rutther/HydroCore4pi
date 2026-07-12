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
python3 tools/build_deb.py --arch arm64
```

输出目录：

```text
dist/
```

安装后：

```bash
sudo dpkg -i ./dist/hydrocore-ai_*.deb
systemctl status hydrocore
systemctl status hydrocore-kiosk-deps
systemctl status hydrocore-kiosk
sudo hydrocore-ctl selfcheck
```

安装后默认形态：

- `hydrocore.service` 使用随包 vendor Python 依赖和 gunicorn 在后台运行核心服务，不需要在线安装 Flask、pyserial、gpiozero、gunicorn。
- `.deb` 内置 arm64 版 `lgpio` Python 后端和 `liblgpio.so.1`，用于 GPIO/PWM 输出。
- `.deb` 内置 Bookworm arm64 的本机屏幕离线依赖仓库，安装后由 `hydrocore-kiosk-deps.service` 从 `/opt/hydrocore/offline-debs` 安装 Chromium、`labwc`/`cage`、`squeekboard` 和 `wlr-randr`，不需要联网。
- `hydrocore-kiosk.service` 是本机屏幕显示层，占据本机 tty1 显示屏并打开 `http://127.0.0.1:5000/ui/`。
- 系统默认启动目标切到 `multi-user.target`，不依赖完整桌面环境。
- `hydrocore-watchdog.timer` 每分钟检查本机 HTTP 状态，失败时重启核心服务。
- `hydrocore-selfcheck` 会检查包文件、vendor Python、GPIO/PWM、systemd、HTTP、本机屏幕组件和离线依赖仓库。

如果设备没有本机屏幕，可以关闭 kiosk：

```bash
sudo systemctl disable --now hydrocore-kiosk
```

自检命令：

```bash
sudo hydrocore-ctl selfcheck
sudo hydrocore-ctl selfcheck --strict-kiosk
```

`--strict-kiosk` 会把 Chromium、窗口合成器等本机屏幕组件也作为硬性检查项。

## 数据保留策略

`.deb` 安装包只在目标文件不存在时初始化默认数据。已有现场配置、数据库、动作配置、用户协议文件不会被覆盖。
