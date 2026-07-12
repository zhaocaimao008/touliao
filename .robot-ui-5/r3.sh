#!/bin/bash
source /root/v信/.robot-ui-5/_common.sh
F="$OUT/R3.md"
echo "# R3 · 无障碍 A11y" > $F
echo "" >> $F
BTN=$(grep -rc '<button' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
ARIA=$(grep -rc 'aria-' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
ROLE=$(grep -rc 'role=' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
CLICKDIV=$(grep -rn 'onClick' $WEB --include=*.jsx 2>/dev/null | grep -c '<div')
NOALT=$(grep -rn '<img' $WEB --include=*.jsx 2>/dev/null | grep -vc 'alt=')
echo "| 指标 | 数量 |" >> $F
echo "|---|---|" >> $F
echo "| <button> | $BTN |" >> $F
echo "| aria-* | $ARIA |" >> $F
echo "| role= | $ROLE |" >> $F
echo "| 可点击 <div onClick> | $CLICKDIV |" >> $F
echo "| <img> 缺 alt | $NOALT |" >> $F
echo "" >> $F
echo "## 可点击 div 缺 aria/role (样例)" >> $F
echo '```' >> $F
grep -rn 'onClick' $WEB --include=*.jsx 2>/dev/null | grep '<div' | grep -v 'aria-' | grep -v 'role=' | head -25 | sed "s#$WEB/##" >> $F
echo '```' >> $F
echo "## <img> 缺 alt (样例)" >> $F
echo '```' >> $F
grep -rn '<img' $WEB --include=*.jsx 2>/dev/null | grep -v 'alt=' | head -15 | sed "s#$WEB/##" >> $F
echo '```' >> $F
echo "## 建议" >> $F
echo "- 图标按钮统一 <IconButton aria-label>；可点击 div → button + Enter/Space" >> $F
echo "- 弹窗遮罩加 role=button + 键盘事件；img 补 alt" >> $F
echo "DONE R3"
