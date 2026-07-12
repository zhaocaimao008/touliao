# v信 彻底体检 · 20 机器人分工 (2026-07-11)

三大维度：UI / 功能 / 性能。全栈:前端(web) + 后端(backend-v2) + 桌面 + 移动。

## A. UI / 设计 (R1-R5)
| # | 机器人 | 范围 |
|---|--------|------|
| R1 | 配色/令牌一致性 | 硬编码色、AURORA 覆盖、亮暗一致 |
| R2 | 布局/间距/圆角 | 魔法数字、栅格违规、响应式断点 |
| R3 | 无障碍 A11y | aria、对比度、键盘导航、focus |
| R4 | 空态/错误态/加载态 | skeleton、empty、error UI 完整性 |
| R5 | 移动端适配 | safe-area、触控目标、viewport |

## B. 前端功能/质量 (R6-R10)
| # | 机器人 | 范围 |
|---|--------|------|
| R6 | React 反模式 | key、effect 依赖、内联函数、状态提升 |
| R7 | 内存/订阅泄漏 | listener/timer/socket 未清理 |
| R8 | 错误处理/边界 | try/catch、ErrorBoundary、Promise reject |
| R9 | 状态/Context | 重渲染、context 拆分、useMemo/useCallback |
| R10 | 死代码/依赖 | 未用 import、console、TODO、依赖漏洞 |

## C. 前端性能 (R11-R13)
| # | 机器人 | 范围 |
|---|--------|------|
| R11 | 打包体积 | bundle 大小、代码分割、单文件内联 |
| R12 | 渲染性能 | 长列表虚拟化、memo、重排 |
| R13 | 资源加载 | 图片懒加载、字体、缓存 |

## D. 后端 API/功能 (R14-R17)
| # | 机器人 | 范围 |
|---|--------|------|
| R14 | 路由/入参校验 | validation、错误处理、状态码 |
| R15 | 安全 | authz、CSRF、rate-limit、注入、上传 |
| R16 | 实时/Socket | handler、断线重连、事件校验 |
| R17 | 数据库/SQL | 注入、索引、N+1、事务 |

## E. 性能/运维/跨端 (R18-R20)
| # | 机器人 | 范围 |
|---|--------|------|
| R18 | 后端性能 | 慢查询、缓存、连接池、阻塞 |
| R19 | 构建/CI/部署 | 构建产物、workflow、脚本 |
| R20 | 桌面/移动/文档 | electron 安全、capacitor、一致性 |
