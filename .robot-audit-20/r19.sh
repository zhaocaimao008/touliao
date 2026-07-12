#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R19.md"
echo "# R19 · 构建/CI/部署" > $F
echo "## CI workflows" >> $F
ls $ROOT/.github/workflows/ 2>/dev/null >> $F
echo "## 构建脚本 (web package.json scripts)" >> $F
echo '```' >> $F
grep -A15 '"scripts"' $ROOT/web/package.json 2>/dev/null | head -18 >> $F
echo '```' >> $F
echo "## source map 泄漏风险 (dist 是否含 .map)" >> $F
echo "dist .map 文件: $(find $ROOT/web/dist -name '*.map' 2>/dev/null | wc -l)" >> $F
echo "## .env 是否被 gitignore" >> $F
grep -nE '\.env|secret|keystore|\.db' $ROOT/.gitignore 2>/dev/null | head >> $F
echo "## 敏感文件是否入库 (git 追踪)" >> $F
echo '```' >> $F
cd $ROOT && git ls-files 2>/dev/null | grep -iE '\.env$|secret|password|keystore|\.pem$|\.key$' | head -15 >> $F
echo '```' >> $F
echo "## 部署脚本" >> $F
ls $ROOT/deploy.sh $ROOT/deploy/ 2>/dev/null | head >> $F
echo "## 建议: 生产关闭 sourcemap 或不发布；确认 .env/keystore 不入库；CI 加 lint+test 门禁" >> $F
echo "DONE R19"
