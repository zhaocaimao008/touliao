# 投聊（touliao）代码库审计报告

- 审计时间：2026-08-29
- 审计范围：`backend-v2/`（Node.js + Express + Socket.io + better-sqlite3，PM2 进程 `touliao-backend`，端口 3003）、`web/`（React + Vite，Electron 包壳复用同一套代码）、`android/`（Kotlin + Jetpack Compose）、`ios/`（SwiftUI）
- 方法：静态代码检索（grep + 关键文件通读）+ 直接导出生产 SQLite 实时 schema，**未做运行时/生产环境行为验证**，属于只读审计，未修改任何代码
- 局限：未逐行读完全部超大文件（如 Web 端 `ChatWindow.jsx` 14万字节），不排除还有零散的、未用标准 TODO/mock 关键字标注的占位逻辑未被发现

---

## 一、后端 HTTP 路由清单 + WebSocket 事件清单

### 0. 挂载前置说明

- 鉴权中间件：`auth`（校验用户 JWT，注入 `req.user`）／`adminAuth`（校验后台管理员 JWT，独立于用户体系）
- `/api` 路径下所有非 GET/HEAD/OPTIONS 请求经过全局 CSRF 双提交校验，登录/注册与 Bearer 头请求豁免
- `/api/admin` 整体额外套一层 IP 白名单门控（`config.admin.ipWhitelist` 非空时生效）
- **P11/P12/P13 三个模块被显式短路为假路由**：`app.use('/api/global', stub501)`、`app.use('/api/ai', stub501)`、`app.use('/api/web3', stub501)`，命中即返回 `501 { error:'功能未实现', code:'NOT_IMPLEMENTED' }`，对应的 `routes/p11-*.js`/`p12-*.js`/`p13-*.js` 三个文件本身写得像真实功能，但从未被 `require`／真正挂载，纯死代码，仅 `stub501` 生效
- **`routes/p14-deep-optimization.routes.js`（131行）未被 `app.js` 或任何其它文件 `require`**，全仓库搜索只在它自身文件中出现。确认为死代码，既不可访问，也没有像 P11/12/13 一样被显式标注下线，建议直接删除或明确归档

### 1. 认证模块 `/api/auth`（`modules/auth/auth.routes.js`）

| Method | Path | 鉴权 | Handler | 说明 |
|---|---|---|---|---|
| POST | /api/auth/register | 否（registerLimiter限流） | auth.controller.js `register` | 注册新用户 |
| POST | /api/auth/login | 否（loginLimiter限流） | auth.controller.js `login` | 登录，签发 JWT |
| POST | /api/auth/switch | 否（switchLimiter限流） | auth.controller.js `switchAccount` | 免密切换账号（凭本机 wallet cookie） |
| POST | /api/auth/forget | 否（forgetLimiter限流） | auth.controller.js `forget` | 从本设备移除某已登录账号 |
| POST | /api/auth/reset-password | 否（resetPasswordLimiter限流） | auth.controller.js `resetPassword` | 凭手机号+邀请码重置密码 |
| GET | /api/auth/me | 是 | auth.controller.js `me` | 获取当前用户资料 |
| POST | /api/auth/refresh | 是 | auth.controller.js `refresh` | 刷新访问令牌 |
| POST | /api/auth/logout | 否 | auth.controller.js `logout` | 登出 |
| GET | /api/auth/sessions | 是 | auth.controller.js `sessions` | 列出活跃会话/设备 |
| DELETE | /api/auth/sessions | 是 | auth.controller.js `deleteAllSessions` | 删除全部会话（强制其它设备下线） |
| DELETE | /api/auth/sessions/:id | 是 | auth.controller.js `deleteSession` | 删除指定会话 |
| POST | /api/auth/delete-account | 是 | auth.controller.js `deleteAccount` | 注销账号 |
| PUT | /api/auth/change-password | 是（resetPasswordLimiter限流） | auth.controller.js `changePassword` | 修改密码 |

### 2. 用户模块 `/api/users`（`modules/users/users.routes.js`）

| Method | Path | 鉴权 | Handler | 说明 |
|---|---|---|---|---|
| GET | /api/users/me/qrcode | 是 | users.controller.js `qrcode` | 获取本人二维码 |
| GET | /api/users/me/invite | 是 | users.controller.js `getMyInvite` | 我的专属邀请码 + 邀请战绩 |
| GET | /api/users/me/settings | 是 | users.controller.js `getSettings` | 获取用户设置 |
| PUT | /api/users/me/settings | 是 | users.controller.js `updateSettings` | 更新用户设置 |
| GET | /api/users/search | 是（searchLimiter限流） | users.controller.js `search` | 搜索用户 |
| POST | /api/users/avatar | 是（profileUpdateLimiter限流） | users.controller.js `uploadAvatar` | 上传头像 |
| POST | /api/users/cover | 是（profileUpdateLimiter限流） | users.controller.js `uploadCover` | 上传封面图 |
| PUT | /api/users/profile | 是（profileUpdateLimiter限流） | users.controller.js `updateProfile` | 更新个人资料 |
| GET | /api/users/:id | 是 | users.controller.js `getUserDetail` | 获取指定用户详情（单段通配） |
| GET | /api/users/me/collections | 是 | users.controller.js `getCollections` | 收藏列表 |
| POST | /api/users/me/collections | 是 | users.controller.js `addCollection` | 添加收藏 |
| GET | /api/users/me/collections/search | 是 | users.controller.js `searchCollections` | 搜索收藏 |
| GET | /api/users/me/collections/:id | 是 | users.controller.js `getCollection` | 单条收藏详情 |
| DELETE | /api/users/me/collections/:id | 是 | users.controller.js `removeCollection` | 删除收藏 |
| GET | /api/users/me/call-logs | 是 | users.controller.js `getCallLogs` | 通话记录列表 |
| PUT | /api/users/me/phone | 是 | users.controller.js `changePhone` | 换绑手机号 |
| POST | /api/users/block/:targetId | 是 | contacts.controller.js `block` | 拉黑用户 |
| DELETE | /api/users/block/:targetId | 是 | contacts.controller.js `unblock` | 取消拉黑 |
| GET | /api/users/me/blocked | 是 | contacts.controller.js `listBlocked` | 黑名单列表 |

### 3. 联系人/好友（同挂在 `/api/users`，`contacts.controller.js`）

> 好友请求/添加好友/删除联系人核心逻辑的 controller 是 `modules/contacts/contacts.controller.js`，但没有独立的 `/api/contacts` 挂载点，路由全部注册在 `users.routes.js` 里。

| Method | Path | 鉴权 | Handler | 说明 |
|---|---|---|---|---|
| GET | /api/users/contacts | 是 | contacts.controller.js `listContacts` | 联系人（好友）列表 |
| POST | /api/users/friend-request | 是（reactLimiter限流） | contacts.controller.js `sendFriendRequest` | 发送加好友请求 |
| GET | /api/users/friend-requests | 是 | contacts.controller.js `listReceived` | 收到的好友请求列表 |
| GET | /api/users/friend-requests/sent | 是 | contacts.controller.js `listSent` | 发出的好友请求列表 |
| POST | /api/users/friend-request/:id/handle | 是（reactLimiter限流） | contacts.controller.js `handleRequest` | 接受/拒绝好友请求 |
| DELETE | /api/users/contacts/:contactId | 是 | contacts.controller.js `deleteContact` | 删除好友 |
| PUT | /api/users/contacts/:contactId/remark | 是 | contacts.controller.js `setRemark` | 设置好友备注 |

### 3b. 好友分组标签 `/api/friend-labels`（`friend_labels.routes.js`）

| Method | Path | 鉴权 | Handler | 说明 |
|---|---|---|---|---|
| GET | /api/friend-labels | 是 | friend_labels.controller.js `list` | 好友分组标签列表 |
| POST | /api/friend-labels | 是 | friend_labels.controller.js `create` | 创建分组标签 |
| PUT | /api/friend-labels/:id | 是 | friend_labels.controller.js `update` | 更新分组标签 |
| DELETE | /api/friend-labels/:id | 是 | friend_labels.controller.js `remove` | 删除分组标签 |
| POST | /api/friend-labels/:id/members | 是 | friend_labels.controller.js `addMember` | 向分组添加好友 |
| DELETE | /api/friend-labels/:id/members/:friendId | 是 | friend_labels.controller.js `removeMember` | 从分组移除好友 |

### 4. 消息/会话/群组/红包/定时消息 `/api/messages`（`messages.routes.js`）

> 路由顺序对契约强敏感：单段通配（`GET/POST /:conversationId`、`DELETE /:msgId`）必须晚于同方法的字面量具体路由，否则会被吞掉（文件头注释专门标注了这条坑）。controller 分散在 `conversations.controller.js`、`messages.controller.js`、`groups.controller.js`、`redpackets.controller.js`（与 `/api/redpackets` 共用）、`scheduled.controller.js`、`chunkUpload.controller.js`。

| Method | Path | 鉴权 | Handler | 说明 |
|---|---|---|---|---|
| POST | /api/messages/conversation/private | 是 | conversations.controller.js `createPrivate` | 创建/获取私聊会话 |
| POST | /api/messages/conversation/private/batch | 是 | conversations.controller.js `createPrivateBatch` | 批量创建私聊会话 |
| POST | /api/messages/conversation/group | 是（joinGroupLimiter） | conversations.controller.js `createGroup` | 创建群聊 |
| GET | /api/messages/file-helper | 是 | conversations.controller.js `fileHelper` | 文件传输助手会话 |
| GET | /api/messages/conversations | 是 | conversations.controller.js `list` | 会话列表 |
| GET | /api/messages/conversation/:conversationId/members | 是 | conversations.controller.js `members` | 会话成员列表 |
| GET | /api/messages/unread-counts | 是 | conversations.controller.js `unreadCounts` | 各会话未读数 |
| GET | /api/messages/my-groups | 是 | conversations.controller.js `myGroups` | 我加入的群列表 |
| GET | /api/messages/search | 是 | messages.controller.js `searchGlobal` | 全局搜索消息 |
| PUT | /api/messages/conversation/:convId/nickname | 是 | groups.controller.js `setNickname` | 设置群内昵称 |
| POST | /api/messages/conversation/:convId/invite-link | 是（reactLimiter） | groups.controller.js `createInviteLink` | 生成群邀请链接 |
| GET | /api/messages/conversation/:convId/qr-code | 是 | groups.controller.js `qrCode` | 入群二维码 |
| GET | /api/messages/join/:token/preview | 是 | groups.controller.js `joinPreview` | 扫码/链接进群前预览 |
| POST | /api/messages/join/:token | 是（joinGroupLimiter） | groups.controller.js `join` | 通过邀请令牌加入群 |
| GET | /api/messages/missed | 是 | messages.controller.js `missed` | 断线补拉未读消息 |
| PUT | /api/messages/conversation/:convId | 是 | groups.controller.js `updateInfo` | 更新群基本信息 |
| PUT | /api/messages/conversation/:convId/avatar | 是 | groups.controller.js `setAvatar` | 设置群头像 |
| POST | /api/messages/conversation/:convId/invite | 是（joinGroupLimiter） | groups.controller.js `invite` | 邀请好友入群 |
| DELETE | /api/messages/conversation/:convId/members/:uid | 是 | groups.controller.js `kick` | 踢出群成员 |
| POST | /api/messages/conversation/:convId/leave | 是 | groups.controller.js `leave` | 退群 |
| POST | /api/messages/conversation/:convId/dissolve | 是 | groups.controller.js `dissolve` | 解散群 |
| GET | /api/messages/conversation/:convId/info | 是 | groups.controller.js `info` | 群详情 |
| PUT | /api/messages/conversation/:convId/manage | 是 | groups.controller.js `manage` | 群管理设置（禁言等） |
| PUT | /api/messages/conversation/:convId/members/:uid/role | 是 | groups.controller.js `setRole` | 设置成员角色 |
| POST | /api/messages/conversation/:convId/transfer-owner | 是 | groups.controller.js `transferOwner` | 转让群主 |
| POST | /api/messages/conversation/:convId/pin | 是 | conversations.controller.js `pin` | 置顶会话 |
| POST | /api/messages/conversation/:convId/mute | 是 | conversations.controller.js `mute` | 免打扰/禁言设置 |
| PUT | /api/messages/conversation/:convId/background | 是 | conversations.controller.js `background` | 设置会话背景（URL） |
| POST | /api/messages/conversation/:convId/background-upload | 是 | messages.controller.js `backgroundUpload` | 上传会话背景图 |
| POST | /api/messages/conversation/:convId/read | 是 | conversations.controller.js `read` | 标记已读 |
| POST | /api/messages/conversation/:convId/mark-unread | 是 | conversations.controller.js `markUnread` | 标记未读 |
| POST | /api/messages/conversation/:convId/burn-after | 是 | conversations.controller.js `setBurnAfter` | 设置阅后即焚时长 |
| DELETE | /api/messages/conversation/:convId/messages | 是 | conversations.controller.js `clearConversation` | 清空单个会话消息 |
| DELETE | /api/messages/conversations/messages | 是 | conversations.controller.js `clearAll` | 清空全部会话消息 |
| GET | /api/messages/conversation/:convId/search | 是 | messages.controller.js `searchInConv` | 会话内搜索消息 |
| GET | /api/messages/conversation/:convId/export | 是 | messages.controller.js `exportConversation` | 导出聊天记录 |
| GET | /api/messages/conversation/:convId/files | 是 | messages.controller.js `conversationFiles` | 会话文件聚合视图 |
| GET | /api/messages/mentions/me | 是 | messages.controller.js `myMentions` | 跨会话 @我 消息聚合 |
| POST | /api/messages/schedule | 是（sendMsgLimiter） | scheduled.controller.js `create` | 创建定时发送消息 |
| GET | /api/messages/schedule | 是 | scheduled.controller.js `list` | 我的定时消息列表 |
| DELETE | /api/messages/schedule/:id | 是 | scheduled.controller.js `cancel` | 取消定时消息 |
| GET | /api/messages/media | 是 | conversations.controller.js `media` | 跨会话媒体列表（注释标注修复了曾被 `/:conversationId` 通配吞掉的死代码问题） |
| GET | /api/messages/:conversationId | 是 | messages.controller.js `history` | 会话消息历史（单段通配） |
| GET | /api/messages/:convId/around/:msgId | 是 | messages.controller.js `aroundMessage` | 指定消息前后的上下文消息 |
| POST | /api/messages/forward | 是（sendMsgLimiter） | messages.controller.js `forward` | 转发消息 |
| POST | /api/messages/batch-delete | 是（sendMsgLimiter） | messages.controller.js `batchDelete` | 批量撤回/删除消息 |
| POST | /api/messages/:conversationId | 是（sendMsgLimiter） | messages.controller.js `send` | HTTP方式发送消息（单段通配） |
| POST | /api/messages/:conversationId/upload | 是 | messages.controller.js `uploadHandle`（前置uploadGuard+multer魔数校验） | 上传文件类消息附件 |
| POST | /api/messages/:conversationId/upload-init | 是（chunkInitLimiter） | chunkUpload.controller.js `init` | 分片上传初始化 |
| GET | /api/messages/:conversationId/upload-status/:uploadId | 是 | chunkUpload.controller.js `status` | 查询分片上传进度 |
| PUT | /api/messages/:conversationId/upload-chunk/:uploadId | 是（chunkUploadLimiter） | chunkUpload.controller.js `chunk` | 上传单个分片 |
| POST | /api/messages/:conversationId/upload-finish/:uploadId | 是 | chunkUpload.controller.js `finish` | 完成分片上传合并 |
| DELETE | /api/messages/:msgId | 是（reactLimiter） | messages.controller.js `remove` | 撤回/删除单条消息（单段通配） |
| POST | /api/messages/:msgId/react | 是（reactLimiter） | messages.controller.js `react` | 消息表情回应 |
| PUT | /api/messages/:msgId/edit | 是（reactLimiter） | messages.controller.js `edit` | 编辑已发送消息 |
| POST | /api/messages/:msgId/transcribe | 是（reactLimiter） | messages.controller.js `transcribe` | 语音消息转文字 |
| POST | /api/messages/conversation/:convId/pin-message | 是 | groups.controller.js `pinMessage` | 置顶消息 |
| DELETE | /api/messages/conversation/:convId/pin-message/:msgId | 是 | groups.controller.js `unpinMessage` | 取消置顶消息 |
| GET | /api/messages/conversation/:convId/pinned-messages | 是 | groups.controller.js `listPinned` | 已置顶消息列表 |
| POST | /api/messages/:msgId/collect | 是（reactLimiter） | messages.controller.js `collect` | 收藏消息 |
| POST | /api/messages/red-packet/send | 是（rechargeLimiter） | redpackets.controller.js `send` | 发红包（与 `/api/redpackets/send` 重复挂载，见下方⚠说明） |
| GET | /api/messages/red-packet/:packetId | 是 | redpackets.controller.js `detail` | 红包详情/领取记录 |
| POST | /api/messages/red-packet/:packetId/claim | 是 | redpackets.controller.js `claim` | 领红包 |

**⚠ 重复路由**：`/api/redpackets/send`、`/api/redpackets/:packetId`、`/api/redpackets/:packetId/claim` 与上表最后三行的 `/api/messages/red-packet/*` 是**同一份 `redpackets.controller.js`**、同一逻辑的两套外部入口，属历史遗留双挂载，非 bug 但建议梳理成单一入口。

### 5. 朋友圈 `/api/moments`（`moments.routes.js`）

| Method | Path | 鉴权 | Handler | 说明 |
|---|---|---|---|---|
| GET | /api/moments/ | 是 | moments.controller.js `timeline` | 朋友圈动态时间线 |
| POST | /api/moments/ | 是（createMomentLimiter） | moments.controller.js `create` | 发布动态 |
| POST | /api/moments/images | 是（momentImageLimiter） | moments.controller.js `uploadImages` | 上传动态配图（**无视频接口**） |
| GET | /api/moments/user/:userId | 是 | moments.controller.js `userMoments` | 指定用户的动态列表 |
| GET | /api/moments/notifications | 是 | moments.controller.js `notifications` | 朋友圈通知列表 |
| GET | /api/moments/notifications/unread-count | 是 | moments.controller.js `notifUnreadCount` | 朋友圈未读通知数 |
| POST | /api/moments/notifications/read | 是 | moments.controller.js `notifMarkRead` | 标记朋友圈通知已读 |
| DELETE | /api/moments/comments/:commentId | 是 | moments.controller.js `deleteComment` | 删除评论 |
| GET | /api/moments/:id | 是 | moments.controller.js `detail` | 动态详情 |
| DELETE | /api/moments/:id | 是 | moments.controller.js `remove` | 删除动态 |
| PUT | /api/moments/:id | 是（createMomentLimiter） | moments.controller.js `edit` | 编辑动态 |
| POST | /api/moments/:id/like | 是（reactLimiter） | moments.controller.js `like` | 点赞/取消点赞 |
| POST | /api/moments/:id/comment | 是（commentLimiter） | moments.controller.js `comment` | 发表评论 |
| GET | /api/moments/:id/likes | 是 | moments.controller.js `likes` | 点赞列表 |
| GET | /api/moments/:id/comments | 是 | moments.controller.js `comments` | 评论列表 |
| POST | /api/moments/:id/report | 是（reactLimiter） | moments.controller.js `report` | 举报动态 |

### 6. 通知/推送 `/api/notifications`（`notifications.routes.js`）

| Method | Path | 鉴权 | Handler | 说明 |
|---|---|---|---|---|
| GET | /api/notifications/vapid-public-key | 否 | notifications.controller.js `vapidPublicKey` | Web Push VAPID 公钥 |
| POST | /api/notifications/web-subscribe | 是（pushSubscribeLimiter） | notifications.controller.js `webSubscribe` | 订阅 Web Push |
| DELETE | /api/notifications/web-subscribe | 是 | notifications.controller.js `webUnsubscribe` | 取消订阅 Web Push |
| POST | /api/notifications/device-token | 是（pushSubscribeLimiter） | notifications.controller.js `saveDeviceToken` | 保存设备推送 Token |
| POST | /api/notifications/push-diag | 是 | notifications.controller.js `pushDiag` | [诊断] iOS 推送注册诊断上报 |
| DELETE | /api/notifications/device-token | 是 | notifications.controller.js `deleteDeviceToken` | 删除设备推送 Token |
| GET | /api/notifications/status | 是 | notifications.controller.js `status` | 推送状态查询 |
| POST | /api/push/getui-diag | 否（app.js单独挂载，绕过CSRF与鉴权） | notifications.controller.js `getuiDiag` | [诊断] 个推 GeTui Android 端直报诊断 |

### 7-11. 其余业务模块

| 模块 | 前缀 | 路由 |
|---|---|---|
| 上传凭证 | `/api/upload` | `POST /credential`（是，uploadCredentialLimiter）— 获取云存储直传STS临时凭证 |
| 表情包 | `/api/stickers` | `GET /`、`POST /upload`、`POST /collect`、`POST /send`、`DELETE /:id`（均需鉴权+stickerLimiter） |
| 红包 | `/api/redpackets` | `POST /send`、`GET /:packetId`、`POST /:packetId/claim`（均需鉴权，见上方⚠重复路由说明） |
| 钱包 | `/api/wallet` | `GET /`(余额)、`GET /transactions`、`POST /recharge`（**代码注释标注"占位"实现**）、`POST /transfer`（均需鉴权） |
| TURN/WebRTC | `/api/turn` | `GET /credentials`（是，turnCredentialLimiter）— 下发 ICE 服务器列表(STUN恒定+coturn时效凭证) |

### 12. 管理后台 `/api/admin`（+ 备用登录入口）

> 整个 router 最外层套 IP 白名单门控；除 `/login` 外全部要求 `adminAuth`。

