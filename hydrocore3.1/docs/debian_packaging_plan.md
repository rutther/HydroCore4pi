# HydroCore 3.1 deb 打包方案

## 目标

把 HydroCore 3.1 打包成可安装的 `.deb`，用于树莓派或 Debian 系边缘端硬件。包必须保留必要预设，并且升级时不覆盖现场数据。

## 依据

- Debian Policy 说明维护脚本用于安装、升级、删除时的必要动作。
- `dh_installsystemd` 的职责是安装 systemd unit 并生成服务启停相关逻辑。本项目当前采用内部包构建，不走完整 debhelper 流程，因此手写最小维护脚本。
- Debian Policy / FHS 要求不要把包内容安装到 `/usr/local`。第三方应用可使用 `/opt/<package>`；可变数据应放在 `/var/lib`，配置放在 `/etc`。

参考：

- https://www.debian.org/doc/debian-policy/ch-maintainerscripts.html
- https://www.debian.org/doc/debian-policy/ch-opersys.html
- https://man7.org/linux/man-pages/man1/dh_installsystemd.1.html
- https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch03s13.html

## 目录设计

```text
/opt/hydrocore                  程序文件，随包升级
/opt/hydrocore/backend          Flask 后端
/opt/hydrocore/ui               前端静态文件
/opt/hydrocore/protocols        内置设备协议定义
/opt/hydrocore/vendor/python    随包 Python 依赖
/opt/hydrocore/vendor/lib       随包 arm64 native 运行库
/opt/hydrocore/offline-debs     本机屏幕离线 apt 仓库

/usr/share/hydrocore/defaults   默认预设，只读种子
/var/lib/hydrocore              运行数据，升级保留
/var/lib/hydrocore/db           SQLite 数据库
/var/lib/hydrocore/logs         应用日志
/var/lib/hydrocore/protocols_user 用户导入协议
/var/lib/hydrocore/kiosk        本机屏幕 Chromium 数据

/etc/hydrocore/hydrocore.env    环境配置，作为 conffile
/etc/chromium/policies/managed/hydrocore.json  禁用 Chromium 自带翻译浮层
/etc/chromium-browser/policies/managed/hydrocore.json  兼容 Raspberry Pi OS Chromium 策略路径
/etc/systemd/journald.conf.d/90-hydrocore.conf  日志容量限制
/lib/systemd/system/hydrocore.service
/lib/systemd/system/hydrocore-kiosk.service
/lib/systemd/system/hydrocore-kiosk-deps.service
/lib/systemd/system/hydrocore-screen-boot.service
/lib/systemd/system/hydrocore-screen-apply.service
/lib/systemd/system/hydrocore-screen-apply.path
/lib/systemd/system/hydrocore-watchdog.service
/lib/systemd/system/hydrocore-watchdog.timer
/usr/bin/hydrocore-ctl          运维辅助命令
/usr/bin/hydrocore-run          后台服务启动脚本
/usr/bin/hydrocore-kiosk-launch 本机屏幕启动脚本
/usr/bin/hydrocore-kiosk-deps-install 本机屏幕离线依赖安装脚本
/usr/bin/hydrocore-apply-screen-orientation 本机屏幕方向应用脚本
/usr/bin/hydrocore-watchdog     HTTP 健康检查脚本
/usr/bin/hydrocore-selfcheck    离线安装与运行自检脚本
```

## 预设保留策略

打包时把以下内容作为默认种子放入 `/usr/share/hydrocore/defaults`：

- `tasks/config_poll_plan.json`
- `data/action_profiles`
- `data/actuators`
- `data/action_units`
- `data/action_tasks`
- `data/action_rules`
- `data/action_schedules`
- `data/automation`
- `data/protocols_user`

安装后 `postinst` 只在目标不存在时复制默认值到 `/var/lib/hydrocore`。因此：

- 首次安装有完整默认预设。
- 升级不会覆盖现场改过的计划、动作、GPIO、任务配置。
- 数据库、日志、runtime 状态不进入包，也不会被升级覆盖。

## systemd 策略

服务名：

