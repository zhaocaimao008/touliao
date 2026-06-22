# P1 实现计划（朋友圈 / 收藏接口补全）

**前置**: PR #30（P0）合并后执行。基于实地代码调研，非凭空设计。
**现状关键事实**:
- 站内**无通知表**；好友申请用 `friend_requests` 表自身当通知源。故朋友圈互动通知需**新建**持久化。
- 朋友圈 like/comment 目前只发 socket 瞬时事件（`moment_liked`/`moment_commented`），离线即丢。
- `utils/push.js` 的 `pushToUser(userId, payload)` 可复用做离线 web/FCM 推送。
- 收藏读接口 `GET /users/me/collections` 现返回**裸数组、无分页、无类型筛选**。

> 兼容性原则（延续 P0）：存量接口契约不破坏。新接口可用信封；存量接口仅做**加法**（裸数组维持裸数组、`{success:true}` 维持含 success）。

---

## 拆分为 3 个独立可交付项

### P1-A — `GET /moments/:id` 单条动态详情（MO1）

实时事件只推 `momentId`，客户端拿不到单条；点赞/评论后需回查。

- `moments.service.js`: 新增 `getMoment(viewerId, momentId)` → 查不到 `notFound('动态不存在')`；复用 `assertVisible(viewerId, m)`；返回 `enrich(viewerId, m)`。
- `moments.controller.js`: `exports.detail = asyncHandler((req,res)=>res.json(svc.getMoment(req.user.id, req.params.id)))`。
- `moments.routes.js`: `router.get('/:id', auth, m.detail)`。
  - ⚠ **路由顺序**：必须在 `GET /user/:userId` **之后**；且 P1-B 的 `GET /notifications*` 静态路径必须在 `GET /:id` **之前**注册，否则 `/notifications` 会被 `/:id` 吞掉。
- 风险：低。无 schema 改动。

### P1-B — 朋友圈互动通知持久化 + feed（MO2）

对标微信「朋友圈 → 消息」。新建通知表，like/comment 落库，离线可见；可选离线推送。

**Schema 迁移**（`db/schema.js` migrations 末尾，幂等）:
```sql
CREATE TABLE IF NOT EXISTS moment_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,        -- 接收者（动态作者）
  actor_id TEXT NOT NULL,       -- 触发者（点赞/评论的人）
  moment_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'like' | 'comment'
  comment_id TEXT DEFAULT NULL,
  is_read INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_moment_notif_user ON moment_notifications(user_id, created_at DESC);
```

**写入点**（`moments.service.js`，均 actor≠author 才记）:
- `toggleLike`：点赞时插一条 `type=like`；**取消赞默认不删通知**（通知是"曾发生过"的历史记录），由配置 `moments.deleteNotifOnCancel`(默认 false) 控制。
- `addComment`：插一条 `type=comment, comment_id`。
- `deleteMoment`：表已 `ON DELETE CASCADE`，自动清（动态都没了，通知无意义）。
- `deleteComment`：**默认保留**通知（同 deleteNotifOnCancel 配置）。

**离线推送**：like/comment 写库后调用 `pushToUser(authorId, {...})`，**默认开启**，由配置 `moments.pushOnInteract`(默认 true) 控制。

**新服务函数**：
- `listNotifications(userId,{limit=20,offset=0})` → JOIN actor(username,avatar) + moment 预览（首图/内容截断），按时间倒序。
- `unreadCount(userId)` → `COUNT(*) WHERE is_read=0`。
- `markRead(userId)` → `UPDATE ... SET is_read=1 WHERE user_id=?`。

**controller + routes**（注册在 `/:id` 之前）:
- `GET  /moments/notifications`            → list
- `GET  /moments/notifications/unread-count` → `{ count }`
- `POST /moments/notifications/read`        → 全部已读 `{ success:true }`

- 风险：中。新表 + 多写入点 + 路由顺序敏感。需测试 like→取消（通知**保留**）、删动态级联清、未读计数、推送开关。

### P1-C — 收藏接口完善（CO2 + CO3）

- **CO2** `getCollections(userId, { type, limit, offset })`：
  - 支持 `type` 过滤（白名单 text/image/file/video）与 `limit/offset` 分页。
  - **无参数时维持现有「返回全部」行为**（或设较大默认上限），响应**仍为裸数组**（前端按数组读，不切信封）。前端可用「返回数 < limit」判断到底。
  - controller 透传 `req.query`。
- **CO3** collect 回传新建对象：
  - `users.service.addCollection` → 返回 `{ success:true, ...collectionRow }`（`extra` 已 parse），保留 `success` 向后兼容。
  - `messages.service.collect` → 返回新建 collection 行；controller 由 `{success:true}` 改为 `{ success:true, ...row }`。
- 风险：低。纯加法。

---

## 建议的 PR 切分与顺序

| PR | 内容 | 规模 | 依赖 |
|----|------|------|------|
| PR-1 | P1-A + P1-C（小、机械、无新表） | 小 | 无 |
| PR-2 | P1-B（新表 + feed + 可选推送） | 中 | 路由顺序需与 P1-A 协调（若 PR-1 先合并，PR-2 在 `/:id` 前插入 `/notifications*`） |

> 若希望一次性，也可合成单 PR，但建议 PR-1 先行（低风险快速合并），PR-2 单独评审。

## 测试要点
- 单条详情：非好友/private 返回 403；不存在 403/404 区分。
- 通知：like 产生通知、取消 like 删除通知、评论产生通知、删评论删通知、删动态级联清；未读计数；标记已读。
- 收藏：type 过滤、分页边界、collect 回传对象含 id、重复仍 409（P0 已保证）。
- 路由顺序回归：`GET /moments/notifications` 不被 `/:id` 命中。
