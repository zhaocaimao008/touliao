#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R15.md"
echo "# R15 · 后端安全" > $F
echo "## 认证/授权中间件" >> $F
echo "auth/jwt/verifyToken 引用: $(grep -rc -iE 'jwt|verifyToken|authenticate|requireAuth' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## rate-limit" >> $F
echo "rateLimit 使用: $(grep -rc -i 'ratelimit\|rate-limit' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## helmet / cors" >> $F
echo "helmet: $(grep -rc -i helmet $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}'), cors: $(grep -rc -i 'cors(' $BE --include=*.js 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 硬编码密钥/密码风险" >> $F
echo '```' >> $F
grep -rnE '(password|secret|apikey|api_key|token)\s*[:=]\s*["'"'"'][^"'"'"']{6,}' $BE --include=*.js 2>/dev/null | grep -viE 'process.env|req\.|require|import' | head -20 >> $F
echo '```' >> $F
echo "## SQL 拼接注入风险" >> $F
echo '```' >> $F
grep -rnE 'query\(.*\+|`SELECT.*\$\{|`INSERT.*\$\{|`UPDATE.*\$\{' $BE --include=*.js 2>/dev/null | head -20 >> $F
echo '```' >> $F
echo "## 上传处理" >> $F
grep -rc -iE 'multer|upload' $BE --include=*.js 2>/dev/null | grep -v ':0' | sed "s#$BE/##" | head >> $F
echo "## 建议: helmet+cors 白名单+rate-limit；参数化查询；密钥入 env；上传类型/大小校验" >> $F
echo "DONE R15"