| Method | Path | 鉴权 | 说明 |
|---|---|---|---|
| POST | /api/vxin-admin-login | 否（IP白名单+登录限流，app.js内单独挂载） | 后台登录备用路径（绕过CF WAF对/api/admin/*的限流），复用admin.routes同款防护 |
| POST | /api/admin/login | 否（IP白名单+限流） | 后台登录 |
| POST | /api/admin/logout | adminAuth | 后台登出 |
| GET | /api/admin/me | adminAuth | 管理员资料 |
| GET | /api/admin/stats | adminAuth | 系统统计数据 |
| GET | /api/admin/metrics | adminAuth | 生产监控指标快照 |
| GET | /api/admin/security | adminAuth | 安全状态(TOTP/可信设备) |
| POST | /api/admin/security/totp/setup\|enable\|disable | adminAuth | TOTP二次验证管理 |
| DELETE | /api/admin/security/trusted/:id | adminAuth | 撤销可信设备 |
| GET | /api/admin/users, /users/:id | adminAuth | 用户列表/详情 |
| POST | /api/admin/users/:id/ban\|unban\|reset-password\|grant-coins\|grant-privilege\|revoke-privilege | adminAuth | 用户管理操作 |
| DELETE | /api/admin/users/:id | adminAuth | 硬删除用户 |
| GET | /api/admin/messages | adminAuth | 消息列表(审查用) |
| GET/DELETE | /api/admin/groups, /groups/:id | adminAuth | 群列表/详情/强制解散 |
| GET/PUT/POST | /api/admin/invite-code* | adminAuth | 邀请码规则管理 |
| GET/PUT | /api/admin/features | adminAuth | 功能开关(修改后socket广播`config:updated`) |
| GET | /api/admin/top-inviters | adminAuth | 邀请排行榜 |
| GET/POST | /api/admin/reports, /reports/:id/resolve | adminAuth | 举报管理 |

### 13-16. 搜索/监控/可靠性/优化模块

| 模块 | 前缀 | 说明 |
|---|---|---|
| 全文搜索 P4.1 | `/api/search` | `GET /messages`、`/global`、`/stats`（均鉴权） |
| 监控诊断 | `/api/monitoring` | `router.use(auth)`：`/health`、`/redis-stats`、`/tracing-stats`、`/query-stats`（鉴权）；`POST /redis-clear`（**auth+adminAuth 双重鉴权**，权限组合特殊，建议确认是否预期设计） |
| 消息可靠性 P4.2 | `/api/reliability` | `POST /ack/delivery`、`/ack/read`、`GET /ack/status`、`/queue/stats`、`/dlq`（均鉴权） |
| 优化特性 P4.3-P4.7 | `/api/optimization` | 搜索排序/批量ACK/去重/缓存预热/网络感知共11个接口（均鉴权）。**多个handler依赖 `req.app.get('searchRanking'/'batchAckManager'/...)`，若这些引擎未在启动时注册到app会抛400"xxx未初始化"——需确认生产环境是否真的初始化了这些模块，否则整组P4路由形同虚设** |

### 17. 直接挂载在 app.js 的路由

| Method | Path | 鉴权 | 说明 |
|---|---|---|---|
| GET | /download | 否 | 客户端下载中心落地页 |
| GET | /downloads/* | 否（静态） | 安装包文件下载 |
| GET | /api-docs | 生产404，其余环境无鉴权 | Swagger文档 |
| GET | /metrics, /api/metrics | 生产404 | Prometheus/JSON指标 |
| POST | /api/client-errors | 否（限流） | 前端错误边界上报 |
| GET | /api/uploads/ticket | 是 | 单文件10分钟只读票据(避免JWT暴露到资源URL) |
| POST/GET | /api/metrics/vitals* | 否 | Web Vitals性能上报 |
| GET | /api/config | 否 | 公开功能开关配置 |
| GET | /health | 否 | 轻量健康检查 |
| ALL | /uploads/:category/:file | 是(Cookie/Bearer+黑名单) | 已上传文件访问，`file_registry`为唯一权威所有权来源(IDOR防护) |
| ALL | /api/global | stub501 | **P11 全球部署——下线，恒501，未实现** |
| ALL | /api/ai | stub501 | **P12 AI增强——下线，恒501，未实现**（注释特别标注：mock版本"内容审核恒安全"极具误导性，故必须真下线） |
| ALL | /api/web3 | stub501 | **P13 Web3集成——下线，恒501，未实现** |

---

### WebSocket 事件清单

握手鉴权：`realtime/index.js` 的 `io.use` 中间件校验 Cookie 中的用户 JWT，检查黑名单/jti黑名单/封禁/密码变更时间；每用户并发连接数上限5，单IP 60秒内最多30次握手。连接成功后自动 join `user_{userId}` 房间与该用户所属的全部会话房间。

**1. 连接生命周期 / 在线状态**

| 事件名 | 方向 | 说明 |
|---|---|---|
| connection / disconnect | C↔S | 建连/断连，触发房间加入与清理 |
| session_expired | S→C | jti已被拉黑（账号别处登出/会话被删）时强制断开 |
| user_online / user_offline | S→C | 上下线广播给联系人 |
| sync:device_connected | S→C | 多端同步：非首台设备接入通知其它在线设备 |
| sync:unread_cleared | S→C | 多端同步：某设备标记已读后通知其它设备清除未读 |
| config:updated | S→C | 管理员改功能开关后全量广播 |

**2. 消息收发**

| 事件名 | 方向 | 说明 |
|---|---|---|
| send_message | C→S | 发文本/名片消息(限流+幂等去重+@解析+黑名单/禁言校验) |
| send_file_message | C→S | 发图片/语音/视频/文件消息(URL白名单+file_registry校验) |
| nudge | C→S | 拍一拍(3秒冷却) |
| new_message | S→C | 新消息推送(单条) |
| new_message_batch | S→C | 新消息批量推送(5ms窗口合并) |
| new_message_notify | S→C | 超大群(在线socket>500)降级轻量通知，客户端需自拉取 |
| message_delivered | S→C | 通知发送者已送达N个在线接收者 |
| mentioned | S→C | 群内被@通知 |
| join_conversation / join_group | C→S | 请求加入会话房间(服务端校验DB成员资格) |
| new_conversation | S→C | 新会话产生通知(建私聊/好友通过/建群/被邀入群) |
| message_read | S→C | 会话内广播已读到某条消息 |
| conversation_messages_cleared | S→C | 清空会话消息完成通知(多端同步) |
| messages_batch_deleted | S→C | 批量撤回后广播被删消息ID列表 |
| message_vanished | S→C | 阅后即焚过期/焚毁通知 |
| message_deleted_for_me | S→C | "仅对我删除"通知(仅发起者本人) |
| message_recall | S→C | 消息撤回通知 |
| message_deleted | S→C | 单条消息删除通知 |
| message_reaction | S→C | 表情回应更新 |
| message_edited | S→C | 消息编辑广播新内容 |
| message_pinned / message_unpinned | S→C | 消息置顶/取消置顶通知 |

**3. typing**

| 事件名 | 方向 | 说明 |
|---|---|---|
| typing / stop_typing | C↔S | 正在输入(400ms节流)；30秒无更新服务端自动补发stop，防幽灵状态 |

**4. 1对1通话信令 call:***

| 事件名 | 方向 | 说明 |
|---|---|---|
| call:request | C→S | 发起通话(5秒冷却) |
| call:incoming | S→C | 通知被叫有来电 |
| call:response | C↔S | 接受/拒绝转发 |
| call:offer / call:answer / call:ice | C↔S | WebRTC SDP/ICE纯转发 |
| call:end | C↔S | 挂断；服务端也会在120s未应答/断线时主动补发 |
| call:error | S→C | 请求参数非法(如callType枚举校验失败) |

> 状态落库 `call_logs`：request→missed, response accepted→ongoing, response rejected→rejected, end(已接通)→completed, end(未接通)→canceled

**5. 群通话信令 group_call:***（mesh网状拓扑，上限9人）

| 事件名 | 方向 | 说明 |
|---|---|---|
| group_call:start | C→S | 群内发起(受后台开关`feature_group_voice_call`/`feature_group_video_call`控制) |
| group_call:invite / :started | S→C | 邀请广播 / 发起者回执 |
| group_call:join | C→S | 加入进行中的群通话 |
| group_call:peers / :peer_joined / :peer_left | S→C | peer列表同步 |
| group_call:offer / :answer / :ice | C↔S | mesh拓扑点对点信令转发 |
| group_call:leave | C→S | 离开(房间空则自动结束) |
| group_call:ended | S→C | 超时(4小时强制上限)/主动结束广播 |
| group_call:error | S→C | invalid_type/busy/active_call/not_group/功能已禁用/not_found/full |

**6. 好友请求**

| 事件名 | 方向 | 说明 |
|---|---|---|
| new_friend_request | S→C | 收到新好友请求 |
| friend_request_accepted | S→C | 好友请求被接受(含双方自动加好友) |
| friend_request_rejected | S→C | 好友请求被拒绝 |

**7. 群管理**

| 事件名 | 方向 | 说明 |
|---|---|---|
| group_updated | S→C | 群信息变更(名称/头像/设置/成员变动复用) |
| group_member_added / group_kicked / group_left / group_dismissed | S→C | 成员变动/被踢/退群/解散通知 |
| group_settings_updated | S→C | 群管理设置更新 |
| role_changed | S→C | 角色变更(转让群主/设管理员) |

**8. 朋友圈 / 9. 红包**

| 事件名 | 方向 | 说明 |
|---|---|---|
| new_moment | S→C | 好友发新动态推送 |
| moment_liked / moment_commented | S→C | 动态被点赞/评论通知作者 |
| red_packet_claimed | S→C | 红包被领取，广播会话内成员 |

---

## 二、SQLite 数据库结构

**规模**：48 张表（含 5 张 FTS5 虚拟表相关内表 + 1 张 FTS5 虚表本体）、104 个索引、3 个触发器（FTS 同步）

**完整 DDL**（从生产库 `backend-v2/wechat.db` 实时导出，`sqlite3 wechat.db ".schema"`，未做任何编辑）：

```sql
CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      cover_photo TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      wechat_id TEXT DEFAULT '',
      status TEXT DEFAULT 'online',
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    , banned INTEGER DEFAULT 0, password_changed_at INTEGER DEFAULT 0, invite_code TEXT DEFAULT NULL, invited_by TEXT DEFAULT NULL, is_privileged INTEGER DEFAULT 0, last_online_at INTEGER DEFAULT 0, dingtalk_id TEXT, wechat_work_id TEXT);
CREATE TABLE contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      remark TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (contact_id) REFERENCES users(id),
      UNIQUE(user_id, contact_id)
    );
CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'private',
      name TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    , owner_id TEXT DEFAULT NULL, announcement TEXT DEFAULT '', no_private_chat INTEGER DEFAULT 0, mute_all INTEGER DEFAULT 0, no_add_friend INTEGER DEFAULT 0, group_number TEXT DEFAULT '', member_can_invite INTEGER DEFAULT 0);
CREATE TABLE conversation_members (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER DEFAULT (strftime('%s', 'now')), role TEXT DEFAULT 'member', nickname TEXT DEFAULT NULL,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      file_url TEXT DEFAULT '',
      reply_to_id TEXT DEFAULT NULL,
      deleted INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')), edited INTEGER DEFAULT 0, duration INTEGER DEFAULT 0, client_msg_id TEXT DEFAULT NULL, is_scheduled INTEGER DEFAULT 0, transcript TEXT DEFAULT NULL, file_mime TEXT DEFAULT NULL, file_size INTEGER DEFAULT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );
CREATE TABLE message_reactions (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
CREATE TABLE conversation_settings (
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      muted INTEGER DEFAULT 0,
      last_read_at INTEGER DEFAULT 0, last_read_message_id TEXT DEFAULT NULL, background TEXT DEFAULT NULL, manually_unread INTEGER DEFAULT 0, burn_after INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, conversation_id)
    );
CREATE TABLE friend_requests (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (from_id) REFERENCES users(id),
      FOREIGN KEY (to_id) REFERENCES users(id)
    );
CREATE TABLE moments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      likes TEXT DEFAULT '[]',
      visibility TEXT DEFAULT 'all',
      created_at INTEGER DEFAULT (strftime('%s', 'now')), visible_to TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
CREATE TABLE moment_comments (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')), reply_to_user TEXT DEFAULT '',
      FOREIGN KEY (moment_id) REFERENCES moments(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
CREATE TABLE collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      extra TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (strftime('%s', 'now')), dedup_key TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
CREATE TABLE blocked_users (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (blocked_id) REFERENCES users(id),
      UNIQUE(user_id, blocked_id)
    );
CREATE TABLE red_packets (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      total_count INTEGER NOT NULL,
      claimed_count INTEGER DEFAULT 0,
      greeting TEXT DEFAULT '恭喜发财，大吉大利',
      created_at INTEGER DEFAULT (strftime('%s', 'now')), status TEXT DEFAULT 'active',
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
CREATE TABLE red_packet_claims (
      packet_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      claimed_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (packet_id, user_id),
      FOREIGN KEY (packet_id) REFERENCES red_packets(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY,
      add_by_vxin_id INTEGER DEFAULT 1,
      add_by_phone INTEGER DEFAULT 1,
      require_verify INTEGER DEFAULT 1,
      profile_visible INTEGER DEFAULT 1,
      block_unknown_messages INTEGER DEFAULT 0,
      message_notify INTEGER DEFAULT 1,
      detail_preview INTEGER DEFAULT 1,
      sound INTEGER DEFAULT 1,
      vibrate INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s', 'now')), chat_background TEXT DEFAULT NULL, moments_visible_days INTEGER DEFAULT 0, no_direct_group_invite INTEGER DEFAULT 0, quiet_enabled INTEGER DEFAULT 0, quiet_start TEXT DEFAULT '23:00', quiet_end TEXT DEFAULT '07:00',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE schema_migrations (
    idx        INTEGER PRIMARY KEY,
    applied_at INTEGER DEFAULT (strftime('%s','now'))
  );
CREATE TABLE pinned_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      pinned_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(conversation_id, message_id)
    );
CREATE TABLE message_deliveries (
      message_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      delivered_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (message_id, user_id)
    );
CREATE TABLE group_invite_tokens (
      token           TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      created_by      TEXT NOT NULL,
      expires_at      INTEGER NOT NULL,
      created_at      INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      subscription TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, endpoint),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, token),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE moment_likes (
      moment_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (moment_id, user_id),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
    );
CREATE TABLE user_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      device     TEXT DEFAULT '未知设备',
      platform   TEXT DEFAULT 'Web',
      ip         TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_seen  INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, device, platform),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE admin_settings (
      key   TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
CREATE TABLE admin_trusted (
      id         TEXT PRIMARY KEY,
      device_id  TEXT NOT NULL,
      ip         TEXT NOT NULL,
      label      TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_seen  INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(device_id, ip)
    );
CREATE TABLE call_logs (
      id         TEXT PRIMARY KEY,
      caller_id  TEXT NOT NULL,
      callee_id  TEXT NOT NULL,
      type       TEXT DEFAULT 'audio',
      status     TEXT DEFAULT 'missed',
      started_at INTEGER DEFAULT (strftime('%s','now')),
      ended_at   INTEGER DEFAULT NULL,
      duration   INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
CREATE TABLE device_accounts (
      wallet_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_used  INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (wallet_id, user_id)
    );
CREATE TABLE user_stickers (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      url        TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
CREATE TABLE moment_notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,           -- 接收者（动态作者）
      actor_id   TEXT NOT NULL,           -- 触发者（点赞/评论的人）
      moment_id  TEXT NOT NULL,
      type       TEXT NOT NULL,           -- 'like' | 'comment'
      comment_id TEXT DEFAULT NULL,
      is_read    INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
    );
CREATE TABLE moment_reports (
      id          TEXT PRIMARY KEY,
      moment_id   TEXT NOT NULL,
      reporter_id TEXT NOT NULL,           -- 举报人
      reason      TEXT DEFAULT '',         -- 举报理由（可选短文本）
      status      TEXT DEFAULT 'pending',  -- 'pending' | 'reviewed' | 'dismissed'
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
      UNIQUE(moment_id, reporter_id)       -- 同一人对同一动态只记一次
    );
CREATE TABLE token_blacklist (
      token      TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
CREATE TABLE wallets (
      user_id    TEXT PRIMARY KEY,
      balance    INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
CREATE TABLE wallet_transactions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      amount        INTEGER NOT NULL,        -- 带符号：正=入账，负=出账
      balance_after INTEGER NOT NULL,        -- 变动后余额，便于对账
      type          TEXT NOT NULL,           -- recharge|red_packet_send|red_packet_claim|red_packet_refund
      ref_id        TEXT DEFAULT NULL,       -- 关联业务 id（如红包 id）
      memo          TEXT DEFAULT '',
      created_at    INTEGER DEFAULT (strftime('%s','now'))
    );
CREATE TABLE group_call_logs (
      id                TEXT PRIMARY KEY,
      conversation_id   TEXT NOT NULL,
      started_by        TEXT NOT NULL,
      type              TEXT NOT NULL,           -- audio|video
      status            TEXT DEFAULT 'ongoing',  -- ongoing|ended
      participant_count INTEGER DEFAULT 1,       -- 累计参与过的人数峰值
      started_at        INTEGER DEFAULT (strftime('%s','now')),
      ended_at          INTEGER DEFAULT NULL
    );
CREATE TABLE conversation_clears (
      user_id         TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      cleared_at      INTEGER NOT NULL, cleared_rowid INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, conversation_id)
    );
CREATE TABLE friend_labels (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      color      TEXT DEFAULT '#07C160',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE friend_label_members (
      label_id   TEXT NOT NULL,
      friend_id  TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (label_id, friend_id),
      FOREIGN KEY (label_id) REFERENCES friend_labels(id) ON DELETE CASCADE
    );
CREATE TABLE scheduled_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id       TEXT NOT NULL,
      content         TEXT NOT NULL,
      type            TEXT DEFAULT 'text',
      send_at         INTEGER NOT NULL,
      status          TEXT DEFAULT 'pending',
      created_at      INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );
CREATE TABLE IF NOT EXISTS 'messages_fts_data'(id INTEGER PRIMARY KEY, block BLOB);
CREATE TABLE IF NOT EXISTS 'messages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS 'messages_fts_content'(id INTEGER PRIMARY KEY, c0, c1, c2);
CREATE TABLE IF NOT EXISTS 'messages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB);
CREATE TABLE IF NOT EXISTS 'messages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID;
CREATE TABLE audit_logs (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          user_id TEXT,
          ip_address TEXT,
          user_agent TEXT,
          resource_type TEXT,
          resource_id TEXT,
          action TEXT,
          details TEXT,
          status TEXT DEFAULT 'success',
          error_message TEXT,
          request_id TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
CREATE TABLE file_registry (
      path TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      conversation_id TEXT DEFAULT '',
      kind TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
CREATE INDEX idx_deliveries_msg ON message_deliveries(message_id);
CREATE INDEX idx_deliveries_user ON message_deliveries(user_id);
CREATE INDEX idx_invite_conv ON group_invite_tokens(conversation_id);
CREATE INDEX idx_messages_conv_time ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_contacts_user ON contacts(user_id);
CREATE INDEX idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);
CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX idx_messages_unread ON messages(conversation_id, created_at, sender_id) WHERE deleted=0;
CREATE INDEX idx_moment_likes_moment ON moment_likes(moment_id);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE UNIQUE INDEX idx_conv_group_number ON conversations(group_number) WHERE group_number != '';
CREATE INDEX idx_call_logs_caller ON call_logs(caller_id, created_at);
CREATE INDEX idx_call_logs_callee ON call_logs(callee_id, created_at);
CREATE INDEX idx_moments_user ON moments(user_id, created_at);
CREATE INDEX idx_moments_time ON moments(created_at);
CREATE INDEX idx_moment_comments_moment ON moment_comments(moment_id, created_at);
CREATE INDEX idx_user_stickers ON user_stickers(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_collections_dedup ON collections(user_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX idx_collections_user ON collections(user_id, created_at DESC);
CREATE INDEX idx_moment_notif_user ON moment_notifications(user_id, created_at DESC);
CREATE INDEX idx_moment_reports_status ON moment_reports(status, created_at DESC);
CREATE INDEX idx_blocked_users_user ON blocked_users(user_id);
CREATE INDEX idx_friend_req_from ON friend_requests(from_id);
CREATE INDEX idx_friend_req_to ON friend_requests(to_id);
CREATE INDEX idx_token_blacklist_exp ON token_blacklist(expires_at);
CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX idx_group_call_conv ON group_call_logs(conversation_id, started_at DESC);
CREATE UNIQUE INDEX idx_messages_client_msg ON messages(sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
CREATE INDEX idx_friend_labels_user ON friend_labels(user_id);
CREATE INDEX idx_conv_settings_conv ON conversation_settings(conversation_id);
CREATE INDEX idx_messages_conv_del_time ON messages(conversation_id, deleted, created_at);
CREATE INDEX idx_reactions_msg ON message_reactions(message_id);
CREATE INDEX idx_conv_members_conv ON conversation_members(conversation_id);
CREATE UNIQUE INDEX idx_friend_req_unique_pending ON friend_requests(from_id, to_id) WHERE status='pending';
CREATE UNIQUE INDEX idx_users_invite_code ON users(invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX idx_users_invited_by ON users(invited_by);
CREATE INDEX idx_users_privileged ON users(is_privileged) WHERE is_privileged=1;
CREATE INDEX idx_scheduled_msgs_status ON scheduled_messages(status, send_at);
CREATE INDEX idx_scheduled_msgs_sender ON scheduled_messages(sender_id, status);
CREATE INDEX idx_red_packets_status_time ON red_packets(status, created_at) WHERE status='active';
CREATE UNIQUE INDEX idx_users_wechat_id_unique ON users(wechat_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_event ON audit_logs(event_type, created_at DESC);
CREATE INDEX idx_audit_risk ON audit_logs(risk_level, created_at DESC);
CREATE INDEX idx_audit_time ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_ip ON audit_logs(ip_address, created_at DESC);
CREATE INDEX idx_users_phone ON users(phone);
CREATE VIRTUAL TABLE messages_fts USING fts5(
        message_id      UNINDEXED,
        conversation_id UNINDEXED,
        content,
        tokenize        = 'trigram'
      )
/* messages_fts(message_id,conversation_id,content) */;
CREATE TABLE user_message_deletions (
      message_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      deleted_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE INDEX idx_user_msg_deletions_user ON user_message_deletions(user_id);
CREATE INDEX idx_user_msg_deletions_msg ON user_message_deletions(message_id);
CREATE INDEX idx_messages_file_url ON messages(file_url) WHERE file_url != '';
CREATE TABLE file_registry_shares (
      path TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (path, conversation_id)
    );
CREATE INDEX idx_file_registry_shares_path ON file_registry_shares(path);
CREATE TRIGGER fts_messages_insert
      AFTER INSERT ON messages WHEN NEW.type='text' AND NEW.deleted=0
      BEGIN
        INSERT INTO messages_fts(message_id, conversation_id, content)
        VALUES (NEW.id, NEW.conversation_id, NEW.content);
      END;
CREATE TRIGGER fts_messages_delete
      AFTER UPDATE OF deleted ON messages WHEN NEW.deleted != 0
      BEGIN
        DELETE FROM messages_fts WHERE message_id = OLD.id;
      END;
CREATE TRIGGER fts_messages_edit
      AFTER UPDATE OF content ON messages WHEN NEW.type='text' AND NEW.deleted=0
      BEGIN
        DELETE FROM messages_fts WHERE message_id = OLD.id;
        INSERT INTO messages_fts(message_id, conversation_id, content)
        VALUES (NEW.id, NEW.conversation_id, NEW.content);
      END;
```

**结构要点**：
- 主键几乎全用 `TEXT`（UUID），仅 `schema_migrations.idx` 用自增整数
- 大量表用组合主键代替自增ID（如 `conversation_members(conversation_id, user_id)`），是多对多/去重关系表的标准做法
- FK 约束多数**只声明未加 `ON DELETE CASCADE`**（如 `messages`、`contacts`、`moments`），少数较新的表才补了级联删除（`user_settings`、`moment_likes`、`user_sessions`、`friend_labels`、`user_message_deletions`）——若 SQLite 未开 `PRAGMA foreign_keys=ON`，这些声明形同虚设、不实际拦截孤儿数据，需要单独确认后端连接配置
- `messages_fts` 用 FTS5 trigram 分词，通过触发器与 `messages` 主表实时同步（增/删/改），仅索引 `type='text' AND deleted=0` 的消息
- `red_packets`/`wallet_transactions` 等资金相关表设计规范（`balance_after` 冗余存储便于对账、`type`+`ref_id` 可追溯业务来源）

---

## 三、四端已实现功能模块 + TODO / mock / 半成品

### 后端全局性 mock / 停用模块

| 模块 | 状态 | 说明 |
|---|---|---|
| P11 全球部署 (`/api/global`) | 已下线，恒501 | 纯mock，从未真实挂载 |
| P12 AI增强 (`/api/ai`) | 已下线，恒501 | **重点风险**：其中的"内容审核"实现被后端代码注释明确标注为**"恒安全极具误导性"**（无论内容是什么永远判定安全），已被主动下线而非以200假响应误导调用方。**这意味着当前生产环境没有任何真实运行中的消息/朋友圈内容审核机制**，是需要独立立项的安全/合规缺口，不是随手能修的小bug |
| P13 Web3集成 (`/api/web3`) | 已下线，恒501 | 区块链交易/NFT铸造/DAO治理，与IM主线功能无关的冗余脚手架，前端无任何调用 |
| P14 深度优化 (`routes/p14-deep-optimization.routes.js`) | **死代码，未挂载** | 未被任何文件require，既不可访问也未被标注下线，建议直接删除 |
| P4.3-P4.7 优化特性 (`/api/optimization`) | 状态存疑 | 多个handler依赖运行时注册的引擎实例（`app.get('searchRanking'/...)`），若启动时未初始化则返回400，需确认生产环境实际状态 |
| 钱包充值 (`wallet.service.js`) | **占位实现** | 代码注释原文："充值（占位：无真实支付网关，直接入账。生产接入支付后改为支付回调触发）"。三端客户端均确认未接入任何真实支付SDK（无支付宝/微信支付/StoreKit/Google Play结算），是纯内部虚拟金币直充 |
| 好友转账/红包 | 真实实现 | 与充值不同，转账和红包的金币流转本身有完整事务保护，是真实可用的内部账本系统 |
| AI机器人自动回复 (`ai-assistant/assistant.service.js`) | 真实功能 | 不要与上面P12的mock混淆，被 `messages.service.js`/`realtime/handlers/*` 实际引用，私聊场景下机器人自动回复逻辑完整，已接入线上消息流 |

### Web 端功能模块

**账号/认证**：登录（手机号+密码，记住用户名、多账号"最近登录"列表、Electron端可切服务器，完整）、注册（含邀请码，是否必填由后端开关控制，完整）、**找回密码已被有意禁用**（仅提示"请联系管理员线下处理"，代码注释标注P1-01——原「手机号+邀请码」重置流程因账号接管风险已下线，是明确的产品/安全决策而非半成品，**与Android/iOS仍在使用弱验证的邀请码重置流程形成三端不一致**，见跨端对比）、多账号免密切换（凭httpOnly wallet cookie重签token，最多15个，完整）、会话/设备管理（查看登录设备+单个/批量远程下线，完整）

**聊天核心**：`ChatWindow.jsx`(2870行)承载收发/撤回/编辑/转发/回复/@提醒/表情回应/置顶/收藏/批量删除/双向删除/导出/阅后即焚(8档)/定时发送(仅文本)/拍一拍；消息类型text/image/voice(含语音转文字)/video/file(支持docx/pdf/xlsx预览)/表情包/贴纸/名片/红包/转账均完整；已读/送达回执(单聊已读、群聊已读人数)完整；离线弱网(发件箱/本地缓存/断线横幅/乐观发送重试)完整；虚拟滚动长列表、会话文件聚合视图完整

**通讯录/好友**：加好友(投聊号/手机号/昵称搜索+防抖竞态取消)、好友请求(收发双列表+前台轻量卡片/后台系统通知)、黑名单、好友标签、备注名、好友资料卡，均完整

**群管理**：建群/邀请(含"允许普通成员邀请"开关)/踢人/设撤管理员/转让群主/群信息编辑/全员禁言/禁止私聊/禁止群内加好友/群二维码(7天有效)/群昵称/大群成员搜索(虚拟化)/扫码或链接加群(预览确认)/退群解散，均完整，覆盖面对齐主流IM

**朋友圈**：文字+最多9张图(**不支持视频**)、九宫格、点赞、评论(含回复评论)、删除、编辑(仅文字，图片发布后不可改)、举报、精细可见范围(全部/仅好友/仅自己/部分可见/不给谁看)、"最近N天可见"、互动通知未读红点、实时推送，均完整

**音视频通话**：真实WebRTC实现(`RTCPeerConnection`+`getUserMedia`，非UI桩)，Socket.io做offer/answer/ICE信令，TURN/STUN从`/api/turn/credentials`拉取(失败降级公共STUN)；含来电铃声(WebAudio生成，无音频文件依赖)、通话计时、静音/摄像头开关、输出设备切换(Chrome/Edge)、**可拖拽画中画/最小化悬浮窗**、ICE超时/断线重连宽限(15秒)。`CallModal.jsx`(803行)；群通话为Mesh拓扑多方WebRTC，响应式宫格布局，同样走真实信令，完整；通话记录(来去电/时长/状态/点击回拨)完整

**钱包/红包/转账**：发红包(拼手气/普通)、抢红包、好友转账、余额、交易记录均调真实后端接口，非前端模拟数据；转账/红包本身的金币流转有真实事务保护；**"充值"是纯前端数字输入直接POST入账，全代码库未发现任何支付宝/微信支付/银联/Stripe等真实支付网关对接**，是否内部虚拟金币经济、后端是否有额度控制需与后端确认，见TODO

**个人资料/设置**：头像/昵称/签名/换绑手机号、我的二维码、邀请好友裂变系统(专属邀请码+战绩)、外观(日夜间/跟随系统/字体4档/语言)、通知设置(锁屏预览/声音震动/夜间免打扰时段)、隐私安全(加好友方式/验证开关/群邀请保护/资料可见性/陌生人消息屏蔽)、服务器地址自定义(仅桌面端)、桌面端全局快捷键自定义(截图)，均完整。国际化(i18n)基础设施存在但**未实际接线**，见TODO

**通知/推送**：Web Push(VAPID+Service Worker)、Capacitor原生推送(FCM/APNs)、Electron原生通知、任务栏图标闪烁+未读角标、浏览器标题未读数，均完整

**其他**：全局搜索(联系人/群/文件传输助手/跨会话历史消息，本地为空可跳转"网络搜索添加好友")、会话内搜索、收藏(按类型筛选+关键词搜索)、扫一扫(仅用于扫群二维码加群，**无扫码登录网页版能力**)，均完整

**Electron桌面壳**：自绘标题栏，复用同一套Web代码，完整

**工程基建**：错误边界(防白屏)、断点下载/发送队列、本地消息/图片缓存、性能监控(Web Vitals)、免打扰时段、无障碍专项审计(`A11Y_AUDIT.md`)、路由级代码分割

### Web 端 TODO / mock / 半成品

代码中不存在字面意义的 TODO/FIXME 标记（全仓库grep为零），是已清理过的成熟代码库。以下是通过行为/实现完整度审查（而非关键词搜索）确认的真实半成品：

| 文件:行号 | 说明 |
|---|---|
| `contexts/I18nContext.jsx:3-108` + `components/Profile.jsx:549` | 词典仅约30个key；全仓库grep `useI18n()` 仅1处调用，且只解构了`{ lang, setLang }`，**从未解构或调用 `t()`**。i18n基础设施(三语词典/Context/切换UI)已搭好，但整个应用没有一处实际调用`t()`渲染文本——所有界面文案都是硬编码简体中文。用户在"外观→语言"切到英文/繁体，除`<html lang>`属性变化外界面文字不会有任何变化。典型"搭好骨架、没接线"的半成品 |
| `components/Profile.jsx:319-332`(Wallet组件) | `axios.post('/api/wallet/recharge', { amount: amt })`，amt直接来自用户输入的1-100000整数，全仓库grep确认零支付网关匹配 | 与后端`wallet.service.js`占位实现一致，前端没有跳转任何支付页或校验支付凭证 |
| `components/ChatWindow.jsx:1074` | `// socket.on('red_packet_claimed', onRedPacketClaimed); // removed` | 已废弃事件监听器的注释残留，红包领取实时通知逻辑曾存在后被移除，代码清理不彻底但无害 |
| `components/StickerPanel.jsx:22-46` | 注释"模拟加载下一页（从全量中截取，避免额外请求）"，`load()`一次性拉取`/api/stickers`全量数据，`loadMore()`只是本地`slice` | 表情包"分页加载"是假分页，非真正服务端分页，用户表情数量正常范围内无影响，量级增长后有一次性大响应的性能隐患 |
| `components/Moments.jsx`(全文件) | 发布只接受`images`(最多9张)，无`videos`字段；已发布动态图片不可编辑，只能删除重发 | 功能范围限制而非bug，若产品需要"朋友圈发视频"这里是空白 |
| `components/ScheduleSendModal.jsx:39-62` | `type: 'text'`写死，无类型选择器 | 定时发送只支持纯文本，不能定时发图片/文件/语音 |
| 交叉推导：无内容审核层 | 结合后端P12 mock已禁用且无替代实现 | **生产环境的消息/朋友圈内容目前没有自动内容审核**，若是产品需求，是需要独立立项的L2级安全/合规缺口 |

**总体结论**：Web端代码完整度很高，通话WebRTC信令、红包/转账后端调用、朋友圈、群管理等核心模块均为真实可用实现，未发现"仅UI无实际功能"的模块。最值得关注的是 **i18n名存实亡**（多语言基本不生效）和**钱包充值缺少真实支付校验**（需与后端联合确认风险边界）。

### Android 端功能模块

**账号/认证**：登录/注册(完整，支持切换服务器地址)、找回密码(基本实现，**用6位邀请码代替短信/邮箱验证码**做身份核验，见下方TODO)、多端会话管理(查看登录设备/踢下线/退出其他设备，完整)、修改密码/注销账户(完整，改密后端返回新token覆盖本地)、会话保持(完整)

**聊天核心**：单聊/群聊(完整，含乐观发送/弱网重发去重/Socket重连补发)；消息类型text/image/voice/video/file/red_packet/transfer/sticker/contact_card均完整；消息操作(撤回/删除/编辑/转发/回复/@聚合/表情回应/群置顶/收藏/批量删除/导出)均完整；进阶功能(定时发送/语音转文字/FTS5会话内搜索/会话文件聚合/阅后即焚/拍一拍/聊天背景)均完整；大文件>8MB自动分片上传；离线草稿/发送队列/本地消息缓存完整

**好友/联系人**：加好友(手机号/投聊号/用户名搜索+扫码，华为等无GMS设备有降级提示)、好友请求、好友备注/标签分组、黑名单，均完整

**群管理**：建群/群信息(公告/名称/头像)/成员管理(设管理员/踢人/转让群主/全员禁言/禁止私聊/禁止加好友)/群二维码/邀请链接/退群解散，均完整

**朋友圈**：**基本实现**，文字+多图，点赞评论，**不支持视频动态**(后端仅有uploadImages接口)

**通话**：单人语音/视频(真实WebRTC，含来电FCM/个推唤醒、前台服务、蓝牙/扬声器切换、摄像头切换)、群语音/视频(mesh架构，受后台开关控制)、通话记录、TURN/STUN，均完整；**本次会话内(2026-08-29)新增通话悬浮小窗，可拖拽+点击恢复全屏**

**钱包/红包/转账**：余额/流水/转账/红包完整对接；**充值无真实支付渠道**(见TODO)

**个人资料/设置**：资料编辑/二维码/邀请好友/隐私/通知(含勿扰时段)/外观/清缓存/关于/收藏(支持搜索+分类)/全局搜索(消息)，均完整

**通知/推送**：FCM+个推GeTui双通道(国产ROM覆盖，GMS不可用自动降级)、通知去重/渠道、设备token注册注销，均完整

**其他**：App内更新(检查/下载/安装引导，完整)、自定义表情、远程功能开关(moments/collect/inviteRequired/groupVoiceCall/groupVideoCall/changePassword均可后台远程关闭)、启动崩溃记录

### Android 端 TODO / mock / 半成品

| 文件:行号 | 说明 |
|---|---|
| `feature/wallet/WalletScreen.kt:120-151` + `data/api/WalletApi.kt:25-27` | 充值弹窗纯数字输入直接调后端加币接口，全仓库无任何真实支付SDK依赖，与后端占位实现一致 |
| `feature/auth/ForgotPasswordViewModel.kt:15-34,49-66` | 找回密码用6位邀请码代替短信/邮箱OTP做身份核验，安全强度不足，建议生产化前补齐真正的手机号验证 |
| `data/api/MomentApi.kt:22-40` | 朋友圈发布仅图片接口，无视频版本，代码层面直接没做(非TODO标记，是接口设计缺项) |
| `ui/theme/Dimens.kt:10-11` | 注释明确写的遗留设计债：两个圆角token(`thumb`/`pill`)与Web端设计规范不一致，暂缓等待视觉验收，纯视觉一致性问题 |

全仓库系统性grep了TODO/FIXME/XXX/mock/"暂不支持"/"未实现"等关键词，绝大多数命中是误报(Compose placeholder文本框提示语、正常工程注释、合理的API兼容处理)。真正的半成品信号集中在上表4处，其中**钱包充值缺真实支付通道**与**找回密码身份核验强度不足**最值得关注。

### iOS 端功能模块

**账号/认证**：登录(完整，支持自定义服务器地址)、注册(完整，邀请码是否必填由后端开关控制)、找回密码(功能完整可用，**同样用6位邀请码代替短信/邮箱OTP**)、多账号切换/添加账号(本地保存多套token可切换/移除，完整——**Android审计未报告有此能力，疑似iOS独有**)、修改密码/注销账号(后端接口+本地清理逻辑均已完整实现，**但App内完全没有UI入口调用它们**，见TODO)、远程配置/换服务器(完整)

**聊天核心**：单聊/群聊(完整，历史分页/离线缓存愈合/失败重发/已读回执/输入提示)；消息类型text/image/voice(带ASR转写)/video/file/sticker/red_packet/transfer/contact_card(**仅接收展示，无法主动发送**，见TODO)；消息操作(回复/撤回/阅后即焚/仅自己删除/批量删除/编辑/转发/@提醒/表情回应/置顶/拍一拍/搜索/文件列表/导出/定时消息)均对接真实后端，完整；红包转账真实走后端金币账本；收藏(表情/消息)完整

**好友/联系人**：搜索加好友/好友请求(完整)、二维码加好友/扫码加群(**仅限App内摄像头扫码路径，链接分享路径未打通**，见TODO)、黑名单(完整)、好友标签/分组(完整)、好友备注(完整)

**群管理**：建群/邀请/踢人/转让群主/设管理员(完整)、群公告/昵称/头像/管理开关(完整)、群二维码/邀请链接(**生成/复制完整，但链接本身不可点击直达**，见TODO)、退群/解散群(完整)

**朋友圈**：发布(文字+多图+可见范围)/点赞/评论(含回复评论)/删除/通知列表，完整

**通话**：单聊语音/视频(真实WebRTC，工程质量高，含TURN/STUN动态获取/CallKit集成/来电通知/45秒未接超时/断网宽限重连/听筒扬声器切换)；**本次会话内(2026-08-29)新增通话悬浮小窗**；群语音/视频(mesh架构，含glare避免逻辑，完整)；通话记录完整；唯一已知小缺口：CallKit"保持通话"直接空操作放行，不支持真正保持(有意为之，非阻断性)

**钱包/红包/转账**：余额/流水/转账/红包完整；**充值无真实支付网关**(同Android)

**个人资料/设置**：资料编辑/二维码/账号安全(换绑手机号)/会话管理/主题外观/字体大小/勿扰模式/通知设置/隐私设置/清缓存/邀请好友，均完整；**修改密码、注销账号无UI入口**(见TODO)

**通知/推送**：APNs+FCM双通道、VoIP Push拉起来电(CallKit)，完整，工程成熟度高

**其他**：应用内搜索(仅聊天记录内容搜索，非全局用户/群组搜索，UI已明确标注非缺陷)、草稿箱、离线消息缓存/发件箱；**未发现**：生物识别/App锁、地理位置分享、应用内更新检查(iOS天然靠App Store/TestFlight，非缺陷)

### iOS 端 TODO / mock / 半成品

| 文件:行号 | 说明 |
|---|---|
| `Data/Repositories/WalletRepository.swift:101-103` + `Features/Profile/WalletView.swift:26-40` | 充值无真实支付渠道(全仓库搜索StoreKit/SKProduct/WXApi/AlipaySDK均无命中)，客户端可自助铸币，上生产前必须补真实支付或确认后端有独立防刷限制 |
| `Data/Repositories/ProfileRepository.swift:181-187`(`changePassword`) | 接口与后端已完整对接，但全项目grep未发现任何View/ViewModel调用，设置页面没有"修改密码"入口，功能已实现但用户完全无法从App内使用 |
| `Data/Repositories/ProfileRepository.swift:189-195` + `Core/Session/SessionStore.swift:127-136`(`deleteAccount`) | 同上：后端接口+本地清理逻辑均已写好，但设置页面没有"注销账号"入口，**是否为App Store强制要求的合规功能遗漏建议重点确认** |
| `Features/Chat/ChatViewModel.swift:568-572`(`parseContactCard`) | 名片消息只有"解析并展示"路径，无任何发送contact_card消息的方法，也无发送入口按钮，iOS端只能被动接收其他端发来的名片 |
| `Features/Group/GroupQrView.swift:29-33` + `Touliao.entitlements` | "复制邀请链接"生成`https://touliao.cc/join/...`形式的Universal Link，但entitlements中未配置`com.apple.developer.associated-domains`，App目录下也无任何`onOpenURL`/`continueUserActivity`处理代码，链接分享出去后对方点击不会拉起App完成进群，唯一能用的入群路径是App内摄像头扫二维码 |
| `Core/Push/VoipCallManager.swift:94-97` | CallKit"保持通话"操作被直接空放行(fulfill但不做任何真实保持处理)，已知有意为之的功能缺口，建议在通话UI上也隐藏/禁用"保持"按钮避免用户误以为生效 |
| `Features/Auth/AuthViewModel.swift:33-35,79-94` | 找回密码用固定6位邀请码作身份核验(同Android)，功能能跑通但核验强度偏弱，建议作为安全评审项 |

---

## 四、Web / Android / iOS 三端功能覆盖差异对比

> 基于以上三份独立审计结果交叉比对整理。标注"待确认"的项目是本轮审计未做针对性核实，不构成确定结论。

| 功能点 | Web | Android | iOS | 差异说明 |
|---|---|---|---|---|
| 多账号本地切换 | ✅ 完整实现(免密切换，最多15个) | 审计未报告 | ✅ 完整实现 | Web/iOS均明确支持；Android审计只报告了"多端会话管理"(查看/踢设备)，与"本地多账号切换"是不同能力，未见Android有等价实现，建议专项核实 |
| 找回密码身份核验方式 | ⚠️ 已主动禁用自助重置(仅提示联系管理员线下处理，代码注释P1-01标注因账号接管风险下线) | ⚠️ 仍用6位邀请码代替短信OTP自助重置 | ⚠️ 仍用6位邀请码代替短信OTP自助重置 | **三端不一致且方向相反**：Web认为这条自助重置路径不安全已经下线，Android/iOS却还在用同样弱验证强度的方式提供自助重置——建议统一决策(要么都下线走人工，要么都升级成真正的短信OTP) |
| 修改密码 / 注销账号 UI 入口 | 未在本轮明确核实 | ✅ 完整实现(有入口) | ❌ 后端接口已对接，**但无UI入口**，孤儿代码 | iOS这一项证据明确，且注销账号可能涉及App Store合规要求，建议优先处理；Web端待专项核实 |
| 朋友圈发视频动态 | ❌ 明确不支持(仅images字段，最多9张) | ❌ 明确不支持 | 审计未明确提及video UI，但后端无video上传接口，实质上也不支持 | 后端`/api/moments/images`只有图片接口，三端一致受限，是后端能力缺失，不是某一端单独的差距 |
| 名片消息发送(而非仅接收展示) | 未在本轮明确核实 | 审计将contact_card列为"完整实现"的消息类型，未特别标注收发不对称 | ❌ 明确只能接收展示，无发送入口/无发送方法 | 需要额外核实Android/Web是否真的能"发送"名片，若能则是iOS单独缺口 |
| 群邀请链接可点击直达(Universal Link/App Link) | ✅ 天然支持(链接本身就是网页URL) | 待确认(未核实intent-filter深链配置) | ❌ 明确未配置Associated Domains，链接分享出去点击无法拉起App，只能App内扫码 | iOS这一项有明确代码证据；Android需要专项核实App Link intent-filter配置 |
| 通话悬浮小窗(通话中可退回其它页面) | ✅ **已有**——`CallModal.jsx`明确含"可拖拽画中画、最小化悬浮窗" | ✅ 已实现(2026-08-29本次会话新增) | ✅ 已实现(2026-08-29本次会话新增) | 三端目前均已具备，此前初版审计误判Web缺失该能力，已订正 |
| 国际化(中英文/繁体切换) | ⚠️ **名存实亡**——词典/Context/切换UI都在，但全仓库仅1处调用`useI18n()`且从未调用`t()`，切换语言界面文字不会变 | 审计未报告有此能力 | 审计未报告有此能力 | Web的i18n是半成品而非可用优势，不构成"Web领先"；移动端是否需要多语言待产品确认 |
| App内自动更新(检查/下载/安装) | N/A(浏览器/Electron自动更新机制不同，非同类比较) | ✅ 完整(检查/下载/APK安装引导) | N/A(依赖App Store/TestFlight，架构上不需要此模块) | 平台特性差异，非功能缺陷 |
| 表情包分页加载 | ⚠️ 假分页(首次拉全量，"加载更多"只是前端slice) | 未在本轮明确核实 | 未在本轮明确核实 | 用户表情数量正常范围内无感，量级增长后有性能隐患 |
| 语音转文字(ASR) | ✅ 完整(调用后端faster-whisper) | ✅ 完整 | ✅ 完整 | 三端一致 |
| 好友标签分组 | ✅ 完整 | ✅ 完整 | ✅ 完整 | 三端一致 |
| 钱包充值真实支付通道 | ❌ 无(占位实现) | ❌ 无(占位实现) | ❌ 无(占位实现) | 三端一致，是后端`wallet.service.js`层面的设计选择(代码注释自称"占位")，不是某端遗漏 |
| 消息内容审核 | 三端均无从感知——后端P12 mock已被禁用且无替代实现 | 同左 | 同左 | 后端层面的能力缺失，非客户端问题 |

---

## 五、总结：最值得 CTO 关注的几项

1. **P12 内容审核 mock 被标注"恒安全极具误导性"并已下线，生产环境目前没有任何真实运行的内容审核机制**——如果合规/产品要求需要审核，这是需要独立立项的安全缺口，不是随手能改的小问题。
2. **iOS 端"修改密码"/"注销账号"后端接口都已就绪，但 App 内完全没有 UI 入口**，属于孤儿功能；注销账号是 App Store 审核可能强制要求的能力，建议优先核实并补齐。
3. **iOS 群邀请链接因缺少 Associated Domains 配置，分享出去的链接点击后无法拉起 App**，只能靠 App 内扫码入群，功能"看起来做了一半"。
4. **三端钱包充值均无真实支付网关**（代码自称"占位"），是否要接入真实支付渠道、或明确产品定位为纯虚拟金币经济，需要产品/CTO 层面拍板，而非工程侧自行决定。
5. **找回密码三端不一致且方向相反**：Web 已经因为"6位邀请码重置密码"存在账号接管风险而主动下线自助重置（代码注释 P1-01），只让用户联系管理员线下处理；Android/iOS 却仍在用同样弱验证强度的邀请码方式提供自助重置入口。建议尽快统一决策——要么三端都收紧成人工处理，要么把移动端也升级成真正的短信/邮箱 OTP，不应该长期停留在"Web 觉得不安全已经关了、移动端还开着"的不一致状态。
6. **通话悬浮小窗三端目前均已具备**（Web 的 `CallModal.jsx` 本来就有可拖拽画中画/最小化悬浮窗；iOS/Android 是本次会话内新增补齐），首版审计曾误判 Web 缺失该能力，已订正——不需要额外补开发。
7. **Web 端国际化是名存实亡的半成品**：三语词典、Context、语言切换 UI 都已经搭好，但全仓库只有 1 处调用 `useI18n()` 且从未调用 `t()`，用户切换"外观→语言"后界面文案实际不会有任何变化。如果多语言是真实产品需求，这里需要补"接线"工作而非从零开发；如果不是当前优先级，建议至少在设置页隐藏这个语言切换入口，避免用户以为功能生效了。
8. **后端 `p14-deep-optimization.routes.js` 是完全未挂载的死代码**，`/api/optimization` 下的 P4.3-P4.7 特性依赖运行时未必真正初始化的引擎实例，建议清理死代码并核实优化模块的真实生产状态。
9. **红包发送接口在 `/api/messages/red-packet/*` 与 `/api/redpackets/*` 重复挂载**，属历史遗留，建议梳理为单一入口以降低维护成本。

---

## 六、认证与会话安全审查

> 2026-08-29 补充审查，范围：密码哈希/JWT密钥管理/token过期与失效/登录限流与提示/四端token存储/WebSocket握手鉴权。纯只读，未修改代码。

**1. 密码哈希** 🟢
- `backend-v2/src/modules/auth/auth.service.js:125`（注册）、`:257`（改密）：`bcrypt.hash(password, 12)`，12轮
- `:148`（登录校验）、`:199`（注销校验）、`:256`（改密校验）：均用 `bcrypt.compare`
- `:94-99`：`login()` 在用户不存在时仍用固定 dummy bcrypt hash 走一遍完整 `compare`（约200ms），防止通过响应耗时侧信道枚举已注册手机号
- 全仓库 grep `md5`/`sha1`/`createHash`：命中的都是上传去重键/ETag/并发控制key（`utils/collections.js:18`、`integrations/cdnOptimizer.js:59`、`modules/upload/chunk.js` 等），**没有一处用于密码**，也没有明文存储

**2. JWT secret** 🟢
- `config/index.js:18` 只读 `process.env.JWT_SECRET`，无硬编码兜底值；`:155-156` 启动时强制校验长度≥32字符，不满足直接致命错误退出
- 根目录与 `backend-v2/` 的 `.gitignore` 均排除 `.env`；`git log --all --full-history -- backend-v2/.env` 和 `git ls-files` 均确认该文件从未被提交、当前也未被追踪——没有泄露到 git 历史

**3. Token 过期/刷新/失效机制** 🟢
- 有效期：普通用户 7 天（`config/index.js:30`），管理后台 12 小时（`:38`，独立更短）
- 刷新：`auth.controller.js:70-81` `refresh()` 签发新 token 后立即把旧 token 拉黑
- 登出：`auth.controller.js:83-113` 把 token 整体拉黑 + 删除对应 session 行 + 拉黑其 `jti`
- 改密码后旧token失效：`auth.service.js:190-191` 推进 `password_changed_at`；HTTP中间件 `middleware/auth.js:55-58` 和 WebSocket握手 `realtime/index.js:95-98` 都会比较 `token.iat < password_changed_at`
- **例外**（详见第七节WebSocket审查）：`changePassword`（`auth.service.js:246-265`）没有像`deleteSession`那样逐个拉黑其它设备session的jti，且WS的逐事件复检中间件不查`password_changed_at`——导致改密码那一刻**已经建立**的其它设备WS连接不会立即被踢断，要等它自然断线重连才会被拒绝

**4. 登录限流 / 验证码** 🟡
- `middleware/rateLimiters.js:63-70`：登录5次失败锁10分钟（`skipSuccessfulRequests:true`，只有失败计入），key优先取手机号、否则IP
- `:121-127`：重置密码 3次/小时，同样按手机号keyed
- **没有任何验证码(CAPTCHA)机制**，`auth.service.js:303`注释也承认"无短信/邮箱验证码投递能力，无法建立真正的身份验证"
- `rateLimiters.js:237-239` 有 `DISABLE_RATE_LIMIT=1` 环境变量能一键关掉所有限流（含登录），需确保生产环境未设置
- **重要发现**：`auth.service.js:309-312` `resetPassword()` 函数目前是**硬编码禁用状态**，无论传什么参数都直接抛"密码重置功能暂不可用，请联系管理员"，后端这个口子实际已关闭。但Android/iOS客户端仍保留调用此接口的"找回密码"（6位邀请码）UI流程，实际点击会统一收到"功能不可用"——是UI层的死功能，不是能被利用的活跃漏洞

**5. 登录失败提示是否区分账号不存在/密码错误** 🟢
- `auth.service.js:149`：无论"手机号不存在"还是"密码错误"，统一返回 `'手机号或密码错误'`，配合第1点的时序保护，两种情况响应内容和耗时都无法区分

**6. Token 客户端存储方式** 🟡
- **Web(浏览器)**：`contexts/AuthContext.jsx:45` 确认"token 始终只在后端签发的 httpOnly Cookie 中，JS 无法读取"，本地只存 `{id, user, lastLoginAt}` 不存token
- **Electron/Capacitor(移动端WebView)**：`AuthContext.jsx:17-20,32-41`、`utils/axiosInterceptor.js:40,49`、`main.jsx:85`：因跨域/file://场景Cookie不可靠，改用 **`localStorage` 存Bearer token**（key: `touliao_electron_token`），暴露在渲染进程JS上下文。`desktop-electron/src/main.js:412-413,425` 确认 `contextIsolation:true`、`nodeIntegration:false`、`webSecurity:true` 均开启，即便XSS偷到token也拿不到Node级别权限，风险被收敛但未完全消除
- **Android**：`core/storage/TokenStore.kt:5,42-48`：`EncryptedSharedPreferences`（AES256-GCM/SIV），符合要求
- **iOS**：`Core/Storage/KeychainStore.swift:26-30`：标准 `Security`框架 Keychain（`kSecClassGenericPassword`），无UserDefaults存token痕迹，符合要求

**7. WebSocket握手鉴权** 🟢——不是"连上就能收发"
- `realtime/index.js:59-105` `io.use`中间件在`connection`事件前跑完整鉴权链：per-IP握手频率限制→取Cookie/auth.token中的JWT→`jwt.verify`→查token黑名单→查jti黑名单→查用户是否存在→查封禁/改密时间，任一失败直接拒绝握手
- 已建立的连接还有逐事件复检（`:131-151`，每次收发都查jti黑名单+封禁状态），比多数IM的"握手过了就一直信任"更严格（但该复检遗漏了`password_changed_at`，见第3点例外）

**一句话总结**：认证与会话整体实现扎实（bcrypt+时序保护、httpOnly cookie、JWT黑名单精确到session级、WS握手全链路鉴权），**唯一值得跟进的活跃风险点是Electron/移动端WebView把Bearer token放在localStorage**；找回密码后端已关闭但客户端UI未同步清理，是技术债而非活跃漏洞。

---

## 七、Realtime / WebSocket 安全与可靠性审查

> 2026-08-29 补充审查，范围：`backend-v2/src/realtime/` 全目录。纯只读，未修改代码。

| 严重程度 | 问题 | 证据 | 说明 |
|---|---|---|---|
| 🟡 中 | **改密码不会立即踢断其它设备已建立的WebSocket连接** | `auth.service.js:246-265`(`changePassword`) vs `realtime/index.js:131-151`(逐事件`socket.use`) | `changePassword`删了`user_sessions`表行、推进了`password_changed_at`、拉黑了**当前**token，但没有循环给其它设备session逐个拉黑jti（对比`deleteSession`/`deleteAllOtherSessions`会做）。逐事件复检中间件只查jti黑名单和`banned`，不查`password_changed_at`。结果：其它设备若WS连接当时还开着，改密码后仍会继续正常收发消息，直到该连接自然断线重连才在握手阶段被拒绝（握手阶段`:95-98`是查`password_changed_at`的）。HTTP侧没有此问题（`middleware/auth.js:55-58`每次请求都查）。 |
| 🟡 中 | **Token过期(7天)本身不会主动断开已连接的WebSocket** | `realtime/index.js:59-105`(仅握手校验)、`:131-151`(逐事件只查jti黑名单+banned，不查`exp`) | 握手成功后，除非触发登出/踢设备/封禁，一条已建立的WS连接不会因JWT自然到期被服务端主动断开。实际影响有限（客户端定期重连会触发握手重验），但严格说不是"token过期即失效"。 |
| 🟢 低 | **`missed()`断线补拉接口排序没有rowid兜底** | `messages.service.js` `missed()`(`:144`)只用`ORDER BY m.created_at ASC`，`created_at`秒级精度 | 主历史查询`history()`有`, m.rowid DESC`兜底，`missed()`没加。同一秒内插入的多条消息在这个接口的返回顺序理论上不严格保证插入序，客户端会按消息自身字段再排一次，实际观感问题不大，建议顺手补上。 |
| 🟢 低 | **超过500个群的用户，连接建立时只自动订阅前500个群的实时房间** | `realtime/index.js:160-166`：`MAX_ROOMS=500` | 第501个及以后的群不会在连接时自动`join`，若客户端未对这些群补发`join_conversation`，实时推送会失效。1000人单机场景概率很低。 |

**逐项结论**：
1. **连接鉴权**：握手时必须携带合法JWT，`:75-98`依次查验签/黑名单/jti黑名单/存在性/封禁/改密时间，任一失败拒绝握手；已建立连接还有逐事件复检（漏了password_changed_at，见上表）。
2/3. **消息投递(local msgId+ack)/去重**：`handlers/message.js:76` 标准socket.io ack模式；`:64-71` `checkDedup()`按`(sender_id, client_msg_id, conversation_id)`查重；DB层`UNIQUE INDEX idx_messages_client_msg`兜底；写操作走单一worker串行队列，实际并发竞态窗口很小。
4. **消息顺序**：`created_at`+`rowid`兜底排序（`missed()`除外，见上表），`broadcaster.js`批量合并"FIFO保序（数组内有序）"。
5. **离线消息**：不管对方在不在线都先落库再广播；`GET /api/messages/missed?after=<时间戳>`按时间戳游标增量拉取用户全部会话的新消息（一次最多300条），不是全量重拉。iOS端确认重连触发当前会话history重拉+失败消息自愈(`ChatViewModel.swift:192-197`)，全局`missed`接口具体调用时机未逐层追完。
6. **心跳与重连**：服务端`server.js:134-135` `pingInterval:25000`/`pingTimeout:20000`；三端(iOS/Android/Web)均用socket.io-client内置重连，1秒起10秒封顶指数退避，参数一致。Android后台被杀/iOS进后台/Electron休眠唤醒的OS生命周期层面行为未深入复核。
7. **广播是否越权（重点复核）**：全仓库仅3处`socket.join(...)`调用（自己的`user_${userId}`房间、连接时按DB查询到的真实会话、`join_conversation`/`join_group`事件且`typing.js:80`明确查`conversation_members`才放行），**没有发现能伪造conversationId收到别人消息的路径**；广播用`io.to(conversationId)`，只有真正join过的socket能收到。
8. **单机1000人规模**：`presence.js:18-24` `removeSocket`断开即清理Map条目，`cleanupUser`(`:48`)清资料缓存+限流计数器，无内存泄漏迹象；连接上限单用户5个并发socket、单IP 60秒30次握手，均在握手阶段拒绝。

**一句话总结**：消息投递/去重/顺序/离线补拉/广播权限控制都做得扎实，**没有发现room伪造越权漏洞**；两个中等问题都指向同一类场景——已经建立的WebSocket连接对"账号状态变化"（改密码、token过期）的实时感知不如HTTP请求灵敏，建议评估是否需要给`socket.use`逐事件复检补上`password_changed_at`比对，或在改密码/踢设备时主动对该用户当前所有活跃socket执行`disconnect(true)`。

---

## 八、接口鉴权与越权（IDOR）专项审查

> 2026-08-30 补充审查，范围：全部 `/api/*` HTTP路由的鉴权与资源归属校验。纯只读，未修改代码。

| 接口/场景 | 是否鉴权 | 是否校验资源归属 | 风险等级 | 证据 |
|---|---|---|---|---|
| 消息编辑 `PUT /api/messages/:msgId/edit` | 是 | ✅ `msg.sender_id!==userId`直接forbidden | 🟢 | `messages.service.js:475-483` |
| 消息撤回/删除 `DELETE /api/messages/:msgId` | 是 | ✅ 本人或群owner/admin才可操作，非法角色一律拒绝 | 🟢 | `messages.service.js:387-427` |
| 会话历史 `GET /api/messages/:conversationId` | 是 | ✅ `requireMember`查`conversation_members`表，非成员直接403 | 🟢 | `messages.service.js:23-24`、`shared.js:38-45,97-99` |
| 断线补拉 `GET /api/messages/missed` | 是 | ✅ 只查`user_id`自己所属的会话 | 🟢 | `messages.service.js:130-145` |
| 好友请求处理 `POST /api/users/friend-request/:id/handle` | 是 | ✅ `WHERE id=? AND to_id=userId AND status='pending'`，不是发给自己的请求查不到 | 🟢 | `contacts.service.js:142-149` |
| 删除好友/设置备注/拉黑/取消拉黑 | 是 | ✅ 全部用`req.user.id`作为操作方，客户端无法伪造"代表别人操作" | 🟢 | `contacts.controller.js:12-13,20-21` |
| 收藏详情/取消收藏 `GET/DELETE /api/users/me/collections/:id` | 是 | ✅ SQL层`WHERE id=? AND user_id=?`，天然无法越权到别人的收藏 | 🟢 | `users.service.js:267-278` |
| 用户资料 `GET /api/users/:id` | 是 | ✅ `bio`/`cover_photo`按好友关系+`profileVisible`设置门控；管理端(`is_privileged`)才有精确`last_online_at` | 🟡 | `users.service.js:172-208` |
| 朋友圈动态详情 `GET /api/moments/:id` | 是 | ✅ `assertVisible`：本人快速放行，否则依次查双向拉黑、`private`、好友关系、分组可见(include/exclude)、"最近N天可见"，任一不满足即403 | 🟢 | `moments.service.js:55-71,289-294` |
| 朋友圈时间线/某用户动态列表 | 是 | ✅ 全部条件下推到SQL WHERE子句里过滤（不是查出来前端再筛），含双向拉黑排除 | 🟢 | `moments.service.js:226-286` |
| 群管理：踢人/解散/转让群主/设管理员/群设置 | 是 | ✅ 分别校验`owner`/`admin`角色，`admin`不能动别的`admin`或`owner`，`transferOwner`/`setRole`/`dissolve`严格要求`owner_id===userId` | 🟢 | `groups.service.js:193-315` |
| 私聊发消息（黑名单拦截） | 是 | ✅ 双向查`blocked_users`（我拉黑对方 OR 对方拉黑我），任一命中即拒绝发送 | 🟢 | `messages/shared.js:56-80` |
| 已上传文件访问 `/uploads/:category/:file` | 是（Cookie/Bearer/短时ticket/管理员，均需token） | ✅ `files`类别强制走`file_registry`/`file_registry_shares`所有权表（明确不信任`messages.file_url`本身，防"在自己会话插入引用受害者文件的消息行"这类planted-row IDOR）；`chunks`一律403；`avatars`/`stickers`登录即可查看（社交展示场景，符合预期） | 🟢 | `app.js:106-217` |
| 管理后台 `/api/admin/*`（垂直越权） | 独立`adminAuth`中间件 | ✅ 要求JWT payload含`admin===true`；普通用户token（`signToken`payload只有`id/username/csrf/jti`，从不含`admin`字段）即便签名算法/密钥意外相同也过不了这道payload claim检查 | 🟢 | `adminAuth.js:13-30`、`auth.service.js:59-67` |
| 后台监控清缓存 `POST /api/monitoring/redis-clear` | **auth+adminAuth 双重鉴权** | — | 🟡 | `monitoring.routes.js`（见第一节路由清单）；权限组合特殊，建议确认是否为预期设计而非遗漏 |
| `GET /api/users/:id` 的`isBlocked`标志只查"我是否拉黑了对方"单向 | 是 | ⚠️ 不查"对方是否拉黑了我"这个反方向，即被对方拉黑后仍可正常查看对方基础资料(受`profileVisible`门控，非完全裸露) | 🟢低 | `users.service.js:192`（查询条件只有`user_id=viewerId AND blocked_id=targetId`一个方向） |
| 后台管理员密钥在非生产环境的兜底 | — | — | 🟢低 | `config/index.js:19-25`：`ADMIN_JWT_SECRET`未设置时，仅在`NODE_ENV==='production'`会致命报错；非生产环境会静默回退到与普通用户共用的`JWT_SECRET`。但`adminAuth.js:24`仍强制要求payload有`admin:true`声明，常规用户token拿不到这个claim，所以即使密钥共享也不能直接跨界签发有效管理员token（除非攻击者本来就已经能签发任意payload的JWT，那密钥是否共享已经不是关键变量）——纯粹是"非生产环境安全边界比生产弱"的常规现象，非活跃漏洞 |

**nginx静态目录检查**：`touliao.cc`当前生效配置（`/etc/nginx/conf.d/touliao-cc.conf:77-86`）明确写着"P1-02: 走 Express 鉴权，禁止 nginx 直读"，`/uploads/` 走`proxy_pass`到Node后端而非`alias`静态目录，与上表`/uploads/:category/:file`的鉴权链路完全一致，**没有绕过应用层鉴权的裸奔路径**。（该目录下还留有几份历史备份配置文件`.bak-diag`/`.phase1-backup`等，其中确实有旧版本用`alias`直出`/uploads/`的写法，但这些文件不带标准`.conf`后缀，不会被nginx主配置的`include conf.d/*.conf`加载，属于死配置，建议清理掉以防未来误操作重新启用。）

**一句话总结**：接口鉴权与资源归属校验做得非常扎实——横向越权（改userId/msgId/conversationId看别人东西）、纵向越权（普通用户碰admin接口）、删改操作的归属校验、拉黑/朋友圈可见范围的服务端强制执行、文件URL的所有权链路，**均未发现可实际利用的越权漏洞**。唯一两处🟡都是"设计选择/权限组合較特殊"级别的观察项，不是活跃风险。

---

## 九、数据库层专项审查（SQLite / better-sqlite3）

> 2026-08-30 补充审查，范围：`backend-v2/src/db/`、写入路径、索引、分页、备份与用户删除级联。纯只读，未修改代码。

**1. WAL模式** 🟢 已开启
- `db/connection.js` `tunePragmas()`：写连接 `journal_mode = WAL`、`synchronous = NORMAL`；只读连接单独走 `query_only = ON` + `locking_mode = NORMAL`，WAL下读写互不阻塞
- `wal_autocheckpoint = 2000`、`journal_size_limit = 67108864`（WAL日志硬顶64MB，防止长期不checkpoint导致WAL文件无限增长）

**2. busy_timeout** 🟢 已设置
- `connection.js`：`busy_timeout = 5000`（5秒），高并发下短暂锁等待不会立即抛`SQLITE_BUSY`

**3. 写入串行化** 🟢 架构合理，非连接池而是专用写线程
- 不是"连接池"模式（SQLite本身是单写者模型，连接池对写没有意义），而是**唯一一个独占写连接的worker thread**（`db/writer.js`+`db/worker.js`）：主线程所有高频写（`write`/`writeAsync`/`writeBatch`）都postMessage给这个worker，worker侧5ms窗口/最多800条攒批，每批在**一个`db.transaction()`**里顺序执行后一次COMMIT
- 多个请求"同时"写：天然串行化到worker的消息队列里，不会出现两个请求同时抢SQLite写锁的情况；`writeBatch`的多条SQL保证原子性（转发消息、发红包+建消息等场景在用）
- 背压/容错完备：队列深度分级（22k过载/8k退出过载）、30k硬顶快速失败、worker崩溃自动重启+未确认操作重放

**4. 索引** 🟢 关键路径均有覆盖（完整清单见第二节schema）
- `messages`: `idx_messages_conv_time(conversation_id,created_at)`、`idx_messages_sender`、`idx_messages_unread`(partial, `WHERE deleted=0`)、`idx_messages_conv_del_time`、`idx_messages_client_msg`(unique)、`idx_messages_file_url`(partial)
- `moments`: `idx_moments_user(user_id,created_at)`、`idx_moments_time`
- 未发现messages/moments主查询路径存在明显缺索引导致的全表扫描；`messages_fts`(FTS5 trigram)承担全文搜索，避免`LIKE '%...%'`全表扫（但`searchGlobal`一处仍用了`content LIKE ?`，见下方观察项）

**5. 参数化查询** 🟢 全量核查，可达路径无拼接注入
- 全仓库检索所有含`${}`插值的SQL模板字符串（41处），逐一核实：绝大多数是`ph = ids.map(()=>'?').join(',')`这种"动态生成占位符数量"的标准安全写法（值仍通过`.run(...ids)`绑定，不是拼值）；`UPDATE ... SET ${assignments}`类的动态列名（`users.service.js:99-101`、`groups.service.js:273`）均来自函数内部硬编码的白名单字段名，不是直接取`req.body`的key
- 仅发现2处"表名/列名直接插值"的不安全写法：`utils/queryOptimizer.js:217`（`getTableStats`）、`utils/optimization-p10/raceConditionAnalyzer.js:19`（`optimisticLockRead`）——但全仓库搜索确认**这两个函数从未被任何HTTP路由/其它模块调用**，是P10优化脚手架里的死代码，当前不可达，不构成活跃注入面（建议连同其它未挂载的P10/P14代码一并清理）

**6. 事务完整性（发消息+更新会话最后一条+未读数）** 🟢 该顾虑在本项目架构下不成立
- `conversations`表**没有**冗余的`last_message`/`unread_count`字段——查了schema确认。会话列表的"最后一条消息"和未读数都是**查询时实时计算**（`unreadCounts()`：`COUNT(*) FROM messages WHERE conversation_id=... AND created_at>last_read_at`，`conversations.service.js:309-324`），不是写时同步维护的缓存计数器
- 因此发消息就是一条`INSERT INTO messages`，没有"第二处状态"需要保持同步，天然不存在这类不一致风险；真正需要原子性的复合写入场景（转发多会话、红包发送+建消息）用的是`writeBatch()`，在worker侧确实包在同一事务里（见第3点）

**7. 分页方式** 🟡 主链路已是游标分页，次要视图仍是offset
- **消息主时间线** `GET /api/messages/:conversationId`（`history()`）：`before`/`after`/`beforeId`游标分页，非offset——已经是推荐做法
- **断线补拉** `GET /api/messages/missed`：`after`时间戳游标，同上
- 朋友圈时间线/某人动态/点赞列表/评论列表、收藏列表、钱包流水、全局搜索/会话内搜索、会话文件聚合视图、@我消息聚合、后台用户/消息/群列表：**均为`LIMIT ? OFFSET ?`**——这些是相对低频翻页、数据变动频率也低于实时聊天流的场景，offset分页在这类场景的"跳页/漏看"体感问题比消息流小得多，但严格来说仍有理论上的重复/遗漏风险，如果产品上朋友圈或消息搜索也要做到分页零误差，建议同样改成基于`created_at+rowid`或`id`的游标

**8. 数据库文件权限 / 备份 / 增长** 🔴 发现一个需要立刻处理的运维缺口
- **文件权限**：`wechat.db`/`-wal`/`-shm` 均为`644 root:root`，理论上"其他用户可读"；但`/root`目录本身是`700 root:root`，非root本地用户根本无法`cd`进`/root/touliao/...`路径，所以**当前并不构成可利用的暴露**（本机仅有的另外两个可登录账号`linuxuser`/`claudeops`都进不去`/root`）。仍建议把文件本身收紧到`600`作为纵深防御，避免未来项目搬出`/root`或加了新的本地账号后失去这层保护
- **🔴 备份：脚本存在但从未被调度执行**。`deploy/touliao-backup.sh`写得很完整（`sqlite3 .backup`热备份+gzip、uploads目录打包、30天自动清理、失败Telegram告警），脚本注释明确写着"由setup-new-server.sh安装到/usr/local/bin/touliao-backup，cron每日03:00执行"——但实际核查：`/usr/local/bin/touliao-backup`**不存在**，`crontab -l`里**没有**这一行，也没有对应的systemd timer，`/var/backup/touliao/`目录**从未被创建过**。也就是说：这是一台1000人量级的生产库，**当前完全没有自动化备份在跑**，一旦`wechat.db`损坏/被误删/磁盘故障，没有任何自动恢复点。这是本轮九项审查里唯一的🔴，建议尽快把这个脚本装上crontab（脚本本身不需要改，只是没人把它接进调度）
- **增长**：当前`wechat.db`约4MB，`-wal`约8.5MB（WAL比主库大是正常现象，`wal_autocheckpoint`还没触发检查点，不是泄漏）。消息表没有设计"自动过期清理"策略（`messages`没有TTL/归档机制），这是预期设计（IM消息通常要求长期保留，不是日志类数据），但如果1000人长期高频使用，`messages`/`messages_fts`/`audit_logs`会持续增长，建议后续关注磁盘容量趋势。`audit_logs`本身有独立的进程内定时清理（`auditLogger.js:259,262`，`setInterval`触发`DELETE FROM audit_logs WHERE created_at<?`），不依赖外部cron，这块是妥善的

**9. 删除用户后的级联处理** 🟢 双层设计，均经过深思熟虑
- **自助注销**(`DELETE /api/auth/delete-account`，`auth.service.js:196-244`)：软删+匿名化——`username`/`phone`/`avatar`/`bio`/`wechat_id`清空替换为`已注销<uuid片段>`、`banned=1`；显式**不**删除该用户发送过的消息/朋友圈动态本身（注释："自助注销仅软删用户本体，不删他人可见的会话/消息"），避免把别人聊天记录里的内容挖空；但会清理该用户自己的私有关系数据（联系人、黑名单、好友请求、群成员身份、设备账号、会话、会话设置/清空水位）。红包结算与余额拦截被有意拆成两个独立事务，避免"退款成功但注销因为余额检查失败被整体回滚"这种资金卡死场景
- **管理员硬删除**(`admin.service.js:141-` `deleteUser`)：真正物理级联——该用户发的全部消息及其反应/送达记录/FTS索引/置顶记录、他对别人动态的点赞评论、他收到/触发的朋友圈通知、他的举报记录、朋友圈动态本体（`moment_likes`/`moment_comments`/`moment_notifications`对**自己动态**的级联由schema里的`ON DELETE CASCADE`外键自动处理，对**别人动态**的互动记录则显式手动DELETE，两类情况都覆盖到了）；群主身份提前处理——继承给最早加入的其他成员或整群解散（解散前还会结算群内在途红包，不会平白吞掉别人的钱）；甚至处理了"别人红包被这个用户领取过，物理删除领取记录会导致原红包剩余金额虚增、到期重复退款"这类不易发现的资金一致性边界（转记到系统占位ghost用户，保留`SUM(claimed)`）

**一句话总结**：数据库层的工程质量总体很高（WAL+worker串行写+完备背压、参数化查询无遗漏、用户删除级联异常仔细，尤其是红包资金一致性的处理），**本轮唯一需要立刻处理的是备份脚本从未接入调度**——这是运维配置缺口，不是代码缺陷，修复成本很低（加一行crontab）但当前风险是真实的。

---

## 十、输入处理与前端安全专项审查

> 2026-08-30 补充审查，范围：Web端XSS面、Electron安全配置、上传文件校验、接口入参健壮性、错误信息泄露、CORS。纯只读，未修改代码。

**1. XSS（React `dangerouslySetInnerHTML` / 内容转义）** 🟢 基本干净，一处第三方库输出
- 全仓库`web/src`只有**一处**`dangerouslySetInnerHTML`：`components/FilePreview.jsx:151`，用于渲染聊天里Excel附件的预览表格，HTML来自`XLSX.utils.sheet_to_html()`（`FilePreview.jsx:118-121`，SheetJS官方API）——该函数在生成`<td>`内容时会对单元格文本做HTML转义，是库本身设计用来做"表格转安全HTML"的标准调用方式，不是手写字符串拼接。安全性依赖SheetJS自身转义实现的正确性，这属于合理的第三方库信任边界，不是touliao自己代码里的漏判
- 昵称/简介/消息内容等其余全部输出路径：全仓库再无第二处`dangerouslySetInnerHTML`，即所有用户可控文本都走JSX`{content}`常规插值——React默认对`{}`插值做HTML转义，天然阻断存储型/反射型XSS，不需要额外处理
- Android/iOS：全仓库确认**无任何WebView/`loadHtmlString`**用法，消息渲染全部是原生`Text`/`Compose Text`，没有HTML解析执行的攻击面

**2. Electron安全配置** 🟢 加固到位
- `desktop-electron/src/main.js:412-413,425`：`contextIsolation:true`、`nodeIntegration:false`、`webSecurity:true`
- 全仓库grep未发现`@electron/remote`/`enableRemoteModule`引入——未使用remote模块
- 外链处理（`main.js:358-378`）：`will-navigate`/`will-redirect`统一拦截，仅放行`file://`本地页面，`http(s)://`一律`e.preventDefault()`后转交`shell.openExternal()`（且外部打开前也做了`/^https?:\/\//`协议白名单校验，`javascript:`/自定义协议等无法触发）；`window.open`/`target=_blank`走`setWindowOpenHandler`统一`deny`+安全外链单独转发；额外禁止了`<webview>`标签嵌入（`will-attach-webview`直接`preventDefault`）。整体是比多数Electron应用更完整的加固覆盖面

**3. 上传文件校验** 🟡 校验体系扎实，唯独没有EXIF/GPS清理
- **真实MIME而非扩展名**：`utils/upload.js`采样4100字节魔数（`MAGIC_SAMPLE_BYTES`），用`file-type`库识别真实类型（`:14,136`），扩展名白名单(`ALLOWED_CHAT_EXTS`)+危险扩展名黑名单(`BLOCKED_EXTENSIONS`，含`.exe/.php/.jsp/.html/.svg`等)+魔数识别出的可执行/危险类型二次拒绝(`DANGEROUS_DETECTED_MIMES`)，三层防伪装（把.exe改名成.mp4会被魔数识破）
- **大小限制**：`MAX_UPLOAD_BYTES`默认200MB(可环境变量覆盖)，另有磁盘剩余空间阈值(500MB以下拒绝新上传，防磁盘耗尽DoS)、单用户并发分片上传会话数上限(5)
- **文件名路径穿越**：落盘文件名一律`uuidv4()+安全派生扩展名`（`:277`），**从不使用客户端提交的`originalname`作为实际存储路径**，天然消除`../../`路径穿越风险；`originalname`只经`sanitizeFilename`处理后用于展示/下载文件名
- **🟡 EXIF/GPS未清理**：全仓库确认**没有引入`sharp`/`jimp`等任何图片处理库**（`package.json`无相关依赖），意味着头像/聊天图片/朋友圈图片全部原样存储、原样下发，**不会剥离EXIF元数据**——如果发送方手机拍照时嵌入了GPS坐标，接收方（有权限查看该图片的人）拿到的就是带定位信息的原图。微信/WhatsApp/Signal等主流IM默认会在服务端或客户端重新编码图片以清除EXIF，这里目前没有等效处理，是一个真实存在的隐私缺口，建议评估是否需要在图片上传管道加一道EXIF剥离（不影响图片视觉内容，纯元数据层面）

**4. 接口入参类型/长度校验、缺参/错类型是否500** 🟢 有统一兜底，不会真正崩溃
- 全部路由经`asyncHandler`包装，任何同步抛出或Promise reject都会被捕获转发给统一错误处理中间件，不会导致进程崩溃或请求挂起
- 抽查的典型路径（登录`if(!phone||!password) throw badRequest`、断线补拉`parseInt(after)||0`后`if(after<=0)throw badRequest`、改密码长度正则校验等）均是显式类型/存在性检查后转为**干净的400**，而不是让类型错误一路捅到运行时异常
- 即便某处校验存在遗漏、底层抛出未预期的`TypeError`等，也会被①中的`errorHandler`兜底为统一500响应（见下一条），**不会导致500消息体夹带堆栈或具体报错内容**，也不会让进程崩掉——安全性有保底，但个别接口对"应该返回400"的输入返回500，属于API健壮性/体验问题，不是安全漏洞，如需要可以再单独抽查哪些接口具体命中这种情况

**5. 错误堆栈是否泄露给客户端** 🟢 未泄露
- `middleware/error.js:32-35`：未预期异常一律返回`{ error:'服务器内部错误', error_code:'INTERNAL_ERROR', request_id }`，真实堆栈只结构化记录进winston日志（`error.log`/`combined.log`），从不出现在HTTP响应体里
- 已知业务错误（`ApiError`及带`.status`的Error）返回的是开发者手写的用户可读中文提示（如"手机号或密码错误"），不是原始异常信息，两类错误处理路径都不会把内部实现细节（文件路径/SQL语句/依赖库报错）透给客户端

**6. CORS配置** 🟢 非通配，显式白名单
- `app.js:65-72`：`origin`是函数而非`'*'`，只放行三类：无`Origin`头的请求（服务端到服务端/curl）、`origin==='null'`且非严格模式（专为Electron`file://`场景开的口子，有注释说明）、显式在`config.allowedOrigins`白名单内的域名（来自`APP_URL`/`CORS_ORIGINS`环境变量）；其余一律`cb(new Error('Not allowed by CORS'))`拒绝。`credentials:true`是在有限定白名单前提下才开的，没有"通配origin+带凭证"这种浏览器本就会拒绝但配置层面仍属危险的组合

**一句话总结**：输入处理这块同样扎实——XSS面几乎为零（唯一的`dangerouslySetInnerHTML`用的是库自带转义）、Electron加固到位（remote模块、外链协议、webview嵌入都堵了）、上传文件的伪装/路径穿越/大小/磁盘耗尽都有防护、错误响应不泄露堆栈、CORS没有通配。**本轮唯一实质性发现是图片上传全程没有EXIF/GPS清理**，这是产品隐私层面的真实缺口，建议评估优先级。

---

## 十一、业务逻辑正确性专项审查

> 2026-08-30 补充审查，范围：点赞/收藏幂等、取消操作后的数据清理、自关注/自私信/互拉黑边界、已读多端同步、消息撤回、群聊生命周期、分页边界、软删/硬删。纯只读，未修改代码。

**1. 点赞/收藏连点两次会不会重复计数** 🟢 双层防护，架构上不可能算错
- 朋友圈点赞`toggleLike()`（`moments.service.js:359-387`）：先查`existing`做常规toggle；对**真正并发**的双击（两个请求都在`existing`查询时看到"未点赞"）用`try/catch`兜底——`moment_likes(moment_id,user_id)`是复合主键，第二次`INSERT`会抛`SQLITE_CONSTRAINT_PRIMARYKEY`，代码显式捕获后按"已点赞"处理，不会报错也不会重复插入
- 收藏`addCollection()`（`users.service.js:226-243`）：同样两层——`dedup_key`（按类型+内容算出的去重键）先查重返回409，`INSERT OR IGNORE`+`res.changes===0`兜底并发竞态，DB层还有`UNIQUE INDEX idx_collections_dedup`兜底
- 关键点：`likeCount`/收藏数从不是一个"写时累加/减一"的独立计数器，全部是`COUNT(*)`实时查出来的，**天然不存在"计数和实际行数不一致"这类漂移问题**——没有counter可以drift
- "关注"在投聊里没有独立于好友关系的单向关注概念（好友关系走`friend_requests`→`contacts`双向建立），不存在"关注"单独的重复点击问题

**2. 取消点赞/删帖后计数、feed、通知是否清理** 🟢
- 取消点赞：`DELETE FROM moment_likes`后`likeCount`同样是`COUNT(*)`实时重算，立即反映最新值；对应的点赞通知默认**保留**（历史记录语义，`moments.service.js:368-371`有配置开关`config.moments.deleteNotifOnCancel`控制是否连带删通知，默认不删——这是产品选择不是bug）
- 删除动态：`purgeMoment()`路径下，`moment_likes`/`moment_comments`/`moment_notifications`三张表对该`moment_id`的关联行**均有`ON DELETE CASCADE`外键**（schema已确认），动态一删这些全部自动级联清空，feed查询本身也是从`moments`表实时JOIN出来的，删了立刻在所有人的feed里消失，不会有"删了还显示"的残留

**3. 互相拉黑 / 自己关注自己 / 给自己发私信** 🟢 全部显式拦截
- 加好友：`sendFriendRequest()` `contacts.service.js:54`：`if (toId===fromId) throw badRequest('不能添加自己')`
- 建私聊：`getOrCreatePrivate()` `conversations.service.js:28`：`if (otherId===myId) throw badRequest('不能与自己创建私聊')`
- 拉黑：`privateSendGuard`/`assertVisible`/`getOrCreatePrivate`里的拉黑检查全部是`(user_id=A AND blocked_id=B) OR (user_id=B AND blocked_id=A)`双向查询，无论谁先拉黑谁，发消息、建私聊、看朋友圈都会被双向拦住（此前几轮审查已反复验证过这个模式的一致性）

**4. 未读数多端同步 / 已读回执** 🟢
- `markRead()`（`conversations.service.js:377-407`）：写入`conversation_settings.last_read_at/last_read_message_id`后，广播两条不同语义的事件——`message_read`发到**会话房间**（让对方看到"已读"双勾），`sync:unread_cleared`发到**自己`user_${userId}`房间**（让自己其它在线设备清掉这个会话的未读角标）。两条事件目标不同、互不干扰，是正确的多端同步设计
- 未读数`unreadCounts()`本身是`COUNT(*) WHERE created_at>last_read_at`实时算的（见第九节第6点），已读状态一改，未读数下次查询立即准确，不存在"标了已读但角标没消"的缓存滞后问题（这也是本轮系列审查里发现的Android/iOS客户端此前漏读`_read`字段的bug已在本次会话内修复，服务端这一层本来就是对的）

**5. 消息撤回：时限校验 / 双端清理** 🟡 无时限（有意为之）+ 清理彻底
- **时限**：代码注释明确写"撤回不限时间：任意时长的消息本人（或群管理员）均可撤回"（`messages.service.js`），即touliao**没有**微信式"发出2分钟内才能撤回"的限制，是产品设计选择而非遗漏——是否要引入时限是产品决策，不是缺陷
- **双端清理**：撤回时服务端直接把该行`content`/`file_url`置空、`deleted=2`（即数据库层面已经不留原文），并`io.to(conversation_id).emit('message_recall', {msgId,...})`广播给**包括撤回者自己在内的所有当前在线设备**——发送方自己开着的其它设备、接收方所有设备，都会实时收到事件更新本地视图；非实时在线的一方下次拉历史时`deleted=2`的行内容也已经是空的，不会看到原文。撤回是彻底的（内容清空而非仅打标记），双端都会同步

**6. 群聊生命周期：退群/踢人/解散后的可见性、@提醒、群主转让** 🟢
- 退群/被踢：`conversation_members`行被删后，`requireMember`会在下次拉取该会话历史时直接403拒绝——**已经在本地缓存的历史消息设备上仍能看到（客户端本地存储，符合预期），但无法再从服务端拉取该会话的新内容**，这是主流IM的通用行为，不是bug
- 解散：`dissolve()`彻底清空会话相关数据（`purgeConversation`），所有成员的`group_dismissed`事件会先广播再执行`socketsLeave`（保证事件先送达再离开房间，避免"房间已空、事件发给0人"的时序问题，代码注释已说明这个细节）
- @提醒：`handleMentions()`基于当前`conversation_members`表JOIN用户名匹配——已退群/被踢的人不再在成员表里，自然不会被@到（正确行为）；@所有人仅群主/管理员生效，普通成员发"@所有人"会被静默忽略（不报错但也不产生群发通知，防刷屏）
- 群主转让：`transferOwner()`严格要求`conv.owner_id===callerId`且新群主必须是现有成员，转让是单个事务内`conversations.owner_id`+两条`conversation_members.role`同步更新，不会出现"转让了但角色没变"的中间态

**7. 分页边界：空列表/最后一页/超大page参数** 🟢
- 全仓库分页函数统一采用`Math.min(Math.max(parseInt(limit)||默认值,1），上限)`+`Math.max(parseInt(offset)||0,0)`的钳制模式（`moments.service.js`/`users.service.js`/`messages.service.js`等处处一致），非数字/负数/超大`limit`都会被夹回合理区间，不会被当成SQL层面的异常值传入
- 超大`offset`（如`offset=999999999`）在SQL语义下天然返回空数组，不会报错，只是当offset非常大时SQLite仍需要扫过被跳过的行、有性能开销（这是offset分页固有特性，不是touliao实现的bug，跟第九节"分页方式"里的观察项是同一件事）
- 空列表：所有列表接口在无数据时返回`[]`/`{items:[],total:0}`风格的空结构，没有发现"空列表时抛错"的情况（本轮抽查的`unreadCounts`/`getCollections`/`timeline`等在`rows`为空数组时都是直接`.map()`/`forEach`空转，JS对空数组的这些操作本身不会报错）

**8. 删除是软删还是硬删 / 级联** 🟢 已在第九节详细覆盖，此处汇总口径
- **消息撤回/删除**：软删（`deleted=2`+内容清空），行本身保留（用于消息计数/审计位置占位），但内容已不可恢复
- **动态删除**：硬删`moments`行，配合`ON DELETE CASCADE`级联清空点赞/评论/通知
- **联系人删除**：硬删`contacts`行
- **用户自助注销**：软删+匿名化本体，硬删自己的私有关系数据（联系人/黑名单/好友请求/群成员身份/设备/会话），但**保留**自己发过的消息/动态（归属显示为"已注销"，避免挖空他人聊天记录/评论上下文）
- **管理员硬删用户**：真正物理级联删除该用户产生的几乎全部数据（消息及其反应/送达/FTS索引/置顶、动态及其互动、举报记录等），并妥善处理群主继承、红包资金结算这两个最容易出错的边界（详见第九节第9点）
- 这是一套内部自洽的软删/硬删策略：**"删除自己主动能控制的数据"倾向硬删，"删除会影响别人可见内容的数据"倾向软删/匿名化保留**，设计意图清晰

**一句话总结**：业务逻辑正确性这轮审查下来同样是"文档级"工程质量——点赞/收藏的并发去重、拉黑/自关注/自私信的边界、多端已读同步、撤回的彻底清理、群生命周期的连带处理，**没有发现实质性的逻辑漏洞**。唯一算"发现"的是撤回没有时间限制，但这是产品设计选择，需要产品侧确认是否要改，不是代码缺陷。

---

## 十二、React Web / Electron 端专项审查

> 2026-08-30 补充审查，范围：`web/src/`全部组件、`desktop-electron/src/main.js`。纯只读，未修改代码。

**1. 网络请求：try/catch / 超时 / 失败重试 / 用户可见错误提示** 🟡
- 全局axios拦截器（`utils/axiosInterceptor.js`）：401自动触发token刷新+重放原请求（`:125-141`）；网络错误或5xx自动重试最多3次，指数退避+随机抖动（`:65-83,144-152`）；慢请求（>1s）和失败请求都有console级别的监控日志
- **🟡 没有设置任何全局请求超时**：全仓库搜索`axios.defaults.timeout`/`timeout:`配置均为零命中（唯二命中是`requestIdleCallback`的timeout，跟HTTP请求无关）。意味着一个"发出去但服务端/网络中间设备静默不响应"（不是明确的连接拒绝，是真正的挂起）的请求，理论上会无限期悬挂——重试逻辑只在`error`产生时触发，请求本身不resolve/reject就不会进入重试分支
- 用户可见的错误提示是**call-site级别**实现的，不是拦截器统一处理（拦截器只负责重试/刷新token，不弹UI）。抽查的几个典型组件（如朋友圈`Moments.jsx`）都有"加载失败，点击重试"这类明确的错误态UI，属于良好实践，但没有做到"拦截器兜底保证所有请求失败都有提示"这种强保证，个别遗漏某个catch分支的组件理论上可能静默失败（本轮未逐组件穷举，如需要可以再做一次专项扫描）

**2. 断网 / 超时 / 500 时页面表现** 🟢 有专门设计，不是白屏/一直转圈
- `components/ReconnectingBanner.jsx`：socket断开超过2秒才显示"网络连接已断开，正在重连…"（debounce避免瞬断闪烁），恢复后短暂展示"网络已恢复"再自动收起，effect里两个分支都正确`clearTimeout`清理
- `contexts/SocketContext.jsx:86`监听浏览器`online`事件触发重连尝试；**但没有对应监听`offline`事件**——断网的感知完全依赖socket断开检测（走socket.io自身`pingTimeout`），不是浏览器网络状态API主动感知，通常也够用，但会比"浏览器一断网立刻提示"慢一点点
- 结合第1点的"无全局超时"：普通网络错误/服务端500都有清晰反馈（重试机制+ReconnectingBanner），但如果是那种"连接建立了但服务端挂起不回包"的极端场景，缺少超时兜底，用户可能会看到某个操作按钮转圈转很久而不是较快得到"失败"反馈

**3. 加载态 / 空状态 / 错误状态三态UI** 🟢 抽查到位，模式统一
- `Moments.jsx:692-699`是典型范例：`loading`→骨架屏组件`MomentsSkeleton`；`loadError`→"加载失败，点击重试"（按钮直接调`load`重试，不是死路）；空数据→"还没有动态，发布第一条吧"（友好文案而非空白）；三态+数据态共四路分支覆盖完整
- 好友列表/互动通知等也有对应的`暂无好友`/`暂无互动消息`空态文案，走同一套`wc-moment-state`样式class，UI一致性好

**4. 长列表虚拟滚动 / 图片懒加载与占位** 🟢 完整实现，且相互配合
- 消息长列表：`components/VirtualMessageList.jsx`（react-window虚拟滚动）
- 图片懒加载：`loading="lazy"`覆盖了几乎所有`<img>`标签（头像、聊天文件、图片预览、朋友圈图片、群信息、收藏等）
- 专门的`components/ImgOptimized.jsx`：为"react-window虚拟列表内提前加载"场景定制的`IntersectionObserver`懒加载 + `decoding="async"`不阻塞主线程 + **加载期间skeleton占位（消除布局抖动）** + 失败时破损图标占位 + WebP格式自动协商（检测浏览器支持后追加`?fmt=webp`，后端不支持时优雅降级回原图）——这是相当讲究的图片加载工程实现

**5. 组件卸载后的清理（请求取消/定时器/监听器）** 🟢 抽查未发现泄漏
- 逐行核对`ChatWindow.jsx`里最大的一个socket事件监听`useEffect`（注册20+个事件），cleanup函数里**逐一精确配对unregister**，无遗漏（初次用`grep -c`数出on比off多1次，追查后发现是一行被注释掉的死代码`// socket.on('red_packet_claimed', ...)`本身仍匹配"socket.on("文本导致的计数误差，排除后实际严格1:1配对）
- `ReconnectingBanner.jsx`两个`useEffect`分支都正确返回`clearTimeout`清理函数
- 本次未对全部组件做穷举式扫描（工作量较大），抽查的核心大组件（聊天窗口、断线提示条）模式规范，倾向认为这是团队一致的编码习惯而非孤例，但不能100%排除个别边缘组件遗漏

**6. 极端内容：超长昵称/纯emoji/换行符/RTL文字/超宽图片** 🟢 主要场景已覆盖，RTL未专门处理
- 换行/长文本：`white-space: pre-wrap`（保留换行符）+ `word-break: break-word`/`break-all` + `overflow-wrap: anywhere`（强制换行，防止一长串无空格字符撑破容器）在消息气泡、群公告、收藏内容、动态通知等处**统一使用**，覆盖超长昵称/无空格长字符串/多行内容场景
- emoji：纯文本渲染，UTF-8/emoji本身不需要特殊处理，未发现字符集相关问题
- **RTL（从右到左文字，如阿拉伯语/希伯来语）**：全仓库未发现任何`dir="auto"`或显式RTL适配，容器布局是固定LTR方向的；不代表完全"崩"——浏览器会对RTL字符本身的文字方向做默认的Unicode双向算法处理，但整体容器排版（头像在左/气泡朝向等）不会跟着文字方向镜像，属于"未专门设计支持"而非"渲染错误"，如果产品有中东用户群体需求需要单独评估
- 超宽图片：聊天图片/朋友圈图片组件普遍配合`max-width`/`object-fit`一类CSS（这次未逐一截图验证渲染效果，只读代码确认样式规则存在）

**7. Electron特有：多窗口 / 托盘 / 开机自启 / 自动更新失败回退 / 休眠唤醒重连** 🟡 多数完善，休眠唤醒依赖通用机制而非系统信号
- **多窗口**：全仓库`new BrowserWindow(`只出现1次——**是单窗口架构，没有多窗口功能**（不是bug，是设计选择，多数桌面IM客户端也是单窗口内部导航）
- **托盘**：`createTray()`（`main.js:654-`）完整实现，且对图标文件缺失/损坏有防御（`nativeImage`为空时降级用空图标而非直接抛异常导致托盘创建失败）；双击/单击都能唤起主窗口（照顾Windows用户单击习惯）
- **开机自启**：托盘菜单里`app.setLoginItemSettings({ openAtLogin: item.checked })`可勾选，完整
- **自动更新失败回退**：`autoUpdater`事件链完整（`update-available`→Ed25519签名校验通过才`downloadUpdate()`，校验失败直接阻止下载并通知渲染层；`download-progress`/`update-downloaded`/`error`均转发给渲染进程UI，不在主进程弹原生dialog（避免和渲染层UpdateBanner"两套UI打架"，注释里说明了这个设计考量）；`autoInstallOnAppQuit=true`兜底"用户不点确认就退出App"的场景；更新失败只是记日志+通知，**不会导致App崩溃或卡在更新流程里出不来**，当前版本能继续正常使用
- **🟡 休眠唤醒后重连**：主进程**没有使用`powerMonitor`监听系统级`suspend`/`resume`事件**，全仓库搜索为零命中。休眠唤醒后的重连完全依赖渲染层socket.io-client自身的机制——`pingTimeout`(20秒)超时后判定断线+内置重连（1-10秒指数退避）+ `window.addEventListener('online')`兜底。这意味着笔记本合盖唤醒后，从"实际已断线"到"App感知到断线并开始重连"之间，最坏情况可能有长达20秒的滞后（要等ping超时），而不是唤醒瞬间就主动触发重连检查。用`powerMonitor.on('resume', ...)`在主进程唤醒事件触发后主动通知渲染层立即做一次连接健康检查，能把这个滞后从"最多20秒"降到"几乎瞬间"，是本轮审查里唯一值得改进的Electron项

**一句话总结**：Web/Electron端的用户体验工程质量总体很高——三态UI覆盖完整、图片懒加载做到了skeleton+WebP协商的精细程度、断线重连有专门设计的UI反馈、Electron的托盘/自启/自动更新都做得比较完善。**两处🟡都不是缺陷而是"可以更好"级别的观察项**：全局请求超时目前是空白，极端网络挂起场景下用户体验会打折扣；休眠唤醒重连依赖通用超时机制而非系统级`powerMonitor`信号，恢复速度有改进空间。

---

## 十三、Web / Android / iOS 三端功能对照表

> 2026-08-30 综合此前十二节全部审查结论 + 本节新增专项核实，逐项列出22项功能在三端的实现情况与后端接口就绪度。"部分实现"均在"缺口说明"列写明具体缺什么。

| 功能 | Web | Android | iOS | 后端接口 | 缺口说明 |
|---|:---:|:---:|:---:|:---:|---|
| 注册登录 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整，支持自定义服务器地址切换 |
| 找回密码 | ⚠️ | ⚠️ | ⚠️ | ❌ | 后端`resetPassword()`已**硬编码禁用**，无论传什么参数都直接返回"功能暂不可用，请联系管理员"（`auth.service.js:309-312`）。Web诚实地只显示"联系管理员"提示，不发起失效请求；Android/iOS仍保留完整的"6位邀请码找回密码"UI流程，实际提交必然收到统一的"功能不可用"错误——是死UI，非真实可用功能，且这套邀请码验证方式本身安全强度也不足（见第六节） |
| 账号注销 | ⚠️ | ✅ | ⚠️ | ✅ | 后端`DELETE /api/auth/delete-account`完整（软删+匿名化，见第九节）。**仅Android有可用UI入口**；iOS的`ProfileRepository.deleteAccount()`方法已写好但全项目无任何View/ViewModel调用，设置页没有入口；**Web同样没有触发入口**——但`index.css:4237-4251`留有`.wc-delete-account-btn`的完整样式定义，全仓库搜索无任何JSX引用它，是孤儿CSS，说明这个按钮大概率曾经存在或计划存在过，后来被拿掉但没清理样式 |
| 资料编辑 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整（头像/昵称/签名/封面等） |
| 发帖-图文 | ✅ | ✅ | ✅ | ✅ | 完整，最多9张图 |
| 发帖-视频 | ❌ | ❌ | ❌ | ❌ | 后端`/api/moments/images`只有图片上传接口，**没有视频版本**，三端UI也均无视频发布入口——是后端能力缺失导致的三端一致性限制，不是某端漏做 |
| 草稿 | ❌ | ❌ | ❌ | — | 全仓库搜索三端"发动态"草稿保存能力均为零命中——退出发布页内容直接丢失，没有本地草稿暂存/恢复。（注：聊天消息本身在Android/iOS有独立的`DraftStore`草稿箱能力，但那是"聊天输入框草稿"，与"朋友圈发布草稿"是两回事，本条特指后者） |
| 动态编辑/删除 | ✅（仅文字） | 未在本轮明确核实 | ✅ | ✅ | 后端`PUT/DELETE /api/moments/:id`完整；Web确认编辑仅能改文字（图片发布后不可增删改，只能删除重发）；iOS确认支持编辑；Android此前审查未专门核实编辑入口是否存在，建议补充确认 |
| 信息流(时间线) | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整，可见性过滤(好友/分组/最近N天可见/双向拉黑排除)在服务端SQL层强制执行，非前端隐藏 |
| 点赞评论 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整，含并发去重（见第十一节第1点） |
| 关注/粉丝 | — | — | — | ❌ | **touliao没有独立于"好友"的单向关注/粉丝模型**。关系只有双向的好友关系（`friend_requests`→`contacts`），没有"关注他人动态但不是好友"这种单向订阅概念，也没有对应的数据表/接口——这是产品模式选择（对齐微信朋友圈"好友互看"，而非微博/小红书式关注关系），如果产品需要单向关注功能需要从0新建 |
| 单聊 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整 |
| 群聊 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整，管理功能(踢人/禁言/转让群主等)覆盖齐全 |
| 消息撤回 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整；后端无时间限制（产品设计选择，见第十一节第5点） |
| 已读回执 | ✅ | ✅ | ✅ | ✅ | 后端history接口早就按`peerLastReadAt`算好每条消息的`_read`字段；Web一直在正确使用；**Android/iOS此前未解码这个字段、只靠实时socket事件更新，导致重新打开会话后历史已读状态显示错误的bug，已在本次会话内修复**（详见此前对话记录，未单独成节） |
| 正在输入 | ✅ | ✅ | ✅ | ✅ | 三端聊天界面均有`typing`/`stop_typing`事件监听与UI展示，后端有400ms节流防刷 |
| 图片/语音/文件消息 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整，含语音转文字、大文件分片上传 |
| 推送 | ✅ Web Push | ✅ FCM+个推GeTui | ✅ APNs+FCM | ✅ | 三端推送通道按平台特性选型合理：Android双通道覆盖GMS/非GMS(华为等国产ROM)设备，iOS走APNs为主；"个推"特指国内Android推送服务，iOS/Web不适用该通道属正常，非缺口 |
| 通知中心 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | **三端均没有"统一通知中心"这一单一入口**——好友请求、朋友圈点赞评论通知、@我消息聚合是三个**独立**的列表/页面（分别对应`friend_requests`列表、`moment_notifications`列表、`mentions/me`聚合接口），互相之间没有合并为一个统一的"消息盒子"。三端在这点上是一致的（不是某端单独缺失），如果产品期望的是类似微博/小红书那种单一通知中心，需要新做一层聚合UI（后端三个数据源都已就绪，是纯前端聚合工作） |
| 搜索 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整，FTS5全文搜索(会话内+跨会话全局) |
| 举报/拉黑 | 拉黑✅ 举报✅ | 拉黑✅ 举报❌ | 拉黑✅ 举报❌ | ✅ | 拉黑功能三端+后端一致完整。**举报仅Web有UI**：后端`POST /api/moments/:id/report`完整，Web的`Moments.jsx`有调用，但Android(`feature/moments/*.kt`)和iOS(`Features/Moments/*.swift`)全部文件搜索均无"举报"相关代码——移动两端的朋友圈举报功能完全没有入口，是本轮排查中新发现的一处三端不一致 |
| 隐私设置 | ✅ | ✅ | ✅ | ✅ | 三端+后端均完整（加好友方式/验证开关/资料可见性/陌生人消息屏蔽/群邀请保护等），且服务端真实强制执行（非前端隐藏，见第十一节） |
| 深色模式 | ✅ | ✅ | ✅ | — | 三端均支持"浅色/深色/跟随系统"三态切换：Web在`Profile.jsx`设置里；Android`ui/theme/Theme.kt`用`isSystemInDarkTheme()`+`ThemeMode`枚举；iOS`RootView.swift:8,13`用`AppearanceStore`+`.preferredColorScheme`。三端实现完整且一致 |
| 多语言 | ⚠️ | ❌ | ❌ | — | **三端均不具备真正可用的多语言能力**。Web有完整的i18n基础设施（词典/Context/切换UI）但全仓库只有1处调用`useI18n()`且从未实际调用`t()`渲染翻译文本，切换语言界面文案不会变，是"名存实亡"的半成品（详见第三节）；Android的`res/values-v31`是API等级限定资源目录（Android 12+的动态取色适配），**不是语言/地区资源目录**（真正的本地化目录应形如`values-en`/`values-zh-rTW`），Android没有任何多语言资源；iOS未发现任何`.lproj`本地化目录，同样没有多语言能力。三端目前都只支持简体中文单一语言 |

**综合观察**：
1. **找回密码、账号注销**两项呈现"后端已实现但客户端要么没入口、要么调了个已废弃接口"的共同模式，是本次全套13节审查里唯一反复出现的"孤儿功能"类问题，建议作为一个专项集中处理（要么补齐入口，要么彻底清理死代码/死UI，两个方向都行，但不该保持现状）。
2. **朋友圈举报**是本节新发现的移动端专属缺口（Web有、Android/iOS没有），后端已就绪，属于纯客户端工作量。
3. **草稿、通知中心、多语言、关注粉丝**这四项是三端"整体缺失/整体做成半成品"，不存在"某端有其它端没有"的不一致，需要产品先明确是否要做、做到什么程度，再排期。
4. 排除以上产品决策类缺口，**核心IM能力（登录/单群聊/消息类型/撤回/已读/推送/搜索/隐私/深色模式）三端已经做到了功能对等**，是这套系统里工程完成度最扎实的部分。

---

## 十四、移动端（Android / iOS）专项审查

> 2026-08-30 补充审查，范围：`android/app/src/main/java/com/touliao/app/`、`ios/Touliao/`。纯只读，未修改代码。

### 🔴 重点发现：账号切换/登出后推送 token 未彻底解绑，存在"串号推送"风险

这是本节最重要的发现，Android 和 iOS **都有**，且都集中在同一个具体路径——「多账号免重登切换」（`switchAccount`），与普通登出的处理不是同一套代码路径，容易被漏掉。

**Android**（`core/push/PushManager.kt` + `core/auth/SessionManager.kt`）：
- `unregisterCurrentToken()`（`PushManager.kt:77-80`）**只处理 FCM token**，调用 `notificationApi.deleteToken()` 前先 `fetchToken()`（专门取 FCM token 的函数）。全仓库搜索确认**没有任何"注销个推(GeTui) CID"的函数**——`registerGeTuiCid()`有注册，没有对应的反注册
- `logout()`/`deleteAccount()`（`SessionManager.kt:117,126`）都调用了`unregisterCurrentToken()`——但这只清了FCM，个推CID从未被清过
- `switchAccount()`（`SessionManager.kt:95-106`，"免重登"快速切号功能）**完全没有调用任何token反注册**——切换到B账号前，A账号在这台设备上注册的FCM/个推token都原样留着
- **实际影响**：后端`device_tokens`表的唯一约束是`UNIQUE(user_id, token)`（复合键，非token单列唯一，见第二节schema），意味着同一个物理token可以同时属于A和B两行记录而不冲突；后端推送查询是`SELECT * FROM device_tokens WHERE user_id=? AND platform='getui'`按`user_id`查（`utils/push.js:93,116,223,590`），**A账号的消息推送会照常查到A残留的那条token记录并推送过去，物理落地到这台已经切换成B在用的设备上**——尤其在无GMS的国产ROM设备（华为/小米等，个推是这类设备的唯一推送通道）上，这个漏洞100%必现，不是小概率
- 涉及隐私：B账号使用者可能在通知栏看到本该属于A账号的消息推送预览

**iOS**（`Core/Push/PushManager.swift` + `Core/Session/SessionStore.swift`）：
- `unregister()`（`PushManager.swift:78-84`）写得是对的——注释直接点明"登出时注销当前token（FCM + APNs都要删，否则登出后旧账号推送继续到达本机）"，且**FCM和APNs两个token都会删**，比Android的实现更完整
- `logout()`/`deleteAccount()`（`SessionStore.swift:129,139`）都正确调用了`unregister()`
- 但`switchAccount(_ id:)`（`SessionStore.swift:101-111`，同样是"免重登切号"功能）**同样完全没有调用`unregister()`**——只调了`PushManager.shared.requestAuthorizationAndRegister()`去注册新账号的token，旧账号的FCM/APNs token在后端从未被清理
- 影响机制与Android完全一致：`device_tokens`表同样的复合唯一键设计、后端同样按`user_id`查询推送

**结论**：两端在"完整登出"路径上态度不同（iOS做对了两个通道，Android漏了个推这一整个通道），但在"免重登快速切号"这个**更常用、更容易触发**的路径上，**两端犯了完全相同的错误**——都只顾着给新账号注册token，忘了给旧账号解绑。修复思路一致：`switchAccount()`切换前，应该先对当前（即将被切走的）账号执行一次完整的token反注册（Android需要补上个推CID的反注册接口和调用，iOS只需要在`switchAccount`里也加一次`unregister()`调用）。

---

### Android 其余审查项

**1. Coroutine scope / GlobalScope** 🟢
- 全仓库搜索`GlobalScope`：**零命中**
- `viewModelScope`在28个ViewModel文件中被使用，是主流模式；`PushManager`等单例类用的是`@AppScope`注入的`CoroutineScope`（生命周期与App进程绑定，对单例合理，不是野生协程）

**2. Compose重组性能** 🟢（抽查未发现明显反模式）
- 抽查`ChatScreen.kt`：日期格式化`SimpleDateFormat`实例正确包在`remember{}`里（`:1662,1730`），不会每次重组都新建；正则`MENTION_RE`是文件级`private val`，只编译一次
- 本轮未做全量扫描（工作量大，需要走查每个大型composable的每个未remember的对象创建/每个可能不稳定的lambda参数），抽查的核心聊天页样本符合规范，倾向认为是团队一致习惯

**3. 配置变更（旋转）/ 进程被杀恢复** 🟡
- `AndroidManifest.xml`未设置`android:configChanges`——没有手动接管配置变更，让系统按标准方式重建Activity+保留ViewModel，是推荐做法，**不是反模式**
- 聊天输入框文字是`ChatViewModel`的UI State字段（`val input: String`），旋转时ViewModel存活，草稿不会丢
- `SavedStateHandle`（应对**进程被杀**、比单纯旋转更彻底的状态丢失场景）在5个文件里使用，`ChatViewModel`本身有注入；**但Compose推荐的`rememberSaveable`在全仓库零命中**——纯本地Compose UI状态（滚动位置、面板展开态等未提升到ViewModel的临时状态）在旋转/进程重建后会丢失。业务性数据（聊天内容、输入草稿）因为托管在ViewModel里不受影响，这条主要影响的是次要UI状态的连续性体验

**4. 网络：Retrofit超时/重试/断网UI** 🟢
- `core/di/AppModule.kt:67-70`：连接20秒、读写60秒（注释说明为弱网/大文件上传特意放宽，默认10秒太短必炸），`callTimeout=0`靠读写超时兜底不设总时长硬上限——配置得比较周全，不是"没配置"
- OkHttp默认`retryOnConnectionFailure=true`（未显式覆盖，即维持默认开启）
- 断网/连接状态在聊天列表标题栏有可见提示（`ConversationListScreen.kt:100-111`，"收取中…"/"未连接"红字），不是静默失败

**5. 权限申请被拒绝后的降级路径** 🟡
- 相册/视频选择：用`ActivityResultContracts.GetContent()`系统选择器（`ChatScreen.kt:175,181,184`），**不需要`READ_MEDIA_IMAGES`运行时权限**，从源头绕开了"被拒绝怎么办"这个问题，是现代、稳妥的做法
- **但录音权限被拒绝后是纯静默**：`recordPermLauncher`（`ChatScreen.kt:178-180`）回调里`if (granted) viewModel.startRecording()`，**`else`分支完全空白**——用户点了语音按钮、系统弹了权限对话框、点了拒绝，然后……什么反馈都没有，界面看起来像没反应。全仓库搜索`shouldShowRequestPermissionRationale`/"去设置"/"前往设置"等引导用户去系统设置手动开权限的文案和逻辑均为零命中，摄像头权限（视频通话场景）大概率是同样处理方式（本轮以录音为代表样本核实，未逐一验证摄像头分支）。建议至少在`else`分支加一条Toast/Snackbar提示"需要麦克风权限才能发语音"

### iOS 其余审查项

**1. @StateObject / @ObservedObject 用法** 🟢 未发现导致状态丢失的误用
- `CallView.swift:9,27,84`：观察单例`CallManager.shared`用`@ObservedObject`（正确——不拥有生命周期的场景该用Observed而非State）；子视图接收父视图传入的`manager`同样用`@ObservedObject`（正确——避免子视图意外用StateObject重新持有一份独立实例，导致父子状态不同步）
- `ChatView.swift:16`：顶层视图用`@StateObject private var vm: ChatViewModel`拥有并创建自己的ViewModel（正确）；`:1439,1648`两处子视图组件都用`@ObservedObject var vm: ChatViewModel`接收（正确，没有在子视图里误用StateObject重复实例化）
- 这是最容易踩坑的一类SwiftUI bug（子视图误用@StateObject导致状态"看起来丢了"，本质是产生了第二个互不同步的实例），本轮抽查的核心聊天/通话视图都是正确模式

**2. 进后台WebSocket处理 / APNs权限与token上报 / 账号切换解绑** 🟡（账号切换解绑问题见上方🔴重点发现）
- `SocketService.swift`全文搜索未发现任何`background`/`UIApplication`相关的显式生命周期处理代码——没有"进后台主动断开、回前台主动重连"的显式编排，完全依赖socket.io-client自身的ping/pong超时检测+内置重连。这不完全是缺陷：iOS App进入后台后本就不该长期保持socket连接活着（系统会限制/挂起后台网络），touliao已经有完整的APNs/FCM推送兜底后台消息送达（见第三节），这是**符合iOS平台规范的正确架构**，只是"重连感知速度"这块（不管是这里还是前面Electron的`powerMonitor`）都属于同一类"靠通用超时兜底、没有用平台提供的更精确生命周期信号"的共性观察
- APNs权限与token上报本身实现完整（`MainTabView.swift:39-46`：App回到前台时主动刷新FCM注册+清角标+清悬挂来电通知，注释里还记录了具体历史bug"Hermes F2"的修复背景，工程记录详实）

**3. Keychain存token** 🟢 已在第六节确认——标准`Security`框架`kSecClassGenericPassword`，无UserDefaults误用

**4. 后台任务** 🟢（不使用，且这是对的）
- 全仓库搜索`beginBackgroundTask`/`BGTaskScheduler`零命中——没有申请额外后台执行时间。结合上一条，这进一步印证了"不依赖长连接，靠推送覆盖后台消息"的设计取向是一以贯之的，不是遗漏

**5. 内存增长** 🟢（基于既有代码模式判断，未做运行时内存profiling）
- 抽查`ChatViewModel.swift`里Combine订阅（`.sink { [weak self] in ... }`）大量使用`[weak self]`弱引用规避循环引用，是本次会话此前多轮编辑该文件时反复确认过的一致模式；本节未使用Xcode Instruments等工具做运行时内存增长的实测（这类工具在当前环境不可用），只能从静态代码模式判断"没有明显会导致强引用循环的写法"，不能等同于"实测内存曲线平稳"，如需要严谨结论建议后续用真机+Instruments专项测

**一句话总结**：移动端本轮审查最重要的发现是**Android/iOS都在"免重登切号"这个路径上漏了旧账号的推送token解绑**，是真实存在、在无GMS安卓设备上必现的隐私问题，建议优先修复（尤其Android的个推通道是彻底没有反注册能力，属于"缺失功能"而非"漏调用"，工作量比iOS那边"补一行调用"要大一点）。其余项目——协程/内存管理、Compose性能、状态恢复、网络超时配置、SwiftUI状态管理——整体工程质量与本审查系列此前十三节一致，处于中上水准，零散发现的都是"可以更完善"级别的次要问题（录音权限拒绝无反馈、`rememberSaveable`未使用、后台重连靠通用超时而非系统信号）。

---

## 十五、品牌一致性 / 命名残留专项审查

> 2026-08-30 补充审查，范围：四端App标识、显示名、图标、数据库与代码命名。纯只读，未修改代码，不涉及任何改名操作。

### 1. 四端 App 标识汇总

| 项目 | 值 | 是否规范 |
|---|---|---|
| Android `applicationId` | `com.touliao.app` | ✅ |
| Android 显示名 (`res/values/strings.xml` `app_name`) | 投聊 | ✅ |
| iOS `PRODUCT_BUNDLE_IDENTIFIER` | `com.touliao.app`（与Android完全一致，跨端统一好） | ✅ |
| iOS `CFBundleDisplayName` | 投聊 | ✅ |
| iOS 测试Target Bundle ID | `com.touliao.app.tests` | ✅ |
| Electron `appId` | `com.touliao.desktop` | ✅ |
| Electron `productName` | 投聊 | ✅ |
| `web/package.json` name / author.name | `touliao-web` / 投聊 | ✅ |
| `backend-v2/package.json` name | `touliao-backend-v2` | ✅ |
| `desktop-electron/package.json` name / author | `touliao-desktop` / Touliao Team | ✅ |
| 通知渠道显示名(Android) | "消息通知"/"来电" | ✅ 功能性命名，无品牌泄漏 |

**结论**：应用标识层面（Bundle ID/applicationId/appId/显示名）**完全没有发现`com.example`占位符、模板名、或其它项目名残留**，四端命名规范、彼此一致，是这轮审查里最干净的一块。

### 2. 版本号现状（仅陈述事实，不代表不一致）

| 端 | 当前版本 |
|---|---|
| Android `versionName` | 8.0.8（`versionCode`=65） |
| iOS `project.yml` 默认 `MARKETING_VERSION` | 8.0.0（**实际TestFlight提交时按用户明确指示固定改写为1.0.0**，见CI workflow `ios-testflight.yml`里`MARKETING_VERSION="$APP_VERSION"`覆盖逻辑，是为控制App Store审核周期的主动决策，不是技术缺陷） |
| Electron `package.json` version | 8.0.0 |

Android/Electron的版本号语义一致（都反映真实迭代次数），iOS对外版本号因App Store审核策略被人为锁定为1.0.0，三者数字不一致是**已知的、有意为之**的情况，不需要"统一"处理，仅在此记录以免后续被误判为遗留问题。

### 3. 🔴 数据库文件名 `wechat.db` 及大量 `wechat_id` 字段命名残留

**规模**：全代码库对"wechat"字样的引用——后端10个文件、Web前端11个文件、Android 8个文件、iOS 7个文件（Electron 0个）。逐一核实后分两类：

**类别A（真正的"微信"命名残留，需要处理）**：
- **`backend-v2/wechat.db`**：主数据库文件名，`config/index.js:15`硬编码默认路径`path.resolve(__dirname, '../../wechat.db')`（可用`DB_PATH`环境变量覆盖，但默认值仍是这个）
- **`users.wechat_id`列**：贯穿`auth.service.js`/`users.service.js`/`contacts.service.js`/`admin.service.js`/`connection.js`共9个后端文件、几十处SQL语句，是产品概念"投聊号"（6位数字唯一ID）在数据库和API层的实际字段名。四端客户端的数据模型全部原样跟随这个字段名：
  - Android：`data/model/Auth.kt`、`data/model/Contacts.kt`、`data/model/ContactCard.kt`、`data/model/InviteInfo.kt`及4个UI文件
  - iOS：`Data/Models/User.swift`、`Data/Models/Contacts.swift`、`Data/Models/ContactCard.swift`及3个UI文件
  - Web：`Login.jsx`/`Home.jsx`/`Profile.jsx`/`GlobalSearch.jsx`/`MessageItem.jsx`/`AddFriendModal.jsx`/`UserProfile.jsx`/`ChatWindow.jsx`/`ChatWindow.css`共9个文件
  - **均为内部字段名/变量名，用户实际看到的UI文案确认统一是"投聊号"，没有发现界面上直接显示"微信号"文字**——是接口契约层面的命名残留，不是用户可见的品牌泄漏，但对"从数据库结构做尽调"的场景（融资/合规审查/代码审计）是一眼可见的痕迹
- **`users.service.js:110`**：`return JSON.stringify({ type: 'vxin-user', id: user.id, vxinId: user.wechat_id })`——**touliao自己的"加好友二维码"payload，`type`字段的值写死是字符串`'vxin-user'`**。如果未来vxin（V信，同一开发团队的姊妹项目）的扫码逻辑也识别这个`type`值，两个独立App的二维码会互相"可读"，是一个具体的、可复现的产品级风险点（不是安全漏洞，是"扫错App会不会误处理"的产品逻辑风险），建议改成`'touliao-user'`并同步四端扫码解析逻辑
- **`user_settings.add_by_vxin_id`列** + 对应的"是否允许通过投聊号加我"隐私开关：同样的vxin残留，字段名和实际功能语义（"允许通过**投聊号**加我"）不匹配

**类别B（不是残留，无需处理，仅说明排除原因）**：
- `wechat_work_id`/`wechat_work_enabled`/`WECHAT_WORK`通知渠道（`notificationCenter.js`/`notificationRoutes.js`）：这是**真实对接企业微信(WeCom)开放平台**的通知渠道功能（腾讯官方为企业提供的合规集成，与"微信"品牌本身是两回事），命名用"wechat_work"是准确描述这个真实第三方集成，不是残留，**不应该被误改名**
- 代码注释里大量出现的"对齐微信"/"微信风格"/"参照微信xxx"（四端UI组件、`design-tokens.css`等）：全部是**开发者解释设计决策依据的注释**（说明"为什么这样设计能让用户上手更顺"），不是运行时字符串，不会编译进最终产物暴露给用户，且这类"参照知名产品交互习惯"的注释在业内很常见，本身不构成商标或合规风险。但如果公司对外开源代码库或代码被第三方审计，大量密集的"微信"字样注释仍可能引起不必要的关注，视审计方风险偏好可考虑批量脱敏，非紧急项

**综合判断**：这**不是从微信官方代码/资源克隆而来**（没有发现微信的图标、字体、真实UI资源文件、或任何可执行代码层面的直接复制痕迹）。真实情况是：touliao 是从同一团队的姊妹项目 **vxin（V信）** 迁移/复用代码库起步的（`vxin`命名在Android 59个文件、iOS 48个文件里出现，规模远超"wechat"，是真正的命名主线），而 vxin 自身在UI/交互设计上大量参照了微信的成熟范式（注释里体现得很清楚）。所以命名残留的真实链条是 **微信(交互参照对象，仅存在于注释) → vxin(实际代码起点，字段名/类名主体) → touliao(当前产品)**，`wechat_id`很可能是vxin当初为了贴合"微信号"这个用户认知概念起的字段名，touliao继承后沿用至今没有改。

### 4. 图标 / 启动图 完整性

| 端 | 检查结果 |
|---|---|
| Android | `mipmap-mdpi`到`mipmap-xxxhdpi`全密度档位齐全，含`ic_launcher`/`ic_launcher_round`/`ic_launcher_foreground`（自适应图标前景层）+ `mipmap-anydpi-v26`矢量适配层，规格完整 |
| iOS | `AppIcon.appiconset/Contents.json`含20个`filename`条目，覆盖iPhone/iPad/通知/设置/聚焦搜索等各尺寸场景，规格完整 |
| Electron | `assets/icon.ico`(Windows)、`icon-1024.png`（macOS/主源图）、`icon.png`齐全 |

未发现文件缺失。本轮**未对图标像素内容做逐一比对**（无法确认是否与vxin共用同一份原始设计稿——这是设计资产问题不是代码问题，如需确认建议直接肉眼比对两个App的图标/启动页是否视觉雷同，这个只读代码审计工具做不到）。

### 5. 推送/邮件/短信模板签名

- Android通知渠道显示名"消息通知"/"来电"：功能性命名，无品牌残留（见上表）
- 后端`utils/push.js`/`notificationCenter.js`：推送payload的`title`/`body`未发现硬编码"微信"或其它品牌字样
- 短信/邮件模板：全仓库搜索未发现独立的短信/邮件发送模板文件（回顾第六节：找回密码功能后端已禁用，本身就没有短信/邮箱验证码发送能力，因此也不存在对应模板需要检查签名）

### 6. 建议改名方案（仅方案，未执行）

**优先级排序**：
1. **`vxin-user`二维码type值**（影响面小、独立、低风险，建议最先处理）：改成`'touliao-user'`，同步四端扫码判断逻辑（`if type==='vxin-user'`→`'touliao-user'`），**必须保证后端改动与四端客户端更新同批发布**，否则旧版本App扫新二维码会识别失败
2. **`add_by_vxin_id`列名及相关隐私开关字段**：影响面中等（`user_settings`表+隐私设置页四端UI+对应API字段），建议与下面第3点数据库改名一并规划，不单独动
3. **`wechat_id`字段名 + `wechat.db`文件名**：影响面最大（贯穿后端9个文件、四端全部客户端的数据模型），**不建议单独为了改名而改**，建议合并进下一次本来就要做的一次"数据契约"版本升级里，一次性完成，减少四端同步发布的协调成本

**数据库文件改名迁移方案（必须走迁移脚本，不能直接 `mv`）**：

```bash
#!/usr/bin/env bash
# touliao 数据库文件改名：wechat.db → touliao.db
# 前提：先停 pm2 进程，避免迁移期间仍有写入（WAL模式下直接复制.db文件不安全，
# 必须先做一次干净的checkpoint，把WAL内容并回主文件，再复制三件套）
set -euo pipefail

OLD_DB="/root/touliao/backend-v2/wechat.db"
NEW_DB="/root/touliao/backend-v2/touliao.db"

echo "1) 停止后端进程（避免迁移期间产生新写入）"
pm2 stop touliao-backend

echo "2) WAL checkpoint：把 wechat.db-wal 里的内容并回主文件，确保 wechat.db 本身是完整状态"
sqlite3 "$OLD_DB" "PRAGMA wal_checkpoint(TRUNCATE);"

echo "3) 用 sqlite3 .backup 而非裸 cp——.backup 是 SQLite 官方一致性快照API，
      对比直接cp能避免拷贝过程中文件被并发修改导致的损坏（即便本例已停进程，仍按最佳实践走）"
sqlite3 "$OLD_DB" ".backup '$NEW_DB'"

echo "4) 校验新文件完整性和行数与旧文件一致，任何一步失败都不得继续"
sqlite3 "$NEW_DB" "PRAGMA integrity_check;" | grep -q "^ok$" || { echo "❌ 完整性校验失败，中止"; exit 1; }
OLD_COUNT=$(sqlite3 "$OLD_DB" "SELECT COUNT(*) FROM users;")
NEW_COUNT=$(sqlite3 "$NEW_DB" "SELECT COUNT(*) FROM users;")
[ "$OLD_COUNT" = "$NEW_COUNT" ] || { echo "❌ users 表行数不一致($OLD_COUNT vs $NEW_COUNT)，中止"; exit 1; }

echo "5) 修改 backend-v2/.env，新增/覆盖 DB_PATH 指向新文件（config/index.js 已支持该环境变量覆盖默认值，无需改代码）"
grep -q "^DB_PATH=" /root/touliao/backend-v2/.env && \
  sed -i "s#^DB_PATH=.*#DB_PATH=$NEW_DB#" /root/touliao/backend-v2/.env || \
  echo "DB_PATH=$NEW_DB" >> /root/touliao/backend-v2/.env

echo "6) 重启前端旧文件先不删——原地保留至少一个完整备份周期(建议7天)，确认新库运行无异常后再手动清理"
mv "$OLD_DB" "${OLD_DB}.migrated-$(date +%Y%m%d)"
[ -f "${OLD_DB}-wal" ] && mv "${OLD_DB}-wal" "${OLD_DB}-wal.migrated-$(date +%Y%m%d)" || true
[ -f "${OLD_DB}-shm" ] && mv "${OLD_DB}-shm" "${OLD_DB}-shm.migrated-$(date +%Y%m%d)" || true

echo "7) 重启"
pm2 start touliao-backend

echo "8) 验证：health check + 抽查几条真实查询"
sleep 2
curl -sf http://127.0.0.1:3003/health || { echo "❌ 健康检查失败，请检查日志并考虑回滚(把.migrated文件改回原名+改回.env)"; exit 1; }
echo "✅ 迁移完成。观察至少24小时后再删除 *.migrated-* 备份文件。"
```

**`wechat_id`列改名迁移方案（SQLite 3.25+ 支持原生`RENAME COLUMN`，但这是破坏性API变更，脚本本身简单、真正的成本在四端协同发布）**：

```sql
-- 迁移脚本：users.wechat_id → users.touliao_id
-- ⚠ 执行前提：必须已确认backend-v2 + 四端客户端(Android/iOS/Web/Electron)新版本
--    已经全部准备好识别新字段名，且走的是"同一批次发布"或"后端过渡期双字段兼容"策略，
--    否则老版本App在字段改名瞬间会读不到这个字段，投聊号显示为空——这是本次迁移
--    真正的风险点，脚本本身的SQL操作是安全的、瞬时的。

BEGIN TRANSACTION;

ALTER TABLE users RENAME COLUMN wechat_id TO touliao_id;

-- 索引名同步重建(原索引名含wechat字样，不改也不影响功能，但顺手统一)
DROP INDEX IF EXISTS idx_users_wechat_id_unique;
CREATE UNIQUE INDEX idx_users_touliao_id_unique ON users(touliao_id);

COMMIT;

-- 建议的过渡期兼容做法(推荐，而非直接硬切)：
-- 后端API响应层(不是数据库层)在改名后的一段时间内，双写字段名：
--   { ...user, touliao_id: user.touliao_id, wechat_id: user.touliao_id }
-- 即数据库层面已经完成改名(干净)，但对外JSON响应同时保留旧字段名做别名兼容，
-- 等确认线上所有客户端版本都已升级到识别touliao_id(可用后端埋点统计新老字段被访问的比例)，
-- 再摘掉wechat_id这个兼容别名。这样数据库改名和客户端发布解耦，不需要强制"同一分钟切换"。
```

**一句话总结**：品牌一致性这块，App标识/图标/推送渠道命名是干净的，没有`com.example`占位符或明显的第三方素材痕迹；真正的命名残留集中在数据层——`wechat.db`文件名、`wechat_id`字段、`vxin-user`二维码类型值——这些都是内部命名，不是用户可见的品牌泄漏，但会在代码审计/尽调场景被一眼看到。**改名建议按影响面从小到大分三批走，数据库层面的改名必须配合API双写兼容期，不能指望一次部署就切干净**，两份迁移脚本已给出但均未执行。

---

## 十六、私有化部署完备性专项审查

> 2026-08-30 补充审查，范围：四端服务器地址配置机制、部署脚本、后台管理能力、授权控制、数据导出、部署文档。纯只读，未修改代码。

**1. 服务器地址可配置性** 🟢 架构设计好，但有一处发现（首次启动仍会"打电话回touliao.cc"）
- 四端均实现了三层优先级机制（以iOS`ServerConfig.swift:16-17`为代表）：**手动覆盖(用户在登录页/设置里填的) > 远程config.json拉取的地址 > 编译内置默认值**，手动覆盖一旦设置就不会被后两者覆盖，且**全部走本地持久化存储（UserDefaults/SharedPreferences/electron-store/localStorage），不需要重新编译打包APP就能换后端地址**——`deploy/README.md`把这个机制作为"换服务器免配置"的核心卖点专门写了文档，是有意为之的产品能力，不是碰巧
- Web端更彻底：`web/.env.production`里`VITE_API_BASE`留空则全部走相对路径，由nginx转发，天然不含任何硬编码域名，换服务器对Web端是**零改动**——2026-08-30再次确认：`.env.production`当前内容就只有`VITE_APP_NAME`/`VITE_APP_VERSION`和空的`VITE_API_BASE`，不存在"每个客户单独构建改这个值"的隐性成本，这个文件本身不是私有化部署的瓶颈
- **发现**：真正的瓶颈不是`VITE_API_BASE`，而是四端"引导阶段去哪拉远程配置"这个种子地址（`CONFIG_URLS`）编译内置死了同一个域名——`web/src/utils/config.js:27-30`、`desktop-electron/src/main.js:129-131`、`android/.../core/config/RemoteConfig.kt:66-67`、`ios/.../Core/Config/RemoteConfig.swift:15-16`，四处都硬编码`https://touliao.cc/config.json`（+`www`子域兜底），也就是说一台**全新安装、用户还没有手动切换过服务器**的客户端，首次启动会先尝试访问touliao.cc拉取远程配置。对于私有化部署客户，这意味着：要么终端用户首次启动后手动去登录页"切换服务器"填自己的域名（有一次性操作成本），要么客户重新编译一份把这四处种子地址改成自己域名的定制包（这需要走一次构建，与"永不重编译换服务器"这个宣传口径在"首次安装"这个场景下不完全一致，仅在切换阶段成立）。这不是缺陷，是当前架构在"toC单一品牌运营"场景下的合理设计，只是拿来做"白标/多客户私有化部署"产品时，"新客户的App出厂默认值指向谁"这个问题需要产品侧明确方案（例如：给每个私有化客户单独出一版改了这四处种子地址的构建，或者接受"首次需要手动填一次服务器地址"这个使用体验）

**2. 首次部署流程** 🟡 存在两套脚本、完整度不一致，其中主推的那套有实际会导致启动失败的缺口
- `deploy/README.md`主推的部署路径是`./deploy/setup.sh <域名>`——脚本本身写得干净（幂等、自动生成强随机`JWT_SECRET`、自动装依赖/建前端/配nginx/起pm2），**但没有生成`ADMIN_USERNAME`/`ADMIN_PASSWORD`这两个环境变量**。而`config/index.js:164-169`明确规定：生产环境缺这两个变量会在启动时**直接致命报错中止**（`console.error`+`process.exit`风格的硬阻断，不是能忽略的警告）。也就是说，**严格按`deploy/README.md`文档描述的3步走下来，`pm2 start`起来的后端进程会在生产模式下立即崩溃退出**，这是一个会在客户第一次尝试部署时就实打实踩到的坑
- 另有一份更完整的`deploy/setup-new-server.sh`（249行，比`setup.sh`的82行详细得多）**正确处理了这个问题**：自动生成随机管理员密码、写入`.env`、同时另存一份`backend-v2/ADMIN_PASSWORD.txt`（`chmod 600`限制权限）并在终端打印，部署完成后运维能直接拿到初始密码登录后台。但这份脚本**没有被`deploy/README.md`引用或提及**，一个第一次接触这个项目的人大概率不会知道该用这份而不是`setup.sh`
- **初始化SQL**：不需要单独的init SQL步骤——`db/connection.js`启动时会调用`applySchema(db)`自动建表/迁移，是自愈式的，这点做得好，不用像传统项目那样"先跑一遍migrate.sql"
- **默认管理员密码是否强制修改**：不存在"默认密码"这个风险点（好消息）——因为压根没有默认值，必须显式配置且生产环境强制≥12位，`setup-new-server.sh`路径下是自动生成的强随机密码，不存在"admin/admin123"这类可预测凭证被大规模已知利用的风险；但也**没有"首次登录强制改密"的流程**，运维如果嫌`ADMIN_PASSWORD.txt`里的随机密码不好记而自己改成弱密码，系统不会拦

**3. 后台管理界面** 🟢 完整存在，不是"只能直连数据库"
- 已在第一节路由清单详细列出：用户管理（查看/封禁解封/重置密码/发放金币与特权/硬删除）、消息审查（`GET /api/admin/messages`）、群管理（查看/强制解散）、举报处理、邀请码规则、功能开关（含实时socket广播生效）、系统统计与生产监控指标（在线数/消息成功率/延迟/SQLite写入队列深度等）、TOTP二次验证、可信设备管理、IP白名单——覆盖面对齐一个正经私有化SaaS产品该有的后台能力，且有独立的管理员鉴权体系（第六节已确认），不依赖直连数据库操作

**4. 授权/许可控制、用户数上限** 🔴 完全没有
- 全代码库搜索`license`/`LICENSE`/`maxUsers`/`授权码`等关键词**零命中**——没有任何形式的许可证密钥校验、用户数量上限、部署实例数控制、试用期限制等商业授权机制
- 如果产品的商业模式是"按部署实例/按用户规模收费授权"，当前代码**没有任何技术手段能阻止客户绕过授权条款自行扩容或转售部署**——这不是代码bug，是纯粹的产品/商业决策缺失，如果确实需要走授权控制，需要单独设计一套license校验机制（常见做法：启动时校验一个签名过的license文件，或定期向授权服务器心跳校验），目前完全是空白

**5. 数据导出与迁移能力** 🟡 底层天然可迁移，但没有面向管理员的"一键导出"UI
- **好消息（架构层面）**：整个后端数据存储是**单文件SQLite + 本地uploads目录**，不依赖任何云厂商专有数据库/存储服务——客户如果要把数据"带走"，技术上只需要复制`wechat.db`文件和`uploads/`目录即可拿到全部数据，不存在"数据被锁在某个专有云服务里导不出来"的问题，这本身是私有化部署天然的迁移友好性优势
- **用户自助层面**：已确认存在`GET /api/messages/conversation/:convId/export`（导出单个会话聊天记录为纯文本），但这是**面向终端用户的单会话导出**，不是面向部署管理员/租户的批量数据导出
- **缺口**：后台管理界面没有找到"导出全部用户数据"/"导出全部消息"这类面向运营/合规的批量导出功能（比如GDPR式的数据可携带权、或客户要更换部署商时的完整数据打包）。如果私有化部署的客户有"合同到期后要拿到自己数据的结构化导出（而非整个数据库文件）"这类需求，目前只能手动写SQL/脚本导，没有现成后台入口

**6. 部署文档完整性** 🟡 内容详实但存在明显的文档冗余/权威性不清问题
- `deploy/README.md`（54行）覆盖了核心3步部署流程、"免配置换服务器"原理说明、关键环境变量表——**但这份文档漏提了第2点发现的`ADMIN_USERNAME`/`ADMIN_PASSWORD`必填项**，跟着走会在生产环境启动失败
- 依赖版本：README列出Node 18+/nginx/pm2，基本项齐全；证书：文档提到`certbot --nginx -d <域名>`一行带过，够用；备份恢复：**`deploy/README.md`本身没有提到备份恢复步骤**，备份脚本(`deploy/touliao-backup.sh`)是独立存在的（且已在第九节指出这份脚本本身没有被接入crontab调度），两者之间没有互相引用，一个只看`deploy/README.md`的运维人员不会知道还有这么一个备份脚本存在
- **文档冗余**：`backend-v2/`目录下同时存在**7份**主题高度重叠的部署类文档（`DEPLOYMENT_REPORT.md`/`DEPLOYMENT-EXECUTION-GUIDE.md`/`README_START_HERE.md`/`DEPLOYMENT_SUMMARY.md`/`DEPLOYMENT-START-GUIDE.md`/`DEPLOYMENT-QUICK-START.md`/`DEPLOYMENT-READY-TO-LAUNCH.md`），全部集中在**同一天（2026-08-15）**生成，文件名又高度相似（"START_HERE"/"QUICK-START"/"START-GUIDE"/"READY-TO-LAUNCH"读起来都像"这是入口文档"），对第一次接触项目、试图判断"到底该看哪份"的人不友好，建议整合成一份权威文档，其余归档或删除

**一句话总结**：私有化部署这块，**架构设计的底子是好的**——三层服务器地址覆盖机制、免重编译切换、SQLite单文件存储带来的天然数据可迁移性、独立完整的后台管理系统，都是加分项。**但"从零到能跑起来"这个第一次部署的体验有实际会踩坑的缺口**：主推的`setup.sh`部署脚本会因为漏配管理员账号导致生产环境启动失败，而正确处理了这个问题的`setup-new-server.sh`又没有被文档引用到；另外**完全没有许可证/授权控制机制**（如果商业模式需要按部署收费，这是空白）；部署文档数量多但权威性混乱，需要整合。这些都是"整理/补齐"级别的工作，不是架构性缺陷。

---

## 十七、部署配置专项审查（PM2 / SQLite备份 / nginx / GitHub Actions / 监控 / 更新校验 / 日志）

> 2026-08-30 补充审查，范围：`backend-v2/ecosystem.config.js`、生产nginx配置、`.github/workflows/`、日志与监控代码、Android更新签名校验。纯只读，未修改代码。

**1. PM2：自动重启 / 内存上限 / 日志切割 / 未处理异常** 🟡
- `backend-v2/ecosystem.config.js`配置得相当周全：`autorestart:true`、`max_memory_restart:'600M'`（防OOM）、`max_restarts:15`+`min_uptime:'10s'`（组合起来能防止"崩溃→重启→秒崩"的死循环无限重启，超过15次会放弃）、`restart_delay:3000`（崩溃后等3秒再重启，注释说明是为了让数据库连接完全关闭）、`kill_timeout:5000`（给优雅关闭留时间）、还配了V8堆大小(`--max-old-space-size=1024`)与内存重启阈值对齐——这些细节说明团队确实认真调过
- `server.js:212-217`：**全局`unhandledRejection`+`uncaughtException`兜底**，注释直接点明"一条坏消息就能让所有人掉线"这个风险，选择记日志后**继续运行**而不是让进程崩溃。这正面回答了"未处理Promise rejection会不会拖垮整个服务"——不会，已经兜底。但这个选择本身有个业界公认的理论风险需要如实指出：Node.js官方文档不建议在`uncaughtException`后继续运行（进程可能已处于不一致状态，比如某个锁没释放、某个流没关闭），这里是团队在"用户体验(不掉线)"和"进程绝对纯净"之间做的权衡，属于合理但有取舍的工程决策，不是错误
- **🟡 `pm2-logrotate`模块未安装**：`~/.pm2/modules/`目录为空，pm2自身的应用日志(`touliao-server-v2-error.log`/`touliao-server-v2-out.log`)**没有自动切割**。当前`out.log`已经5.8MB（不到一天的测试期间产生），长期生产运行下会无限增长，建议`pm2 install pm2-logrotate`

**2. SQLite备份与恢复验证** 🔴 已在第九节指出核心问题，此处补充恢复验证维度
- 回顾第九节结论：备份脚本(`deploy/touliao-backup.sh`)写得完整但**从未被接入crontab/systemd timer调度**，当前生产环境没有自动备份在跑
- 本节新增检查点：即便备份脚本被接入调度，**脚本本身也没有任何"恢复验证"逻辑**——没有对生成的备份文件做`PRAGMA integrity_check`，没有做试恢复(test restore)校验"这份备份文件真的能被还原"。行业标准做法是备份后立即在临时目录做一次恢复+基本查询验证，而不是只确认"备份文件生成了、大小不为0"就算成功

**3. nginx：gzip / 缓存策略 / 上传限制 / WebSocket升级头** 🟢 配置完整规范
- `gzip on`已在`nginx.conf`全局启用（对所有站点生效，含touliao）
- 缓存策略分层清晰：静态构建产物`expires 1y`+`Cache-Control: public, immutable`+`gzip_static on`（长期强缓存，适合带hash文件名的构建产物）；`config.json`/后台管理面板/健康检查等动态或必须实时的内容一律`no-cache, no-store, must-revalidate`，没有一刀切
- `client_max_body_size 200m`与后端`MAX_UPLOAD_BYTES`默认值(200MB)完全对齐，不存在"nginx先拦一刀、跟后端限制不一致"的体验断层
- `/socket.io/`location块：`proxy_http_version 1.1`+`proxy_set_header Upgrade $http_upgrade`+`proxy_set_header Connection "upgrade"`齐全，`proxy_read_timeout 86400s`（24小时）避免长连接被nginx默认60秒超时误杀——WebSocket升级所需的关键头一个不少

**4. GitHub Actions：secret泄露 / 部署失败回滚 / 健康检查** 🔴 代码质量很高，但因secret从未配置，核心逻辑实际从未真正跑过
- **Secret处理本身干净**：`echo "${{ secrets.DEPLOY_SSH_KEY }}" > ~/.ssh/deploy_key`是标准安全用法（写入文件后立即`chmod 600`，不会打印到日志），GitHub Actions本身也会自动脱敏已知secret值，全部workflow文件检查下来没有发现意外`cat`/`echo`密钥内容到stdout的情况
- **`deploy.yml`（"自动部署投聊后端"）的健康检查+自动回滚逻辑写得非常完整**：部署后轮询`/health`最多30秒，不通过则自动`git reset --hard`到部署前commit、重新构建、重启、再次健康检查，仍不健康则明确提示"🚨需人工介入"——这是教科书级别的CI/CD回滚设计
- **🔴 但这套逻辑在生产实践中从未真正执行过**：该job依赖的`secrets.DEPLOY_SSH_KEY`/`DEPLOY_USER`/`DEPLOY_SERVER_HOST`在仓库里**从未配置**（`gh secret list`确认，且已排查过repo级、environment级"production"环境均为空）。实际运行日志显示`DEPLOY_USER`/`DEPLOY_HOST`都是空字符串，`ssh -i ~/.ssh/deploy_key @`必然失败。但`deploy.yml:154`显式设了`continue-on-error: true`（注释："SSH key未配置时不阻断CI Gate"），导致这个job**每次都"成功"结束**，GitHub Actions界面上完全看不出部署实际失败了——查了近期运行记录，"自动部署投聊后端"这个workflow反复显示绿色✅，但这只代表job没有阻断其它gate，不代表真的部署成功。**本次会话内所有对生产环境的真实变更，都是这次对话过程中直接在生产服务器本机操作完成的，不是经这条CI流水线走的**，与此前在其它模块（Android Release APK部署、iOS相关workflow）观察到的"同一组secret缺失"是同一个系统性问题，不是touliao独有，是整条工具链目前对"要不要接真正的自动化远程部署"这件事悬而未决——回滚代码质量高是真的，但等于是从未实战验证过的代码，建议要么补齐secret让它真正跑起来（并找个安全窗口主动触发一次演练验证回滚确实生效），要么干脆去掉这个误导性的"绿色成功"、明确标注这条流水线目前仅用于CI gate、真正部署走别的路径
- **健康检查**：代码逻辑完整（見上），但同样因为从未真正执行到这一步，**未经实战验证**

**5. 基础监控** 🟡 有仪表盘，没有主动告警
- `GET /api/admin/metrics`提供相当丰富的生产监控数据：在线用户/socket数、消息发送成功率与延迟、重连率、CPU/内存、SQLite写入队列深度(worker背压状态)等（第一节路由清单已列出）——这部分是真实存在、内容详实的
- **🟡 但这是纯拉取式(pull)仪表盘**，需要运维主动打开后台面板查看，**没有发现任何主动推送告警机制**（如异常时自动发Telegram/邮件/短信通知）——`deploy/touliao-backup.sh`脚本里虽然写了`ALERT_BOT_TOKEN`/`ALERT_CHAT_ID`用于备份失败时发Telegram通知，但这**仅限于备份脚本自身**，且该脚本本身还没被调度（见第2点），后端应用主进程本身没有集成任何类似的主动告警能力
- **磁盘占用监控缺失**：全代码库搜索未发现任何磁盘空间检测逻辑（`admin.service.js`/`prodMetrics.js`均无命中）——结合本节第1、2点（PM2日志无限增长、备份未调度可能导致的存储堆积），当前系统对"磁盘要满了"这件事没有任何自动感知能力，只能靠人定期手动`df -h`

**6. Android版本JSON自动更新的签名校验（防劫持）** 🟢 做得比预期更扎实
- `core/update/ApkInstaller.kt:64-146`：安装前会用`PackageManager`取出**待安装APK的签名证书SHA256指纹**，与**当前已安装应用的签名证书指纹**做全量比对（兼容APK v1/v2/v3多签名场景），**指纹集合完全一致才放行安装，不一致直接拒绝并记录日志**
- 这是比"简单校验一个下载哈希"更强的防护——即便更新服务器/下载CDN被入侵，攻击者伪造的恶意APK因为拿不到touliao真正的私钥签名，指纹必然不匹配，会被Android系统级签名校验挡在安装这一步之前，不依赖App自己实现的哈希比对逻辑是否可靠
- 下载链路本身走HTTPS（`https://touliao.cc/downloads/...`），传输层完整性也有保障，双重防护
- 唯一的历史教训（代码注释里记录）：v8.0.3之前误用过V信项目的签名密钥，导致换签名后旧版本用户静默安装失败——这是已经复盘过并加了明确报错提示的历史问题，不是当前风险

**7. 日志敏感信息** 🟢 处理规范
- 全局请求日志中间件(`utils/logger.js`的`requestLogger`)**只记录method/path/query(脱敏后)/status/duration/userId/ip，从不记录`req.body`**——意味着登录/注册/改密码这些密码走请求体传输的接口，密码原文根本不会进日志
- `SENSITIVE_QUERY_KEYS`覆盖`password/oldpassword/newpassword/token/secret/code/otp/totp/phone`共9个敏感query key，命中即替换成`***`（覆盖了`/uploads/...?token=`这类通过URL参数传token的场景）
- `auditLogger.js`里出现的"password"字样是`PASSWORD_CHANGE`/`PASSWORD_RESET`这类**审计事件类型常量**（用于分类"发生了什么类型的事"），不是密码明文被记录
- 未发现手机号在日志里明文出现的路径（`userId`记录的是UUID不是手机号本身）

**8. Electron 更新元数据 Ed25519 验签 —— 2026-08-30 已启用并实测验证** 🟢（原🟡，本次会话内闭环）

**发现时的状态**（首次审查记录，保留作为背景）：`desktop-electron/src/update-public-key.pem`当时仍是`gen-update-keys.js`留的占位文本，不是真实公钥；`main.js`检测到占位内容会自动跳过验签、静默降级为"仅信TLS继续安装"——代码看起来已实现，实际这道纵深防御从未真正生效。附带发现姊妹项目vxin的对应私钥`/root/vxin-1.0/desktop-electron/update-private-key.pem`以明文躺在服务器本地磁盘，不符合文档自己要求的"离线/密码管理器/HSM保管"标准。

**本次已完成的整改**（同一会话内，只查不改的审查之后紧接着做了实现）：
- 生成真实Ed25519密钥对（`node scripts/gen-update-keys.js --force`），`src/update-public-key.pem`已提交入库替换占位文件；私钥**不落地项目目录**，生成后立即移出并离线保管，服务器上不留明文副本（第一次生成时未按约定保存导致作废重新生成过一次，第二次严格按"私钥只输出一次、写到项目目录外、之后从对话记录里删除"的流程处理，全程没有把私钥内容写进任何会被提交的文件）
- `verifyUpdateSignature()`删掉"公钥未配置则跳过验签、回退仅信TLS"这条路径——现在只有`'ok'`/`'fail'`两态，公钥缺失/占位/篡改/`.sig`缺失，任一情况一律阻止安装并在「我的」页展示提示（新增启动自检`checkUpdateKeyStatus()` + `update:getKeyStatus` IPC + Profile.jsx展示），不再有可被攻击者利用的降级路径
- 签名接入构建流程：`afterPack`钩子打包时校验私钥+校验打包产物里真的装了合法公钥；签名本身**不用**`afterAllArtifactBuild`钩子——实测时真实复现过该钩子与electron-builder自身写`latest*.yml`的内部任务之间的竞态（签的是半成品/陈旧文件，`latest-linux.yml`一度完全没有有效签名而构建日志显示"成功"），改成`electron-builder`进程退出后的独立步骤（`&&`保证时序）彻底解决
- **实测清单**（真实构建+真实密钥对，非"应该会拒绝"的推测）：干净构建→自动签名→验签通过（退出码0）；篡改latest-linux.yml一字节→拒绝（退出码1）；删除.sig→拒绝；换成不匹配的另一对密钥公钥→拒绝（测完已核对sha256确认公钥已恢复正确值）；本地构建不配`UPDATE_PRIVATE_KEY`→真实失败退出码1；产物中人为排除公钥文件→`afterPack`真实拦截退出码1。全部5项对抗测试的报错栈都来自实际抛出的Error，不是模拟
- **仍未验证的部分**（如实说明，不夸大完成度）：CI（Windows runner）路径未实际触发真实workflow run验证失败行为——避免为测试而临时删除已配置好的`UPDATE_PRIVATE_KEY` GitHub Secret这个破坏性操作；完整GUI端到端流程（真实启动旧版客户端→看到更新条→点安装→重启进新版本）在这个无GUI的root容器环境里无法验证，是本系列审查全程存在的环境限制，不是这次新出现的缺口
- vxin那把明文私钥的问题**依然存在**，不在touliao这次整改范围内，仍需另行知会vxin负责人评估

**9. Android 自动更新加固：SHA-256 + APK内versionCode一致性 + 降级检测，version.json不签名（有独立防线）** 🟢 2026-08-30 实现并实测

**评估结论：version.json不用Ed25519签名（不同于Electron的latest.yml必须签）**——原链路"信任json→读URL/sha256/versionCode"确实存在"攻击者能同时伪造json+APK、三者自洽"的理论缺口，但Android这条链路多一道Electron当时没有的独立防线：`ApkInstaller.isSignatureMatch()`比对的是下载到的APK签名证书与**当前已安装应用**的证书，这个比对目标来自设备本地的既有安装记录，不依赖json或下载host的完整性——攻击者要通过这一关，需要真正拿到`touliao-release.jks`私钥（只以GitHub Secret存在，从未落地任何服务器磁盘），不是靠篡改json和APK内容就能绕过的。Electron当时必须签名，是因为代码签名证书压根不存在，Ed25519是唯一独立锚点；Android已经有等效强度的独立锚点，加签名的边际收益有限，成本是重新搭一整套密钥生成/托管/CI集成/轮换的运维负担（且不能复用Electron那把私钥——本节第6点记录过的vxin/touliao密钥混用教训）。

**但复核这个结论时，发现一处真实的薄弱环节，一并加固了**：`ApkInstaller.isSignatureMatch()`失败时，`UpdateViewModel`原本的提示是"此更新使用了新的签名密钥，无法直接覆盖安装。请先卸载当前App，再重新安装新版本"——这条消息是为v8.0.3那次真实的签名迁移历史事件写的，但**真实攻击触发的签名不匹配会显示一模一样的消息**，等于App自己的正常UX在教用户绕开这道刚论证过是"唯一独立锚点"的防线（卸载后设备上就没有可比对的已安装签名了）。已经把这类校验失败单独归类到新状态`SecurityBlocked`（跟"网络超时"这类`Error`视觉区分：弹窗标题"⚠️ 安装包校验未通过"），文案改成引导去官方渠道核实、不再无条件建议卸载重装，且被拒绝的APK文件现在会被立即删除（此前会残留在磁盘，理论上能被文件管理器单独打开安装，绕开整套校验）。

**三道新增校验**：
- ①版本号单调递增（`UpdateChecker.kt`）：已有的`versionCode`门槛保留，新增"服务器返回的版本号比当前还低"单独打warn日志（此前和"已是最新版"混在同一条info日志里，异常信号被吞掉，没有留痕）
- ②SHA-256（`ApkDownloader.kt`）：边下载边算哈希，完成后比对`AppVersionDto.sha256`，不一致删除文件+抛`ApkIntegrityException`，不留可疑文件在磁盘。CI（`android-release.yml`）新增对刚打包完的真实APK文件算sha256写进`version.json`
- ③APK内versionCode与json声明比对（`ApkInstaller.kt`，本轮新发现、新加的核心防线）：SHA-256只保证"下载到的文件没被中间人换掉"，防不住"服务器故意用一份完全合法、真实签名过的**旧版**APK（不用伪造任何东西），配一条谎报"版本号很高"的假json"——这种情况SHA-256和签名校验全部通过（文件本身货真价实），用户会被静默装回可能带着已修复漏洞的旧版本。这道检查专门堵这个口子，比对APK文件自己manifest里的真实versionCode，不依赖json自述，放在签名校验之前（更便宜、报错原因更具体）

**实测**（真实构建`app-debug.apk` + `aapt2 dump badging`独立读取真实versionCode + 真实sha256sum，逐字复刻三处判断逻辑跑真实数据，非推测）：正常更新→三道检查依次通过；SHA-256改错一位→拒绝+文件删除；**真实签名的APK配谎报versionCode的json→`ApkInstaller`真实拦截，日志"APK内版本号与更新源声明不一致，拒绝安装: apk内=65 声明=99"，文件删除**；服务器下发降级版本号→`UpdateChecker`打warn日志、不触发下载。受限于本环境无真实Android设备/模拟器/Robolectric，`PackageManager`/`Context`/`Log`等真实Android运行时API无法literal调用，用逐字复刻真实代码判断逻辑跑真实文件数据的方式验证，边界如实说明。

**一句话总结**：这轮部署配置审查发现了本系列篇幅最长的16个部分里少见的一个"代码质量很高但从未被验证过在跑"的典型案例——`deploy.yml`的自动回滚+健康检查逻辑写得很专业，但因为`DEPLOY_SSH_KEY`等secret从未配置、又被`continue-on-error:true`悄悄盖住了失败信号，导致这套机制事实上是**摆设**，且GitHub Actions界面还会持续显示"成功"制造一种"CI/CD在正常工作"的假象。PM2/nginx层面的配置总体扎实规范；Android更新的签名校验做得比预期好；日志敏感信息处理干净。**唯一需要认真对待的是"绿色的deploy job不代表真的部署成功"这件事**，建议要么把secret配上让它真正生效并做一次回滚演练，要么明确从文档和workflow展示层面说清楚"这条流水线目前只是占位，真实部署走人工"，避免团队被界面上的绿色勾误导。

---

## 十八、专项方案：Electron/Capacitor 端 Token 存储加固

> 2026-08-30 补充。**本节是方案设计文档，不是只读审计发现**——只出方案、列改动清单和工作量估算，**没有执行任何代码改动**。对应第六节"Token 客户端存储方式"🟡 里"Electron/Capacitor 端 Bearer token 存在 localStorage"这条的后续深挖。

### 0. 先界定范围：Capacitor 这条腿目前是"活的"还是"死的"

写方案前先查了一下 Capacitor 是否真的在给 touliao 出包：

- `web/capacitor.config.json` 里 `appId: "com.vxin.app"`、`appName: "vxin"`——**是姊妹项目 vxin 的包名，不是 touliao 的**，判断是代码同源迁移时带过来的历史遗留配置，没有随品牌切换更新
- `web/package.json` 的 `build:android`/`build:ios` 脚本是 `cap add android && cap sync android && cap open android` 这种**现场生成原生壳工程**的写法，仓库里没有签出任何 Capacitor 生成的 `android/`、`ios/` 壳工程目录（`/root/touliao/android`、`/root/touliao/ios` 是完全独立的原生 Kotlin/SwiftUI App，不是 Capacitor 产物）
- 没有找到任何 Capacitor 版本的构建产物、下载链接或安装包记录

**判断：Capacitor 目前不是一个真实在出包、在给用户用的移动端形态**，touliao 真正的移动端分发渠道是原生 Android/iOS App。下面的风险场景和方案对比里，**"Capacitor"按"和 Electron 共用同一份 web/src 代码、理论上有同样的 token 存储方式、但没有证据表明它在被真实分发"来处理**——修不修看你们要不要正式启用/保留这条腿，不建议现在为一个不确定还用不用的形态投入方案设计工作量；如果确认要弃用，建议单独清理 `capacitor.config.json`/相关 npm 依赖，作为另一件事处理。下文的方案对比以 **Electron** 为主要目标。

### 1. 当前具体风险场景

Token 存储链路（`web/src/contexts/AuthContext.jsx:32-41` `setElectronToken()`）：登录成功后 `localStorage.setItem('touliao_electron_token', token)`，7 天有效期的 Bearer JWT 明文写入 `localStorage`。Electron 下 `localStorage` 落盘位置是 `<用户数据目录>/Local Storage/leveldb/*.log`（明文 LevelDB 文件，不是加密格式）。

**场景A（已确认成立，不需要 XSS，门槛最低）——本机文件系统访问**：
用户的电脑中招其它恶意软件、被盗、被临时借给不信任的人，或者电脑维修/二手转卖前没有彻底清空数据。只要能读到这台电脑的文件系统（不需要通过投聊 App 本身，不需要任何投聊自身的漏洞），直接翻 `Local Storage/leveldb/*.log` 就能读到明文 token。拿到后可以在任何其它地方冒充该用户调用全部 API（发消息、改资料、加好友、读聊天记录……），直到用户主动登出撤销或 token 7 天自然过期。

**场景B（纵深防御考虑，触发门槛更高）——活体 XSS 窃取**：
如果攻击者找到一个可用的 XSS 注入点（本轮审查第十节确认全仓库目前只有一处 `dangerouslySetInnerHTML`，来源是 SheetJS 官方转义 API，**没有发现真实可用的 XSS 漏洞**，这是假设性场景，不是已发现的活跃风险），恶意脚本能直接 `localStorage.getItem('touliao_electron_token')` 读到明文并 `fetch` 发送到攻击者服务器——不需要绕过 `contextIsolation`（`main.js:412`已开启），因为 `localStorage` 本来就是标准 Web API，不受 Electron 的 Node/`contextBridge` 隔离保护，隔离保护的是"拿不到 Node/系统级权限"，不是"拿不到页面自己存的数据"。

场景A 是当前更值得优先考虑的——它不依赖任何应用层漏洞，纯粹是"明文密钥用普通文件存储"这个选型本身的风险敞口。

### 2. 三个方案对比

#### 方案A：httpOnly Cookie（比照 Web 端已经在用的方案）

**思路**：Electron 不再走 Bearer token，改成和浏览器版一样，让后端把 token 签进 `httpOnly` Cookie，渲染进程 JS 完全读不到。

**为什么当初没这么做**：`AuthContext.jsx:15,18` 的注释写的是"Electron 模式下 Cookie 跨域无法自动携带"、"Electron(file://)与移动端(Capacitor 跨域 https://localhost)均无法可靠使用 Cookie"。技术上重新核实了一下：httpOnly Cookie 是否被浏览器/Chromium 接受、存储，取决于**响应的 `Set-Cookie` 来自哪个域**，不取决于发起请求的页面是 `file://` 还是 `https://`；Electron 的 `session.defaultSession.cookies` 是 Chromium 网络层维护的，理论上 `file://` 页面发出的 XHR/fetch 只要带 `withCredentials`，后端返回的 `Set-Cookie`（需要 `SameSite=None; Secure`）应该能被存住、后续请求自动带上。但这只是"理论上应该可行"，**没有实测验证过**，历史上这条路被放弃可能是踩过 `SameSite`/`file://` 组合的某个具体坑，也可能是团队图省事直接照搬了 Capacitor 那边"WKWebView Cookie 不可靠"的经验、没有专门针对 Electron 单独验证过——这一点需要先花一小段时间做一次可行性验证（起一个最小 Electron demo 实测），不能直接假定能work。

**改动量**：中等，但**可行性本身未知，有推翻重来的风险**。
- 后端：登录/刷新接口需要判断"是不是 Electron 客户端"（比如按 `User-Agent` 或专门的请求头）分别走 Cookie 签发 vs 现有 Bearer 签发，或者干脆统一切 Cookie（连带要重新过一遍 CSRF 双提交校验在 Electron 场景下是否也一样能工作）
- Electron 主进程：`main.js` 的 CSP（`connect-src` 等）、cookie 存储位置的用户数据目录持久化策略需要确认
- 渲染层：`AuthContext.jsx`/`axiosInterceptor.js`/`SocketContext.jsx`/`utils/url.js`/`main.jsx` 里所有 `touliao_electron_token` 相关代码整体删除，改成和 Web 端完全一样的"不存 token，靠 Cookie"逻辑——这部分工作量不大，因为等于是删代码、复用 Web 端已经写好且验证过的路径
- WebSocket：`realtime/index.js` 握手鉴权已经优先认 Cookie（`cookieToken || bearerToken`），这条不用改
- `utils/url.js` 的媒体票据逻辑：`bearerToken()` 这个函数没有 token 可用了，取票据的 XHR 需要看 Cookie 能不能自动带上，大概率不用改（票据接口本来就要求鉴权，Cookie 能带的话直接过）

**四端影响**：Web 不受影响（本来就是这套）；Android/iOS 原生 App 不用 Cookie（不受影响）；Electron 是唯一改动目标；Capacitor 同理但优先级见第0节。

**兼容性**：**需要强制同步发版**——旧版 Electron 客户端还在发 Bearer，如果后端切换成"只认 Cookie"，旧版本会直接登录失效；除非后端过渡期两种都接受（Cookie 优先、Bearer 兜底），这样能避免强制同步，但意味着旧的"token 存 localStorage"风险在过渡期内仍然存在，直到确认所有存量客户端升级完。

**工作量预估**：验证可行性 0.5~1 天（起一个最小demo实测 `file://` + `httpOnly` Cookie 组合是否真的稳定工作，这一步不能跳）+ 若验证通过，改造本身 1~1.5 天。**如果验证不通过（比如某个 Electron/Chromium 版本上 Cookie 真的不持久化），这个方案要推倒重来，风险在于"验证之前不知道能不能做"**。

---

#### 方案B：主进程 safeStorage + 请求头注入（渲染进程全程不接触明文 token）

**思路**：Token 只活在 Electron 主进程内存/加密文件里，用 `safeStorage`（Electron 官方 API，底层调用 macOS Keychain / Windows DPAPI / Linux libsecret，是 OS 级加密）加密落盘。渲染进程永远拿不到明文——不读、不存、也不再自己往请求头里塞 `Authorization`，改成主进程通过 `session.webRequest.onBeforeSendHeaders` 拦截所有出站请求，统一注入头。这是能同时堵住"场景A"（落盘明文）和"场景B"（活体XSS窃取，因为渲染进程 JS 运行时就没有这个字符串可读）两个风险的方案。

**已经核实过的两个关键技术点**：
1. **WebSocket 鉴权走不了 `onBeforeSendHeaders`**：`socket.io-client` 的 `auth: {token}` 是 Socket.IO 协议自己的 CONNECT 包内容，不是 HTTP 头，`onBeforeSendHeaders` 拦不到。但后端握手鉴权本来就优先认 Cookie（`realtime/index.js:68-71` `cookieToken || bearerToken`），所以做法是：**渲染进程连 socket 时完全不传 `auth.token`**，改成主进程在 WS 升级请求（本质上还是一次 HTTP 请求，`onBeforeSendHeaders` 拦得到）上注入一个 `Cookie: vxin_token=<token>` 头，绕开 Bearer 这条路，直接命中后端已有的 Cookie 校验分支——不需要改后端代码。
2. **图片/文件等 `<img src>` 类请求同样能被 `onBeforeSendHeaders` 覆盖**：这类请求也走同一个 `session` 的网络层，不是 renderer JS 发起的才拦得到。核实了 `utils/url.js` 现在的设计（`:57-63`）——它已经是"用 Bearer 换一张短时票据、票据本身进 URL，登录 JWT 不进 URL"的做法，改造只需要把里面 `xhr.setRequestHeader('Authorization', ...)` 这行删掉（让主进程注入），不用大改这个文件的整体逻辑。

**改动量**：这三个方案里**技术上最彻底、但改动面也最广**，且只能覆盖 Electron（Capacitor 没有等价的"主进程"概念，这条路线天然不适用于它）。

**四端影响**：Web/Android/iOS 不受影响；Electron 是唯一目标；Capacitor 无法复用这个方案，需要单独考虑（或维持现状，见第0节的建议）。

**兼容性**：**不需要强制同步发版**。渲染进程不再需要知道 token 具体值，只需要知道"登录了没有"（布尔值），可以做成新旧两套逻辑并存一段时间——`electronAPI` 新增的 IPC 方法在旧版本客户端里就是"不存在"，不会报错也不会崩，只是旧版本继续用它自己那套 localStorage 逻辑；新版本装上之后自动切到新逻辑。真正需要认真做的是**登录态迁移**：老版本升级到新版本那一刻，`localStorage` 里可能还有一个有效的旧 token，新版本首次启动时应该把它读出来、通过新 IPC 存进 `safeStorage`、再把 `localStorage` 里那份清掉，避免用户升级后被强制重新登录，也避免明文 token 在磁盘上留了新旧两份。

**文件改动清单**：
| 文件 | 改动内容 |
|---|---|
| `desktop-electron/src/main.js` | 新增 `safeStorage` 加解密读写函数；新增 `session.webRequest.onBeforeSendHeaders` 拦截器，按当前登录态注入 `Authorization`/WS用的`Cookie`头；新增 IPC handler：`auth:setToken`/`auth:clearToken`/`auth:isLoggedIn`（都不返回明文token） |
| `desktop-electron/src/preload.js` | `electronAPI` 新增 `setAuthToken(token)`/`clearAuthToken()`/`isLoggedIn()` 三个白名单方法 |
| `web/src/contexts/AuthContext.jsx` | `setElectronToken()` 改成调 `window.electronAPI.setAuthToken/clearAuthToken`（Electron 分支），不再直接碰 `localStorage`；启动时的登录态判断改成 `await window.electronAPI.isLoggedIn()` |
| `web/src/main.jsx:85` | 启动时读 token 那段改成异步查 `isLoggedIn()`，不再需要真的读出 token 值来设 `Authorization` 头（主进程会自动注入） |
| `web/src/utils/axiosInterceptor.js:40,49` | token 刷新成功/失败后的处理改成调 `setAuthToken`/`clearAuthToken`，不再 `localStorage.setItem/removeItem` |
| `web/src/contexts/SocketContext.jsx:45-52` | 不再读 `localStorage` 拼 `auth.token` 传给 `io()`，socket 连接参数里去掉这部分，鉴权交给主进程注入的 Cookie 头 |
| `web/src/utils/url.js:29-30,57-63` | 删掉 `bearerToken()` 函数和 `xhr.setRequestHeader('Authorization', ...)` 这一行，票据请求的鉴权头交给主进程注入 |
| `web/src/utils/migrateStorage.js` | 新增一段一次性迁移逻辑：检测到 `localStorage` 里还有旧 key 的 token，读出来调一次 `setAuthToken` 迁移进 `safeStorage`，然后清掉旧 key |

**工作量预估**：3~4 天（含主进程 IPC/webRequest 改造、渲染层 6 个文件改造、WS 改 Cookie 验证、迁移逻辑、真机手工回归登录/断线重连/发图/发文件全流程）。这台开发机没有 GUI，之前验证 Electron 相关改动时踩过"root+容器沙箱跑不起来 Chromium"的坑（休眠重连那条修复时记录过），**这个方案的验证必须在有图形界面的真机上做**，没法在这个环境里像后端改动一样自己跑一遍就交差。

---

#### 方案C：系统钥匙串仅作存储后端（不改变"渲染进程仍持有明文token"这个现状）

**思路**：只换"存在哪"，不换"谁能读到"。还是用 `safeStorage`（即系统钥匙串：macOS Keychain / Windows DPAPI / Linux libsecret），但只做存储层替换——渲染进程登录成功后仍然通过 IPC 把 token 交给主进程加密存起来，**但需要用的时候，渲染进程仍然会调 IPC 把明文要回来**，自己按老方式设进 `axios.defaults.headers`、传给 `socket.io`、拼进媒体 URL。整体请求逻辑（`axiosInterceptor.js`/`SocketContext.jsx`/`utils/url.js`）基本不用动。

**能解决什么、不能解决什么**：
- ✅ 解决场景A：磁盘上不再是明文 LevelDB 文件，攻击者拿到文件系统访问权限也读不出token（除非同时拿到能解锁系统钥匙串的权限，比如用户已登录的会话——这本身也是操作系统级别的一层防护）
- ❌ 不解决场景B：token 运行时仍然以明文字符串形式活在渲染进程 JS 的内存/变量里，一次真实的 XSS 依然能读到、依然能带出去——这是"存储层"方案的天然局限，不是实现问题

**改动量**：三个方案里**最小**。
**四端影响**：Web/Android/iOS 不受影响（Android/iOS 本来就分别用 `EncryptedSharedPreferences`/Keychain，早就是这个级别的防护，这次不用动）；Electron 是目标；Capacitor 如果确认要保留，需要另找一个 Capacitor 生态的等价方案（如 `@capacitor-community/secure-storage-plugin` 之类），属于新增原生依赖，这台机器没法验证原生插件能否正常编译，需要在有 Android Studio/Xcode 的机器上做，风险和工作量单独算，不包含在下面的预估里。

**兼容性**：**不需要强制同步发版**，且比方案B简单——因为对外行为（渲染进程该干嘛还干嘛）完全没变，只是把 `localStorage.getItem/setItem` 换成 `await window.electronAPI.getToken()`/`setToken()` 两个 IPC 调用，旧版本客户端不受影响，新版本平滑切换，同样需要一次性把 `localStorage` 里的旧 token 读出来迁移过去再清掉（迁移逻辑比方案B更简单，因为不涉及请求头注入时机的问题）。

**文件改动清单**：
| 文件 | 改动内容 |
|---|---|
| `desktop-electron/src/main.js` | 新增 `safeStorage` 加解密读写 + 对应 IPC handler：`auth:setToken(token)`/`auth:getToken()`/`auth:clearToken()`（这次 `getToken` 是允许返回明文的，和方案B的关键区别） |
| `desktop-electron/src/preload.js` | `electronAPI` 新增 `setAuthToken`/`getAuthToken`/`clearAuthToken` 三个白名单方法 |
| `web/src/contexts/AuthContext.jsx` | `setElectronToken()` 里的 `localStorage.setItem/removeItem` 换成对应的 IPC 调用 |
| `web/src/main.jsx:85` | 启动时改成 `await window.electronAPI.getAuthToken()` 取值，其余逻辑不变 |
| `web/src/utils/axiosInterceptor.js:40,49` | `localStorage.setItem/removeItem` 换成 IPC 调用 |
| `web/src/contexts/SocketContext.jsx:46` | `localStorage.getItem(...)` 换成需要提前异步取好的值（这里有个小麻烦：现在这处是同步读 `localStorage`，换成 IPC 异步调用需要把 socket 初始化的 `useEffect` 稍微调整成先 `await` 拿到 token 再 `io()`，不是纯粹的字符串替换，但改动量仍然很小） |
| `web/src/utils/url.js:29-30` | `bearerToken()` 里的 `localStorage.getItem` 换成……这里有个更明显的麻烦：`mediaUrl()` 全函数是同步的（调用方需要同步拿到字符串直接塞进 `<img src>`），而 IPC 调用是异步的，这一处没法简单替换，需要引入一层"启动时预取一次 token 缓存进内存变量、按需读这个内存变量"的中间层，不能每次都现查 IPC |
| `web/src/utils/migrateStorage.js` | 同方案B，一次性迁移旧 `localStorage` token 进新存储 |

**工作量预估**：1.5~2 天（比方案B省了 `onBeforeSendHeaders`拦截器、WS改Cookie这两块，但 `SocketContext.jsx`/`utils/url.js` 这两处"同步读改异步读"需要引入内存缓存层，不是纯粹的查找替换，也要真机验证）。

### 3. 三方案对比表

| | 方案A：httpOnly Cookie | 方案B：主进程注入 | 方案C：钥匙串仅存储 |
|---|---|---|---|
| 解决场景A（落盘明文） | ✅ | ✅ | ✅ |
| 解决场景B（活体XSS） | ✅ | ✅ | ❌ |
| 需要强制同步发版 | 视是否做过渡期兼容而定 | 否 | 否 |
| 覆盖 Capacitor | 理论可行(同架构) | ❌ 天然不适用 | 需要另找方案，工作量未知 |
| 可行性确定性 | **未验证，有推翻重来风险** | 已核实关键技术点，把握较高 | 把握最高，改动最简单 |
| 工作量预估 | 1.5~2.5天（含验证） | 3~4天 | 1.5~2天 |
| 是否需要真机验证 | 是 | 是 | 是 |

### 4. 推荐

**推荐方案C，作为第一步先做**；如果之后确认要把这类风险按"纵深防御"标准彻底堵上（不只是防落盘明文，也防万一出现XSS），**再追加方案B**。理由：

1. 场景A（本机文件系统访问）是**已确认成立、门槛最低**的风险，场景B（活体XSS）目前**没有已知的实际攻击路径**（本轮审查没找到可用XSS点）——优先花小代价把确定成立的风险堵掉，再考虑要不要为一个目前只是假设性的场景投入大改造，性价比更合理。
2. 方案C 工作量最小（1.5~2天）、不需要强制同步发版、不改变现有请求逻辑的整体结构，出问题时回滚成本也最低。
3. 方案A 的"能不能做"本身还没验证过，贸然投入 1.5~2.5 天可能验证不通过要推倒重来，不确定性最高，不建议作为第一选择。
4. 方案B 技术上最完整，但改动面广、涉及 WebSocket 鉴权路径切换和请求拦截器这类"改错了会导致登录/收发消息全线故障"的核心链路，且这台开发机没有图形界面没法自己先验证一遍再交付，风险和工作量都需要留出更宽裕的测试窗口——**不建议跳过方案C直接上方案B**，按 C→B 分两步走，每一步都有独立、可回滚的交付节点，比一次性重构更稳妥。
5. Capacitor 那条腿建议先确认第0节的判断（是否已经是事实上弃用状态），如果确认弃用，直接从方案范围里去掉，不需要为它单独设计存储方案；如果确认还要保留，需要单独立项评估（涉及新增原生依赖，这台机器没法验证）。

以上均为方案设计，**未执行任何代码改动**，具体实施顺序和是否追加方案B，需要你确认后再排期。

---

## 十九、专项方案：wechat_id / wechat.db 命名残留完整改造计划

> 2026-08-30 补充。**本节是方案设计文档，不是只读审计发现，没有执行任何代码改动**。对应第十五节"品牌一致性"里"数据库文件名 `wechat.db` 及大量 `wechat_id` 字段命名残留"这条 🔴 的完整落地方案。第十五节当时给的是一份"草稿"（`AUDIT.md:1445-1524`，二维码 `vxin-user` 那部分已经在另一次改动里落地——`fix(brand): 扫码加好友客户端兼容新旧两种二维码type值`，四端已接受新旧两种 type 值，后端目前仍吐旧值，这次不重复处理），本节是补全数据库改名、四端配合改造、迁移/回滚脚本、停机估算、商标合规风险这几块此前没有展开的部分。

### 0. 完整清单：所有 wechat 相关命名的位置

全仓库重新跑了一遍搜索（不是照抄第十五节的旧结论），按类别列出。**不含 `wechat_work`/`WECHAT_WORK`**——这是真实对接企业微信(WeCom)开放平台的通知渠道，命名准确描述了一个真实第三方集成，不是残留，不在本次改造范围内（第十五节已经论证过，这里不重复）。

#### 0.1 数据库层（3处，是本次改造的核心）

| 位置 | 定义 | 用途 |
|---|---|---|
| `users.wechat_id` 列 | `backend-v2/src/db/schema.js:22,188` | 6位数字"投聊号"，产品概念上早就是"投聊号"不是"微信号" |
| `idx_users_wechat_id_unique` 索引 | `backend-v2/src/db/connection.js:144` | 上面这列的唯一索引 |
| `user_settings.add_by_vxin_id` 列 | `backend-v2/src/db/schema.js:172` | "是否允许通过投聊号加我"的隐私开关，字段名里的 vxin 是姊妹项目遗留 |
| 数据库文件名 `wechat.db` | `backend-v2/wechat.db` | 主数据库文件本体 |

#### 0.2 后端应用代码（7个文件，约34处引用 `wechat_id`/`add_by_vxin_id`）

| 文件 | 处数 | 备注 |
|---|---|---|
| `src/db/connection.js` | 6 | 投聊号生成/查重/去重逻辑 |
| `src/db/schema.js` | 2 | 列定义 + 迁移语句 |
| `src/modules/users/users.service.js` | 8 | 含 `vxin-user`/`vxinId` 二维码 payload（type值兼容已上线，`vxinId` 这个JSON key名还没动） |
| `src/modules/admin/admin.service.js` | 4 | 后台用户搜索/列表 |
| `src/modules/contacts/contacts.service.js` | 6 | 好友列表/好友请求 |
| `src/modules/auth/auth.service.js` | 7 | 注册/登录/资料/注销 |
| `src/config/index.js` | 1 | `wechat.db` 默认路径 |

#### 0.3 引用了 `wechat.db` 路径的部署/运维脚本（12个文件）

这批文件**改数据库文件名时必须同步改**，否则重命名后这些脚本会指向一个不存在的文件（部署脚本会部署失败；`ops/perf_purge.js`/`ops/perf_seed.js` 更危险——**这两个文件是硬编码字面量 `'wechat.db'`，没有 `DB_PATH` 环境变量兜底**，改名后如果有人手滑跑了这两个脚本，会在当前目录**新建**一个空的 `wechat.db` 而不是报错，属于容易被忽略的坑）：

`backend-v2/.env.example`、`deploy/setup.sh`、`deploy/touliao-backup.sh`、`deploy/rollback.sh`、`deploy/restore-drill.sh`、`deploy/README.md`、`ops/perf_purge.js`（硬编码⚠️）、`ops/perf_seed.js`（硬编码⚠️）、`ops/seed_test_users.js`、`ops/hermes_vxin_capacity_check.sh`、`.github/workflows/ci.yml`（仅注释）、`.github/workflows/deploy.yml`（仅注释）

#### 0.4 测试/CI基础设施（10个文件）

`backend-v2/test/{globalSetup.js, e2e.js, harden-01-02.test.js, testEnv.js, ws-load-test.js}`、`tests/{acceptance.js, socket_profile.js, profile_api.js, monitor/stability.js, pytest_suite/helpers/db_helper.py}`——多数是断言里查了 `wechat_id` 字段值，或者测试库路径引用，列名/文件名改了这批测试会全红，需要同批更新。

#### 0.5 Web 端（9个文件，含后台管理面板）

`web/src/components/{AddFriendModal.jsx, GlobalSearch.jsx, ChatWindow.jsx, MessageItem.jsx, UserProfile.jsx, Profile.jsx}`、`web/src/pages/{Login.jsx, Home.jsx}`、`admin/index.html`。均为内部字段名/变量名读取，**用户实际看到的界面文案确认统一是"投聊号"**，不是用户可见的品牌泄漏。

额外发现两处第十五节没提到的 **CSS 类名残留**：`wc-card-picker-item-wechat`（`ChatWindow.jsx:2469`）、`wc-contact-card-wechat`（`MessageItem.jsx:307`）——纯样式钩子，不影响功能，改不改都行，顺手带上成本很低。

> 旁注：Web 端 CSS 类名普遍带 `wc-` 前缀（这次搜索过程中大量出现，规模远超上面这两个），这大概率是"vxin/微信风格"命名年代定下的前缀约定，但这是**整个项目级别的 CSS 命名规范**，不是"wechat 残留"这个具体问题的一部分——除非确认要把整套 CSS 命名规范一起改，否则不建议顺带处理，工作量和风险都不是一个数量级，本方案不包含这部分。

#### 0.6 Android（8个文件）

`data/model/{Auth.kt, ContactCard.kt, Contacts.kt, InviteInfo.kt}`、`feature/contacts/AddFriendScreen.kt`、`feature/profile/{MyQrCodeScreen.kt, ProfileEditScreen.kt, ProfileScreen.kt}`。字段名统一是 `wechat_id`（Kotlin 属性名直接对齐 JSON key，没有做 CodingKeys 那层映射）。

#### 0.7 iOS（7个文件）

`Data/Models/{ContactCard.swift, Contacts.swift, User.swift}`、`Features/Contacts/AddFriendView.swift`、`Features/Profile/{MyQRCodeView.swift, ProfileEditView.swift, ProfileView.swift}`。**iOS 这边已经有一层间接**——Swift 属性名是 `wechatId`（驼峰），通过 `CodingKeys` 映射到 JSON key `"wechat_id"`（如 `Data/Models/User.swift:15`），改后端字段名时，iOS 只需要改 `CodingKeys` 里那一个字符串常量，不需要满文件替换属性名，四端里这个改起来风险最小。

#### 0.8 文档类（.md，约15+个文件，运行时零影响）

`docs/archive/` 下9份历史优化报告、`backend-v2/{FINAL-COMPLETION-REPORT.md, NOTIFICATION-*.md, SPEC.md, OPERATIONS.md, vxin-v2-audit.md}`、`PROJECT_AUDIT_GUIDE.md` 等。这些是历史归档文档，不参与编译/运行，**优先级最低，可以不改或者事后批量替换文字**，不纳入下面的分阶段计划正式排期。

---

### 1. 分阶段改造计划

| 阶段 | 内容 | 能否立刻改 | 需要数据库迁移 | 需要四端同步发版 |
|---|---|---|---|---|
| **阶段0（已完成）** | 二维码 `type` 值扩容兼容（`vxin-user`/`touliao-user` 都认） | 已上线 | 否 | 否（expand，向后兼容） |
| **阶段1** | 纯注释/文档类改名（0.8节 + 代码里解释性注释里的"微信"字样，如果有） | ✅ 立刻改，零风险 | 否 | 否 |
| **阶段2** | Web 端 CSS 类名残留（0.5节末尾那两处 `wc-*-wechat`） | ✅ 立刻改，零风险（纯样式类名，不影响功能） | 否 | 否（Web 是集中部署，不存在"客户端版本"问题） |
| **阶段3** | 后端 JSON 响应体里 `vxinId` 这个 key 名 → 改成语义化的 `touliaoId`，**同时保留 `vxinId` 双写一段时间** | ⚠️ 能改，但要走双写过渡期，不是"改完就完事" | 否（这是 JSON 响应字段，不是DB列） | 建议：先双写两个key，四端逐步升级到读新key后再摘掉旧key，不强制同步 |
| **阶段4** | 数据库层：`user_settings.add_by_vxin_id` 列改名 | ❌ 不能直接改 | **是**，见第2节脚本 | 后端可以做"双字段兼容"降低同步压力，但如果不做兼容层则需要同步 |
| **阶段5** | 数据库层：`users.wechat_id` 列改名 + 索引改名 | ❌ 不能直接改 | **是**，见第2节脚本 | 同上，影响面最大（贯穿7个后端文件+四端全部客户端） |
| **阶段6** | 数据库文件本体 `wechat.db` → `touliao.db` | ❌ 不能直接 `mv` | **是**，见第2节脚本 | 否（纯服务端文件路径改名，客户端不感知，但0.3节列的12个脚本/配置必须同步改） |

**建议顺序**：0→1→2（本周内可做完，零风险）→3（先双写，观察一两周确认没有客户端在读旧 key 再摘）→6（文件改名可以和阶段4/5分开先做，只影响服务端）→4+5（数据库列改名，建议合并成一次迁移窗口一起做，减少总的"维护窗口"次数，见下方脚本）。

**阶段4/5为什么建议"合并进下一次本来就要做的数据契约版本"**（第十五节已经这么建议过，这里重申并给出具体理由）：这两步涉及后端7个文件 + 四端全部客户端的数据模型，字段一旦改名，没升级到新版本的存量 App 会读不到这个字段（老版本继续读 `wechat_id` 这个 JSON key，如果后端改名后不做双字段兼容，老版本用户会看到"投聊号"显示为空）。**必须要么做双字段兼容期，要么接受"这次改名要等一个观察期确认客户端存量升级比例后才能收尾"**，不是一次部署能干净切换的。

---

### 2. 数据库迁移脚本 + 回滚脚本 + 停机时间估算

三个改名目标分开给脚本：文件名、`wechat_id`列、`add_by_vxin_id`列。**全部要求先停 pm2 进程再操作，不能带着写入压力做 schema 变更**，且**一律走 `sqlite3 .backup`/`ALTER TABLE`，绝不直接 `mv`/裸改字段**。

#### 2.1 数据库文件改名：`wechat.db` → `touliao.db`

```bash
#!/usr/bin/env bash
# migrate-01-db-filename.sh —— wechat.db → touliao.db
set -euo pipefail
ROOT="/root/touliao"
BE="$ROOT/backend-v2"
OLD_DB="$BE/wechat.db"
NEW_DB="$BE/touliao.db"
DATE=$(date +%Y%m%d_%H%M%S)

echo "1) 停止后端进程"
pm2 stop touliao-backend

echo "2) WAL checkpoint：把 wechat.db-wal 内容并回主文件"
sqlite3 "$OLD_DB" "PRAGMA wal_checkpoint(TRUNCATE);"

echo "3) 用 sqlite3 .backup（官方一致性快照API）复制，不用裸 cp"
sqlite3 "$OLD_DB" ".backup '$NEW_DB'"

echo "4) 完整性校验 + 行数比对，任何一步失败中止，不动旧文件"
sqlite3 "$NEW_DB" "PRAGMA integrity_check;" | grep -q "^ok$" || { echo "❌ integrity_check 失败"; rm -f "$NEW_DB"; exit 1; }
OLD_COUNT=$(sqlite3 "$OLD_DB" "SELECT COUNT(*) FROM users;")
NEW_COUNT=$(sqlite3 "$NEW_DB" "SELECT COUNT(*) FROM users;")
[ "$OLD_COUNT" = "$NEW_COUNT" ] || { echo "❌ users 行数不一致($OLD_COUNT vs $NEW_COUNT)"; rm -f "$NEW_DB"; exit 1; }

echo "5) 更新 .env 的 DB_PATH 指向新文件"
grep -q "^DB_PATH=" "$BE/.env" && \
  sed -i "s#^DB_PATH=.*#DB_PATH=$NEW_DB#" "$BE/.env" || \
  echo "DB_PATH=$NEW_DB" >> "$BE/.env"

echo "6) 同步更新 0.3 节列出的运维脚本里的硬编码路径（不能漏，尤其 ops/perf_*.js 的硬编码字面量）"
sed -i "s#wechat\.db#touliao.db#g" \
  "$ROOT/deploy/touliao-backup.sh" "$ROOT/deploy/rollback.sh" "$ROOT/deploy/restore-drill.sh" \
  "$ROOT/ops/perf_purge.js" "$ROOT/ops/perf_seed.js" "$ROOT/ops/hermes_vxin_capacity_check.sh"

echo "7) 旧文件先不删，原地改名保留一个完整备份周期（建议7天）"
mv "$OLD_DB" "${OLD_DB}.migrated-${DATE}"
[ -f "${OLD_DB}-wal" ] && mv "${OLD_DB}-wal" "${OLD_DB}-wal.migrated-${DATE}" || true
[ -f "${OLD_DB}-shm" ] && mv "${OLD_DB}-shm" "${OLD_DB}-shm.migrated-${DATE}" || true

echo "8) 重启 + 健康检查"
pm2 start touliao-backend
sleep 3
for i in $(seq 1 10); do
  curl -sf http://127.0.0.1:3003/health && { echo "✅ 迁移完成"; exit 0; }
  sleep 2
done
echo "❌ 健康检查失败，执行 rollback-01-db-filename.sh"
exit 1
```

```bash
#!/usr/bin/env bash
# rollback-01-db-filename.sh —— 回滚 touliao.db → wechat.db
set -euo pipefail
ROOT="/root/touliao"; BE="$ROOT/backend-v2"
DATE_SUFFIX="${1:?用法: rollback-01-db-filename.sh <迁移时打印的DATE后缀，如20260830_090000>}"
OLD_DB="$BE/wechat.db"

pm2 stop touliao-backend
# 找回被 mv 改名的旧文件（迁移期间从未被写入，直接原样恢复）
[ -f "${OLD_DB}.migrated-${DATE_SUFFIX}" ] || { echo "❌ 找不到 ${OLD_DB}.migrated-${DATE_SUFFIX}，无法回滚"; exit 1; }
mv "${OLD_DB}.migrated-${DATE_SUFFIX}" "$OLD_DB"
[ -f "${OLD_DB}-wal.migrated-${DATE_SUFFIX}" ] && mv "${OLD_DB}-wal.migrated-${DATE_SUFFIX}" "${OLD_DB}-wal" || true
[ -f "${OLD_DB}-shm.migrated-${DATE_SUFFIX}" ] && mv "${OLD_DB}-shm.migrated-${DATE_SUFFIX}" "${OLD_DB}-shm" || true
sed -i "s#^DB_PATH=.*#DB_PATH=$OLD_DB#" "$BE/.env"
sed -i "s#touliao\.db#wechat.db#g" \
  "$ROOT/deploy/touliao-backup.sh" "$ROOT/deploy/rollback.sh" "$ROOT/deploy/restore-drill.sh" \
  "$ROOT/ops/perf_purge.js" "$ROOT/ops/perf_seed.js" "$ROOT/ops/hermes_vxin_capacity_check.sh"
rm -f "$BE/touliao.db" "$BE/touliao.db-wal" "$BE/touliao.db-shm"   # 迁移期间没有新写入，直接删掉误建的新文件是安全的
pm2 start touliao-backend
sleep 3
curl -sf http://127.0.0.1:3003/health && echo "✅ 回滚完成" || echo "❌ 回滚后健康检查仍失败，需要人工介入"
```

**停机时间估算**：当前 `wechat.db` 主体约4~6MB，`.backup` 快照 + 完整性校验 + 行数比对全部是本地磁盘操作，实测量级在1秒以内；真正占时间的是 `pm2 stop` → `pm2 start` → 健康检查轮询这几步。**预估停机窗口 30~60秒**，主要花在 pm2 进程重启和健康检查确认上，不是数据库操作本身。数据库量级即使涨到百倍（400~600MB），`.backup` 操作预计仍在数秒级，不会显著拉长停机窗口。

#### 2.2 列改名：`users.wechat_id` → `users.touliao_id`

```sql
-- migrate-02-column-wechat-id.sql
-- 前提：pm2 已停（同一停机窗口内和 2.1 一起做，减少总维护次数）
-- SQLite 3.25+ 原生支持 RENAME COLUMN；本机实测 better-sqlite3 编译的 SQLite 版本是 3.45.3，满足要求。
-- ALTER TABLE RENAME COLUMN 是元数据级操作，不重写整张表数据，耗时和表行数无关，是毫秒级操作。

BEGIN TRANSACTION;

ALTER TABLE users RENAME COLUMN wechat_id TO touliao_id;

DROP INDEX IF EXISTS idx_users_wechat_id_unique;
CREATE UNIQUE INDEX idx_users_touliao_id_unique ON users(touliao_id);

COMMIT;

PRAGMA integrity_check;  -- 迁移后立刻跑一次，人工确认输出是 ok
```

```sql
-- rollback-02-column-wechat-id.sql
BEGIN TRANSACTION;
ALTER TABLE users RENAME COLUMN touliao_id TO wechat_id;
DROP INDEX IF EXISTS idx_users_touliao_id_unique;
CREATE UNIQUE INDEX idx_users_wechat_id_unique ON users(wechat_id);
COMMIT;
```

#### 2.3 列改名：`user_settings.add_by_vxin_id` → `user_settings.add_by_touliao_id`

```sql
-- migrate-03-column-add-by-vxin-id.sql
BEGIN TRANSACTION;
ALTER TABLE user_settings RENAME COLUMN add_by_vxin_id TO add_by_touliao_id;
COMMIT;
PRAGMA integrity_check;
```

```sql
-- rollback-03-column-add-by-vxin-id.sql
BEGIN TRANSACTION;
ALTER TABLE user_settings RENAME COLUMN add_by_touliao_id TO add_by_vxin_id;
COMMIT;
```

**2.2/2.3 停机时间估算**：`RENAME COLUMN` 在 SQLite 里是纯 schema 元数据修改，不涉及重写行数据，**和表的行数无关，属于毫秒级操作**。真正的停机时间成本仍然是 `pm2 stop/start` + 后端代码本身也要在同一个窗口内切到读新列名（不能库先改名、代码还没跟上，那样后端会直接因为查询不存在的列名而报 SQL 错误）——**这两步数据库迁移必须和对应的后端代码发布绑在同一次停机窗口里，不能分开做**。合并 2.1+2.2+2.3 一起做，预估**总停机窗口 1~2 分钟**（含确认三步 `integrity_check` 都通过、后端代码同步发布、健康检查轮询）。

**双字段兼容期方案**（如果不想承受"客户端没升级完就看不到投聊号"的风险，建议采用）：数据库层面完成改名后（干净），**后端 API 响应层临时双写**：
```js
// 伪代码示意，不是本次要执行的改动
{ ...user, touliao_id: user.touliao_id, wechat_id: user.touliao_id }
```
等确认线上四端存量版本都已经升级到能读 `touliao_id`（可以在后端埋点统计新旧字段被访问的比例），再摘掉 `wechat_id` 这个兼容别名。这样数据库改名和客户端发布解耦，不需要卡着"这一分钟必须四端一起上线新版本"。

---

### 3. 四端同步发版需求汇总

| 改动 | Web | Android | iOS | Electron |
|---|---|---|---|---|
| 阶段1/2（注释/CSS类名） | 不需要（集中部署） | 不涉及 | 不涉及 | 复用Web代码，同Web |
| 阶段3（`vxinId`→`touliaoId` JSON key，双写期） | 建议升级到读新key，不强制 | 同左 | 同左（只需改 `CodingKeys` 一行，改动最小） | 同Web |
| 阶段4/5（DB列改名，若不做双字段兼容） | **必须**同批升级 | **必须**同批升级 | **必须**同批升级 | **必须**同批升级 |
| 阶段4/5（DB列改名，做双字段兼容） | 可以错峰升级 | 可以错峰升级 | 可以错峰升级 | 可以错峰升级 |
| 阶段6（数据库文件改名） | 不涉及（后端内部路径） | 不涉及 | 不涉及 | 不涉及 |

**结论：只要做双字段兼容期（强烈建议），四端不需要被迫同步发版**；不做兼容期的话，Android/iOS 尤其要考虑 App Store/应用商店审核周期——iOS 审核有时要等几天，"数据库改名当天四端必须一起过审上线"在实践中几乎不可行，所以双字段兼容期不是"锦上添花"，是这个改造能不能落地的前提条件。

---

### 4. 如果不改，存在哪些商标和合规风险

供你判断优先级，不是危言耸听式的夸大：

1. **商标层面**：`wechat_id`/`wechat.db` 这类命名不是用户可见的品牌展示（第十五节已确认界面文案统一是"投聊号"），**普通用户使用产品完全看不到这些命名**，不构成"假冒微信品牌误导消费者"这类直接商标侵权。真正的风险场景是**代码审计/尽调**——如果 touliao 未来要融资、被并购、或者被第三方安全公司/监管机构做代码级审计，一个审计方一眼就能看到数据库表里字段叫 `wechat_id`、主库文件叫 `wechat.db`，容易引发"这个项目是不是抄袭/山寨微信代码"的第一印象质疑，即便深挖后（就像第十五节做的那样）能证明不是直接复制代码、只是命名沿用，**这种"需要额外解释澄清"的尽调摩擦本身就是一种商业风险**（拖慢融资/并购流程、增加审计方的怀疑起点）。
2. **合规层面**：数据库字段名本身不涉及用户隐私合规（GDPR/个人信息保护法关心的是"存了什么数据、怎么保护"，不关心"这一列叫什么名字"），**这条不是一个真实的数据合规风险点**，不需要以"合规必须整改"的紧迫性去推动。
3. **产品/品牌一致性层面**（不算严格意义的"合规"，但是相关的现实考量）：如果 touliao 后续要做对外技术分享、开源部分组件、或者在技术团队招聘/面试中把这部分代码作为作品展示，`wechat_id` 这类命名会需要额外解释"这是历史遗留，不是抄的"，是一种可以避免的沟通成本。
4. **对内风险**：这次搜索发现的 `vxin-user` 二维码 `type` 值残留（已处理一半），如果未来同一团队的姊妹项目 vxin 的扫码逻辑也识别这个 `type` 值，两个独立 App 的二维码会互相"可读"——这是本节里**唯一一个有具体、可复现产品逻辑影响**的点（不是抽象的"品牌不一致"），第十五节已经指出过，这里重申其重要性高于其它纯命名残留项。

**一句话总结**：这次命名残留**不是紧急合规风险**，是一个"尽调摩擦成本"+"内部沟通成本"的问题，优先级应该低于本报告里所有 🔴 和大部分 🟡 项；建议按上面的分阶段计划，先把零风险的阶段1/2（本周内）和阶段3（双写观察期）做掉，阶段4/5/6（数据库改名）合并进下一次本来就要做的、有明确业务动机的版本发布窗口里一起做，不建议单独为了这件事排一次发版。

以上均为方案设计，**未执行任何代码改动**，具体实施顺序需要你确认后再排期。

---

## 二十、本轮收尾：交接记录（2026-08-30）

> 面向"三个月后打开这份文档"的读者写的。覆盖从 `pre-audit-fixes` tag 到本次收尾，整个审计+修复轮次的最终状态。commit hash 均可用 `git show <hash>` 核实，本节不重复贴代码。

### 工作区状态

写这节时曾经"不干净"，随后已分三组提交完毕：`5757116`（消息列表游标分页四端改动，含`mentions-cursor-pagination.test.js`）、`b8ed8ad`（`deploy/restore-drill.sh`）、本节所在的`AUDIT.md`更新单独一组。三组commit hash均可用`git show`核实。

- 消息分页改动**已确认完全向后兼容，不需要四端同步发版**：`before`/`beforeId`都不传时走原有offset分支（SQL逐字未变），旧客户端请求处理无任何变化；响应新增的`hasMore`字段，Android(`AppModule.kt`全局`Json`配了`ignoreUnknownKeys=true`)/iOS(`Decodable`默认行为)都会静默忽略，不会报错、不会空白、不会重复消息。后端可以先上线，客户端各自按节奏升级
- Android已编译通过（`./gradlew :app:compileDebugKotlin`）、Web已浏览器验证；**iOS本机无Xcode未编译**，但`.github/workflows/ios-build.yml`会在push到main且改动路径匹配`ios/**`时自动触发，在iOS模拟器上编译+跑`TouliaoTests`单元测试，不依赖任何签名/部署secret，push后去Actions标签查看这次commit的运行结果即可，**不是完全没人验证过，只是本机没法验证**
- 7个`backend-v2/test/core-*.test.js`+`ws-load-test.js`——**不是本轮产生的**，从本轮最早介入这个项目时就已经是未跟踪状态，全程没有碰过内容，按要求原样留着，未提交

### 已修复项

| 问题 | 修复方式 | commit | 验证状态 |
|---|---|---|---|
| pm2应用日志无限增长，`pm2-logrotate`模块未装 | `pm2 install pm2-logrotate` | 无commit（服务器直接操作，非仓库文件） | 已确认模块在线运行（`pm2 list`可见） |
| GitHub Actions部署流水线secret未配置却显示绿色成功，误导性 | secret检测+未配置时显式warning而非静默continue-on-error | `7b8af60` | 已改代码；**secret本身仍未配置，见下方遗留风险** |
| 图片上传未剥离EXIF/GPS，定位信息随图外泄 | `sharp`自动orient后重编码剥离metadata | `b298a0c` | 已实现 |
| Web端全局请求无超时兜底，挂起请求无限期悬挂 | axios全局20s超时 | `ef7101c` | 已实现 |
| Electron休眠唤醒后要等pingTimeout(20s)才重连 | `powerMonitor`系统信号，唤醒瞬间通知渲染层检查连接 | `5c1e1c2` | 已实现 |
| 扫码加好友：新旧二维码`type`值不兼容 | 客户端兼容新旧两种type值 | `661eeaa` | 已实现 |
| 登录无限流/无验证码，暴力破解/撞库风险 | 自建SVG图形验证码，四端接线 | `c105d9a` | 已实现 |
| 改密码/token过期后，已建立的WS连接不会立即失效 | 服务端主动断开旧连接 | `c150942` | 已实现 |
| `setup.sh`部署脚本漏配`ADMIN_USERNAME`/`ADMIN_PASSWORD`，照文档走完会导致生产进程启动即崩溃 | 补齐必填环境变量生成 | `0d2d2e7` | 已实现，`AUDIT.md`十六.2仍建议统一到`setup-new-server.sh`（见待办） |
| 备份脚本只确认文件生成、不验证能否真正恢复 | 备份后跑`PRAGMA integrity_check`+行数比对 | `3f7326c` | 已用真实数据+构造损坏文件两种场景验证 |
| 备份**从未被调度**（本系列唯一🔴），1000人量级生产库无自动恢复点 | 装`/usr/local/bin/touliao-backup`+crontab每日03:00 | 无commit（服务器直接操作） | 已确认crontab生效，另有独立`deploy/restore-drill.sh`真实跑通过一次完整恢复演练 |
| 账号切换/登出后推送token未彻底解绑，存在"串号推送"（本系列🔴重点发现） | 切换/登出时显式解绑旧token | `a2a728b` | 已实现 |
| 生产指标越限只能靠人主动开后台看，无主动告警；无磁盘空间检测 | 复用备份脚本的Telegram约定，越限15分钟冷却推送；新增磁盘检测 | `5818297` | 代码已实现，**但生产`.env`从未配置`ALERT_BOT_TOKEN`/`ALERT_CHAT_ID`，目前是"哑火"状态**（commit信息里自己写明了），需要申请Bot Token才能真正收到推送——见下方待办 |
| Electron更新元数据Ed25519验签代码已写但公钥仍是占位文本，纵深防御从未真正生效 | 生成真实密钥对+删除"未配置则回退TLS"降级路径+启动自检+打包时强制校验 | `2128918`+`5f85634` | 真实构建+5项对抗测试（篡改/删sig/换错公钥/不配私钥/产物缺公钥）全部验证通过，见十七.8 |
| Android自动更新：SHA-256/APK内版本号/降级检测三道校验缺失 | 详见十七.9 | `8cc28cd` | 真实APK+aapt2独立读取+真实数据跑4项对抗测试通过 |

### 已决策不修 / 暂缓项

- **消息撤回无时限**——产品设计选择，代码注释明确写"任意时长均可撤回"，不是遗漏（十一.5）。如果以后要改成微信式限时窗口，是产品决策不是bug修复。
- **Android更新version.json不做Ed25519签名**——`ApkInstaller.isSignatureMatch()`已提供不依赖json/下载host完整性的独立信任锚点（比对对象是设备本地已安装应用的签名证书，攻击者需要真正的`touliao-release.jks`私钥才能通过），加签名的边际安全收益小于新增一整套密钥管理运维负担的成本（十七.9）。**前提条件**：这个结论成立的唯一条件是`isSignatureMatch()`保持强制、不被弱化，如果以后有人为兼容性把它改成可选，这条决策需要重新评估。
- **SSH纵深加固（fail2ban/PermitRootLogin收紧）暂缓**——评估vxin密钥暴露风险时顺带查过：`PasswordAuthentication no`已是关的，但`PermitRootLogin yes`+**没有装fail2ban**，日志显示背景扫描量级正常（两周内5253次失败尝试，符合互联网背景噪音）。因为密码登录已关闭，暴力破解实际不可行，这轮没有优先处理，纯粹是"查过、记录了、这轮没排上"，不是评估后认为不需要——建议下一轮找时间装上fail2ban，成本很低。

### 待办排期项（未实现，附方案与工作量）

| 项目 | 现状 | 方案位置 | 工作量估算 |
|---|---|---|---|
| Electron/Capacitor端Token存localStorage | 只有方案，未实现 | 十八节，推荐"keychain-as-storage-only"方案 | 方案里已给出文件清单+工作量估算，建议直接翻十八节 |
| `wechat.db`/`wechat_id`命名残留 | 只有方案，未实现；`vxin-user`二维码type值已客户端兼容（`661eeaa`），后端仍吐旧值未改 | 十九节，含完整迁移+回滚脚本、停机估算 | 阶段1/2(改内部变量/注释)零风险可本周做；阶段3双写观察期；阶段4-6数据库改名建议并入下次有业务动机的发版窗口，不单独排期（十九节结论） |
| 批量数据导出UI（面向管理员/合规） | 无方案，仅发现"底层SQLite天然可迁移，但没有一键导出UI"（十六.5） | 无 | 未评估，需要先确认是否有实际合规/客户需求再决定要不要做 |
| Mac/Linux桌面端CI workflow缺失 | 只有Windows有`windows-build.yml`，Mac/Linux是本地手动`npm run build:mac/linux` | 十七.9实现Android校验时顺带记录的现状，无补齐方案 | 如果需要CI化，可复用`windows-build.yml`的secret写入/清理模式，估算半天到一天 |
| `docs/`目录里剩余的vxin文档**（本轮请求但未执行，遗留）** | 三件事都已经明确方案、你也已经确认要做，但对话中途转向了Electron签名工作，**没有回来处理**：①`TODO-lockscreen-notification.md`5处vxin路径引用改写成中性表述；②`docs/archive/`两份历史文档（`优化完成报告_20260611.md`/`快速验证指南.md`）直接删除；③新发现的7份纯vxin文档（`DESIGN_TOKENS_CROSS_PLATFORM.md`/`HOT_UPDATE_PLAN.md`/`HOT_UPDATE_POC_SKELETON.md`/`offline-message-cache-contract.md`/`PRE_LAUNCH_AUDIT_20260713.md`/`SECURITY_AUDIT_20260807.md`/`云存储配置步骤.md`）逐份复制到`/root/vxin-1.0/docs/`后删除 | 已在对话记录里给出具体行号方案 | 半小时以内，纯文件操作，下次会话直接执行即可 |
| Telegram告警Bot Token未申请 | 代码已就绪（`5818297`），纯配置缺口 | 无需方案，申请Bot Token+写入`.env`即可 | 10分钟 |
| 五节里点2/3：iOS修改密码/注销账号无UI入口、群邀请链接缺Associated Domains配置 | 后端接口已就绪，纯前端/配置缺口；注销账号可能是App Store审核硬性要求 | 无方案，需要先排优先级 | UI入口：小；Associated Domains：配置级，小 |
| 五节里点4：三端钱包充值无真实支付网关 | 代码自称"占位" | 无 | 需要产品先决定是否接入真实支付，不是纯技术任务 |
| 五节里点7/8/9：Web i18n名存实亡、`p14-deep-optimization.routes.js`死代码、红包路由重复挂载 | 均为工程债，非安全风险 | 无 | 均为小工作量清理，优先级最低 |

### 遗留风险清单（按严重程度排序，说明触发场景）

1. **🔴 内容审核完全缺失**——P12 mock已下线且注释明确"极具误导性"，生产环境没有任何真实运行的内容审核机制。**触发场景**：任何违规内容通过消息/朋友圈发布，没有自动拦截，完全依赖举报后人工处理。是否需要补，取决于业务合规要求（五节.1），不是纯技术决策。
2. **🟡→需关注 找回密码三端不一致，Android/iOS仍是弱验证强度**——Web已经因为"6位邀请码重置密码"存在账号接管风险主动下线自助重置（P1-01），只留人工处理；Android/iOS仍在用同样弱强度的邀请码方式自助重置。**触发场景**：攻击者能猜到/枚举6位邀请码时，可在Android/iOS上接管任意账号——Web已经认定这个风险不可接受并关闭了这条路，移动端还开着，是三端不一致造成的实际风险敞口（五节.5）。
3. **🟡 CI自动部署secret依然未配置**（`7b8af60`只是让它诚实报错，没有让它真正能用）——`DEPLOY_SSH_KEY`/`DEPLOY_USER`/`DEPLOY_SERVER_HOST`在Windows/Android/后端三条部署流水线上都缺失。**触发场景**：需要紧急回滚时，代码质量很高的自动回滚逻辑**从未实战验证过**，真出事故时能不能真的按预期工作是未知数，所有生产变更目前依赖人工直接操作服务器。
4. **🟡 授权/许可控制完全没有**——全代码库无license/用户数上限/部署实例控制机制（十六.4）。**触发场景**：如果商业模式依赖"按部署收费"，当前没有任何技术手段阻止客户绕过授权自行扩容或转售部署。
5. **🟡 SSH无fail2ban**——见上方"已决策暂缓"，触发场景：目前密码登录已关闭使得实际利用门槛较高，但如果密钥认证出现漏洞/误配置，缺少自动封禁是唯一还没补的一层。
6. **信息层面：vxin密钥存放路径曾经在touliao公开仓库暴露过约2个月**（已删除引用，`e873a46`）——历史commit里仍留痕，是否要做git history清理，方案已给过（未执行，等待用户明确授权force-push）。**触发场景**：如果vxin那边的`/root/vxin-release-keystore/`没有因为这次暴露做纵深加固，且有人专门去挖touliao的历史commit，仍能拿到这条路径信息（不是密钥本身）。

---

以上是本轮收尾的完整交接记录。三个月后如果要继续这个项目，建议阅读顺序：本节 → 十六至十九节（私有化部署/部署配置/两个专项方案）→ 五节（产品侧待决策项）→ 其余章节按需查阅。

---

## 二十一、事故记录：手动部署Web时`rsync --delete`误删`config.json`（2026-08-30）

**背景**：本轮修复代码全部合入main、CI（CI Gate/Android Build/E2E Web Tests/iOS Build/自动部署投聊后端内嵌门禁）全绿后，因`deploy.yml`缺`DEPLOY_SSH_KEY`等secret（见二十节"已修复项"表）不会自动部署，手动在生产服务器上执行部署：备份当前`/var/www/touliao-web` → `rsync -a --delete /root/touliao/web/dist/ /var/www/touliao-web/` → `nginx -s reload`。

**事故**：`rsync --delete`把`/var/www/touliao-web/config.json`删掉了。这个文件**不是Vite构建产物**（`web/dist/`里没有它），是运维单独手动维护、部署在Web根目录下的运行时远程配置文件——四端（Web/Electron/Android/iOS）启动时都会去请求`https://touliao.cc/config.json`拉取当前后端地址（见`web/src/utils/config.js`"远程配置模块"，`desktop-electron/src/main.js`的`CONFIG_URLS`同理）。`rsync -a --delete`语义是"让目标目录内容与源目录完全一致，目标里多出来的一律删除"——`config.json`只存在于目标目录、源目录（`dist/`）里没有，天然会被当成"多余文件"清掉，这是`rsync --delete`的正常行为，不是bug，是**用这个命令部署一个"目标目录里混有非构建产物文件"的场景时的必然结果**。

**发现与恢复**：`--delete`执行后立即检查`config.json`是否还在，发现已被删除；从刚做的备份`/var/www/touliao-web.bak-20260830-135323/config.json`原样恢复；用`diff`比对备份目录与当前目录的完整文件列表，确认**仅这一个文件受影响**，没有其它遗漏。恢复后用真实公网请求（`curl https://touliao.cc/config.json`）确认HTTP 200、内容正确。

**影响范围**（2026-08-30事后用文件时间戳+nginx access log精确核实，更正了最初"约几分钟"的粗略估计）：真实缺失窗口是**13:53:23（备份创建，即将执行删除）到13:53:41（恢复完成），共18秒**。查了这18秒内nginx access log的全部请求（不限于`config.json`）：**0条记录**——这18秒内没有任何客户端访问过服务器，不是"侥幸躲过404"，是这个窗口内根本没有流量经过，真实影响为零。

**根因**：`deploy/README.md`和`deploy.yml`里描述的"标准"部署流程都是**全新一键部署**（新服务器/全新构建），没有一份文档描述"已经在跑的生产环境，手动更新Web这一步该用什么命令"——这次是凭经验现场决定用`rsync -a --delete`，没有意识到`config.json`是运行时另外维护、不随构建走的文件。这是一个**文档空白**导致的操作事故，不是这次改动本身的代码问题。

**给以后部署的人的建议**：
1. 手动更新生产Web时，**不要用`rsync --delete`直接对着`/var/www/touliao-web`根目录做全量同步**——这个目录混有构建产物和运行时配置文件（至少`config.json`一个，未来可能更多），`--delete`语义和这种混合目录天然冲突
2. 更安全的做法：`rsync -a`（不带`--delete`）只增量覆盖构建产物，让`config.json`这类运行时文件保持原样不受影响；或者显式排除：`rsync -a --delete --exclude=config.json ...`
3. ~~更彻底的做法（建议，未执行）~~ → **已执行**（2026-08-30当天）：把`config.json`挪到独立目录`/var/www/touliao-runtime-config/`，nginx的`location = /config.json`改为`alias`指向新路径，公开URL不变。旧路径原文件`mv`成`/var/www/touliao-web/config.json.bak-20260830`保留24小时作兜底（不是`rm`，且这个文件名不会被任何请求匹配到，也不影响以后的`rsync --delete`——真删掉的话下次部署顺手就清了）。迁移后`/var/www/touliao-web/`目录**只剩纯构建产物**，跟`web/dist/`内容可以做到完全一致，`rsync -a --delete`从此对这个目录是安全的
4. ~~`deploy/README.md`应该补一节~~ → **已补**：`deploy/README.md`新增"已有生产环境的日常更新（手动，不走setup.sh）"一节，写清后端/Web各自的正确更新命令、`config.json`新位置、以及为什么不放在构建产物目录里

**验证**：以上是真实发生的事故+真实的恢复过程记录，不是事后补写的"应该注意"清单。改用新alias后用`curl https://touliao.cc/config.json`完整比对过响应内容+响应头，与事故前md5一致（`9b15fc5d5b5768856bb7c6ea440b5efe`）。

---

## 二十二、事故记录：8.1.0 Windows启动崩溃（`Cannot find module`）+ 修复过程中连带发现两个`@electron/asar`跨平台路径分隔符bug（2026-08-30）

**背景**：8.1.0在CI里"构建成功+自我验证签名通过"，真实用户在Windows上安装后启动即崩溃：
```
Error: Cannot find module '../scripts/lib/validatePublicKeyPem'
Module path: resources/app.asar/src/main.js
```

**根因**：`validatePublicKeyPem.js`放在`desktop-electron/scripts/lib/`下，而`package.json`的`build.files`只打包`src/**/*`和`assets/**/*`，`scripts/`从未进入过`app.asar`。`main.js`用`require('../scripts/lib/validatePublicKeyPem')`引用它，产物一启动就`Cannot find module`。

**为什么此前测试完全没发现**：`afterPack.js`自己也`require`同一个文件，但它是在构建机器上直接读源码（不受打包范围限制），永远能成功，给了假的信心；本环境此前也一直没有真正启动过打包后的GUI app去走`main.js`的运行时require路径——这是一个已知但直到这次才真正暴露代价的盲区。

**修复（用户给出5点要求，逐条确认后实施，commit `24afce9`起）**：
1. 模块移到`src/lib/validatePublicKeyPem.js`——`src/`是唯一会被打进产物的运行时代码边界，运行时依赖不放只在构建机器上跑一次的`scripts/`目录。
2. 排查`main.js`全部相对require：确认只有这一处和`./screenshot`，均已在`src/`内部，无同类问题。
3. `afterPack.js`反向require `src/lib/`下的文件是安全的方向（构建机器本机读源码），无需改动。
4. 新增`scripts/lib/verifyPackedRequires.js`：从`src/main.js`出发递归解析本地相对`require()`依赖树，逐个确认真的打进了`app.asar`，缺失就让`afterPack`直接throw、终止构建。
5. 版本号8.1.0→8.1.1，重新发版。

**过程中连续暴露的两个`@electron/asar`真实Windows bug**（本地Linux环境完全测不出来，只有真Windows CI才会炸，desktop-v8.1.1标签因此连续failed了两次才成功，commit `9dedd7f`、`75e1d76`）：
1. `listPackage()`在Windows上内部用`path.join()`拼路径，返回的是`\src\main.js`这种反斜杠路径，而检查工具里用`path.posix`构造的候选路径全是正斜杠，永远匹配不上——把刚移好、真实存在的文件全部误判成缺失。修复：路径比对前统一把反斜杠转正斜杠。
2. 修完①后又暴露：`@electron/asar`的`extractFile()`内部`getNode()→searchNodeFromDirectory(path.dirname(p))`用Node内置`path.sep`对目录部分做split，Windows上`path.sep`是`\`；传入正斜杠多层路径（如`src/lib/x.js`）时`path.dirname()`返回的`src/lib`依然是正斜杠，按`\`split整段切不开，被当成一个不存在的目录名去查，实际存在的文件也报"not found in this archive"。只有单层路径（如`src/update-public-key.pem`）凑巧不受影响，这也是这个bug至今没被发现的原因。修复：`extractFile`调用前统一转换成当前系统原生分隔符（`toNativeAsarPath()`），`afterPack.js`原有的pubkey提取也顺手改成`path.join()`防止以后文件挪进子目录再踩一次。

**验证**：
- 本地用真实的两个asar分别验证：修复前遗留的`dist/linux-unpacked/app.asar`能精确复现原始报错；用当前`src/`重新打包出的asar结果为空。
- 用`path.win32`直接模拟Windows路径语义，确认两个bug的复现机制和修复都成立（非猜测）。
- desktop-v8.1.1第三次构建（`75e1d76`）真实Windows CI全绿，`afterPack`日志打出`[afterPack] 更新公钥+签名私钥+main.js 依赖闭包均校验通过（win32/1）`，证明新检查真的执行了而不只是构建没崩。
- 部署后用公网curl独立验证（不信CI日志）：`updates/latest.yml`（内容`version: 8.1.1`）、`updates/latest.yml.sig`、版本化安装包、直链均HTTP 200；用`crypto.verify()`对新鲜下载的`latest.yml`+`latest.yml.sig`独立验签，`signature valid: true`。

**仍未验证的部分（如实披露）**：这套新增的静态依赖闭包检查只能证明"模块解析路径正确"，无法证明"app真的能启动且无其它原因崩溃"——本环境依然没有真正的Windows/GUI设备去实机安装验证，需要等真实用户或有Windows机器的人确认8.1.1能正常启动。

---

## 二十三、修复：通话状态多端不同步 + iOS 来电推送从未真正送达

**背景**：用户报告真实场景——A呼叫B，B在网页端点了拒绝，但B的移动端仍然显示"通话中"。同时排查发现 iOS 端锁屏收不到来电通知的独立问题。两个问题都用只读排查（fork并行调查）先定位根因，用户确认后才动代码。

### 问题1：通话状态多端不同步

**根因**（`backend-v2/src/realtime/handlers/call.js`）：每个 socket 连接都会 `socket.join('user_${userId}')`（`realtime/index.js:171`），同一用户的所有设备本来就在同一个 room 里，机制上具备"广播给自己其他设备"的能力，但 `call:response`（接听/拒绝）、`call:end`（挂断）、`call:request`（发起呼叫）三处 handler 都只把状态变更 `io.to('user_${对方}')` 广播给了对方，从没往操作者自己的 `user_${自己}` room 发过——B 在Web拒绝，B的手机端永远收不到通知。这是同一个模式的bug，在3个地方重复出现，不是3个独立原因。

**修复**（三处都补，不只是拒绝那一处）：
1. `call:response`（约203行后）：接听/拒绝后，用 `socket.to('user_${userId}')`（注意是 `socket.to` 不是 `io.to`，见下方"避免回声"说明）复用已有的 `call:end` 事件，通知操作者自己的其他设备收起来电/通话界面，`reason` 新增 `answered_elsewhere`/`rejected_elsewhere` 两个值。
2. `call:end`（约259行）：挂断后同样用 `socket.to('user_${userId}')` 发一份跟发给对方完全一致的 `call:end`，通知挂断者自己的其他设备。
3. `call:request`（约154行）：新增事件 `call:outgoing`（`{to, type, callId}`），用 `socket.to('user_${userId}')` 通知呼叫方自己的其他设备"我正在用另一台设备呼叫"——此前这个场景完全没有任何通知，是新增能力不是修复已有能力。

**避免回声**：三处新增全部用 `socket.to()`（Socket.IO 语义：广播给 room 内除当前 socket 外的所有连接）而不是 `io.to()`（会包含当前 socket 自己）。这个机制差异不是凭经验判断的，写了一个真实的 socket.io server + 两个真实 client 连接做过对照实验（同一 room 两个连接，`socket.to()` 触发方0次收到/另一方1次收到；`io.to()` 对照组触发方1次收到），确认 `socket.to()` 确实排除发起者自己，避免操作设备收到自己动作的回声后重复处理（比如拒绝后又触发一次拒绝逻辑）。

**四端客户端改动**：`call:end`/`call:response` 复用现有事件，四端理论上不需要新增监听（客户端处理"收起来电/通话界面"的逻辑天然挂在收到 `call:end` 就执行，不区分发起方），只需要确认 `reason` 文案覆盖新增的 `answered_elsewhere`/`rejected_elsewhere`（否则会退化成通用文案，功能不受影响，只是提示语不够精确）。`call:outgoing` 是全新事件，四端都需要新增监听（Android/iOS/Web/Electron），用于让呼叫方的其他设备进入"呼叫中"状态、避免重复拨号——这部分客户端改动这次没有一并做，只完成了后端广播这一侧。

**已知遗留、这次不修**（按用户要求记入待办）：`activeCalls` 是纯内存 `Map`（`call.js:32`，无 Redis/DB 镜像），进程重启会丢失全部进行中通话的状态，没有任何恢复逻辑。这次的修复解决的是"状态变了、广播覆盖面不够"，不解决"状态存储本身是单点无持久化"这个更底层的问题——后续如果要做，方向是把 `activeCalls` 迁到 Redis（多进程/重启安全），或至少在进程重启时对"标记为ongoing但早已超时"的悬空 `call_logs` 记录做一次启动时扫描清理。

### 问题2：iOS 来电推送从未真正送达

**根因**（`backend-v2/src/utils/push.js`）：`pushCallInvite()` 查询设备 token 用的是 `platform IN ('android','ios','ios_voip')`，唯独漏了 `ios_apns`——而 iOS 客户端注册 token 时用的 platform 实际就是 `ios_apns`（真实64位APNs token，直连APNs用）。对照同文件里 `pushToUser()`（普通消息推送）早就优先查 `ios_apns` 并直连 `api.push.apple.com`（这正是之前"锁屏收不到消息通知"那次真实修复留下的模式，`AppDelegate.swift:42-44` 注释里写明原因是 FCM→APNs 会有 third-party-auth-error），但 `pushCallInvite()` 从没跟进这个修复，来电推送因此从未真正送达过 iOS 设备（不只是没弹CallKit界面，是连普通通知横幅都没有）。

**修复**：
1. `pushCallInvite()` 的查询加上 `ios_apns`。
2. 新增 `sendIosCallPush()`，复用 `sendIosPush()` 同款 HTTP/2 直连 `api.push.apple.com` 的逻辑（同一把 `.p8` 密钥/`getApnsVoipToken()`），payload 用 `aps.category='INCOMING_CALL'` + 顶层 `from`/`callerName`/`callId`/`callType` 字段——字段名跟 `AppDelegate.swift:89-92` 读取 `userInfo` 的字段名逐一对应（早就写好在等这几个字段，此前从未真正收到过）。
3. `ios_voip`/`sendVoipPush()`/`VoipCallManager.swift` 里从未被调用的 CallKit 死代码这次都没动，是另一件事。

**待人工验证**（代码/CI无法完成）：生产服务器 `.env` 里 `APNS_P8`/`APNS_KEY_ID`/`APNS_TEAM_ID` 三个值是否真的配置且有效，已给出不打印密钥内容的检查命令（含用现有代码同款 `require('dotenv').config()` + `crypto.createPrivateKey()` 做结构性校验）。

---

## 二十四、新增：AI 助手 Turn 生命周期跟踪（Codex Thread/Turn/Item 模型落地）

**背景**：AI 助手（`backend-v2/src/modules/ai-assistant/assistant.service.js`）此前调用大脑（OpenClaw/Hermes）出错时只在日志里 `console.warn`，没有任何持久化记录——出问题只能翻服务器日志，无法按会话/时间统计成功率、耗时、token 消耗，也查不出历史上某次失败的具体原因。这次给"一次用户输入 → 一轮 AI 处理"这个过程补上结构化的生命周期记录。

**改动**：
1. `backend-v2/src/db/schema.js` 新增 `ai_turns` 表：`id`/`conversation_id`/`bot_id`/`status`（`started`/`completed`/`failed`）/`input_preview`/`output_preview`（各截 200/300 字，避免整段对话内容膨胀表体积）/`token_usage`/`duration_ms`/`error`/`created_at`/`completed_at`，加 `(conversation_id, created_at)` 索引供按会话查历史。
2. `askAI()` 返回值从纯文本 `string` 改成 `{content, tokens}`（`tokens` 取 `data.usage.total_tokens`，取不到则记 0），供上层记录 token 用量。
3. `doReply()` 包一层 try/catch：处理开始前先插入 `status='started'` 的 turn 行；正常返回后 `UPDATE` 为 `completed` 并写入耗时/token/回复预览；抛错（大脑超时、返回错误文本等）则 `UPDATE` 为 `failed` 并写入截断后的错误信息，再重新抛出（不改变原有的降级行为，调用方该怎么处理错误还是怎么处理）。
4. 所有 `ai_turns` 的写入都用 `.catch(() => {})` 静默吞掉——这张表是**观测用**的旁路记录，它自身写失败绝不能影响主流程（AI 回复本身能不能发出去）。

**为什么现在做**：纯粹是可观测性补课，不改变 AI 回复的用户可见行为（`replyMsg`/广播逻辑完全没动），风险面很小；`ai_turns` 表是全新表，不影响任何现有查询。

**已验证**：`node --check` 语法通过；全量测试 `npm test`（69 suites / 561 passed / 1 skipped）跑通，无回归。

**待办（这次没做）**：
- 没有任何地方读取/展示 `ai_turns` 数据——目前只写不读，价值要等后续接一个查询接口或统计脚本才能兑现。
- 没有清理策略，`ai_turns` 会无限增长，量大后需要加 TTL 清理或归档（参考 `message_reactions` 等表目前也没有这类清理，是全仓一致的已知缺口，不是这次新引入的）。

| 群通话结束落库 `group_call_logs`(status=ended + participant_count,`realtime/handlers/groupCall.js` endCall),但历史列表(`users.service.js` `getCallLogs`)只查 `call_logs`(1 对 1),四端历史页(Web `CallHistory.jsx` / Android `CallHistoryScreen` / iOS `CallHistoryView`)也只调 `/api/users/me/call-logs` → **群通话记录永远不展示**。 |
| 改动方案(先不做):① `getCallLogs` 用 `UNION ALL` 合并 `group_call_logs`(映射同字段集:type/status/started_at/ended_at/duration/participants),或新增独立接口;② 四端 UI 区分展示"1 对 1 / 群通话"两种条目(群通话无 peer_id,点击不回会话,展示参与人数);③ 注意 `group_call_logs` 的 status 只有 ongoing/ended 两值,与 `call_logs` 的 missed/canceled/rejected/completed/interrupted 语义不同,前端状态映射需新增分支。 |

| 通话历史页缺少事件驱动刷新:Web `CallHistory.jsx` 只在组件挂载时拉取(无 socket `call:end` 监听),Android `CallHistoryViewModel`/iOS `CallHistoryView` 只在进入页面时加载——**停留在历史页时通话结束,列表不会自动出现新记录**(实测:通话中停留在"通话记录" tab,挂断后列表不刷新,需切换 tab 或刷新页面)。 |
| 改动方案(先不做):Web `CallHistory.jsx` 监听 socket `call:end` 事件(或 Home 层在通话弹窗关闭时 bump `callsRefreshKey`)触发重新拉取;Android/iOS 在 CallManager 结束回调里刷新 ViewModel(可随移动端发版批次)。 |

同批次还补了 6 个核心流程回归测试（`core-idor`/`core-friend-relation`/`core-moments-like`/`core-moments-post`/`core-register-login`/`core-send-message`，覆盖越权访问/好友关系/朋友圈点赞发布/注册登录/发消息）和 1 个 1000 并发 WebSocket 压测脚本（`test/ws-load-test.js`，独立子进程+专用SQLite文件+专用端口3099，全程不碰生产 `wechat.db`/生产端口），均已跑通，随本次一并提交。

---

## 二十五、通话模块完整收尾（2026-09-01）：E2E 测试 + 推送防护体系 + 破坏验证

### 1. 本轮涉及的修复项汇总（含 commit）

| 修复项 | 根因一句话 | commit |
|---|---|---|
| iOS 来电推送 platform 漏项 | `pushCallInvite` 查询 `IN ('android','ios','ios_voip')` 漏 `ios_apns`——而 iOS 客户端注册的 platform 实际就是 `ios_apns`，来电推送从未送达（锁屏连普通横幅都没有） | `4b71faa` |
| 个推来电通道缺失 | `pushCallInvite` 只查 FCM/APNs，无 `getui` 分支——国产 ROM 无 GMS 锁屏收不到来电 | `2cb5212` |
| 通话状态多端不同步 | `call:response`/`call:end`/`call:request` 三处都只广播给**对方**，从没往操作者自己的 `user_` room 发——B 在 Web 拒绝，B 的手机端永远不知道（同模式 bug 出现 3 处） | `23ad2b0` |
| 四端铃声失效 | Web 无被叫铃声/autoplay 被拦；Android 回铃音走 `STREAM_VOICE_CALL` 未先切音频模式；iOS 播放受静音键影响。修复：Web `callTones` 三音合成 + 手势栈内 `prewarmAudio()`；Android 先 `MODE_IN_COMMUNICATION` 再回铃；iOS 播放前配 `.playAndRecord` | `1817c42`（Web）+ `e1e4ad7`（移动端，随 8.1.8 上线） |
| 聊天窗口通话记录气泡 | 通话结束只落库不写消息，聊天窗口看不到通话记录。修复：落 `call_logs` 同时写系统消息（`b9fa8a2`），老客户端兼容——content 存人话文本、结构化 JSON 放 `file_url`（C 方案，`696ed3e`） | `b9fa8a2` + `696ed3e`（随 8.1.8 上线） |
| 通话历史页刷新 | Web/Android/iOS 历史页只在挂载/进入时拉取,停留在历史页时通话结束列表不自动刷新。修复:Web Home 层 call:end → bump refreshKey 静默重拉;Android/iOS 监听 CallManager stage 回落触发静默 refresh(`1ffe8b5`,Web 部署即生效,移动端随下版本) | `1ffe8b5` |

### 2. 新增防护：通话 E2E + 推送通道三层覆盖检查（`eee8cdd`）

前两轮"platform 漏项"事故（漏 `ios_apns`、漏 `getui`）暴露：**没有测试能在编码阶段拦住查询漏项**。本轮新增 17 个测试用例：

- **`test/call-e2e.test.js`（9 用例）**：真 socket 全链路（`app.listen(0)` + socket.io-client 双端连接）——呼叫→响铃→接听/拒绝→挂断→超时→断线重连→重拨覆盖，含多端双连接广播断言；`call_logs` 落库状态与消息文案逐条断言。
- **`test/push-distribution.test.js`（8 用例）**：推送通道三层覆盖检查——①运行时断言每个 platform 的发送器都被调用（漏查=零调用=红）②`DB DISTINCT platform ⊆ KNOWN_PLATFORMS` 子集守卫（新 platform 进 DB 即红）③静态扫描 `push.js` 的 SQL platform 字面量 ⊆ 声明全集。
- 测试确定性基建：`FORCE_SYNC_WRITES=1` 同步写模式（jest 下 worker flush 延迟不稳定已实证）+ `CALL_TIMEOUT_MS`/`CALL_COOLDOWN_MS`/`CALL_RECONNECT_GRACE_MS` 环境变量注入（生产默认 120s/5s/15s 不变）。

### 3. 破坏验证结论（证明测试真能拦住 bug，全部实测）

| 破坏操作 | 结果 | 拦截点 |
|---|---|---|
| 删 `pushCallInvite` 的 `'ios_apns'` | 🔴 5 failed / 3 passed | 运行时零发送断言 + 守卫2 + 守卫3 静态扫描 |
| 删 `'getui'` | 🔴 4 failed / 4 passed | 兜底推送 + 未配置直连 + 守卫2/3 |
| 插入 `platform='huawei'` token | 🔴 守卫1 红（提示「发现未声明的新 platform 值，请确认所有 pushXxx 已覆盖」） | DB 子集守卫 |
| 全部恢复 | ✅ 17/17 全绿 + 全量 82 suites / 668 pass | — |

**破坏验证抓到真实测试缺陷**：守卫1 原实现 `ALL_PLATFORMS = DB DISTINCT ∪ KNOWN`——新 platform 进 DB 会被**自动吸收进声明**，守卫恒绿、永远拦不住（`691fbb3` 修正为纯声明 + 断言 DB ⊆ KNOWN）。

### 4. 仍挂待办

| 待办 | 说明 |
|---|---|
| 群通话历史接入 | `group_call_logs` 已落库但四端历史页只查 `call_logs`，群通话记录永远不展示（方案见上，`6603058` 只记不改） |
| `activeCalls` 纯内存无持久化 | 进程重启丢失全部进行中通话状态，无恢复逻辑；方向：迁 Redis 或启动时扫描清理悬空 `call_logs` |
| Web 被叫无手势时铃声受 autoplay 限制 | 被叫无用户手势触发时 AudioContext 被浏览器暂停，来电铃可能不响；当前有手势栈预热兜底，冷启动纯被叫场景仍受限 |

> 通话历史页刷新已修复（`1ffe8b5`，见上文修复项表）。CALL_* env 注入超大值上限保护见 `353c777`。

### 5. 测试规范：新增测试后必须做破坏验证

> **新增/修改测试后，必须做一次故意破坏验证**：临时删除被测代码里一个关键分支（漏 platform、漏字段、短路逻辑），确认测试真的变红；恢复后确认全绿。没验证过"能变红"的测试等于没有测试——它可能恒绿（如守卫1 的并集吸收缺陷）、可能没连到被测代码、也可能断言方向反了。

- 破坏对象：每个新增测试对应的**核心守卫/关键路径**至少一个。
- 破坏方式：临时删改生产代码（git 可回退），不修改测试。
- 验收：①破坏后测试必须红（不是恰好绿）②红的原因必须是**该守卫/断言本身**，不是环境故障 ③恢复后全绿。
- 动机：守卫1 恒绿教训——`ALL_PLATFORMS` 从 DB 自动发现新值，DB 子集断言形同虚设，是破坏验证（注入 `huawei`）才暴露的。**恒绿的测试比没有测试更危险**（给虚假信心）。

### 6. 测试纪律：数量如实 + 用例入库 + 红灯驱动（2026-09-02 新增）

> 本次教训：「commit 472863a 单测 4 场景 PASS」写在提交说明里，仓库实际只有 2 个用例。**根因是验证与入库脱节**——本地跑过的临时用例没进 git，提交后仓库里无法复现声称的验证结果，等于基于错误信息做决策。以下三条为强制纪律：

1. **数量如实**：commit message 声称的测试场景数必须等于该 commit 实际变更的用例数。提交前自查：`git show --stat | grep test`，确认测试文件在变更列表里、用例数与声称一致；不一致就不写 PASS。
2. **用例入库**：验证用的临时用例一律落进仓库再写 PASS，哪怕先标 `it.skip` 留档。跑过但没提交的验证结果不算数。
3. **红灯驱动**：修 bug 前先写会红的用例钉住缺陷（能稳定复现），修完必须转绿才算完成；红灯用例提交留证（参考 `2cb13d5`：2 绿 2 红入库，红的即洞 A/B 的活证据）。

---

# 2026-09-02 二分插入排序改造（commit 472863a）部署前审计

- 背景：`applySyncEvents`/三端 sync 合并改为「按 server_sequence 二分插入，删除全量重排」。用户部署前要求确认三条核心风险。本审计只读代码，未改任何实现。
- 结论：Q1/Q3 风险可控（有结构性保障）；**Q2 存在两个可达的排序破坏路径，无任何断言/自愈**，且提交说明声称的「单测 4 场景」实际只提交了 2 个用例，Q2 核心场景零覆盖。

## Q1 有序性前提

| 场景 | 结论 | 证据 |
|---|---|---|
| 首次加载/分页是否按 server_sequence 有序 | 实质有序，但不是按 seq 排的：服务端按 `(created_at, rowid)` 升序返回，`server_sequence` 在写 worker 单线程事务内与消息 INSERT 同序分配（rowid 序==seq 序），旧数据按 rowid 回填 —— 两序等价依赖该不变式，客户端无显式验证 | messages.service.js:65/69、worker.js:36-54、schema.js:589 |
| 上翻历史插头部还是二分 | 插头部，不走二分：`setMessages(prev => [...data, ...prev])`，前提是 data 全部早于数组头（服务端复合游标保证） | ChatWindow.jsx:843 |
| 撤回/编辑就地处理后有序性 | 安全：按 id 就地改字段 / splice 移除，不移动其他元素 | messageSync.js:42-47 |
| 服务端乱序 | sync 事件表 `ORDER BY e.server_sequence ASC`；历史按 (created_at,rowid)。**真正的破序源不在服务端，在客户端 pending 混排（见 Q2）**。dev 无有序断言、无自愈 | sync.service.js:79 |

## Q2 pending 消息（核心风险 —— 有两个可达洞）

1. **二分比较遇 pending**：`(result[mid]?.server_sequence || 0) < seq` —— pending 视为 seq 0，恒小于真实 seq，搜索越过它向右；尾部 pending 场景（当场发送失败）插入位置正确。Android 同（Long 默认 0，无 NPE）。证据：messageSync.js:33-38、ChatViewModel.kt:1023。
2. **洞 A —— outbox created_at 混排把 pending 锚到数组中部/头部**：重开会话时 `merged = [...data, ...stillPending].sort(created_at)`（ChatWindow.jsx:622-624），pending 的 created_at 是**客户端时钟**（:1362），与服务端时钟混排。旧 outbox（几天前失败）/时钟偏差 → pending 落数组中间。一旦中间有 pending，数组 seq 不再单调，二分中位探测可能跳过正确落点 → 新事件插错位（例：`[M1(1),M2(2),P(0),M3(3)]` 插 seq1.5 会落到 P 之后而非 M1/M2 之间），且永不自动纠正。实际触发面窄（catchUp 事件 seq 通常都大于数组已有最大值，ChatWindow.jsx:652-654 游标从 maxSequence 起），但代码层无保证。iOS 同样按 createdAt 混排（ChatViewModel.swift:790/813）。
3. **洞 B —— 旧 pending 重发成功后真实消息带最新 seq 却留在原位**：ack 是就地替换（Web ChatWindow.jsx:1246、iOS :1015-1021 同），pending 若因洞 A 停在中间/头部，重发成功消息（seq 最新）就卡在比它旧的上下文中，顺序颠倒、三端均有、直到重开会话才被服务端快照纠正。**自动重发路径（重连 healedOnReconnect :1265-1277、进会话 healedOnMount :1285-1297）会主动触发**。

## Q3 切会话

- ChatWindow 以 `key={activeConv.id}` 渲染（Home.jsx:1023/1163）→ 切会话=整组件重挂载：A 实例卸载时 state 随实例销毁、in-flight 请求被 cleanup `ac.abort()`（ChatWindow.jsx:695-696）+ `.then` 内 `ac.signal.aborted` 检查（:606）丢弃 → **A 的晚到数据结构性不可能写进 B/C 的新实例**。
- firstArrival 是会话切换 effect 内的局部变量（:590，deps :714 含 conversation.id）→ **每会话独立，非全局**；同实例内 conversation 原地变化（scrollToId 跳转等）时 effect 重跑、firstArrival 重置。
- 残余风险仅视觉级：卸载前最后微任务窗口内旧 fetch 已 setState 的瞬时帧，被新会话首次到达整体替换覆盖，不残留。

## 修复状态（2026-09-02 已修，测试 6/6 绿）

- **洞 A 已修**（`a05852b`）：messageSync 插入比较忽略 pending（透明锚点，`lowerBoundSeq`），ChatWindow outbox 合并不再按 created_at 与服务端消息混排，pending 统一排末尾、多条间按 created_at 升序。洞 A 用例转绿。
- **洞 B 已修**（`f292c72`）：同 id 就地更新与 3 处 ack 落地后做相邻 seq 校验（`violatesOrder`，忽略 pending、O(1)——依赖 seq 每会话 UNIQUE，全局乱序必含相邻逆序对），违序则取出按新 seq 重插（`insertBySeq`）。洞 B 用例转绿。
- **dev 有序断言已加**（`f292c72`）：`insertBySeq` 插入前校验真实消息 seq 单调，违序 console.error + 降级全量排序；`import.meta.env.DEV || MODE==='test'` 判定，生产构建零开销。
- 红灯用例入库 `2cb13d5`（2 绿 2 红）→ 现全部转绿，验证了「先写会红 → 修完转绿」纪律。

## 待办（先不做，方案如下）

| 待办 | 方案 |
|---|---|
| **eslint-plugin-react-hooks 7.x 新规则治理**：`set-state-in-effect`/`immutability` 对三处合理模式误报（CallModal.jsx:571 异步回调 ref 持流防 GC、CallModal.jsx:601 状态守卫型清空质量、ChatWindow.jsx:591 会话切换 loading 起点），已行内 `eslint-disable-next-line` + 理由注释豁免（commit eef2667 后），CI `--max-warnings=0` 门禁恢复通过 | 后续统一评估：effect 外派生状态 / 拆分 effect 真正满足规则，或按项目实际收紧/放宽规则配置；当前豁免均不改行为 |
| **Android/iOS 三端同款逻辑未同步**：Kotlin sync 合并二分比较 `current[mid].server_sequence < seq`（ChatViewModel.kt:1023）同样把 pending 当 0，iOS outbox 合并按 createdAt 混排（ChatViewModel.swift:790/813）同洞 A 源头 | 按 Web 语义移植：Android 加透明 lowerBound + outbox 排末尾；iOS 同。两平台当前无单测基建，须先建（Kotlin JVM 单测 / XCTest）再按红灯驱动纪律改 |
| 洞 A/B 修复仅覆盖 Web/Electron | 上一条的移动端移植即此项收敛 |

## 2026-09-02 部署记录（洞 A/B 修复上线）

- **部署方式**：本地直连生产（45.77.131.33 = 本机）。CI deploy.yml 五次被 E2E 门禁阻塞——GitHub runner 当日环境持续恶化（E2E 总时长 5m33→5m54→7m26→11m6 递增），断网模拟类用例（OB-02/EDGE-06）失败态计时器全被拖爆。产品代码本地全量 E2E 39/39 绿 + 单跑 4.5s 过 + DBG 日志证明 ack 替换/消息链路正确，判定环境性 flake，用户授权本机直部署。
- **已执行**（等价 deploy job 步骤）：web `npm ci && vite build`（1.73s）→ backend-v2 `npm ci --omit=dev` → `pm2 restart touliao-backend`（↺107，/health `{"ok":true,"db":"ok"}`）→ 备份 `/var/www/touliao-web.bak-20260902-082343` → `rsync -a web/dist/ /var/www/touliao-web/`（不带 --delete，README 事故记录）→ touliao.cc 200，线上 index.html 与最新 dist 一致（index-98bdZjib.js）。
- **commit 链**（本会话，全部已 push）：a750798 审计 → 2cb13d5 红灯测试 → f0bcbf4 纪律 → a05852b 洞 A → f292c72 洞 B → 09c276a 状态 → eef2667 tree-shake → 5a028a1 lint → 92c0b8a env-guard → 376926e OB-02 超时 30s。
- **残余**：CI E2E 门禁在 runner 环境正常时应恢复（376926e 已加宽超时）；Android/iOS 同款修复未移植（见上表待办）。

---

# 2026-09-02 晚：schema drift 事故全链路 + 防护体系 + 8.1.9 发版收尾

> 今日教训主线：**「失败/故障却无人知晓」今天出现六次**（CI 红无人知、E2E 五连败、deploy 假绿灯、schema drift 双雷 500、health grep 误放行、iOS 编译红窗无人拦）。系统性补防：启动全量核对 + health 503 降级拦截 + CI 扫描器 + 心跳 + 迁移纪律 + 保护机制破坏验证纪律。

## 1. schema drift 事故：message_reads 缺失致消息历史 500（2026-09-02 晚）

### 时间线（UTC）
| 时间 | 事件 |
|---|---|
| 09-02 03:12 | `bab4d19` 入库：后端加 message_reads 已读回执——建表 SQL **插入 migrations 数组中部**（idx 18-20）+ history/markRead 查询代码 |
| 08:41-08:48 | deploy `ec2959b` 首次成功（deploy.yml 真部署上线以来第一个绿）+ pm2 重启 → 新代码上线，但表未建 |
| 08:48-12:44 | **潜伏**：所有含 message_reads 查询的接口必然 500，但无 history 请求所以日志未暴露 |
| 12:44 | 第一个用户打开会话 → `GET /api/messages/{convId}` 与 `?before=` 分页 500（`SqliteError: no such table: message_reads`）→ 用户报告"服务器内部错误/查看更多加载不出来" |
| 12:54 | 止血：备份 + 手动建表 + 2 索引 → 真实用户流量 3 秒后恢复 200 |

### 根因：迁移 idx 撞车（机制）
- `schema.js` 用 `schema_migrations` 表按**数组下标**记录已执行迁移，已记录的 idx 启动时直接跳过（`alreadyApplied.has(idx)`）。
- migrations 数组**中部插入**新迁移 → 新迁移的 idx 撞上存量库已记录的旧 idx → 启动跳过 → 建表/加列**从未执行**，但元数据标记"已应用"。
- 双雷同根因：
  - **message_reads**（idx 18，`bab4d19` 插在 message_deliveries 后）→ history/markRead 查询 500
  - **user_settings.ringtone**（idx 102）→ 用户改铃声 500（写路径；读路径 SELECT * → undefined → 默认 'classic' 不炸，故潜伏更深）
- 全量核对（`scripts/schema-audit.js`）：133 条迁移中 1 条漂移（ringtone）；46 张声明表全在。**只有这两个雷**。

### 影响面
- 接口级故障，**与客户端版本无关**：任何端（iOS 8.1.8/8.1.9/Android/Web）打开会话拉历史均 500；sync/收发消息正常；markRead soft-degraded（双勾失效不致命）。
- 472863a/b0908dd（消息合并洞修复）**纯客户端**，与本次事故无关——事故引入者是 bab4d19 的后端部分。

### 修复链
1. 止血：备份（better-sqlite3 backup API）→ 手动执行 schema.js:238-245 建表 SQL → 真实流量 200 验证
2. 排雷：`scripts/schema-audit.js` 核对脚本发现 ringtone → 备份 + ALTER 补列
3. 防再犯（commit `082c8c3`）：
   - `assertRequiredColumns` → `verifySchemaDrift`：启动时对**每条已 applied 迁移**解析预期对象（表/列/索引）核对真实结构，返回清单不 throw
   - **降级策略**（用户拍板）：默认打 error 日志 + `/health` 503 → deploy 健康检查拦截并自动回滚；`SCHEMA_DRIFT_ABORT=1` 强中止（CI/测试）——避免非变更重启把可用服务打死（abort 会把"局部 500"升级成"全线挂"）
   - `REQUIRED_COLUMNS` 补 message_reads
   - 验证链：真实库 ringtone 漂移被拦截 → 补列 → 0 漂移；副本库 DROP message_reads → 返回 4 条清单不 throw；副本实例 /health 503 + grep '"ok":true' 不匹配 → deploy 判定失败（拦截实证）
4. 测试适配（commit `1f798c3`）：p0-schema-drift.test.js D/E 改清单断言 + F 全量核对主路径（6 用例全绿）。教训：**改导出名要搜 test/**（第一次 deploy 被 backend-jest 门禁拦下，`assertRequiredColumns is not a function`）
5. 第二次部署全绿上线；重启后逐项验证通过（health 200 / 首屏 200 / 分页 200 / markRead success）

## 2. /health grep "ok" bug —— deploy 自动回滚此前形同虚设（今日第六次"假绿灯"类问题）

- **问题**：deploy.yml 健康检查 `curl /health | grep -q "ok"` 匹配的是**子串**。原 503 响应体 `{"ok": false, ...}` **含键名 "ok"** → grep 误命中 → 判定"健康" → **自动回滚机制从未真正触发过**（503 分支只要出现即被误放行）。
- **修复**（`082c8c3`）：health 503 响应彻底移除 "ok" 键（status/database/drift 字段）；deploy.yml 两处健康检查改 `grep '"ok":true'` **精确匹配**。副本验证：503 body 不匹配 → 判定失败 ✓；200 body 匹配 → 放行 ✓。
- **同族历史问题**（假绿灯系列）：deploy.yml 曾 `continue-on-error:true` 吞 SSH 失败显示绿但从未真部署；android-release 曾 secret 缺失静默跳过；E2E 门禁五连败期间 deploy 全红未部署（本次反而是"红得真实"）。**规则：任何"绿灯"都必须能被破坏验证证明它会红。**

## 3. 三端消息合并洞 A/B 修复对齐（Web → Android → iOS 完成）

- Web 已修（`a05852b` 洞 A / `f292c72` 洞 B，测试 6/6 绿）——见上方"二分插入排序改造"章节。
- **Android 移植**（`d84fe59`）：ChatMessageMerge.kt 抽取纯函数 + 红灯驱动（ChatMessageMergeTest 对齐 Web 语义）；pending 透明 lowerBound + outbox 排末尾 + violatesOrder/relocate + BuildConfig.DEBUG 断言。
- **iOS 移植**（`b0908dd`，第 2 轮）：ChatMessageMerge.swift 同款修复；ChatViewModel dispatchSend ack 落地（洞 B 第二条生产路径）补 relocate；`#if DEBUG` 断言；XCTest 4/4 红灯转绿（CI run 18/18 绿）。
- 原待办表"Android/iOS 同款逻辑未同步"→ **已完成**（见下）。
- 红灯纪律实证链：`2cb13d5`（2 绿 2 红入库）→ Web 绿 → Android 红灯驱动 → iOS 红灯驱动。

## 4. main 的 iOS 编译红窗（2026-09-02 06:25 → 修复前）

- **破坏提交**：`25c7ec7`（03:22，通话质量指示，CallManager.sampleQuality 新旧 WebRTC stats API 混用）与 `472863a`（03:41，聊天窗口修复把 appendUnique 定义删除但漏改 4 处调用点）——main 的 iOS 从此时起编译不过。
- **红窗事实**：ios-build 在 main 上仅 1 次红 run（06:25 批 push）；**期间所有 iOS 改动（含 8.1.8 后 6 个功能提交）未经过编译验证**；无分支保护、无告警、无人知晓（见第 5 节）。
- **修复**：fix/ios-message-merge 分支 5 commits（70d88ac 抽取+红灯 / 3c7e3e3 appendUnique 补调用 / ea0a783+5ee33f4 stats API 修复 / b0908dd 洞 A/B）→ ff 合并 main → main ios-build 转绿（run 33625664083 success）。
- 8.1.8 发版健康确认：ios-v8.1.8 tag（b3a83ba，09-01 13:48）**早于破坏提交约 14 小时**，TestFlight 全 18 步 success——8.1.9 之前 6 个 iOS 提交未进任何包。

## 5. CI 失败告警缺口 + 扫描器落地

- **缺口**：全 9 个 workflow 零通知集成（无 webhook/TG/issue）；main 无分支保护（API 404）；GitHub Actions 失败通知只发给触发者且需个人开启（本仓库 actor 全为 zhaocaimao008，排除 bot 触发）；gmail 收件易沉 Updates 标签。
- **落地**：Hermes cron `ci-red-scan`（每 12h 09:30/21:30 扫 main 近 24h 终态红 run，按 run id 去重 + 已自愈过滤，全绿静默，报 workflow/run 链接/commit/失败 job）；**心跳**：周一且距上次消息 ≥7 天发"运行正常"（红报即活证据，最长静默 ≤14 天）；gh 故障 → stderr + exit 1 → cron 自动 alert（24h 错误去重）。
- 关联：本日另有 `iOS Beta 审核自动提交监控`（ios_beta_watch.py）处于暂停态。

## 6. 新增纪律（2026-09-02）

1. **migrations 数组只允许追加尾部，禁止中部插入/删除/重排**——idx 是位置的隐式标识，中部插入必然导致存量库 idx 撞车、新迁移被"已应用"跳过（message_reads/ringtone 双雷）。评估中：改按迁移 name 记录（下次 schema 重构时落地）；CI 检查（对比 git diff，新增迁移必须位于数组末尾）见方案待实施。
2. **保护机制（健康检查/告警/测试/门禁）上线前必须验证它会红**——grep "ok" 子串误放行、恒绿测试、continue-on-error 吞失败、secret 缺失静默跳过，全是"看起来在保护、实际形同虚设"。验收标准：人为制造故障 → 机制必须变红 → 恢复后变绿（破坏验证，同 2250 节测试纪律）。

## 7. 8.1.9 发版记录（2026-09-02 晚）

- Android `android-v8.1.9`（commit 2bd46a5：versionCode 71 / versionName 8.1.9）：android-release run success → 下载站 version.json=71/8.1.9，APK sha256 与清单一致（51951fea...），公网 URL 实测生效。内容：洞 A/B 修复 d84fe59 + 通话质量指示/切音视频/弱网调优/铃声 4 款/聊天窗口两问题修复等 8 提交。
- iOS `ios-v8.1.9`（同 commit）：ios-testflight run success（解析版本=8.1.9 显式传参未落默认值 → 归档 → 上传 TestFlight → 提交外部 Beta 审核全绿）。内容：11 提交（6 功能/问题 + 5 编译与洞 A/B 修复；质量指示/聊天窗口修复首次到达 iOS）。
- 两端发版均包含当日 schema 修复之后的状态（8.1.9 的 TestFlight 构建与 schema 修复同源于 main，后端独立 deploy 已上线）。

## 8. 遗留待办

| 待办 | 方案 |
|---|---|
| migrations 按 name/哈希记录改造 | 显式 id（`2026-09-02_xxx`），存量 133 条一次性回填映射；择机随 schema 重构落地 |
| migrations 中部插入 CI 检查 | 见本节上方"新增纪律 1"关联方案（git diff 定位数组新增元素位置，非末尾即 fail） |
| 401 自测小坑备忘 | 手签 JWT 需带 `csrf` claim（auth 通过 verify 后设 CSRF cookie 时缺字段会抛错进 catch 返回 401"Token无效或已过期"）；真实用户 token 由登录接口签发无此问题 |

---

# 四端 UI 与功能一致性审计（2026-09-05, zcode GLM-5.2 只读 + Hermes 抽验）

- 范围：web / android / ios / desktop-electron（壳复用 web dist），以 Web 为基准
- 方法：zcode 静态审计（全程只读，git 工作树保持干净），关键结论 Hermes 独立 grep 抽验通过
- 已核实**一致**（无需处理）：撤回/删除双删 vanish 语义三端+后端已对齐（a638c7c）；8.1.14 竞态广播修复已闭环（410868d，purgeQueuedMessage 覆盖三路径，测试在库）；`DeleteMessageBody.forMe` 无 UI 调用方与提交说明相符；删除确认弹窗文案三端逐字一致；钱包"充值已下线"三端一致；主色 #6D5AE6/成功色/气泡紫/暗色提亮档三端一致，#576B95 零残留；桌面 preload 能力与浏览器版无入口打架

## 待办（先不做，附方案）

| 级别 | 待办 | 证据 | 方案 |
|---|---|---|---|
| **P0** | **Android 收藏列表不可达（半残）**：长按「收藏」能存入，但 `Routes.FAVORITES`（AppNavigation.kt:134）从未注册进 NavHost，`FavoritesScreen.kt` 全库无引用；Web 是一级 tab、iOS 在「我」页 | AppNavigation.kt:134 vs composable 列表；FavoritesScreen.kt:51 | NavHost 补 favorites 路由 + 「我」页加入口；收藏空态文案（FavoritesScreen.kt:97）随入口修复 |
| **P1** | 撤回弹窗文案失真（三端一致 bug）：承诺「对方会看到"消息已撤回"」，实际接收方对 recall/deleted/vanished 均**无痕移除**，无任何占位 | I18nContext.jsx:166 / ChatScreen.kt:1255 / ChatView.swift:923；无痕实现 ChatWindow.jsx:1043-1054、ChatMessageMerge.kt:103-104、ChatMessageMerge.swift:84-85 | 三端文案改为与删除一致：「对方不会再看到这条消息」 |
| **P1** | Web 多选批量删除是死代码：`ctxAction('multiselect')`（ChatWindow.jsx:2123-2126）无任何 UI 触发，MultiSelectBar/multiDelete 全死路径；Android/iOS 长按菜单有「多选」入口 | ChatWindow.jsx:2123,2190-2207,2658-2664 vs ChatScreen.kt:1226、ChatView.swift:914 | Web 长按菜单补「多选」项（对齐原生端）或删死代码 |
| **P1** | `--brand-primary` 变量从未定义（全 css 0 定义），4 处兜底微信绿 #07C160 **实际渲染**：文件消息图标、文件预览 tab/进度/链接 | MessageItem.jsx:316；FilePreview.jsx:149,402,427 | 改 `var(--color-primary)` |
| **P1** | 裸写微信绿按钮 ×2 | CallSoundGuide.jsx:63；PushPermissionGuide.jsx:100 `background:'#07C160'` | 改 `var(--color-primary)` |
| **P1** | 版本号三线分裂：8.1.14 只 bump Android（build.gradle.kts code76）/iOS（project.yml），桌面 8.1.7、Web 8.0.0 掉队，「我的-版本」四端三个数字 | desktop-electron/package.json:3；web/package.json:4 | 出包脚本统一从单一 VERSION 源 bump 四端 |
| P2 | Android 壳层背景 VxinBg=#F7F7F7 微信灰，Web 对应紫调 #E7E4F0/#F3F1FA | Color.kt:14 vs design-tokens.css:139,152 | Android 换 0xFFF3F1FA 系 |
| P2 | 危险色不统一：Web --color-danger #F53F3F vs Android/iOS #FA5151（=web badge 红） | design-tokens.css:73 vs Color.kt:17、Theme.swift:16 | 统一为 #F53F3F 或明确 badge/danger 两档语义 |
| P2 | 微信绿字面量残留（非支付语义）：文件传输助手图标、标签默认色（三端+后端 schema.js:468）、下载页 CSS、截图通知底色；钱包橙 Android FA9D3B vs Web F4511E | ChatScreen.kt:1343-1345；FriendLabel.kt:10、FriendLabelRepository.swift:12、schema.js:468、download/index.js:77、ScreenCaptureService.kt:95；WalletScreen.kt:63 | 非支付位换品牌色；标签默认色四端统一（支付绿 #07C160 三端 token 是有意保留） |
| P2 | iOS 无「检查更新」入口（SettingsHomeView.swift 仅「关于」显示版本）；Web 浏览器版无入口属正常 | iOS SettingsHomeView.swift:53-57 | iOS 按 TestFlight 策略决定是否需入口（走 TF 自动更新可豁免） |
| P2 | Web/桌面无「清除缓存」入口（Android/iOS 有） | web Profile.jsx 全文无 clearCache | 浏览器无法清本地缓存则豁免；桌面 Electron 可加（session.clearCache） |
| P2 | 转发/收藏排除规则三端不同：Web 转发全类型、收藏限 text/image/video/file；Android 仅排除红包；iOS 排除红包+转账 | ChatWindow.jsx:2895-2899 vs ChatScreen.kt:1198,1211 vs ChatView.swift:886 | 以后端可转发类型为准统一（转账应为资金凭证不可转发/收藏） |
| P2 | 封面图 coverPhoto 仅 Web 可编辑，Android 无字段、iOS 模型有字段无入口 | ProfileEditScreen.kt 无 cover；ios User.swift:11 vs ProfileEditView.swift | 原生端补封面编辑或后端裁剪该能力（产品决策） |
| P2 | 通话记录入口：Web 独立 tab，Android/iOS 藏在「我」页 | Home.jsx:993-994 vs ProfileScreen.kt:293、ProfileView.swift:157-159 | 移动端消息页顶栏加通话入口（产品决策） |
| P2 | 撤回不限时（无 2 分钟限制），Android 编辑消息 API 注释过时「2 分钟内」 | MessageApi.kt:126 vs messages.service.js:614 | 删过时注释 |
| P2 | 后端 vanish 分支缺 `msg.deleted===2` 幂等短路（forEveryone 分支有 :519） | messages.service.js:464 | vanish 分支补幂等 return |
| P2 | desktop-electron/src/package.json:3 version=2.0.58 残留（:16 注释自称已不保留版本） | src/package.json:3 | 删残留字段 |
| P2 | downloadManager.js:95 引用 window.touliaoAPI?.downloadFile（全库无定义，死兼容） | desktop-electron/src/lib 内 | 删死引用 |
| P2 | 桌面关闭=最小化到托盘（main.js:496-504），与浏览器关闭即退出不同，首次关闭无提示 | main.js:60,496-504 | 首次关闭 toast 提示 |
