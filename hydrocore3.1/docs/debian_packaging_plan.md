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

/usr/share/hydrocore/defaults   默认预设，只读种子
/var/lib/hydrocore              运行数据，升级保留
/var/lib/hydrocore/db           SQLite 数据库
/var/lib/hydrocore/logs         应用日志
/var/lib/hydrocore/protocols_user 用户导入协议

/etc/hydrocore/hydrocore.env    环境配置，作为 conffile
/lib/systemd/system/hydrocore.service
/usr/bin/hydrocore-ctl          运维辅助命令
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
```

运行用户：

```text
hydrocore
```

权限：

- 加入 `dialout` 组访问串口。
- 如果系统存在 `gpio` 组，也加入 `gpio`。
- 程序文件只读，运行数据只写 `/var/lib/hydrocore`。

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
hydrocore-ctl status
hydrocore-ctl logs
```

浏览器访问：

```text
http://<设备IP>:5000/ui/
```

