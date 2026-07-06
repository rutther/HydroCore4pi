# HydroCore 3.1 - AI 重制版

本仓库当前主线是 `hydrocore3.1`，定位为循环水处理边缘控制端软件。

## 当前状态

- 版本标记：AI 重制版
- 运行目标：树莓派 / Debian 系 Linux 边缘端
- 主要能力：传感器采集、数据仪表、硬件配置、动作配置、任务计划、系统设置
- 部署目标：支持打包为 `.deb`，方便在其他硬件上安装和迁移

## 项目入口

- 应用目录：`hydrocore3.1/`
- 后端入口：`python3 -m backend.app`
- 前端入口：`/ui/`
- 默认端口：`5000`

## 打包方向

软件文件安装到 `/opt/hydrocore`，运行数据保存在 `/var/lib/hydrocore`，可编辑环境配置放在 `/etc/hydrocore`。升级包不应覆盖现场运行数据。

详细打包方案见：

- `hydrocore3.1/docs/debian_packaging_plan.md`

