#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R12.md"
echo "# R12 · 渲染性能" > $F
echo "## 长列表虚拟化" >> $F
echo "VirtualMessageList 存在: $([ -f $WEB/components/VirtualMessageList.jsx ] && echo yes)" >> $F
echo "react-window/virtual 引用: $(grep -rc -iE 'react-window|virtual|react-virtuoso' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 大列表 .map 但未虚拟化的组件" >> $F
echo '```' >> $F
for f in ChatList ContactList Moments CallHistory Collections; do
  ff="$WEB/components/$f.jsx"
  [ -f "$ff" ] && echo "$f: map=$(grep -c '\.map(' $ff) virtual=$(grep -ic virtual $ff) memo=$(grep -c 'memo(' $ff)"
done >> $F
echo '```' >> $F
echo "## memo 化情况" >> $F
echo "各组件 export default 是否 memo:" >> $F
grep -rln 'export default' $WEB/components --include=*.jsx 2>/dev/null | while read f; do
  m=$(grep -c 'memo(' "$f"); echo "${f#$WEB/components/}: memo=$m";
done | grep 'memo=0' | head -25 >> $F
echo "## 建议: ContactList/Moments 等长列表虚拟化；纯展示子组件 React.memo；MessageItem 已在长列表建议 memo" >> $F
echo "DONE R12"
