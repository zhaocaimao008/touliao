#!/bin/bash
source /root/v信/.robot-ui-5/_common.sh
F="$OUT/R5.md"
echo "# R5 · 移动端适配" > $F
echo "" >> $F
SAFE=$(grep -rnic 'safe-area\|env(safe' $WEB --include=*.jsx --include=*.css 2>/dev/null | awk -F: '{s+=$2} END{print s}')
MQ=$(grep -rnc '@media' $WEB --include=*.css 2>/dev/null | awk -F: '{s+=$2} END{print s}')
VW=$(grep -rnc 'vw\|vh\|dvh' $WEB --include=*.css 2>/dev/null | awk -F: '{s+=$2} END{print s}')
echo "| 指标 | 数量 |" >> $F
echo "|---|---|" >> $F
echo "| safe-area 使用 | $SAFE |" >> $F
echo "| @media 查询 | $MQ |" >> $F
echo "| vw/vh/dvh 单位 | $VW |" >> $F
echo "" >> $F
echo "## 断点分布 (@media 值)" >> $F
echo '```' >> $F
grep -rohE '@media[^{]*' $WEB --include=*.css 2>/dev/null | grep -oE '(max|min)-width:\s*[0-9]+px' | sort | uniq -c | sort -rn >> $F
echo '```' >> $F
echo "## 触控目标偏小 (width/height < 44px 的可点击元素)" >> $F
echo '```' >> $F
grep -rnE '(width|height):\s*(2[0-9]|3[0-9]|4[0-3])(px)?\b' $WEB --include=*.jsx 2>/dev/null | grep -i 'onClick\|button\|icon\|btn' | head -20 | sed "s#$WEB/##" >> $F
echo '```' >> $F
echo "## viewport meta" >> $F
echo '```' >> $F
grep -rn 'viewport' $ROOT/web/index.html 2>/dev/null >> $F
echo '```' >> $F
echo "## 建议" >> $F
echo "- 触控命中区 ≥44px；补平板/大屏断点(768/1024)" >> $F
echo "- safe-area 覆盖顶栏/底栏；长内容用 dvh 避免移动端地址栏抖动" >> $F
echo "DONE R5"
