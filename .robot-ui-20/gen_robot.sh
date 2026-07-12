#!/usr/bin/env bash
# 生成机器人脚本：参数 = 编号 + 文件列表
ROOT="/root/v信"; SRC="$ROOT/web/src"; REP="$ROOT/.robot-ui-20/reports"
mkr() {
  local n="$1"; shift; local files="$*"
  cat > "r$n.sh" <<EOF
#!/usr/bin/env bash
ROOT="/root/v信"; SRC="\$ROOT/web/src"; REP="\$ROOT/.robot-ui-20/reports"
OUT="\$REP/R$n.md"
echo "# R$n 报告" > "\$OUT"
echo "" >> "\$OUT"
echo "负责文件: $files" >> "\$OUT"
echo "" >> "\$OUT"
for rel in $files; do
  f="\$SRC/\$rel"
  [ -f "\$f" ] || { echo "- MISSING \$rel" >> "\$OUT"; continue; }
  div=\$(grep -cE 'div[^>]*onClick' "\$f")
  sty=\$(grep -c 'style={{' "\$f")
  hex=\$(grep -oE '#[0-9A-Fa-f]{3,8}' "\$f" | sort -u | tr '\n' ' ')
  keyi=\$(grep -cE 'key={i}|key={index}|key={idx}' "\$f")
  memo=\$(grep -c 'React.memo\|memo(' "\$f")
  lines=\$(wc -l < "\$f")
  echo "## \$rel (\$lines 行)" >> "\$OUT"
  echo "- 可点击 div onClick: \$div" >> "\$OUT"
  echo "- 内联 style: \$sty" >> "\$OUT"
  echo "- 硬编码 hex: \${hex:-无}" >> "\$OUT"
  echo "- key={i} 隐患: \$keyi" >> "\$OUT"
  echo "- React.memo: \$memo" >> "\$OUT"
  echo "" >> "\$OUT"
done
echo "DONE R$n"
EOF
  chmod +x "r$n.sh"
}
mkr 1  "components/ContactList.jsx"
mkr 2  "components/Profile.jsx"
mkr 3  "components/ChatWindow.jsx"
mkr 4  "components/Moments.jsx"
mkr 5  "components/GroupInfo.jsx"
mkr 6  "components/CallModal.jsx"
mkr 7  "components/ChatList.jsx"
mkr 8  "components/ForwardModal.jsx"
mkr 9  "components/UserProfile.jsx"
mkr 10 "components/StickerPanel.jsx"
mkr 11 "components/CallHistory.jsx"
mkr 12 "components/Collections.jsx"
mkr 13 "components/AddFriendModal.jsx"
mkr 14 "components/GlobalSearch.jsx"
mkr 15 "components/MessageItem.jsx"
mkr 16 "components/Avatar.jsx components/AuthImage.jsx"
mkr 17 "components/ElectronTitlebar.jsx"
mkr 18 "components/RedPacketModal.jsx components/VoicePlayer.jsx"
mkr 19 "components/EmojiPicker.jsx components/ReconnectingBanner.jsx components/GroupCallModal.jsx"
mkr 20 "index.css design-tokens.css mobile-adapt.css"
echo "generated 20 robots"
