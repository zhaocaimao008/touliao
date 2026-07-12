#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R17.md"
echo "# R17 · 数据库/SQL" > $F
echo "## DB 文件" >> $F
ls -lh $ROOT/backend-v2/*.db 2>/dev/null | awk '{print $5,$9}' >> $F
echo "## 查询语句总数" >> $F
echo "SELECT/INSERT/UPDATE/DELETE: $(grep -rciE 'SELECT |INSERT |UPDATE |DELETE ' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 索引定义 (CREATE INDEX)" >> $F
echo "索引数: $(grep -rciE 'CREATE INDEX|CREATE UNIQUE INDEX' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 表定义" >> $F
grep -rnoiE 'CREATE TABLE[^(]*' $BE --include=*.js 2>/dev/null | head -30 >> $F
echo "## SELECT * 使用 (取全列低效)" >> $F
echo "SELECT *: $(grep -rciE 'SELECT \*' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 循环内查询 (N+1 风险 - for/map 内含 db 调用)" >> $F
echo '```' >> $F
grep -rnB2 -iE 'db\.(get|all|run|prepare)|\.query\(' $BE --include=*.js 2>/dev/null | grep -iE 'for |\.map\(|forEach' | head -15 >> $F
echo '```' >> $F
echo "## 事务使用: $(grep -rc -iE 'BEGIN|transaction|db.transaction' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 建议: 高频查询列建索引；避免 SELECT *；消除循环内查询(批量IN)；写操作用事务" >> $F
echo "DONE R17"
