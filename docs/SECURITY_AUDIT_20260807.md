# v信 系统安全审计报告

- **日期**：2026-08-07
- **审计版本**：`4ab3e05`（desktop 2.0.41 / android 1.0.41 code42 / iOS 1.0.25 build25）
- **范围**：backend-v2 鉴权与越权、钱包与红包资金账本、消息与媒体水平越权、依赖漏洞、密钥泄露
- **测试基线**：`npm test` 24 suites / 147 passed / 1 skipped，全绿

---

## 0. 结论摘要

| 编号 | 等级 | 问题 | 状态 |
|------|------|------|------|
| S-1 | **严重** | 历史提交 `backend_backup/.env` 泄露全套生产密钥，且 VAPID 私钥至今未轮换 | **待修** |
| S-2 | **高** | 充值接口无支付网关，任意用户可自助无限增加余额 | **待修（设计缺陷）** |
| S-3 | 中 | 依赖漏洞：后端 5 high / web 2 critical + 10 high | **待修** |
| S-4 | 低 | `ADMIN_IP_WHITELIST` 默认为空，后台无 IP 限制 | 建议加固 |
| S-5 | 低 | admin 无操作审计日志，发币/改权限无法追溯 | 建议加固 |

鉴权、越权、SQL 注入、XSS 四个主要攻击面**未发现可利用漏洞**，实现质量高于同类项目平均水平。

---

## 1. 鉴权与越权（未发现漏洞）

`middleware/auth.js` 实现扎实，逐项确认：

- JWT 仅从 httpOnly Cookie / Bearer 读取，**从不进响应体或 localStorage** → 免疫 XSS 窃取
- 强制 `algorithms: ['HS256']` → 免疫算法混淆（`alg: none` / RS256→HS256）
- 每请求校验 `banned` → 封禁用户凭既有 token 无法继续调用接口或用 `/refresh` 续签
- 校验 `payload.iat < password_changed_at` → 改密后旧 token 立即失效
- token 黑名单（logout）检查失败时**不降级放行**，返回 503 → 无 fail-open

`adminAuth.js` 使用独立 Cookie `vxin_admin_token` + 独立 `ADMIN_JWT_SECRET` + 强制 `payload.admin === true`。普通用户 token 无法越权进后台，**密钥隔离正确**。生产环境未配 `ADMIN_JWT_SECRET` 直接启动中止，无弱默认值兜底。

CSRF 采用双提交 Cookie。Bearer 请求跳过校验这一点**判断正确**——第三方站点无法设置自定义 header，不构成绕过。

水平越权已在数据层收口：`shared.js` 的 `requireMember()` 被 `/messages/media`、红包 `send`/`detail`/`claim`、群管理等全部敏感路径调用；`GET /messages/media` 的查询本身以 `conversation_id` + 成员校验双重约束，**无法读取他人会话媒体**。拉黑（`privateSendBlockReason`）与屏蔽陌生人（`strangerBlockReason`）覆盖了文本与文件全部发送路径，堵住了「只拦文本不拦图片」的骚扰绕过。

## 2. 资金安全（账本实现正确，但充值是设计缺陷）

**做对的部分（值得保留）：**

- `applyDeltaTx` 用**原子 CAS**：`UPDATE ... WHERE balance+?>=0`，避免读-判-写 TOCTOU，多进程 WAL 下不会并发双扣
- 余额变动与流水写入**同一事务**，且发红包的扣款 + 建包 + 发消息三写原子
- 领红包用 `.exclusive()` 事务，`claimed_count` 与 `SUM(amount)` 双重校验 → 无并发超发
- 重复领取由 `red_packet_claims` 唯一性拦截，**幂等成立**
- 过期回收 / 注销结算共用一把 `status` CAS（`active`→`expired`）互斥 → 同一红包只退一次，**不存在双花**
- 金额边界完备：充值 1~100000、红包 1~20000、个数 1~100、总额≥个数；全部 `Number.isInteger` 校验，负数与超大值均被拒

**S-2（高，设计缺陷）**：`POST /api/wallet/recharge` 无任何支付网关，校验通过即 `applyDelta` 直接入账，代码注释自陈"占位"。当前限流 10 次/小时 × 100000 → **任意登录用户每小时可自造 100 万金币**，经红包转移给他人。红包资金链路做得再严密，入口无限印钞则整个账本经济意义归零。

> 若尚未真实运营（无真金支付），此项风险可接受；一旦开放付费必须先接支付回调。建议立即用环境变量 `ENABLE_FAKE_RECHARGE` 门控，生产默认关闭，避免遗忘上线。

## 3. SQL 注入（未发现漏洞）

全库扫描动态 SQL 拼接共 28 处，逐一核验**全部安全**：

