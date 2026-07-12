#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R18.md"
echo "# R18 · 后端性能" > $F
echo "## 缓存使用 (redis/node-cache/lru)" >> $F
echo "$(grep -rc -iE 'redis|node-cache|lru-cache|memcache' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 同步阻塞调用 (Sync 后缀 / fs.readFileSync 等)" >> $F
echo '```' >> $F
grep -rnE '[a-zA-Z]+Sync\(' $BE --include=*.js 2>/dev/null | grep -v 'node_modules' | head -25 >> $F
echo '```' >> $F
echo "同步调用总数: $(grep -rcE '[a-zA-Z]+Sync\(' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 连接池/DB 初始化" >> $F
grep -rn 'new Database\|createPool\|pool' $BE --include=*.js 2>/dev/null | head -10 >> $F
echo "## 大 JSON 解析/无分页查询" >> $F
echo "LIMIT 使用: $(grep -rc -i 'LIMIT' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}'), 分页 offset/page: $(grep -rc -iE 'offset|page' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 压缩中间件" >> $F
echo "compression: $(grep -rc -i compression $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 建议: 热数据加 redis/LRU；避免请求路径同步IO；列表接口分页；启用 gzip 压缩" >> $F
echo "DONE R18"
