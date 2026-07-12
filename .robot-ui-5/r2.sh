#!/bin/bash
source /root/v信/.robot-ui-5/_common.sh
F="$OUT/R2.md"
echo "# R2 · 布局 / 间距 / 圆角" > $F
echo "" >> $F
INLINE=$(grep -rn 'style={{' $WEB --include=*.jsx 2>/dev/null | wc -l)
RADIUS=$(grep -rn 'borderRadius' $WEB --include=*.jsx 2>/dev/null | wc -l)
echo "| 指标 | 数量 |" >> $F
echo "|---|---|" >> $F
echo "| 内联 style={{}} | $INLINE |" >> $F
echo "| borderRadius 使用 | $RADIUS |" >> $F
echo "" >> $F
echo "## 内联 style Top 文件" >> $F
echo '```' >> $F
grep -rl 'style={{' $WEB --include=*.jsx 2>/dev/null | while read f; do c=$(grep -c 'style={{' "$f"); echo "$c ${f#$WEB/}"; done | sort -rn | head -12 >> $F
echo '```' >> $F
echo "## 圆角魔法数字分布" >> $F
echo '```' >> $F
grep -rohE 'borderRadius:\s*[0-9]+' $WEB --include=*.jsx 2>/dev/null | grep -oE '[0-9]+' | sort -n | uniq -c | sort -rn >> $F
echo '```' >> $F
echo "## 间距魔法数字 (padding/margin 数值)" >> $F
echo '```' >> $F
grep -rohE '(padding|margin)(Top|Bottom|Left|Right)?:\s*[0-9]+' $WEB --include=*.jsx 2>/dev/null | grep -oE '[0-9]+$' | sort -n | uniq -c | sort -rn | head -15 >> $F
echo '```' >> $F
echo "## 建议" >> $F
echo "- 定义 --radius-sm/md/lg/full (6/10/16/9999) 全量替换" >> $F
echo "- 间距用 4/8 梯度令牌；内联 style 抽为 class 或模块外常量" >> $F
echo "DONE R2"
