#!/bin/bash
source /root/v信/.robot-audit-20/_common.sh
F="$OUT/R7.md"
echo "# R7 · 内存/订阅泄漏" > $F
echo "## addEventListener vs removeEventListener" >> $F
echo "add: $(grep -rc 'addEventListener' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), remove: $(grep -rc 'removeEventListener' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo '```' >> $F
grep -rl 'addEventListener' $WEB --include=*.jsx 2>/dev/null | while read f; do
  a=$(grep -c 'addEventListener' "$f"); r=$(grep -c 'removeEventListener' "$f");
  [ "$a" -gt "$r" ] && echo "泄漏风险 ${f#$WEB/}: add=$a remove=$r";
done >> $F
echo '```' >> $F
echo "## setInterval/setTimeout vs clear" >> $F
echo "setInterval: $(grep -rc 'setInterval' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), clearInterval: $(grep -rc 'clearInterval' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo '```' >> $F
grep -rl 'setInterval' $WEB --include=*.jsx 2>/dev/null | while read f; do
  a=$(grep -c 'setInterval' "$f"); r=$(grep -c 'clearInterval' "$f");
  [ "$a" -gt "$r" ] && echo "定时器未清理 ${f#$WEB/}: set=$a clear=$r";
done >> $F
echo '```' >> $F
echo "## socket/on 监听 vs off/removeListener" >> $F
echo ".on(: $(grep -rc '\.on(' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}'), .off(: $(grep -rc '\.off(' $WEB --include=*.jsx 2>/dev/null | awk -F: '{s+=$2} END{print s}')" >> $F
echo "## useEffect 缺 cleanup return" >> $F
echo "含订阅但 return 少的组件需人工复查" >> $F
echo "## 建议: 每个 add/on/setInterval 在 useEffect cleanup 中对应清理" >> $F
echo "DONE R7"
