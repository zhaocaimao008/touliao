#!/usr/bin/env bash
ROOT="/root/v信"; SRC="$ROOT/web/src"; REP="$ROOT/.robot-ui-20/reports"
OUT="$REP/R4.md"
echo "# R4 报告" > "$OUT"
echo "" >> "$OUT"
echo "负责文件: components/Moments.jsx" >> "$OUT"
echo "" >> "$OUT"
for rel in components/Moments.jsx; do
  f="$SRC/$rel"
  [ -f "$f" ] || { echo "- MISSING $rel" >> "$OUT"; continue; }
  div=$(grep -cE 'div[^>]*onClick' "$f")
  sty=$(grep -c 'style={{' "$f")
  hex=$(grep -oE '#[0-9A-Fa-f]{3,8}' "$f" | sort -u | tr '\n' ' ')
  keyi=$(grep -cE 'key={i}|key={index}|key={idx}' "$f")
  memo=$(grep -c 'React.memo\|memo(' "$f")
  lines=$(wc -l < "$f")
  echo "## $rel ($lines 行)" >> "$OUT"
  echo "- 可点击 div onClick: $div" >> "$OUT"
  echo "- 内联 style: $sty" >> "$OUT"
  echo "- 硬编码 hex: ${hex:-无}" >> "$OUT"
  echo "- key={i} 隐患: $keyi" >> "$OUT"
  echo "- React.memo: $memo" >> "$OUT"
  echo "" >> "$OUT"
done
echo "DONE R4"
