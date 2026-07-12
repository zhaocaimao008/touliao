#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R2.md"
echo "# R2 · 布局/间距/圆角/魔法数字" > $F
echo "## 内联 style 数量 (维护性差)" >> $F
echo "总内联 style=: $(grep -rc 'style={{' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo '```' >> $F
grep -rc 'style={{' $WEB --include=*.jsx 2>/dev/null | grep -v ':0' | sort -t: -k2 -rn | head -20 >> $F
echo '```' >> $F
echo "## 像素魔法数字 (px 硬编码 padding/margin/width)" >> $F
echo '```' >> $F
grep -rnoE '(padding|margin|width|height|top|left|right|bottom|gap|border-radius):[^;]*[0-9]+px' $WEB --include=*.css 2>/dev/null | head -40 >> $F
echo '```' >> $F
echo "## borderRadius 使用分布" >> $F
grep -rohE 'borderRadius:[^,}]*' $WEB --include=*.jsx 2>/dev/null | sort | uniq -c | sort -rn | head -20 >> $F
echo "## 建议" >> $F
echo "- 统一间距/圆角为 spacing/radius token (4/8/12/16px 梯度)" >> $F
echo "- 大量内联 style 抽到 CSS class 或样式常量" >> $F
echo "DONE R2"
