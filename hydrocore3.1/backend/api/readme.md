测试命令

最近 2 小时，10s 分桶，avg：

```bash
curl -s "http://127.0.0.1:5000/api/v1/data/series?protocol=lanchang_ec&address=10&parameter=ec_value&bucket=10s&agg=avg&round=3&from=$(date '+%F %T' -d '-2 hours')&to=$(date '+%F %T')" | head -c 400
```

最近 24 小时，1h 分桶，max：

```bash
curl -s "http://127.0.0.1:5000/api/v1/data/series?protocol=lanchang_ph&address=9&parameter=temperature&bucket=1h&agg=max&round=2" | head -c 400
```

1d 分桶，ohlc（K线数据）：

```bash
curl -s "http://127.0.0.1:5000/api/v1/data/series?protocol=lanchang_ec&address=10&parameter=ec_value&bucket=1d&agg=ohlc&round=3&from=$(date '+%F %T' -d '-7 days')&to=$(date '+%F %T')" | head -c 400
```

导出 CSV（30m 分桶，avg）：

```bash
curl -s -D- "http://127.0.0.1:5000/api/v1/data/export.csv?protocol=lanchang_ec&address=10&parameter=tds_value&bucket=30m&agg=avg&round=2&from=$(date '+%F %T' -d '-1 day')&to=$(date '+%F %T')" | head
```


路由检查

```bash
python - <<'PY'
from backend.app import app
for r in sorted(app.url_map.iter_rules(), key=lambda x: x.rule):
    print(f"{sorted(list(r.methods))} -> {r.rule}")
PY
```