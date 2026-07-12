# v信 · 20 机器人体检报告 (2026-07-11)

> 20 个机器人并行扫描完成。重点回答：**可视化界面 / 按钮 / 组件 有什么可优化**。
> 明细见 `reports/R1.md ~ R20.md`。

---

## 一、总评分（可视化 & 组件维度）

| 维度 | 现状 | 评级 |
|------|------|------|
| 配色令牌一致性 | 有 design-tokens，但仍有大量内联硬编码色 | 🟡 中 |
| 布局/间距/圆角 | 294 处内联 style，圆角/间距无统一梯度 | 🟠 待优化 |
| 无障碍 A11y | aria/role 覆盖不错，但可点击 div 偏多 | 🟡 中 |
| 空/错/加载态 | error 态好，skeleton 仅 4 处 | 🟡 中 |
| 移动适配 | safe-area 有，触控目标偏小 | 🟡 中 |
| React 组件质量 | 内联函数 184、map 无 key、无 memo | 🟠 待优化 |
| 性能 | 长列表未虚拟化、无代码分割 | 🟠 待优化 |

---

## 二、🎯 界面/按钮/组件 —— 最该优化的 8 件事

### 1. 按钮/可点击元素用 `<div onClick>` 代替 `<button>`（A11y + 一致性）
- 可点击 `<div>` 共 **多处**，其中弹窗遮罩、列表项、图标按钮居多。
- 影响：键盘用户无法 Tab/Enter 触发；屏幕阅读器不识别；无原生 :focus / disabled。
- **优化**：图标按钮统一封装 `<IconButton aria-label>`；遮罩关闭按钮补 `role="button"` + 键盘事件；列表项交互改真正的 button/可聚焦元素。

### 2. 294 处内联 `style={{}}`（维护性 + 性能）
- 集中在 CallModal(43)、Profile(34)、Moments(28)、ContactList(22)、ChatWindow(20)。
- 影响：每次渲染新建 style 对象 → 子组件白渲染；样式散落无法主题化。
- **优化**：抽到 CSS class / 样式常量对象（模块外定义），配合 design-tokens。

### 3. 硬编码颜色未走令牌（主题/暗色一致性）
- 典型：Profile.jsx 主题色卡、CRow 图标底色 `#F0A020/#17B8A6/#8A93A6`、ElectronTitlebar `#1A2033/#E53E3E`。
- **优化**：迁移到 `design-tokens.css` 变量（如 `--brand-wallet`、`--titlebar-bg`），新增 ESLint 规则禁止内联 hex/rgba。

### 4. 圆角/间距无统一梯度
- borderRadius 出现 6/8/10/12/14/20/50% 等混用。
- **优化**：定义 `--radius-sm/md/lg/full`（如 6/10/16/9999），全量替换魔法数字。

### 5. 内联箭头函数 184 处（渲染性能）
- ChatWindow(38)、Profile(27)、GroupInfo(19)、ContactList(19) 最多。
- **优化**：列表项事件用 `useCallback` + 事件委托或 `data-id` 读取，避免每行新建函数。

### 6. 长列表未虚拟化
- **ContactList**（map=13，virtual=0，memo=0）、**Moments**、CallHistory、Collections 均无虚拟化。
- ChatWindow 已有 VirtualMessageList（好）。
- **优化**：ContactList / Moments 引入 react-window（依赖已在）；列表项 `React.memo`。

### 7. 组件几乎无 `React.memo`
- 大量 export default 组件未 memo（Profile、ChatWindow、AddFriendModal…）。
- **优化**：纯展示/低频变化子组件（MessageItem、列表项、Avatar、StickerPanel）加 memo。

### 8. 加载态用 skeleton 太少（仅 4 处）
- error 态覆盖好（371），但首屏/列表加载多为空白或 spinner。
- **优化**：为 ChatList / ContactList / Moments 首屏加骨架屏（Skeleton），统一三态组件 `<EmptyState/> <ErrorState/> <Skeleton/>`。

### 其它界面细节
- 触控目标偏小：ForwardModal 28px、mobile 图标 32/36px → 移动端建议 ≥44px 命中区。
- `.map` 中出现 `key={i}`（Moments/ContactList/ChatList），列表增删会错位 → 改稳定 id。
- 媒体查询断点少（仅 max-width:767px 一个业务断点）→ 平板/大屏无专门适配。

---

## 三、其余维度速览（功能/后端/性能）

**前端质量**
- 内存泄漏疑点：`ChatWindow.jsx` add=13/remove=10（3 个监听未清理）→ 复查 useEffect cleanup。
- Promise 吞异常：多处 `.catch(() => {})` 空处理，排障困难。
- console 残留仅 3 处（良好）。85 行疑似注释代码可清理。

**打包/性能**
- dist 仅 932K（良好），但 **React.lazy=0，无路由级代码分割**。
- 超大单文件需拆分：ChatWindow **2705 行**、Profile 1180、Home 1025、GroupInfo 857。

**后端（backend-v2，整体较规范）**
- ✅ rate-limit(45)、helmet(3)、socket 握手鉴权(io.use)、39 个索引、参数化 prepare。
- 🟡 66 处 `req.body` 直接透传业务（updateSettings/updateProfile）→ 建议 zod/joi 校验。
- 🟡 动态 SQL 片段（`${assignments}`/`${where}`）虽用占位符，仍应白名单校验列名。
- 🟡 upload.js 请求路径含同步 IO（statSync/readSync/mkdirSync）→ 高并发改异步。

**桌面 Electron（安全良好）**
- ✅ contextIsolation:true、nodeIntegration:false、webSecurity:true、openExternal 有 https 校验。

---

## 四、建议优先级（按投入产出）

| 优先级 | 事项 | 收益 |
|--------|------|------|
| P0 | 可点击 div → button + aria（A11y）| 合规、可用性 |
| P0 | ContactList/Moments 虚拟化 + memo | 大列表流畅度 |
| P1 | 294 内联 style → class/常量 | 渲染性能+可维护 |
| P1 | 硬编码色/圆角 → design-tokens | 主题一致、暗色 |
| P1 | 拆分 ChatWindow(2705行) | 可维护、可测试 |
| P2 | 路由 React.lazy 代码分割 | 首屏 |
| P2 | Skeleton 三态组件统一 | 体验 |
| P2 | 后端 req.body zod 校验 | 健壮性 |
