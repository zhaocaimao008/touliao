#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R13.md"
echo "# R13 · 资源加载" > $F
echo "## 图片懒加载" >> $F
echo "<img> 总数: $(grep -rc '<img' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), loading=lazy: $(grep -rc 'loading="lazy"\|loading={.lazy' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 未懒加载的 <img>" >> $F
echo '```' >> $F
grep -rn '<img' $WEB --include=*.jsx 2>/dev/null | grep -v 'loading=' | head -25 >> $F
echo '```' >> $F
echo "## assets 大图 (>200KB)" >> $F
echo '```' >> $F
find $ROOT/web/src/assets $ROOT/web/public -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' \) 2>/dev/null -exec ls -lh {} \; | awk '$5 ~ /[0-9]M|[2-9][0-9][0-9]K/ {print $5, $9}' | head -20 >> $F
echo '```' >> $F
echo "## 字体加载" >> $F
grep -rn '@font-face\|fonts.googleapis' $WEB $ROOT/web/index.html 2>/dev/null | head >> $F
echo "## 建议: 消息/朋友圈图片 loading=lazy + 缩略图；大图转 webp；字体 preconnect/font-display:swap" >> $F
echo "DONE R13"
