#!/bin/bash
source /root/v信/.robot-ui-5/_common.sh
F="$OUT/R4.md"
echo "# R4 · 空态 / 错误态 / 加载态" > $F
echo "" >> $F
SKEL=$(grep -rnic 'skeleton' $WEB --include=*.jsx --include=*.css 2>/dev/null | awk -F: '{s+=$2} END{print s}')
EMPTY=$(grep -rnic 'empty\|暂无\|没有\|空空' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
ERR=$(grep -rnic 'error\|失败\|出错' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
LOAD=$(grep -rnic 'loading\|加载中\|spinner' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')
echo "| 三态指标 | 命中数 |" >> $F
echo "|---|---|" >> $F
echo "| skeleton 骨架屏 | $SKEL |" >> $F
echo "| empty/空态文案 | $EMPTY |" >> $F
echo "| error/错误态 | $ERR |" >> $F
echo "| loading/加载态 | $LOAD |" >> $F
echo "" >> $F
echo "## 列表组件是否缺三态检查" >> $F
echo '```' >> $F
for c in ContactList ChatList Moments Collections CallHistory GlobalSearch; do
  f=$(find $WEB -name "$c.jsx" 2>/dev/null | head -1)
  [ -z "$f" ] && continue
  s=$(grep -ic 'skeleton' "$f"); e=$(grep -ic 'empty\|暂无\|没有' "$f"); l=$(grep -ic 'loading\|加载' "$f")
  echo "$c : skeleton=$s empty=$e loading=$l"
done >> $F
echo '```' >> $F
echo "## StateViews 组件" >> $F
echo '```' >> $F
grep -nE 'export|const .*=' $WEB/components/StateViews.jsx 2>/dev/null | head -20 >> $F
echo '```' >> $F
echo "## 建议" >> $F
echo "- 统一 <EmptyState/> <ErrorState/> <Skeleton/> 三态组件" >> $F
echo "- ChatList/ContactList/Moments 首屏补骨架屏" >> $F
echo "DONE R4"
