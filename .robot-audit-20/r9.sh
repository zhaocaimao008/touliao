#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R9.md"
echo "# R9 · 状态/Context/重渲染" > $F
echo "## Context 使用" >> $F
ls $WEB/contexts/ >> $F 2>/dev/null
echo "## useContext 调用: $(grep -rc 'useContext' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## useState 数量最多的组件 (状态过多需拆分)" >> $F
grep -rc 'useState' $WEB --include=*.jsx 2>/dev/null | grep -v ':0' | sort -t: -k2 -rn | head -15 | sed "s#$WEB/##" >> $F
echo "## useMemo/useCallback 使用" >> $F
echo "useMemo: $(grep -rc 'useMemo' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), useCallback: $(grep -rc 'useCallback' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), React.memo: $(grep -rc 'memo(' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## Context value 内联对象 (导致 consumer 全量重渲染)" >> $F
echo '```' >> $F
grep -rn 'Provider value={{' $WEB --include=*.jsx 2>/dev/null | head -20 >> $F
echo '```' >> $F
echo "## 建议: 大状态组件拆分/useReducer；Provider value 用 useMemo；按更新频率拆 Context" >> $F
echo "DONE R9"