- 绝大多数是 `IN (${ph})` 形式，`ph` 由 `map(()=>'?').join(',')` 生成，值全走占位符
- `updateSettings` / `groups.manage` 的 `SET` 子句列名来自**代码内白名单**（`normalizeSettings` / 显式解构三字段），不受用户输入控制
- `searchCollections` 的 `type` 经 `['text','image','file','video'].includes()` 白名单过滤；LIKE 关键词做了 `\ % _` 转义 + `ESCAPE '\'`，通配符注入亦被堵

全项目使用 better-sqlite3 `prepare()` 参数化，**未发现任何字符串插值进入值位置**。

## 4. XSS（未发现漏洞）

- 前端无 `dangerouslySetInnerHTML`、无 `eval`、无 `new Function`
- 唯一 `.innerHTML` 在 `web/src/perf-monitor.js:149`，插入内容全为自身采集的**数值型性能统计**（p50/p95/p99），无用户可控数据，且需手动调用 `showOverlay()` 才渲染 → 不可利用
- 后端启用 helmet

## 5. 密钥与凭据

### S-1（严重）历史密钥泄露

提交 `d71ec96`（blob `18cb277`）曾加入 `backend_backup/.env`，含 **JWT_SECRET、R2 访问密钥、VAPID 私钥、ADMIN_USERNAME/PASSWORD、INVITE_CODE** 全套生产凭据。该文件虽已从 HEAD 移除，但**仍存在于 git 历史对象中**，仓库为 GitHub 私有库 `zhaocaimao008/vxin-1.0`，任何有读权限者或未来一旦转公开即可 `git cat-file` 取出。

逐项比对当前 `backend-v2/.env`：

| 密钥 | 状态 |
|------|------|
| JWT_SECRET | ✅ 已轮换 |
| ADMIN_PASSWORD | ✅ 已轮换 |
| R2_ACCESS_KEY_ID | ✅ 已轮换 |
| INVITE_CODE | ✅ 当前未使用 |
| **VAPID_PRIVATE_KEY** | ❌ **仍在使用泄露值** |

VAPID 私钥泄露的实际影响：持有者可**伪造 Web Push 推送**，向所有订阅用户下发钓鱼通知（内容可任意伪装成 v信官方消息）。危害偏中等但完全真实，且轮换成本极低。

### 当前状态（正常）

- HEAD 中已提交的 `web/.env.*` 仅含 `VITE_` 前缀公开配置，**无机密**，文件内已有醒目警示注释
- `.gitignore` 覆盖 `.env` / `.env.*` / `*keystore*` / `*.jks` / `*.db`，规则完备
- `AuthKey_*.p8`、`.git-credentials`、`claude.env` 位于 `/root` 而非仓库内，**未被误提交**（全历史扫描确认）
- `wechat.db`（45MB 生产库）已被 `backend-v2/.gitignore` 排除

## 6. 依赖漏洞（S-3）

**后端** 16 项（0 critical / 5 high / 10 moderate）：

| 包 | 等级 | 说明 |
|----|------|------|
| `socket.io-parser` | high | 零附件内存耗尽 DoS —— **本项目直接暴露，优先级最高** |
| `ip-address` | high | 前导零octal解析歧义导致 SSRF 绕过 —— 与 push endpoint 校验相关，需关注 |
| `js-yaml` | high | YAML merge-key 二次CPU消耗 |
| `brace-expansion` / `fast-uri` | high | DoS / host confusion，多为传递依赖 |
| `file-type` | moderate | ASF 解析器无限循环 —— 上传路径使用，需关注 |

**Web** 18 项（2 critical / 10 high）：`tar`、`vitest` critical，`vite` / `undici` / `postcss` high。**多数为构建期依赖（vitest/vite/concurrently/capacitor-cli），不进生产 bundle，实际运行时风险显著低于数字观感。**

优先修 3 个真正影响运行时的：`socket.io-parser`、`ip-address`、`file-type`。

## 7. 其余加固建议

- **S-4**：`ADMIN_IP_WHITELIST` 默认空 = 后台仅靠账密 + TOTP 防护。后台已有 TOTP、可信设备、登录限流 10次/15min，基础不弱，但建议生产配置白名单。
- **S-5**：`grantCoins`（±100万）、`setPrivilege`、`resetPassword`、`deleteUser` 等高危 admin 操作**无审计日志**，一旦后台凭据泄露无法追溯。建议落 `admin_audit_log` 表。
- 已有针对性安全回归测试值得肯定：`push-endpoint-ssrf`、`user-search-privacy`、`delete-account-funds`、`stranger-block-file`、`redpacket-claim-expired`。

---

## 8. 修复优先级

1. **立即**：轮换 VAPID 密钥对（S-1）；确认 git 历史泄露的其他密钥无遗漏
2. **立即**：给 `/wallet/recharge` 加环境变量门控，生产关闭（S-2）
3. **本周**：升级 `socket.io-parser`、`ip-address`、`file-type`（S-3）
4. **规划**：admin 审计日志（S-5）、后台 IP 白名单（S-4）、git 历史清理（filter-repo，需协调所有协作者重新 clone）
