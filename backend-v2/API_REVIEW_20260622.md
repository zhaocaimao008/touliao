# VXin v2 后端 API 系统性审查报告

**审查日期**: 2026-06-22
**范围**: `backend-v2/src/`（API 规范、返回结构、错误码、HTTP 状态码、错误处理、日志、朋友圈/收藏模块）
**结论**: 功能基本完整，但缺少统一的 API 契约约定。返回结构、状态码、错误格式各模块各行其是；收藏功能存在真实 bug（去重失效）；朋友圈缺少若干必要读接口。建议先确立规范，再分批整改。

---

## 1. API 规范问题审查

### 1.1 返回结构不统一（最突出问题）

同一后端内并存至少 5 种成功返回形态：

| 形态 | 出现位置 | 示例 |
|------|----------|------|
| 裸对象 | moments.create、users 等 | `{ id, content, author, ... }` |
| 裸数组 | `GET /moments`、`GET /messages/conversations` | `[ {...}, {...} ]` |
| `{ success: true }` | 删除/收藏/点赞类（统计 46 处） | `{ success: true }` |
| `{ ok: true }` | `/api/client-errors`、`/health` | `{ ok: true }` |
| 自定义字段 | 搜索、上传、点赞 | `{ results, total }` / `{ urls }` / `{ liked, likeCount }` |

**影响**：前端无法用统一的拦截器处理响应；裸数组无法在不破坏契约的情况下追加分页元信息（`total` / `hasMore`）；`success` 与 `ok` 混用，前端判断成功的逻辑要分接口写。

> 注：`utils/http.js` 注释明确写了"响应结构保持与旧后端逐字一致（裸 JSON，非信封）"——这是**有意为之的历史约束**，不能简单粗暴改成信封，否则会破坏在线的 Web/Electron 前端。规范须以"向后兼容"为前提（见 §2）。

### 1.2 HTTP 状态码使用过窄

- 创建资源（发动态、发消息、加好友）一律返回 **200**，从不用 **201 Created**。
- 删除/无返回体场景返回 `200 + {success:true}`，从不用 **204 No Content**。
- controller 里只显式用过 `401/403/500/503`，其余全靠 `ApiError` 的 `400/401/403/404`。
- 缺少 **409 Conflict**（重复收藏、重复好友申请、红包并发领取等冲突场景目前要么 400 要么静默）。
- 缺少 **422**（语义校验失败，目前全归到 400）。
- 限流命中应为 **429**，需确认 `rateLimiters` 是否统一返回 429（待核）。

### 1.3 错误返回格式过简

统一为 `{ error: "中文文案" }`（见 `middleware/error.js`）。问题：

- **没有机器可读的错误码**。前端只能靠匹配中文文案做分支（脆弱，且无法国际化）。
- 校验失败不返回**字段级**错误（哪个字段、为什么），客户端无法精确提示。
- `400` 既用于"参数缺失"也用于"业务规则不满足"，语义混在一起。

### 1.4 命名/路由一致性

- 资源层级混乱：**收藏**功能横跨三个路由前缀——`/users/me/collections`、`/messages/:msgId/collect`、`/stickers/collect`，没有统一的 `/collections` 资源。
- 会话/群组挂在 `/messages` 下（`/messages/conversations`、`/messages/my-groups`），而非独立的 `/conversations`、`/groups`，与 `src/modules/{conversations,groups}` 的模块划分不一致。
- 动作式 vs 资源式混用：`POST /moments/:id/like`（toggle，动作式）对比 RESTful 的 `PUT/DELETE`。toggle 语义可保留，但应在规范里明确"哪些用动作式"。
- 路径参数命名不统一：`:id` / `:msgId` / `:convId` / `:commentId` / `:userId` 并存（可接受，但需写进规范固定下来）。

---

## 2. 统一 API 设计规范建议（向后兼容版）

鉴于"裸 JSON 不可推翻"的历史约束，采用**渐进式**而非推倒重来：

### 2.1 响应结构

