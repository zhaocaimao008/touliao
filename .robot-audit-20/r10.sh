#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R10.md"
echo "# R10 · 死代码/依赖" > $F
echo "## console.* 残留 (生产不应有)" >> $F
echo "console 总数: $(grep -rc 'console\.' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo '```' >> $F
grep -rc 'console\.' $WEB --include=*.jsx 2>/dev/null | grep -v ':0' | sort -t: -k2 -rn | head -15 | sed "s#$WEB/##" >> $F
echo '```' >> $F
echo "## TODO/FIXME/HACK" >> $F
echo '```' >> $F
grep -rnE 'TODO|FIXME|HACK|XXX' $WEB --include=*.jsx 2>/dev/null | head -30 >> $F
echo '```' >> $F
echo "## 被注释掉的代码块 (// <jsx/js>)" >> $F
echo "疑似注释代码行: $(grep -rcE '^\s*//.*[;{}()]' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## npm 依赖审计 (web)" >> $F
echo '```' >> $F
cd $ROOT/web && npm audit 2>/dev/null | grep -E 'vulnerabilit|high|critical|moderate' | head -15 >> $F
echo '```' >> $F
echo "## 建议: 生产移除 console (babel plugin)；清理 TODO/注释代码；修复依赖漏洞" >> $F
echo "DONE R10"
