# Windows 8.1.27 自动更新发布 — 2026-09-19

本轮将此前交付的同一个 Windows 8.1.27 安装包接入旧版已有的自动更新通道，不重新构建应用，不修改客户端校验或数据存储。Android、iOS、Web 和后端均不发布。

**已发布成功。** 最终 [35425944415](https://github.com/zhaocaimao008/touliao/actions/runs/35425944415) 的公网发布、实际旧版自动升级均通过，回退 job 正确跳过。发布/测试代码提交 `baa4eb66`，安装包源提交仍为 `e764f396`。

## 包与协议

- 安装包源提交：`e764f3969fe84f9577883e790ebae7e85ce6210c`；已通过的构建 `35412981635` 和手动覆盖升级 `35413242790` 继续有效。
- 安装包 SHA256：`c2ae64ec1316d5f033b9f2afa25b3eb5bfbf56f978d8abe99b20b21c2cbcf7e0`，108,813,349 字节。
- 原 Windows 入口保持 `https://touliao.cc/downloads/updates/latest.yml`，签名为同地址加 `.sig`，更新包及 blockmap 使用带版本号的原协议文件名。
- [8.1.27 安装包](https://touliao.cc/downloads/updates/touliao-8.1.27-setup.exe)；既有 [latest 下载入口](https://touliao.cc/downloads/touliao-windows-latest.exe) 和 `touliao-windows-latest-setup.exe` 同步。
- 原 Ed25519 公钥和签名保持；公网文件重新下载后与已验证构建产物逐字节/哈希相同。

## 本次发布授权及边界

用户在已知该包没有 Windows 发布者签名的情况下，明确要求将已交付的包推送自动更新。本次仅允许 `windows-8127-publication.json` 固定的构建运行、提交和四份文件哈希，使用独立手动参数 `publish_verified_8127`；不是新增通用“跳过签名”开关。

安装包仍无 Authenticode，不将 Ed25519 描述为 Windows 发布者签名。普通正式构建的证书门禁继续保留，旧客户端 Ed25519 及下载完整性校验没有关闭。包名、应用 ID、profile 路径、后端地址和原客户端更新地址均不变。

新加坡服务器 `13.212.117.22` 上仅操作 Windows 下载文件。发布前检查现网清单/签名仍为预期 8.1.26，固定版本 URL 不允许覆盖不同字节；备份旧安装包、blockmap、下载别名与清单，再更新下载入口和清单。文件通过临时文件原子替换，清单最后生效；清单与签名切换间隙若被读到不匹配组合，客户端继续拒绝校验，重试即可。没有弱化该校验。

## 验证记录

- 发布/回退工具 6 项测试通过：正常激活与恢复、旧包与 Android 文件保留、并发版本拒绝覆盖、篡改暂存包拒绝、损坏备份拒绝、写入失败自动恢复。
- 首轮 [35414085088](https://github.com/zhaocaimao008/touliao/actions/runs/35414085088)：公网发布与校验通过；旧版实际发现 8.1.27，Ed25519 校验通过，blockmap 差分下载约 4% 后生成完整新包。测试账户的 WebSocket 被主动关闭，重连条遮住了更新按钮，原生测试未完成。保护 job 自动将清单和下载别名恢复 8.1.26，首次运行未被记为发布成功。
- 后续测试仅为隔离账号提供 Socket.IO 连接握手，避免持续重连条干扰；不伪造消息或通话成功。更新流量仍由真实旧主进程访问生产 HTTPS，未替换更新器、签名检查或 NSIS 安装器。
- 第二轮 `35414458568`：真实旧客户端显示“新版已就绪”，主进程启动了新版 NSIS 安装器；测试驱动等待 Playwright 关闭事件后才操作安装向导，导致等待不结束。终止测试后，保护 job 成功恢复 8.1.26。此轮没有完整结果，不能标为升级通过。
- 第三轮 `35425384218` 在修正安装向导与进程关闭的等待顺序期间取消；保留该轮发布与回退记录。修正后的驱动在点击真实“立即重启安装”按钮的同时操作已弹出的原生向导，不另行运行安装包。
- 第四轮 `35425584214` 保留了真实安装器截图：向导识别原用户安装位置 `D:\a\_temp\TouliaoLegacy`，明确显示将覆盖升级；但此 Windows VM 的 UI Automation 没有将可见的 NSIS “Next” 控件识别为 Button，操作记录为空，测试超时。该轮自动恢复 8.1.26。驱动随后按实际 Win32 Button 窗口与文字操作控件，仍由原旧客户端启动安装器。
- 最终 `35425944415`：真实 8.1.26 安装状态下完成断网检查失败 → 恢复网络 → 发现生产 8.1.27 → 原 Ed25519 校验 → 差分下载和完整包哈希校验 → 点击旧客户端“立即重启安装” → 原生 NSIS 的 Next / Finish → 实际运行 8.1.27。主进程日志记录 `Install: isSilent: false, isForceRunAfter: true` 与 `--updated,--force-run`，没有从测试脚本另行执行新版安装包。
- 新旧 `appPath`、`userData` 完全相同；升级后原 token 保留，登录请求总次数为 1；历史接口关闭为 503 后，仍显示升级前写入的 IndexedDB 消息缓存。机器结果 `passed:true`、`installedThroughHistoricalUpdater:true`、`accountSessionAndOfflineHistoryPreserved:true`。
- 最终运行结束后重新下载正式安装包、blockmap、清单、签名及两个 latest 安装包入口，全部匹配固定哈希。Android 清单和 Web 首页与发布前 SHA256 一致。

原生测试使用 GitHub Windows VM，不是物理 Windows 电脑。登录 API 和 Socket.IO 传输是隔离测试环境；不能据此宣称生产账号、真实双人消息、附件库或音视频联测通过。

本轮完整自动升级实测范围为 Windows 8.1.26、账号窗口 1；更早 Windows 版本、全机器安装、不同权限/OEM 环境、多账号同时运行及安装中断电恢复未逐项实测。失败恢复已验证网络中断后的重试，以及服务端发布失败时恢复旧清单；不将其扩大成所有安装故障均已验证。

截图、机器结果、安装动作和发布回执：[审阅入口](windows-auto-update-evidence/20260919/index.html)。新版截图显示新 UI 从原缓存读取 `LEGACY-CACHED-MESSAGE-MUST-SURVIVE`，明确为隔离测试消息。

## 用户操作

旧 8.1.26 使用账号窗口 1 检查更新；右上角 `↑` 为检查入口，也会在启动后自动检查。下载完成后点击“立即重启安装”，按系统安装向导完成。安装前退出其他账号窗口，保持现有安装位置，不卸载、不清理用户目录。手动安装过同版本 8.1.27 的客户端不会再次提示相同版本。

这是应用内覆盖升级；即使下载使用 blockmap 差分，也不是 renderer 资源热更新。

## 回退

最终运行使用 `/var/www/downloads/.release-backups/windows/35425944415-1/` 保存原 8.1.26 的安装包、blockmap、清单、签名和两个下载别名，完整哈希记录见发布回执。此前四轮恢复均保留记录，没有删除旧安装包。

若以后需要回退入口，通过既有部署身份执行该次暂存目录的脚本：

```bash
python3 /var/www/downloads/.windows-stage-35425944415-1/publish.py --run-id 35425944415-1 --mode rollback
```

回退会确认当前入口仍属于该次发布、备份哈希正确；若已有另一版本则拒绝覆盖。它只恢复下载入口和更新清单，不会把已升级的客户端自动降级；已安装用户的问题应通过更高版本的修复包处理，不能卸载清数据。

完整证据目录：`/home/ubuntu/touliao-windows-auto-update-evidence-20260919`。

审阅包：`/home/ubuntu/touliao-windows-auto-update-review-20260919.zip`。只包含报告和验证证据；正式 EXE 使用本报告中的下载链接，SHA256 固定。原 UI、发布、兼容修复和手动出包工作区均保留原提交。源码恢复只应 revert 独立分支上本轮所需撤销的发布/测试提交，不 reset 已有 UI 改版；源码回退不会自动恢复生产入口。
