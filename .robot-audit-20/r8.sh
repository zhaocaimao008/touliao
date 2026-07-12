#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R8.md"
echo "# R8 · 错误处理/边界" > $F
echo "## ErrorBoundary 使用" >> $F
grep -rln 'ErrorBoundary' $WEB --include=*.jsx 2>/dev/null | sed "s#$WEB/##" >> $F
echo "## try/catch 覆盖" >> $F
echo "try: $(grep -rc 'try {' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), catch: $(grep -rc 'catch' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## .then 无 .catch 的 Promise" >> $F
echo '```' >> $F
grep -rl '\.then(' $WEB --include=*.jsx 2>/dev/null | while read f; do
  t=$(grep -c '\.then(' "$f"); c=$(grep -c '\.catch(' "$f");
  [ "$t" -gt "$c" ] && echo "${f#$WEB/}: then=$t catch=$c";
done >> $F
echo '```' >> $F
echo "## catch 块为空 (吞异常)" >> $F
echo '```' >> $F
grep -rnA1 'catch' $WEB --include=*.jsx 2>/dev/null | grep -B1 '{}' | head -20 >> $F
echo '```' >> $F
echo "## 建议: 顶层+关键子树包 ErrorBoundary；async 全 try/catch；避免空 catch" >> $F
echo "DONE R8"
