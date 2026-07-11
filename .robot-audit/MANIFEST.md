# v信 全面检查 · 10 机器人分工 (2026-07-11)

延续 AURORA 重设计风格，全栈体检 + 修复。仅在有明确缺陷时改动，核心功能不破坏。

| # | 机器人 | 负责范围 |
|---|--------|----------|
| R1  | 设计令牌一致性  | design-tokens/index.css：残留旧蓝/绿硬编码色、AURORA 未覆盖处 |
| R2  | 前端构建/依赖   | vite 构建、依赖版本、console 泄漏、死代码 |
| R3  | 前端组件 A11y   | 大组件(ChatWindow/Home/Profile) 无障碍/key/props 校验 |
| R4  | 前端状态/Context| Auth/Socket/Settings/I18n context、hooks 泄漏 |
| R5  | 后端 API 路由   | modules 路由入参校验、错误处理、鉴权中间件 |
| R6  | 后端实时/Socket | realtime handlers、断线重连、事件校验 |
| R7  | 后端安全        | CSRF/rate-limit/auth/SQL 注入/上传校验 |
| R8  | 数据库/一致性   | db schema、迁移、索引、SQL 语句 |
| R9  | 桌面/Electron   | electron main/preload 安全、CSP、IPC |
| R10 | 移动/构建/文档  | capacitor、android/ios、landing、脚本 |
