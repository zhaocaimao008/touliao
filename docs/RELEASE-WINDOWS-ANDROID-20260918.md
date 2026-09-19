# Windows / Android UI 发布 — 2026-09-18

> 2026-09-19：已另行生成 Windows 8.1.27 手动安装包并完成旧版覆盖测试，尚未正式发布，见 [安装包交付记录](WINDOWS-PACKAGE-8.1.27-20260919.md)。

> 后续旧版实物审计发现：API 29 上历史 Android 更新器会误报同签名 APK 不匹配。下文 `adb install -r` 结果不等于旧客户端应用内升级通过；各版本/系统的实际升级结果、未发布修复候选和热更新边界以 [旧版更新审计](LEGACY-UPDATE-AUDIT-20260918.md) 为准。Windows / Android 历史包均没有本轮 UI 资源热更新加载器。

## 最终状态

| 平台 | 版本 | 结果 | 下载 / 提交 |
| --- | --- | --- | --- |
| Android | **8.1.25 / versionCode 82** | **已发布，已从公网重新下载验证** | [正式 APK](https://touliao.cc/downloads/touliao-android-8.1.25.apk)，构建提交 `9733b33199c2587740fca0486cd0bc6e597cc7af` |
| Windows | 候选 **8.1.27**；现网 **8.1.26** | **新版暂停，未构建、未发布**：缺少正式 Authenticode 凭据 | [现网旧版 8.1.26](https://touliao.cc/downloads/updates/touliao-8.1.26-setup.exe)，旧版提交 `5ea568c3de5c2ba1ccfc57283f590a50259fb44b`；候选版本准备在 `9733b331` |

Android 于 2026-09-18 15:59 UTC 通过现有官网下载渠道发布到**新加坡**服务器 `13.212.117.22`。成功运行：[Android Release APK (signed) / 35364703651](https://github.com/zhaocaimao008/touliao/actions/runs/35364703651)。官网既有 [latest 入口](https://touliao.cc/downloads/touliao-android-latest.apk) 已更新；[更新清单](https://touliao.cc/downloads/touliao-android-version.json) 指向带版本号的新 APK。现有渠道为官网直装，不要求 AAB，本次未生成 AAB。

Windows 仓库 Secrets 和 production 环境均未提供 `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD`。保留现有正式签名门禁，没有重复历史无签名例外。现网旧安装包 PE 证书表为空；其 Ed25519 更新清单签名有效，但不能替代安装包 Authenticode。没有新 Windows 安装包或自动更新发布成功的结论。

## 来源与操作范围

- 接续干净的 UI 分支 `ui/design-system-20260918`、提交 `729e08c87c50894de29092138bf05d5c2e9006d2`，使用独立分支 `release/windows-android-ui-20260918`，保留所有原提交和其他工作区。
- 原 Web / Windows 五次改版提交 `aa740615`、`755aac1b`、`b4f551b7`、`31b8d322`、`20aef960`，以及后续 Android UI 提交，均为发布提交祖先。
- 本轮产品改动只有 Android 版本从 `8.1.24 / 81` 递增为 `8.1.25 / 82`、Windows 候选版本从 `8.1.26` 递增为 `8.1.27`。已有业务代码、包名、签名配置、生产服务地址保持。
- 使用现有 Android 手动工作流 `deploy=true`，只推送独立发布分支；没有推送 main 或任何平台标签。main 仍为 `45dccd9963cad8dec00ef8d13019207491016fb4`。
- **未修改、构建、上传、发布 iOS，未提交 TestFlight / App Store；未单独部署 Web、后端，未操作生产数据库。** 原 UI 分支与原工作区保持不变。
- 增加 Android 发布身份/升级检查、事务备份及带并发保护的回退工具；正式构建继续使用既有 keystore Secrets 和生产配置，没有导出或更换密钥。

## 验证结果

| 检查 | 结果及边界 |
| --- | --- |
| 正式构建 | `testDebugUnitTest assembleRelease` 成功；96 项 JVM 测试，0 失败、0 跳过 |
| 身份与签名 | `com.touliao.app` 不变；与线上旧包证书 SHA256 完全一致；v1、v2、v3 均验证通过 |
| 覆盖升级版本 | 实际 APK `8.1.25 / 82` 高于旧包 `8.1.24 / 81`；四种既有 ABI 保留 |
| 正式配置 | APK 非 debuggable，包含生产默认地址 `https://touliao.cc`；无 ReviewRunner / UiReviewActivity / 测试夹具或演示服务地址 |
| 原生模拟器 | API 29 x86_64：实际安装旧正式 APK，再执行 `adb install -r` 安装新正式 APK；新旧登录页启动成功，无检测到的崩溃/ANR；应用 UID、首次安装时间、私有文件标记保留 |
| 发布与回退工具 | 4 项事务/并发保护测试通过；本地错误证书、篡改 APK、相同 versionCode 三项负向校验均拒绝 |
| 公网复验 | 重新下载版本 APK 与 latest APK，二者及 CI 产物字节完全一致；SHA256、ZIP CRC、实际包版本与签名复验通过；更新清单 URL 和哈希正确 |
| 旧版保留 | 公开下载的旧 Android 8.1.24 与发布前备份字节完全一致；Windows latest.yml 与 latest.yml.sig 与发布前备份完全一致 |
| 原 UI 验证 | 复用上轮 UI 改版报告与截图，不重复运行其他平台构建；原始资料在 `/home/ubuntu/touliao-native-ui-evidence-20260918` |

Android APK 大小 **56,836,978 字节**，SHA256：

```text
6a7dde4ce989a41f525c365296c2047608c65cf652a1242cd2ce5a6ef58bc5b9
```

原生产签名证书 SHA256（新旧一致）：

```text
345e9485b4220e607c40afee304f16ca00f87d6f080184423defc0ea1e85983c
```

首次运行 `35363560520` 在发布前校验阶段失败，未上传。下载该产物独立检查后，证书与旧包一致；固定使用工作流指定的 Build Tools 34.0.0，并为 v1 增加独立的 JAR 验证后重新执行全部门禁。minSdk >= 24 时默认签名验证优先使用 v2/v3，不能用默认输出中的 `v1=false` 判断 JAR 签名缺失。签名、身份及升级门禁均未移除。

机器可读记录位于 [release-evidence/20260918](release-evidence/20260918)：发布回执、公开下载复验、签名检查、模拟器升级结果。完整 APK、日志及前后登录截图位于本机 `/home/ubuntu/touliao-release-20260918`，成功运行的 Actions Artifacts 也保存了产物与记录。

## 回退依据与方法

Android 切换前的完整 APK、更新清单与回执保存在服务器：

```text
/var/www/downloads/.release-backups/android/35364703651-1/
```

旧 APK 仍可从 [Android 8.1.24](https://touliao.cc/downloads/touliao-android-8.1.24.apk) 下载。旧包 SHA256：`0631c12bd21cd7abd1518d4357b8f617bbe65c699b4fe82b27ab4deeb3568763`。本机两端原安装包及原更新配置另存于 `/home/ubuntu/touliao-release-20260918/before`。

如需回退下载入口，由已有部署身份在新加坡服务器执行（本次没有执行回退）：

```bash
python3 /var/www/downloads/.android-stage-35364703651-1/publish.py --run-id 35364703651-1 --rollback
```

该命令校验当前入口仍属于本次发布、备份未损坏，随后恢复原 APK 和原更新清单；若另一版本已发布则拒绝覆盖。回退后应再次公开下载并核对原哈希。它只恢复下载入口，不回滚已经升级的手机；已安装 code 82 的用户需要更高 versionCode 的修复包，不能将 code 81 当作普通覆盖升级。

Windows 未切换入口，无须执行回退。其上一版安装包和更新配置已本地保留。若要撤销本轮源码准备，先按 `git log` 选择本发布分支提交进行 `git revert`，不 reset 原 UI 分支，不回退已经完成的改版提交；源码撤销也不会自动撤销线上发布。

## 仍未验证

- Android 手机真机覆盖升级后的既有登录会话、聊天数据库、附件、真实推送和音视频；模拟器私有文件保留不代表上述项目已通过。
- Windows 新版签名、构建、真机安装、覆盖升级、自动更新与字体效果：因正式签名材料未配置，全部保留为未完成。
- Windows / Android / iOS / Web 四端真实音视频联测仍未验证；本次未对 iOS 作任何发布操作。
