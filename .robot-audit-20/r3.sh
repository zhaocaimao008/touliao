#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R3.md"
echo "# R3 · 无障碍 A11y" > $F
BTN=$(grep -rc '<button' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
ARIA=$(grep -rc 'aria-' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
echo "## 统计" >> $F
echo "- <button> 总数: $BTN" >> $F
echo "- aria-* 使用: $ARIA" >> $F
echo "- role= 使用: $(grep -rc 'role=' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "- alt= (img): $(grep -rc 'alt=' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 无 alt 的 <img>" >> $F
echo '```' >> $F
grep -rn '<img' $WEB --include=*.jsx 2>/dev/null | grep -v 'alt=' | head -30 >> $F
echo '```' >> $F
echo "## 仅图标按钮缺少 aria-label (可点击 div/无文本 button)" >> $F
echo '```' >> $F
grep -rn 'onClick' $WEB --include=*.jsx 2>/dev/null | grep '<div' | grep -v 'aria-label' | grep -v 'role=' | head -30 >> $F
echo '```' >> $F
echo "## 可点击 div 总数 (应改用 button): $(grep -rn 'onClick' $WEB --include=*.jsx 2>/dev/null | grep -c '<div')" >> $F
echo "## 建议" >> $F
echo "- 图标按钮补 aria-label；可点击 div 改 <button> 并支持键盘 Enter/Space" >> $F
echo "- <img> 补 alt；检查颜色对比度 (需 R1 配合)" >> $F
echo "DONE R3"
