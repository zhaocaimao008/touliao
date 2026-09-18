# Windows / Android UI 发布 — 2026-09-18

接续 `729e08c8`，独立分支 `release/windows-android-ui-20260918`。原 UI 分支及其他工作区保持；不推送 main、不打裸版本标签、不触发 iOS、不单独部署 Web / 后端。

## 发布前核对

- Windows 线上 `8.1.26`；本分支准备候选 `8.1.27`，设计系统 Web / Windows 五次提交完整包含。仓库缺少 `WINDOWS_CERTIFICATE_BASE64` 和 `WINDOWS_CERTIFICATE_PASSWORD`；现有正式 Authenticode 门禁保留，Windows 暂停打包与发布，不沿用历史无签名例外。当前安装包 PE 证书表为空；Ed25519 更新签名验证通过，不能替代 Authenticode。
- Android 线上 `8.1.24 / 81`；本次准备 `8.1.25 / 82`，包名 `com.touliao.app`、生产服务 `https://touliao.cc` 与已有密钥保持。
- 旧 Android APK SHA256 `0631c12bd21cd7abd1518d4357b8f617bbe65c699b4fe82b27ab4deeb3568763`；证书 SHA256 `345e9485b4220e607c40afee304f16ca00f87d6f080184423defc0ea1e85983c`。
- 上轮原生 UI 测试及 Web / Windows 隔离测试复用；发布额外检查实际正式 APK 身份、签名、版本递增、生产地址、四种原有 ABI、无测试页面/假数据，模拟器旧版覆盖升级及私有文件保留。
- 当前渠道是官网直装 APK，不是 Google Play；现有渠道不要求 AAB。

## 发布与回退约束

本次使用既有 `Android Release APK (signed)` 工作流，在独立发布分支手动触发 `deploy=true`；不推送任何端标签，避免重复发布或连带构建。发布流水线在全部校验成功后，向既有新加坡服务器 `13.212.117.22` 的 `/var/www/downloads` 写入 Android 安装包和清单，不修改生产数据库、后端、Web、Windows、iOS 文件。

新增不可变版本链接 `touliao-android-8.1.25.apk`；保留落地页使用的 `touliao-android-latest.apk`，更新清单仍为 `touliao-android-version.json`。切换前保存旧 APK 与更新清单到 `.release-backups/android/<run-id>-<attempt>/`，并保留旧版带版本号的 APK。先验证新版本链接的公开字节，再更新入口；公开复验失败时尝试恢复之前的入口和清单，记录失败或回退结果，不报告假成功。

本机发布证据目录 `/home/ubuntu/touliao-release-20260918` 已保存发布前两端安装包与更新配置。最终状态、发布提交、运行编号和公开下载复验结果在发布完成后补充。

手机真机覆盖升级、登录会话/聊天数据库、真实推送与音视频；Windows 新版安装/升级/自动更新及真机字体仍需对应环境验证。模拟器私有文件保留不等于这些项目已通过。
