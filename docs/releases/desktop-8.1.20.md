# Windows 8.1.20 / Web 8.1.19 / Backend 8.0.1

## 发布内容

- Windows 提供 1 至 5 号独立账号窗口，登录信息、缓存和配置分别保存，1 号保留旧版数据目录。
- 登录页和个人设置增加独立窗口入口，托盘可选择编号，再次打开同编号只聚焦已有实例。
- 修复桌面登录页顶部图标在 file:// 页面下使用根路径而加载失败。
- Web 独立窗口使用各自的会话凭据、聊天连接及缓存；普通窗口保留原有共享登录行为。
- 后端支持显式独立会话，不读取或覆盖其他窗口的登录 Cookie；图片短时票据优先于共享 Cookie。
- 媒体取票失败不会退回其他账号身份；同服务器绝对上传地址也经过票据鉴权。
- 修复桌面账号切换后仍使用旧 Bearer token 的问题。
- Web 发布包含旧 Service Worker 配置缓存兼容修复；桌面 file:// 不使用该缓存。

## 发布顺序与限制

先上线后端，再发布 Web，最后发布 Windows 安装包及配套更新元数据和签名。
Windows 更新前退出全部账号窗口；安装后可从登录页或托盘选择 1 至 5 号窗口。
Web 独立窗口关闭后不提供独立后台推送；恢复关闭标签页的登录行为由浏览器会话恢复机制决定。
Android 和 iOS 的准备改动不包含在本次发布提交中，不发布手机包。

本次使用明确的版本标签运行 CI Gate 和 Windows 构建工作流；后端及 Web 在生产机备份后发布。
提交标记跳过 push 自动部署，避免旧部署流程 stash/reset 工作区内未发布的手机改动；CI 门禁通过 workflow_dispatch 单独执行，不省略测试。

## 验证入口

- Web Vitest、ESLint、Capacitor 版本守护、生产模式及 desktop 模式构建。
- 后端 Jest 和覆盖率门禁；多窗口测试包含登录、刷新、退出、Socket 和图片身份隔离。
- `node --test desktop-electron/scripts/profiles.test.js`。
- `desktop-electron/scripts/multi-window-smoke.cjs`：真实 Electron 独立目录、重开持久化、登录图片加载。
- `scripts/multi-window-browser-smoke.cjs`：临时数据库中三个浏览器账号同时登录及独立退出。
- 发布后核对真实 API 隔离响应头、不含 Set-Cookie，校验更新签名、安装包 SHA-512 和公开下载。

Windows 构建通过不等于 Windows 真机安装和多开操作验收；本机 Electron 交互回归在 Linux 上执行。
