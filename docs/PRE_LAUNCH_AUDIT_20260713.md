# 上线前全栈体检报告（2026-07-13）

多路并行审计后端(80文件)/Web(54)/Android(139)/iOS(90),覆盖安全、性能、可靠性、生产就绪度。
**总体结论：达到上线要求。** 无 Critical/High 阻塞项；已修 1 项安全加固；其余为可接受的设计权衡，附建议。

---

## ✅ 通过项（证据）

| 维度 | 结论 | 证据 |
|------|------|------|
| **后端测试** | 全绿 | 20 套件 / 134 用例通过 / 0 失败 / 1 跳过 |
| **SQL 注入** | 无 | 全部参数化 prepare()，无字符串拼接 |
| **硬编码密钥** | 无 | 全部走 process.env，客户端无明文密钥 |
| **危险函数** | 无 | 无 eval/命令执行（regex.exec/db.exec 属正常） |
| **HTTP 安全头** | 完备 | helmet + CSP + CORS 白名单 + credentials |
| **限流** | 完备 | 22 个限流器覆盖登录/注册/上传/改密等 |
| **鉴权** | 完备 | JWT + 黑名单 + /uploads 静态资源鉴权 |
| **启动校验** | 严格 | JWT_SECRET/ADMIN_JWT_SECRET <32 字符即 exit(1) 拒绝启动 |
| **崩溃防护** | 完备 | uncaughtException/unhandledRejection/优雅关闭齐全 |
| **事务** | 规范 | 资金/注销/红包等关键路径用 db.transaction |
| **监控** | 接入 | Sentry + /health + /api/metrics（生产 404 保护，无泄漏） |
| **DB 性能** | 优化 | WAL + 33 索引 + 32MB cache + 256MB mmap + 写 worker 线程 |
| **Web 依赖漏洞** | 0 | npm audit: found 0 vulnerabilities |
| **XSS** | 无 | 无 dangerouslySetInnerHTML |

---

## 🔧 已修复（本次）

**[安全加固] JSON/表单 body 无体积上限 → DoS 风险**
- `express.json()` 原未设 limit，超大请求体可撑爆内存。
- 已加 `limit: '1mb'`（文本消息最长 2000 字，大文件走分片上传，1MB 足够）。
- commit `f556fa4`。

---

## ⚠️ 观察项（非阻塞，建议后续处理）

1. **9 个 moderate 依赖漏洞（后端）** — 全部是 `firebase-admin` 的深层传递依赖（uuid 边界检查 / file-type ASF 解析）。
   - 无实际暴露面（不在请求路径），修复需 firebase-admin 大版本升级（有破坏性，风险大于收益）。
   - **建议**：单独排期升级 firebase-admin 并回归推送功能，非上线阻塞。

2. **Android `usesCleartextTraffic=true`** — 允许 HTTP 明文。
   - 原因：App 支持用户自定义/自建服务器（可能是局域网 HTTP），是核心功能的合理权衡。
   - **建议**：后续可改用 network_security_config 仅对用户手动添加域名放行明文，默认强制 HTTPS。

3. **Web bundle 827KB（gzip 237KB）单文件内联、无路由级代码分割** — 首屏一次性加载。
   - 原因：单文件内联便于 Electron/Capacitor 内嵌，是刻意设计。
   - **建议**：若追求首屏速度，可对 Moments/Wallet/Profile 等非核心页做 React.lazy 分割（可选优化）。

4. **iOS 发布签名 Secret 未配置** — 仅影响 iOS 出包，不影响 Web/Android/后端上线。见 docs/IOS_SIGNING_SETUP.md。

---

## 结论

后端工程质量高（测试齐全、安全到位、生产就绪基建完善），Web/客户端无高危问题。
**可以上线。** 观察项均为可接受的设计权衡或低风险传递依赖，建议上线后按优先级排期处理。
