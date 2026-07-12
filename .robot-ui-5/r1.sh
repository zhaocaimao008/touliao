#!/bin/bash
source /root/v信/.robot-ui-5/_common.sh
F="$OUT/R1.md"
echo "# R1 · 配色 / 令牌一致性" > $F
echo "" >> $F
HEX=$(grep -rohE '#[0-9a-fA-F]{3,8}\b' $WEB --include=*.jsx --include=*.css 2>/dev/null | grep -vic 'var(')
RGBA=$(grep -rncE 'rgba?\([0-9]' $WEB --include=*.jsx --include=*.css 2>/dev/null | awk -F: '{s+=$2} END{print s}')
TOK=$(grep -c -- '--' $WEB/design-tokens.css 2>/dev/null)
echo "| 指标 | 数量 |" >> $F
echo "|---|---|" >> $F
echo "| 硬编码 HEX 色 | $HEX |" >> $F
echo "| 硬编码 rgb/rgba | $RGBA |" >> $F
echo "| design-tokens 变量数 | $TOK |" >> $F
echo "" >> $F
echo "## 硬编码色 Top 文件" >> $F
echo '```' >> $F
grep -rlE '#[0-9a-fA-F]{3,6}\b' $WEB --include=*.jsx 2>/dev/null | while read f; do c=$(grep -cE '#[0-9a-fA-F]{3,6}\b' "$f"); echo "$c ${f#$WEB/}"; done | sort -rn | head -12 >> $F
echo '```' >> $F
echo "## 样例（前 25 处内联 hex）" >> $F
echo '```' >> $F
grep -rnE '#[0-9a-fA-F]{3,6}\b' $WEB --include=*.jsx 2>/dev/null | head -25 | sed "s#$WEB/##" >> $F
echo '```' >> $F
echo "## 建议" >> $F
echo "- 内联 hex/rgba 迁移到 design-tokens.css CSS 变量（--brand-*, --titlebar-* 等）" >> $F
echo "- 新增 ESLint 规则禁止 jsx 内联 hex/rgba" >> $F
echo "DONE R1"
