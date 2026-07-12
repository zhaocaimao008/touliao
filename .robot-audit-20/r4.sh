#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R4.md"
echo "# R4 · 空态/错误态/加载态" > $F
echo "## 关键词覆盖" >> $F
echo "- loading 相关: $(grep -rc -iE 'loading|isLoading|加载中|spinner|skeleton' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "- error 态: $(grep -rc -iE 'error|失败|出错|retry|重试' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "- empty 空态: $(grep -rc -iE 'empty|暂无|没有|空空|nothing' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "- skeleton: $(grep -rc -i 'skeleton' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## 有列表渲染 (.map) 但可能缺空态的组件" >> $F
echo '```' >> $F
for f in $(grep -rl '\.map(' $WEB --include=*.jsx 2>/dev/null); do
  if ! grep -qiE 'empty|暂无|没有|length === 0|length == 0|length ? |!.*length' "$f"; then
    echo "缺空态判断?: ${f#$WEB/}"
  fi
done | head -30 >> $F
echo '```' >> $F
echo "## 有 fetch/await 但无 catch 的加载" >> $F
echo '```' >> $F
grep -rl 'await ' $WEB --include=*.jsx 2>/dev/null | while read f; do
  a=$(grep -c 'await ' "$f"); c=$(grep -c 'catch' "$f");
  [ "$a" -gt "$c" ] && echo "${f#$WEB/}: await=$a catch=$c";
done | head -30 >> $F
echo '```' >> $F
echo "## 建议: 统一 <EmptyState/> <ErrorState/> <Skeleton/> 三态组件" >> $F
echo "DONE R4"