- **保留**现有裸 JSON 形态作为存量接口契约，不动。
- **新增**接口统一走信封：
  ```jsonc
  // 成功
  { "data": <payload>, "meta": { ... } }   // meta 可选，列表必带分页
  // 失败（全局统一）
  { "error": { "code": "MOMENT_NOT_FOUND", "message": "动态不存在", "fields": {} } }
  ```
- 过渡期：错误体兼容旧格式——`errorHandler` 同时输出顶层 `error`（字符串，兼容旧前端）**和** `error_code`（新增机器码），新前端读 `error_code`，旧前端继续读 `error`。这样零破坏地引入错误码。
- 列表统一返回 `{ items, total, hasMore }` 或 cursor 形式，禁止再新增裸数组接口。

### 2.2 HTTP 状态码约定

| 场景 | 状态码 |
|------|--------|
| 读取成功 | 200 |
| 创建成功 | 201（响应体带新资源） |
| 更新成功 | 200 |
| 删除成功 / 无返回体 | 204 |
| 参数缺失/格式错误 | 400 |
| 语义校验失败 | 422 |
| 未认证 | 401 |
| 无权限 | 403 |
| 资源不存在 | 404 |
| 状态冲突（重复、并发） | 409 |
| 限流 | 429 |
| 服务端错误 | 500；依赖不可用 503 |

### 2.3 错误码体系

- 定义集中式错误码枚举（如 `utils/errorCodes.js`），格式 `MODULE_REASON`：`AUTH_INVALID_CREDENTIALS`、`MOMENT_NOT_FOUND`、`COLLECTION_DUPLICATE` 等。
- `ApiError` 增加可选 `code` 字段；`badRequest/notFound` 等工厂支持传 code。

### 2.4 命名规范

- 资源用复数名词、kebab/无分隔小写：`/moments`、`/collections`、`/conversations`。
- 收敛收藏：规划统一 `/collections`（见 §4）。
- 路径参数统一为 `:id`（同一资源下），跨资源引用才加前缀（`:userId`）。

---

## 3. 错误处理与日志的不足及改进

### 3.1 错误处理

| # | 问题 | 改进 |
|---|------|------|
| E1 | `errorHandler` 用 `console.error` 打 500，**绕过了 winston**，不进 `error.log`、不结构化、Sentry 之外无统一归集 | 改用 `logger.error()`，带 requestId/userId/method/url |
| E2 | 无 **requestId / traceId**，一次请求的多条日志无法串联 | 加 `X-Request-Id` 中间件，注入 logger 与错误响应 |
| E3 | 错误码缺失（§1.3）；前端靠文案分支 | 引入错误码体系（§2.3） |
| E4 | `messages.service.collect` 等处把"已收藏"靠 `try/catch` 吞掉（且约束不存在，见 §4），异常被静默 | 显式查重 → 409，而非吞异常 |
| E5 | 业务 throw 普通 `Error`（非 `ApiError`）时若带 `status` 会被透传，否则 500——边界依赖隐式约定 | 统一只 throw `ApiError`；非 ApiError 一律视为未预期错误 |

### 3.2 日志

| # | 问题 | 改进 |
|---|------|------|
| L1 | `requestLogger` 记录完整 `req.query`，可能含手机号/搜索词/token（安全审计 L3 已提） | 敏感字段白名单脱敏 |
| L2 | 无 requestId 关联（同 E2） | — |
| L3 | 500 走 console 不进文件（同 E1） | — |
| L4 | 无慢查询/慢请求告警阈值落地到日志（`logPerformance` 存在但未接入请求链路） | 在 requestLogger 中对 `duration > 阈值` 升级为 warn |
| L5 | 业务关键操作（删动态、收藏、改密码、封号）无审计日志 | 关键写操作补 `logger.info('audit', {...})` |

---

## 4. 朋友圈 / 收藏 模块评估 + 待补接口清单

### 4.1 朋友圈（Moments）— 实现较完整

