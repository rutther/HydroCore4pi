
1.关于config_poll_plan.json 的说明：

```
default_sampling_sec：默认采样周期（秒），不写则按此值；

default_persist_sec：默认落库周期（秒），不写则按此值；

align_persist_to_wall：是否把落库时间对齐到“整十秒、整分钟”这种频率机制；

round_to：落库写入前保留的小数位数（warning 这类状态量可设为 0 目前是不计划存 详见下方nonzero）；

agg_mode：连续量用 "avg"，状态量用 "last"；

event_only：

"nonzero"：仅在非 0 时落库；

"change"：仅在值发生变化时落库；

"nonzero_or_change"：满足其一即落库；

不写则每次落库都按聚合模式写入。

```
如果这个配置json寄了  那config_poller.py代码里面也是有默认值的
详见/task/config_poller.py