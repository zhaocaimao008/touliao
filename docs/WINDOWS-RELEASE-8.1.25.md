# Windows 8.1.25 — 2026-09-18

本次只发布 Windows 界面调整：连续的侧栏与会话列表、清晰的文字层级、简化消息气泡、宽版设置页、适配浅色/深色及 900×600 最小窗口的登录页。修复会话列表虚拟行高与真实布局不一致、悬停出现横向滚动条的问题。

- 发布提交：`babd81e59dfd0f2a64de9af8ec8082bba9e5cc08`，标签 `desktop-v8.1.25`。
- [Windows 构建与部署](https://github.com/zhaocaimao008/touliao/actions/runs/35320429240)：成功。
- [下载 Windows 8.1.25](https://touliao.cc/downloads/updates/touliao-8.1.25-setup.exe)。现有客户端可检查更新并重启安装。
- 安装包：108790444 字节；SHA-256 `aa6f240fa0df344daa1cd6c8d8cf9e178ac2b2df205e8ffff0e85ac2535941f7`。

## 验证

- 界面改动发布前已通过前端构建、lint、240 个单元测试、37 个浏览器界面场景和 Electron 本地文件加载检查。
- Windows runner 实际安装 NSIS 包，通过桌面快捷方式六窗口启动、并发账号隔离、关闭后资料保留，以及真实 Windows preload 和样式加载、900×600 登录操作可见性检查。
- 部署工作流逐字节比对线上六个更新/下载文件；独立验证 Ed25519 元数据签名、安装包 SHA-512、版本号和 blockmap。解包确认实际资源包含 Windows 样式及正确更新公钥。
- 248 个既有网站/移动端部署文件的 SHA-256 未改变，后端健康检查及数据库状态正常。

## 发布范围与证书状态

从独立分支 `fix/windows-ui-20260918` 打桌面端标签。没有合入 main，避免触发网站部署；Android/iOS 未改版本、未构建或发布，后续跨端工作需显式整合此分支。

仓库仍缺少 Windows Authenticode 发布者证书。本次按用户要求发布 Windows 新版，沿用 8.1.24 的无发布者签名渠道；该假设及未知发布者提示已在发布过程中告知。更新元数据继续强制 Ed25519 签名，不能将其描述为 Windows 发布者签名。只在本次标签快照对缺少证书作明确例外，发布后分支已恢复原有生产证书门禁，客户端验签逻辑未修改。仍可能出现 Windows 未知发布者/SmartScreen 提示，正式发布者证书尚待配置。

本机完整证据：`/home/ubuntu/touliao-windows-release-8.1.25/`；界面证据：`/home/ubuntu/touliao-windows-ui-evidence-20260918/`。
