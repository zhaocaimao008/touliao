# 无障碍（a11y）审计报告

审计日期：2026-06-19 | 审计范围：`/root/v信/web/src` 下全部 34 个 JSX 文件

---

## 一、缺失 aria-label 的图标按钮

### 🔴 高优先级（按钮仅含 SVG/✕，无任何文本标签）

| 文件 | 行号 | 缺陷 |
|------|------|------|
| `Home.jsx` | 721-722 | 搜索栏清空按钮 `✕`，无 `aria-label`，无 `title` |
| `Home.jsx` | 766 | 二维码弹窗关闭按钮 `✕`，无 `aria-label`，无 `title` |
| `Home.jsx` | 382-385 | `CreateGroupModal` 关闭按钮（纯 SVG），无 `aria-label`，无 `title` |
| `MessageSearch.jsx` | 95-101 | 搜索框清空按钮 `✕`，无 `aria-label`，无 `title` |
| `CallModal.jsx` | 342-357 | `CtrlBtn` 组件使用 `<div>` 模拟按钮，含语音通话静音/挂断等控制按钮，无 `role="button"`，无 `aria-label`，无 `tabIndex`，不支持键盘操作 |

### 🟡 中优先级（按钮仅有 `title` 属性，缺 `aria-label`）

屏幕阅读器对 `title` 的读取行为不稳定，建议补充 `aria-label`。

| 文件 | 行号 | 按钮用途 |
|------|------|----------|
| `Home.jsx` | 727-729 | 二维码按钮 `title="我的二维码"` |
| `Home.jsx` | 732-734 | 发起按钮 `title="发起"` |
| `ChatWindow.jsx` | 1448 | 返回按钮 `title="返回"` |
| `ChatWindow.jsx` | 1465-1471 | 搜索聊天记录按钮 `title="搜索聊天记录"` |
| `ChatWindow.jsx` | 1473 | 语音通话按钮 `title="语音通话"` |
| `ChatWindow.jsx` | 1474 | 视频通话按钮 `title="视频通话"` |
| `ChatWindow.jsx` | 1475 | 查看资料按钮 `title="查看资料"` |
| `ChatWindow.jsx` | 1477-1481 | 更多/群聊信息按钮 `title="群聊信息"` 或 `"更多"` |
| `ChatWindow.jsx` | 1752-1756 | 表情按钮 `title="表情"` |
| `ChatWindow.jsx` | 1758-1762 | 表情包按钮 `title="表情包"` |
| `ChatWindow.jsx` | 1764-1768 | 语音输入按钮 `title="语音输入"` |
| `ChatWindow.jsx` | 1770 | 图片按钮 `title="图片"` |
| `ChatWindow.jsx` | 1775 | 文件按钮 `title="文件"` |
| `ChatWindow.jsx` | 1786-1791 | 发红包按钮 `title="发红包"` |
| `ChatWindow.jsx` | 1792-1796 | 更多功能按钮 `title="更多"` |

### ✅ 已正确使用 aria-label 的示例

- `Sidebar.jsx` L43 — 头像切换 `aria-label="个人资料"`
- `Sidebar.jsx` L62 — 导航标签动态 `aria-label={label}`
- `ChatWindow.jsx` L1499, L1641, L1694, L1708, L1721, L2157 — 清空搜索/关闭面板/取消上传等
- `AddFriendModal.jsx` L109, L138 — 关闭和清空按钮
- `GroupInfo.jsx` L293, L474, L639, L671 — 关闭/清空按钮
- `ImagePreview.jsx` L141 — `aria-label="Close"`
- `ThemeToggle.jsx` L50 — `aria-label={darkMode ? '切换到亮色模式' : '切换到暗黑模式'}`
- `StickerPanel.jsx` L62 — `aria-label="删除表情"`

---

## 二、缺失 `role="alert"` 的错误消息

### 🔴 需要修复

| 文件 | 行号 | 内容 | 建议 |
|------|------|------|------|
| `Profile.jsx` | 130 | `<div className="wc-edit-error">{error}</div>` | 加 `role="alert"` |
| `Home.jsx` | 259 | `<div className="wc-add-form-error">{err}</div>` | 加 `role="alert"` |
| `Home.jsx` | 449-452 | `<div className="cgm-error">{error}</div>` | 加 `role="alert"` |
| `Home.jsx` | 248-249 | `<div className="auth-server-result">` 服务器测试结果 | 加 `role="alert"` 或 `role="status"` |
| `ChatWindow.jsx` | 1508 | `<div className="wc-search-status">未找到相关记录</div>` | 加 `role="status"` |
| `ChatWindow.jsx` | 1586 | `<div className="wc-search-status">加载中...</div>` | 加 `role="status"` |
| `SearchResults.jsx` | 24-27 | `<div>未找到相关消息</div>` | 加 `role="status"` |
| `GlobalSearch.jsx` | 215-217 | `<div>搜索中…</div>` | 加 `role="status"` |
| `Collections.jsx` | 38-40 | `<div>暂无收藏</div>` / `<div>加载中…</div>` | 加 `role="status"` |
| `NewFriendsPage.jsx` | 63-64 | `<div className="nf-empty">暂无新的好友请求</div>` | 加 `role="status"` |
| `ContactList.jsx` | 165-174, 188-194, 229-232 | 空状态提示 | 加 `role="status"` |
| `ChatList.jsx` | 171-173 | `<div>暂无聊天</div>` | 加 `role="status"` |