```text
hydrocore.service
hydrocore-kiosk-deps.service
hydrocore-kiosk.service
hydrocore-watchdog.timer
```

运行用户：

```text
hydrocore
```

权限：

- 加入 `dialout` 组访问串口。
- 如果系统存在 `gpio` 组，也加入 `gpio`。
- 如果系统存在 `video`、`render`、`input`、`audio` 组，也加入，用于本机屏幕 kiosk。
- 程序文件只读，运行数据只写 `/var/lib/hydrocore`。

服务分层：

- `hydrocore.service` 是核心控制服务，使用随包 vendor Python 和 gunicorn 单 worker 运行 Flask 应用和后台采集线程。
- `hydrocore-kiosk-deps.service` 是一次性离线依赖安装服务，使用 `/opt/hydrocore/offline-debs` 作为本地 apt 仓库安装 Chromium、`labwc`/`cage`、`squeekboard`、`wlr-randr`。它会等待 dpkg 锁释放，避免和主包安装抢锁。
- `hydrocore-kiosk.service` 是可选本机 HMI，只负责在 tty1 用 `labwc` 或 `cage` 加 Chromium 全屏显示 `http://127.0.0.1:5000/ui/`。
- `hydrocore-screen-apply.path` 监听 `/var/lib/hydrocore/runtime/screen_apply.request`。后端保存屏幕方向后写入这个请求文件，root 服务再读取 `screen.json` 并写入系统启动配置；不做运行时旋转，不重启 HMI。
- `hydrocore-screen-boot.service` 在本机 HMI 启动前确认本次启动已应用的触摸方向，再为 kiosk 写入 active 方向。kiosk 只读取 active 方向，避免保存配置后未重启时出现画面和触摸半生效。
- `hydrocore-watchdog.timer` 每分钟检查本机 HTTP 接口，失败时重启核心服务。

安装后默认把系统启动目标切到 `multi-user.target`，并停止常见 display manager。核心服务不依赖桌面、不依赖系统预装浏览器；本机屏幕依赖由随包离线仓库补齐，然后启用 kiosk。

安装时会清理旧的 `/var/lib/hydrocore/runtime/reboot.request`，避免历史重启请求在升级期间再次触发。

## 离线依赖策略

当前 `.deb` 内置以下应用运行依赖：

- Flask / Werkzeug / Jinja2 / MarkupSafe
- pyserial
- gunicorn
- gpiozero / colorzero
- arm64 `lgpio` Python 模块、`_lgpio` 扩展和 `liblgpio.so.1`

因此核心 Web 服务、串口采集、GPIO/PWM 输出不需要联网安装 Python 包或 apt Python 包。

当前 `.deb` 还内置 Bookworm arm64 的本机屏幕离线 apt 仓库：

- 根组件：Chromium、`labwc`、`cage`、`squeekboard`、`wlr-randr`
- 离线闭包：按空 dpkg 状态、`--no-install-recommends` 计算，共 331 个 `.deb`
- 安装位置：`/opt/hydrocore/offline-debs`
- 安装方式：`hydrocore-kiosk-deps.service` 只使用 `file:/opt/hydrocore/offline-debs`，不会访问在线 apt 源

在已有 Raspberry Pi OS 上，apt 会跳过已满足的基础包；在更干净的 Lite 系统上，本地仓库用于补齐缺失的图形栈依赖。

## 构建策略

`tools/build_deb.py` 使用纯 Python 生成 Debian binary package：

```text
debian-binary
control.tar.gz
data.tar.gz
```

这样在 Windows 开发机也可构建 `.deb`，不依赖本机安装 `dpkg-deb`。

## 安装验证

目标设备上执行：

```bash
sudo apt install ./hydrocore-ai_*.deb
systemctl status hydrocore
systemctl status hydrocore-kiosk-deps
systemctl status hydrocore-kiosk
systemctl status hydrocore-watchdog.timer
hydrocore-ctl status
sudo hydrocore-ctl selfcheck
sudo hydrocore-ctl selfcheck --strict-kiosk
hydrocore-ctl logs
```

浏览器访问：

```text
http://<设备IP>:5000/ui/
```
