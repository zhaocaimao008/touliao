# v信 · 20 机器人 UI 修复分工 (2026-07-11)

策略：三端共用 web/src（Capacitor/Electron 套壳），改一处三端生效 → **无需重写各端**。
每个机器人独占若干文件，避免写冲突。任务=实际修复（非再体检）。

| R  | 负责文件 | 修复维度 |
|----|----------|----------|
| R1 | ContactList.jsx | 硬编码 hex→token、内联 style→常量、key={i}修复 |
| R2 | Profile.jsx | div onClick→IconButton、hex→token、style抽离 |
| R3 | ChatWindow.jsx | div onClick(13)→button、useEffect cleanup 复查 |
| R4 | Moments.jsx | style(28)抽离、key={i}(2)修复、div onClick |
| R5 | GroupInfo.jsx | div onClick(8)、style(19)、key={i} |
| R6 | CallModal.jsx | style(43)抽离、hex→token |
| R7 | ChatList.jsx | style(13)、div onClick(4)、key={i} |
| R8 | ForwardModal.jsx | div onClick(5)、style(10)、触控区≥44px |
| R9 | UserProfile.jsx | div onClick(5)、style(5) |
| R10| StickerPanel.jsx | style(10)、div onClick |
| R11| CallHistory.jsx | style(10)、skeleton三态、div onClick |
| R12| Collections.jsx | skeleton三态补齐 |
| R13| AddFriendModal.jsx | div onClick(3)、style |
| R14| GlobalSearch.jsx | div onClick(3)、key={i} |
| R15| MessageItem.jsx | React.memo、hex→token |
| R16| Avatar.jsx / AuthImage.jsx | memo、hex→token、alt |
| R17| ElectronTitlebar.jsx | hex→token (#1A2033/#E53E3E) |
| R18| RedPacketModal.jsx / VoicePlayer.jsx | div onClick、memo |
| R19| EmojiPicker.jsx / ReconnectingBanner.jsx / GroupCallModal.jsx | 一致性、memo |
| R20| index.css / design-tokens.css / mobile-adapt.css | 全局：触控区44px、圆角令牌收敛、断点 |