### ✅ 已正确使用

- `Login.jsx` L159 — `role="alert"`
- `Register.jsx` L104 — `role="alert"`

---

## 三、缺失 `htmlFor` + `id` 标签关联的输入控件

### 🔴 需要修复

| 文件 | 行号 | 输入控件 | 建议 |
|------|------|----------|------|
| `Home.jsx` | 251-258 | 账号切换表单（手机号/密码输入框） | 使用 `htmlFor` + `id` 或 `aria-label` |
| `Home.jsx` | 392-398 | 创建群聊名称输入框 | 添加 `<label>` 或 `aria-label` |
| `Home.jsx` | 714-718 | 全局搜索输入框 | 添加 `aria-label="搜索"` |
| `ChatWindow.jsx` | 1491-1498 | 消息搜索输入框 | 添加 `aria-label="搜索聊天记录"` |
| `ChatWindow.jsx` | 1851-1866 | 聊天输入 textarea | 添加 `aria-label="输入消息"` |
| `AddFriendModal.jsx` | 127-135 | 搜索好友输入框 | 添加 `aria-label="搜索好友"` |
| `MessageSearch.jsx` | 79-89 | 搜索消息输入框 | 添加 `aria-label="搜索消息"` |
| `ContactList.jsx` | 421-426 | 联系人搜索输入框 | 添加 `aria-label="搜索联系人"` |
| `Profile.jsx` | 118-127 | 修改昵称输入框 | text 输入，有 placeholder 但无正式标签 |
| `Login.jsx` | 240-246 | 服务器地址输入框 | 在桌面端服务器切换面板中，无标签关联 |

### ✅ 已正确实现

- `Login.jsx` L117 + L123: `htmlFor="login-phone"` + `id="login-phone"`
- `Login.jsx` L138 + L145: `htmlFor="login-password"` + `id="login-password"`
- `Register.jsx` L84 + L88: `htmlFor={"reg-${f.key}"}` + `id={"reg-${f.key}"}`

---

## 四、缺失键盘事件处理

### 🔴 高优先级 — 可点击的 `<div>` 无键盘支持

| 文件 | 行号 | 元素用途 | 问题 |
|------|------|----------|------|
| `ChatList.jsx` | 137-168 | 会话列表项（`onClick`） | 无 `onKeyDown`，无 `role`，无 `tabIndex` |
| `ChatList.jsx` | 180-190 | 右键菜单项（`onClick`） | 无键盘支持 |
| `ContactList.jsx` | 114-138 | `EntryRow` 功能入口（`onClick`） | 无键盘支持 |
| `ContactList.jsx` | 147-161 | 联系人项（`onClick`） | 无键盘支持 |
| `ContactList.jsx` | 217-228 | 群聊项（`onClick`） | 无键盘支持 |
| `ContactList.jsx` | 240-248 | 字母索引（`onClick`） | 无键盘支持，无 `role="button"` |
| `ContactList.jsx` | 268-286 | `EntryRow` 组件（`div` 模拟按钮） | 无键盘支持 |
| `Home.jsx` | 195-223 | 账号切换列表项（`onClick`） | 无键盘支持 |
| `Home.jsx` | 227-238 | 添加账户行（`onClick`） | 无键盘支持 |
| `Home.jsx` | 269-278 | 个人资料行（`onClick`） | 无键盘支持 |
| `Home.jsx` | 689-698 | 左侧导航 tab（`div`, `onClick`） | 无 `role="tab"`，无键盘支持 |
| `ChatWindow.jsx` | 1342-1356 | 联系人名片卡片（`onClick`） | 无键盘支持 |
| `ChatWindow.jsx` | 1361-1378 | 红包卡片（`onClick`） | 无键盘支持 |
| `ChatWindow.jsx` | 1388-1398 | 表情回应 pill（`onClick`） | 无键盘支持 |
| `ChatWindow.jsx` | 1514-1545 | 搜索结果项（`onClick`） | 无键盘支持 |
| `ChatWindow.jsx` | 1648-1655 | 名片选择器项（`onClick`） | 无键盘支持 |
| `Profile.jsx` | 64-79 | `CRow` 组件（可点击时 `onClick`） | 无键盘支持 |
| `Profile.jsx` | 208-210 | 外观设置按钮（使用 `<button>` ✅） | OK |
| `CallModal.jsx` | 344-357 | `CtrlBtn`（`div` 模拟按钮） | 无 `role="button"`，无 `tabIndex`，无键盘支持 |
| `GlobalSearch.jsx` | 153-190 | 搜索结果的 div | 无键盘支持 |
| `ForwardModal.jsx` | 后续检查 | 转发目标选择 | 需验证 |
| `Moments.jsx` | 76-82 | 评论删除按钮 | `<button>` 元素 ✅ |
| `Moments.jsx` | 51-61 | 点赞/评论按钮 | `<button>` 元素 ✅ |

