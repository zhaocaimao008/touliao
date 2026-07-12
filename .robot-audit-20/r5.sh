#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R5.md"
echo "# R5 · 移动端适配" > $F
echo "## viewport / safe-area" >> $F
echo "- index.html viewport:" >> $F
grep -i 'viewport' $ROOT/web/index.html >> $F 2>/dev/null
echo "- safe-area-inset 使用: $(grep -rc 'safe-area-inset' $WEB 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "- env( 使用: $(grep -rc 'env(safe-area' $WEB 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 触控目标 (按钮/可点击 min 尺寸) - 小于44px 风险" >> $F
echo '```' >> $F
grep -rnoE '(width|height|min-width|min-height):\s*[0-9]{1,2}px' $WEB --include=*.css 2>/dev/null | awk -F: '{n=$NF; gsub(/[^0-9]/,"",n); if(n+0<44) print}' | head -30 >> $F
echo '```' >> $F
echo "## 媒体查询断点分布" >> $F
grep -rohE '@media[^{]*' $WEB --include=*.css 2>/dev/null | sort | uniq -c | sort -rn >> $F
echo "## mobile-adapt.css 行数: $(wc -l < $WEB/mobile-adapt.css 2>/dev/null)" >> $F
echo "## 固定宽度 (非响应, px 宽度)" >> $F
echo '```' >> $F
grep -rn 'width:.*[0-9]px' $WEB --include=*.css 2>/dev/null | grep -viE 'max-width|min-width|border|1px|2px|3px' | head -20 >> $F
echo '```' >> $F
echo "## 建议: 触控目标≥44px；固定px宽度改 % / max-width；补 safe-area" >> $F
echo "DONE R5"
