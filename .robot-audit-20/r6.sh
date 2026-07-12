#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R6.md"
echo "# R6 · React 反模式" > $F
echo "## 列表 key=index (反模式)" >> $F
echo '```' >> $F
grep -rnE 'key=\{[a-zA-Z]*(i|idx|index)\}' $WEB --include=*.jsx 2>/dev/null | head -30 >> $F
echo '```' >> $F
echo "## .map 无 key 风险" >> $F
echo "map总数: $(grep -rc '\.map(' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), key总数: $(grep -rc 'key=' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## useEffect 空依赖/缺依赖" >> $F
echo "useEffect总数: $(grep -rc 'useEffect' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo '```' >> $F
grep -rn 'useEffect' $WEB --include=*.jsx 2>/dev/null | wc -l >> $F
echo '```' >> $F
echo "## 内联箭头函数在 JSX (每渲染新建)" >> $F
echo "onClick={() => 内联总数: $(grep -rc 'onClick={() =>' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo '```' >> $F
grep -rc 'onClick={() =>' $WEB --include=*.jsx 2>/dev/null | grep -v ':0' | sort -t: -k2 -rn | head -15 >> $F
echo '```' >> $F
echo "## 建议: key 用稳定 id；高频子组件 memo + useCallback；抽出内联函数" >> $F
echo "DONE R6"