### ✅ 已正确实现键盘事件

- `ChatWindow.jsx` L1497 — Escape 关闭消息搜索
- `ChatWindow.jsx` L1862 — `onKeyDown={handleKeyDown}` (发送消息)
- `MessageSearch.jsx` L84 — `onKeyDown={handleKeyDown}` (Enter/Escape)
- `AddFriendModal.jsx` L134 — `onKeyDown={e => e.key === 'Enter' && doSearch(query)}`
- `ImagePreview.jsx` — Escape 关闭，滚轮缩放 ✅
- `Profile.jsx` L121 — Enter 保存昵称
- `Moments.jsx` L93 — Enter 提交评论、Escape 关闭
- `GroupInfo.jsx` L314, L590 — Enter 保存名称/Escape 取消

---

## 五、表单提交 loading/disabled 状态

### ✅ 已正确实现

| 文件 | 行号 | 代码 | 状态 |
|------|------|------|------|
| `Login.jsx` | 167-172 | `disabled={loading}` + `<span className="auth-spinner" />` | ✅ |
| `Register.jsx` | 112-113 | `disabled={loading}` + `<span className="auth-spinner" />` | ✅ |
| `Home.jsx` | 260 | `disabled={submitting}` + "登录中..." | ✅ |
| `Home.jsx` | 459 | `disabled={loading \|\| selected.size === 0}` + "创建中…" | ✅ |
| `ForwardModal.jsx` | 219 | `disabled={selected.size === 0 \|\| sending}` | ✅ |
| `NewFriendsPage.jsx` | 113 | `disabled={state === 'loading'}` | ✅ |
| `StickerPanel.jsx` | 44 | `disabled={uploading}` + "上传中…" | ✅ |
| `Profile.jsx` | 110 | `disabled={saving}` + "保存中" | ✅ |
| `RedPacketModal.jsx` | 89 | `disabled={!canSend \|\| sending}` | ✅ |
| `UserProfile.jsx` | 176, 209 | `disabled={remarkSaving}` / `disabled={sending}` | ✅ |

### 🟡 注意事项

- `Login.jsx` L254: 服务器测试按钮有 `disabled={serverBusy}` + 状态文字 ✅
- `CallModal.jsx`: 通话控制按钮无 disabled 状态（合理，因为按钮一直可用）✅

---

## 六、其他发现

### 缺少 alt 文本
| 文件 | 行号 | 问题 |
|------|------|------|
| `Moments.jsx` | 44 | 朋友圈图片 `alt=""` — 应添加有意义的描述 |
| `Collections.jsx` | 27 | 收藏图片 `alt=""` — 应添加描述 |
| `ChatWindow.jsx` | 1305 | 聊天图片 `alt=""` — 建议加入描述 |

### 缺少 focus trap（焦点陷阱）
- `AddFriendModal.jsx` — 使用 Portal 弹出，无 focus trap，Tab 键可跳出弹窗
- `ForwardModal.jsx` — 无 focus trap
- `CallModal.jsx` — 全屏通话界面，无 focus trap
- `GroupInfo.jsx` — 侧边面板，无 focus trap

### 缺少关闭按钮的 aria-label
- `Home.jsx` L382-385: `CreateGroupModal` 关闭按钮（纯 SVG 图标）

### 颜色对比度依赖
- `Home.jsx` L80-84: 多个 SVG icon 使用 `var(--text-tertiary)` 等 CSS 变量，需确保暗色模式下对比度达标

---

## 汇总

| 类别 | 高优先级 | 中优先级 | 合计 |
|------|---------|---------|------|
| 缺失 aria-label 图标按钮 | 4 | 18 | 22 |
| 缺失 role="alert" | 12 | - | 12 |
| 缺失 label+id 关联 | 10 | - | 10 |
| 缺失键盘事件处理 | 18 | - | 18 |
| 表单 loading 状态 | 0 | - | 0（全部达标） |
| 其他（alt、focus trap） | 3 | 4 | 7 |
| **总计** | **47** | **22** | **69** |

### 优先修复建议

1. **最高优先级** — 可点击 `<div>` 添加键盘支持（18 处），这是影响最严重的可访问性问题
2. **高优先级** — 纯图标按钮（✕/SVG）添加 `aria-label`（4 处），屏幕阅读器完全不可见
3. **高优先级** — 12 处错误消息添加 `role="alert"`，确保屏幕阅读器即时播报
4. **高优先级** — 输入控件添加 label 关联或 `aria-label`（10 处）
5. **中优先级** — 18 处 `title` 属性增强为 `aria-label`
