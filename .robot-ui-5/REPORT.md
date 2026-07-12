# v信 · UI 5 机器人同步体检 (2026-07-11)

范围：web 前端 (`web/src`, 41 个 jsx)。R1-R5 并行同步扫描。

## 总评分
| # | 机器人 | 关键数据 | 评级 |
|---|--------|---------|------|
| R1 | 配色/令牌 | 硬编码 HEX 319 + rgba 365；tokens 已有 329 | 🟠 待优化 |
| R2 | 布局/间距/圆角 | 内联 style 297；圆角 2~20 混用 11 种 | 🟠 待优化 |
| R3 | 无障碍 A11y | 可点击 div 73；img 缺 alt 3；aria 覆盖不错(193) | 🟡 中 |
| R4 | 三态 | error 344 好；skeleton 仅 22、多列表 skeleton=0 | 🟡 中 |
| R5 | 移动适配 | safe-area 22；断点较全；触控目标 22~24px 偏小 | 🟡 中 |

## 最该改的 6 件事（按投入产出）
| P | 事项 | 依据 |
|---|------|------|
| P0 | 可点击 div(73) → button/IconButton + 键盘 | R3；已有 IconButton 可复用 |
| P0 | ContactList/Collections/CallHistory 补 skeleton(=0) | R4 |
| P1 | 内联 style 297 抽 class/常量 (CallModal43/Profile34/Moments28) | R2 |
| P1 | 硬编码色 → design-tokens (ContactList18/CallModal10/Avatar10) | R1 |
| P1 | 圆角统一 --radius-sm/md/lg/full 替换 11 种魔法数 | R2 |
| P2 | 图标按钮触控区 →44px；补 min-width alt | R5/R3 |

## 亮点（已做好，勿破坏）
- design-tokens 已有 329 变量；StateViews 已封装 Skeleton/EmptyState/ErrorState(均 memo)
- IconButton 已存在，用于替换散落 div onClick
- aria(193)/role(167) 覆盖较好；断点覆盖 375~1024；viewport-fit=cover 已设
