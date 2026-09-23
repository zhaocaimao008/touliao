# Windows 8.1.27 手动安装包 — 2026-09-19

> 后续状态：同一安装包已按用户后续指令发布到旧版自动更新通道，并通过真实 8.1.26 → 8.1.27 应用内覆盖升级。见 [自动更新发布记录](WINDOWS-AUTO-UPDATE-8.1.27-20260919.md)。下文保留出包时的历史记录。

已按用户“给我出包”的指令，通过现有 Windows 工作流 `deploy=false` 生成 NSIS x64 安装包。本次是安装包交付，未向生产下载入口或自动更新通道发布；Android、iOS 未修改或构建。

- 文件：`/home/ubuntu/touliao-8.1.27-setup.exe`，108,813,349 字节。
- SHA256：`c2ae64ec1316d5f033b9f2afa25b3eb5bfbf56f978d8abe99b20b21c2cbcf7e0`。
- 构建源提交：`e764f3969fe84f9577883e790ebae7e85ce6210c`，包含既有 Web/Windows UI 改版。
- 构建：[35412981635](https://github.com/zhaocaimao008/touliao/actions/runs/35412981635)，成功，部署 job skipped。
- 原 Ed25519 清单签名、SHA512、文件大小和 blockmap 校验通过；实物 app.asar 版本为 8.1.27，主进程/preload/更新公钥与原发布代码一致，更新地址保持原值。
- **没有 Authenticode 发布者签名**，PE 证书表为空；这是现有流程允许的手动审阅包。正式生产发布所需的签名门禁未修改，客户端现有校验未关闭。

## 验证

- 96 项字体/深浅主题渲染场景通过，运行在 Windows Chrome；此项明确不是原生 Electron 升级测试。
- 新包在 Windows VM 实际 NSIS 安装、快捷方式、原生 Electron 启动及 6 个隔离账号窗口回归通过。
- [旧版覆盖升级测试 35413242790](https://github.com/zhaocaimao008/touliao/actions/runs/35413242790) 通过：安装真实现网 8.1.26，旧 UI 登录并建立 IndexedDB 消息缓存；运行本次 8.1.27 NSIS 安装器覆盖；新进程版本、app 路径、userData 与文件 origin 符合预期；旧 token 保留，登录次数为 1；历史接口返回 503 时，新界面仍显示原消息缓存。
- 上述账号 API 是隔离 fixture，安装器和已安装 Electron 为真实产品二进制。未测试物理 Windows 电脑、真实生产账号、附件库及音视频；未测试自动更新到候选版，不称作热更新。
- 重新下载 CI 产物后校验签名和文件哈希，交付路径的 EXE 与该产物一致；现网 latest.yml 与 latest.yml.sig 在前后逐字节哈希一致，仍为 8.1.26。

机器结果：[windows-package-evidence/20260919](windows-package-evidence/20260919)。完整截图、构建记录和旧版/新版安装测试日志在 `/home/ubuntu/touliao-windows-package-evidence-20260919`。

## 保留与回退

没有生产入口切换，无需生产回退。原 8.1.26 安装包、blockmap、清单和签名继续保留在 `/home/ubuntu/touliao-release-20260918/before`。若手动安装后遇问题，先保留现有用户目录和现场，不通过卸载清数据解决；旧版重新覆盖及跨版本数据库回退尚未验证。

本轮独立分支 `build/windows-ui-package-20260919` 只增加安装升级审计和交付记录，原 UI / 发布 / 审计工作区保留。源码恢复可仅 revert 本轮测试与文档提交，不 reset 已有 UI 改版。
