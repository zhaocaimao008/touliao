#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R14.md"
echo "# R14 · 后端 路由/入参校验" > $F
echo "## 路由文件" >> $F
find $BE -type f -name '*.js' 2>/dev/null | grep -iE 'route|controller|api' | sed "s#$BE/##" | head -40 >> $F
echo "## 路由数量" >> $F
echo "router.get/post/put/delete: $(grep -rcE 'router\.(get|post|put|delete|patch)' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 校验库使用 (joi/zod/express-validator)" >> $F
echo "$(grep -rc -iE 'joi|zod|express-validator|validate' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 直接使用 req.body 无校验风险" >> $F
echo "req.body 使用: $(grep -rc 'req.body' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo '```' >> $F
grep -rn 'req.body' $BE --include=*.js 2>/dev/null | head -25 >> $F
echo '```' >> $F
echo "## 错误处理中间件" >> $F
grep -rln 'err, req, res, next\|errorHandler' $BE --include=*.js 2>/dev/null | sed "s#$BE/##" >> $F
echo "## 建议: 引入 zod/joi 统一入参校验；集中 error 中间件返回规范状态码" >> $F
echo "DONE R14"