**已有**：时间线（本人+好友、分页、可见性过滤）、发布（图文/可见性）、图片上传、某用户动态、删除（级联）、点赞 toggle、评论、删评论，且带 Socket 实时事件（new_moment / moment_liked / moment_commented）。质量较高。

**缺口**：

| # | 缺失接口/能力 | 说明 | 优先级 |
|---|--------------|------|--------|
| MO1 | `GET /moments/:id` 单条详情 | 实时事件只推 momentId，客户端无法拉单条；点赞/评论后需要回查 | 高 |
| MO2 | 点赞/评论**通知**未落 notifications 表 | 只发了 socket 瞬时事件，离线用户丢失 | 高 |
| MO3 | `GET /moments/:id/likes`、`/comments` 分页 | 热门动态评论多时 `enrich` 一次性全查，无分页 | 中 |
| MO4 | 评论 `reply_to_user` 存的是字符串、无校验 | 应为 userId 并校验存在性 | 中 |
| MO5 | 可见性仅 all/friends/private，缺"部分可见/不给谁看" | 微信对标功能 | 低 |
| MO6 | 无举报/屏蔽某人朋友圈 | — | 低 |

### 4.2 收藏（Collections）— 存在真实 bug，且接口割裂

**已有**：`GET/POST/DELETE /users/me/collections`、`POST /messages/:msgId/collect`、`POST /stickers/collect`，共用 `collections` 表。

**问题（确凿）**：

1. 🔴 **去重失效（真实 bug）**：`users.service.addCollection` 用 `try/catch` 注释"unique constraint — already collected"来吞重复插入，但 `db/schema.js` 的 `collections` 表**根本没有 UNIQUE 约束**。结果：同一内容可被无限重复收藏，catch 是死代码。`messages.service.collect` 同样无查重，重复收藏同一条消息会产生多行。
2. 🟠 **写入字段不一致**：`messages.collect` 写 `extra = {file_url, source_msg_id}`；`addCollection` 写客户端任意 `extra`。同一张表语义不统一，前端渲染要分情况。
3. 🟠 **接口割裂**：三个不同前缀做同一件事，没有统一 `/collections` 资源，也没有"按类型筛选/分页"。
4. 🟠 `POST /messages/:msgId/collect` 成功返回 `{success:true}` 不回传新建的 collection id，前端拿不到刚收藏项。

**待补/整改接口清单**：

| # | 接口 | 说明 | 优先级 |
|---|------|------|--------|
| CO1 | 给 `collections` 加去重约束 + 修 addCollection/collect | 加 `UNIQUE(user_id, type, content)` 或基于 source 的去重键；重复返回 **409** | 高 |
| CO2 | 统一 `GET /collections?type=&limit=&offset=` | 收敛入口、支持按类型筛选与分页 | 高 |
| CO3 | `collect` 返回新建 collection 对象 | 而非 `{success:true}` | 高 |
| CO4 | 统一 `extra` schema | 文档化 text/image/file/video/sticker/message 各自字段 | 中 |
| CO5 | `GET /collections/:id` 详情 | — | 低 |
| CO6 | 收藏搜索 `GET /collections/search?q=` | 收藏多时检索 | 低 |

---

## 5. 推进优先级（建议分批 PR）

**P0（修 bug + 立规范，低风险）**
- CO1 收藏去重（schema 迁移 + 服务层查重 → 409）— 真实数据问题，最先修
- E1/E4/E5 错误处理收敛（500 走 winston、统一 throw ApiError）
- 错误码体系骨架 + errorHandler 双写 `error`/`error_code`（向后兼容）

**P1（补朋友圈/收藏接口）**
- MO1 单条动态详情、MO2 点赞评论入 notifications
- CO2 统一 `GET /collections`、CO3 collect 回传对象

**P2（规范化与体验）**
- L1 日志脱敏、E2/L2 requestId 链路
- 新接口走 201/204/409、列表统一分页元信息
- MO3/MO4、CO4 字段 schema 文档化

每批独立成 PR，先行 P0。规范文档建议落到 `backend-v2/docs/API_GUIDELINES.md` 作为后续接口的强制约定。
