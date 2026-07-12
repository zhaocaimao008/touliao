#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R1.md"
echo "# R1 · 配色/令牌一致性" > $F
echo "" >> $F
echo "## 硬编码颜色 (应改用 design-tokens)" >> $F
echo '```' >> $F
grep -rnE '#[0-9a-fA-F]{3,8}\b' $WEB --include=*.jsx --include=*.css 2>/dev/null | grep -vi 'design-tokens.css' | head -60 >> $F
echo '```' >> $F
echo "硬编码HEX总数: $(grep -rohE '#[0-9a-fA-F]{3,8}\b' $WEB --include=*.jsx --include=*.css 2>/dev/null | grep -vic 'var(' )" >> $F
echo "" >> $F
echo "## rgba/rgb 硬编码" >> $F
echo '```' >> $F
grep -rnE 'rgba?\([0-9]' $WEB --include=*.jsx --include=*.css 2>/dev/null | head -30 >> $F
echo '```' >> $F
echo "" >> $F
echo "## design-tokens 定义的变量数" >> $F
echo "tokens: $(grep -c -- '--' $WEB/design-tokens.css 2>/dev/null)" >> $F
echo "" >> $F
echo "## 建议" >> $F
echo "- 将上述硬编码色迁移到 design-tokens.css 的 CSS 变量" >> $F
echo "- 建立 lint 规则禁止内联 hex/rgba" >> $F
echo "DONE R1"
