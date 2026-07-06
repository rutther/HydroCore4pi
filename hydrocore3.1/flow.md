1.激活环境（注意在hydrocore3.1 目录下执行）
source hy3.1/bin/activate
2.安装依赖
pip install -r requirements.txt
3.启动服务
python -m backend.app

4.检查
4.1网络检查
4.2数据库检查
4.2.1数据库文件存在与大小
cd ~/app/hydrocore3.1
ls -lh data/db/hydro.db
4.2.2自检（应该返回OK）
sqlite3 data/db/hydro.db "PRAGMA integrity_check;"
4.2.3传感器数据时间范围与总点数
sqlite3 data/db/hydro.db "
SELECT MIN(ts) AS min_ts,
       MAX(ts) AS max_ts,
       COUNT(*) AS n
FROM sensor_data;
"





4.2.4表和索引
# 表定义
sqlite3 data/db/hydro.db "
SELECT name, sql
FROM sqlite_master
WHERE type='table' AND name='sensor_data';
"



# 该表上的所有索引
sqlite3 data/db/hydro.db "
SELECT name, sql
FROM sqlite_master
WHERE type='index' AND tbl_name='sensor_data';
"





5.tree结构
cd ~/app/hydrocore3.1

tree -a -I 'hy3.1|ui|__pycache__'



冲突处理
git add <file_with_conflict>
git commit -m "Resolve merge conflicts"


推送git
git push -u origin main


tmux运行
tmux new -s hydrocore 'python3 -m backend.app'
查看
tmux attach -t hydrocore
仅退出会话
Ctrl+b
停止
tmux kill-session -t hydrocore