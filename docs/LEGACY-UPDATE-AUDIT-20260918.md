# 旧版投聊更新能力、安装状态验证与过渡材料

核验日期：2026-09-18。范围仅 Windows / Android；iOS 未修改、构建、上传或发布。生产服务器沿用新加坡 `13.212.117.22`。

## 结论与发布边界

**已检查的旧版没有能加载本轮 UI 改版的热更新机制。** Windows 8.1.26 使用 NSIS 整包更新；Android 8.1.4–8.1.18、8.1.24 使用系统 APK 安装器。更新清单或远程服务配置不是 UI 资源加载器，上传 HTML/JS/主题 JSON 不能使这些已安装客户端突然具备加载能力。

Android 8.1.25 / code 82 是此前已发布的新 UI 整包。本轮发现 Android 10 上旧更新器读取 APK 证书的兼容缺陷，修复版本准备为 **8.1.26 / code 83，待审阅，不发布**。Windows 新 UI 候选仍为 8.1.27，缺正式 Authenticode 凭据，未构建或发布安装包。没有修改现网版本清单、下载入口、Web 服务或后端，也没有发布伪称热更新的资源。

## 接续基点与历史实物

独立工作区 `/home/ubuntu/touliao-legacy-update-20260918`，分支 `fix/legacy-update-compat-20260918`，恢复基点 `d95d6903`。原 UI 分支 HEAD `729e08c87c50894de29092138bf05d5c2e9006d2` 和发布工作区保留，未 reset、覆盖或重做 UI 改版。原 Web/Windows 五个提交及后续 Android UI 均是本轮分支祖先。

- Windows：从现网下载真实 [8.1.26 安装包](https://touliao.cc/downloads/updates/touliao-8.1.26-setup.exe)，SHA256 `3933d478dc6dd8c4ffb9863abc84c4a4635c8913bfe3a70fd537b1626b4c5c46`，108,791,606 字节。解包 NSIS → `app-64.7z` → `app.asar`，实物主进程、preload、公钥和 profile 管理代码与发布提交 `5ea568c3de5c2ba1ccfc57283f590a50259fb44b` 一致（仅 CRLF 差异）。不是只查看当前开发源码。
- Android：下载 16 次历史正式发布工作流保留的已签名 `app-release.apk`，逐个验证签名、包名、versionCode、DEX 中更新地址与更新器类，并核对各自发布提交源码。完整清单：[binary-inventory.json](legacy-update-evidence/20260918/binary-inventory.json)、[source-versions.json](legacy-update-evidence/20260918/source-versions.json)。
- 历史包没有 React Native、Tinker 加载入口或 `.jsbundle` 资源；结合原始 Application/Compose/更新器源码，确认并不存在上述方案中的运行时热更系统。`HOT_UPDATE_PLAN.md`、`HOT_UPDATE_POC_SKELETON.md` 只是历史设计提案，已补充显著纠正说明。
- 没有用户版本遥测，不声称这 16 个版本各有多少活跃用户；更早版本、第三方渠道包及未取得的版本不能据此保证兼容。尤其历史源码记载 8.0.3 前曾迁移签名，不能让这些用户卸载来绕过签名，数据迁移需单独核查。

## 旧客户端的真实协议

| 平台 | 旧客户端固定入口 / 协议 | 更新器及校验 | 生效方式 |
| --- | --- | --- | --- |
| Windows 8.1.26 | `https://touliao.cc/downloads/updates/latest.yml` 与 `.sig`；generic provider，latest 通道；文件 URL / size / SHA512 | 实物 `electron-updater 6.8.9`；内置 Ed25519 公钥校验清单，缺失或无效即阻止下载；下载包 SHA512；NSIS 安装器 | 启动约 8 秒或设置/托盘检查；发现更新后验签下载；用户重启安装或退出时安装。属于应用内覆盖升级 |
| Android 8.1.4–8.1.18、8.1.24 | `https://touliao.cc/downloads/touliao-android-version.json`；`versionCode/versionName/url/notes/sha256` | OkHttp 检查更大 code；下载 APK 后 SHA256；核对 APK 内实际 code；比对当前 APK 签名证书集合；FileProvider + 系统 PackageInstaller | 打开“我”会检查并提示，或“我 → 设置 → 检查更新”；授权安装来源、确认系统安装，完成后打开应用。属于应用内覆盖升级 |

Windows `config.json` 仅下发服务器等配置；实物用 `loadFile(app.asar/web/dist/index.html)`，没有远程 renderer 加载器。当前公网配置没有 `updateFeed` 字段，清单获取和验签均使用原 canonical 地址。旧代码的 `updateFeed` 覆盖只作用于验签 URL，不能贸然用它迁移 electron-updater 下载地址，本轮未改变该字段。

Android 包名始终 `com.touliao.app`；16 个历史包及现网 8.1.25 的证书 SHA256 均为：

```text
345e9485b4220e607c40afee304f16ca00f87d6f080184423defc0ea1e85983c
```

这 16 份发布源码中的 UpdateChecker、ApkDownloader、ApkInstaller、UpdateViewModel 完全一致。实际历史客户端按旧协议已能发现现网 code 82，因此没有必要再新增一个旧版不认识的更新接口。

## 原生改动和热更边界

- Windows 新 UI 相对 8.1.26 不需要新增主进程、preload 或 Electron 依赖；变化在 renderer HTML/CSS/JS、图标与字体样式。但 8.1.26 把 renderer 固定装在 app.asar，仍必须先通过整包加入加载器，才有后续兼容 renderer 资源热更新的可能。
- Android 本轮 UI 涉及 45 个正式 Kotlin 源文件，包括主题、图标、基础控件及登录、会话/聊天、联系人、群、通话、文件、资料、设置等 Compose 页面。这些编译进 DEX，不是旧版能解释的 CSS/JS 资源。没有把原生页面伪装成远程资源，也没有引入 RN/Tinker 替换现有技术栈。
- 现网 8.1.25 已包含这些 Android 页面；一次真正成功的覆盖升级后，新 UI 随新进程启动生效。已安装旧版不会因为清单刷新而直接变成新 UI。

## Android 证书读取缺陷及修复

在未改动的历史 APK 上，API 29 原生模拟器实际经历：发现生产更新 → 下载完成 → SHA256 一致 → 签名步骤错误拦截。8.1.4、8.1.18、8.1.24 均复现。不是不同生产密钥导致，独立 apksigner 已证明证书相同。

[AOSP Android 9](https://android.googlesource.com/platform/frameworks/base/+/android-9.0.0_r1/core/java/android/content/pm/PackageManager.java) 和 [Android 10](https://android.googlesource.com/platform/frameworks/base/+/android-10.0.0_r1/core/java/android/content/pm/PackageManager.java) 的 `getPackageArchiveInfo` 只在请求 `GET_SIGNATURES` 时收集证书。旧客户端在 API >= 28 仅传 `GET_SIGNING_CERTIFICATES`，导致 `signingInfo` 为空，最终误判签名不匹配。Android 9 的结论来自 AOSP 源码，尚非该版本设备实测；不同厂商回补行为仍需真机验证。

修复提交 `77bf376a` 同时请求两个标志以触发原生证书收集；仍只读取 `apkContentsSigners`、比较全部当前证书集合，并对空值、异常、篡改或不匹配继续拒绝。没有放开历史签名回退或关闭校验。签名兼容探针加载的是正式 APK 里真实编译的 `ApkInstaller` 类，在 API 29 系统 PackageManager 上运行，不替换生产类或系统校验。

修复候选 [正式签名构建 35373394824](https://github.com/zhaocaimao008/touliao/actions/runs/35373394824) 成功；参数 `deploy=false`，发布步骤明确 skipped。96 项 JVM 测试全部通过。实际候选 APK 为 `8.1.26 / 83`、56,836,984 字节，SHA256 `29d51c67ac255f6af3a0d717ace35688a6fba49834925943a01e8302dedcc0bc`，构建提交 `77bf376a5301d0e72fc846323db6028fdaeff996`。原包名、生产默认地址、四种 ABI、原正式密钥和 v1/v2/v3 签名验证通过，未加入测试 fixture。

API 29 原生探针实测：旧标志读不到 signingInfo；双标志能读到；旧 APK 中的验证器拒绝同签名新包，修复后的真实验证器接受同签名包、拒绝篡改包。另以实际现网 8.1.25 → 候选 8.1.26 的 `adb install -r` 验证启动、UID、首次安装时间和私有文件标记保留；此项单独标记为 adb 覆盖冒烟，不冒充旧客户端应用内升级或生产账号测试。

该修复不能通过服务器清单注入已安装旧 DEX。因此，受影响设备若要使用新 UI，必须先经官方同签名 APK 做一次外部覆盖安装（保留应用数据，不能卸载）。本轮只准备未发布的 code 83 修复候选，不把外部覆盖安装当成已修通的旧版应用内升级，也不宣称候选新增了热更新加载器。

现网 8.1.25 也沿用了有缺陷的更新器；原生探针的“旧验证器”正来自该现网 APK。因此仅外部安装 8.1.25 可以获得新 UI，但不能修复受影响系统上的后续应用内更新。code 83 修复的是此兼容缺陷，仍然通过整包更新后续原生界面。

## Windows 签名材料

检查仓库 Secrets 名称、production 环境、现有构建配置和本机凭据文件：没有可用 `WINDOWS_CERTIFICATE_BASE64` / `WINDOWS_CERTIFICATE_PASSWORD`，也没有可复用 PFX/P12 或已配置的云签名凭据。存在的 `UPDATE_PRIVATE_KEY` 是 Ed25519 更新清单密钥，不能用作 Authenticode。

需要现有发布流程可用的有效 Windows 代码签名证书和对应私钥（PFX/P12）、密码、正确发布者身份及受信任时间戳；或完整可接入的等效云/HSM 签名凭据与配置。继续沿用旧版内置公钥对应的 Ed25519 私钥，不生成新公钥替换旧信任链。

实物 8.1.26 的安装包无 Authenticode，且旧主进程已有 `verifyUpdateCodeSignature` 空实现，即历史客户端未检查 Windows 发布者身份。这是历史事实，**不是本轮关闭校验**。旧版仍强制 Ed25519 清单校验；现有新版发布流程的 Authenticode 门禁也保留，没有用历史缺陷绕开正式签名要求。

使用实物内置公钥验证现网清单成功；修改清单一字节或修改签名一字节均拒绝。此项是独立加密检查，不等于已安装客户端完成新版本下载/安装。

## 实际安装状态验证

全部原生测试都使用官方历史安装包。Windows 在 GitHub Windows VM 内运行真实 NSIS 安装及已安装 Electron；Android 在 Android 原生系统模拟器内运行历史正式 APK，不是浏览器或新版首次安装测试。

账号 API 使用隔离 loopback fixture，通过真实旧 UI 登录、真实 token 存储和真实聊天缓存；更新检查与下载直接使用原生产 HTTPS 地址，没有伪造更新接口、替换验证方法或用 adb 安装新包冒充应用内升级。fixture 不连接生产账号或数据库；没有声称实时聊天/通话服务联测通过。

| 原生测试 | 已得到的结果 | 边界 |
| --- | --- | --- |
| Windows 8.1.26 安装、检查、重启 | NSIS 安装成功；运行路径为已安装 app.asar；公钥有效；旧客户端访问现网并报告最新仍 8.1.26；同版本重启后隔离登录和 IndexedDB 消息缓存保留，登录仅 1 次 | 没有可签名的 8.1.27，发现新版本、下载/安装新版、失败恢复及跨版本数据保留仍未验证 |
| Android API 29：8.1.4、8.1.18、8.1.24 | 生产版本发现、下载 SHA256、断网失败后恢复重试通过；缓存 APK 替换成真实旧包后被 code 校验拒绝并删除 | 真实签名读取兼容缺陷阻止系统安装；这 3 项完整升级为失败，不能写成通过 |
| Android API 26：8.1.24 → 8.1.25 | 从旧客户端发现、下载、校验，到原生系统安装全部通过；断网重试、错误 code 删除、取消安装保留旧版本均通过；升级后无需重新登录，历史接口关闭时仍呈现原加密消息缓存，UID/首次安装时间不变 | Android 8.0 原生模拟器，隔离账号；不是手机真机或生产账号结论 |
| Android API 34：8.1.4、8.1.18、8.1.24 → 8.1.25 | 3 项均完成以上完整链路；真实系统安装器执行覆盖，没有 adb 安装新包；新 UI 呈现旧缓存、登录仅 1 次 | Android 14 原生模拟器；其余 13 个历史版本及其他 OS/OEM 组合仅静态核对，不冒充逐个实测 |
| Android API 29：8.1.24 → 未发布 8.1.26 候选 | 从已登录且已有缓存的真实旧 APK 出发，经系统 Files 打开候选 APK，系统安装器取消/再安装通过；登录仅 1 次，旧消息在历史接口离线后仍显示，UID/首次安装时间保留 | 明确为外部覆盖安装，不是旧应用内升级；adb 只复制候选文件到 Downloads，没有安装新包；候选未发布 |

Windows 成功测试和 Android 29 缺陷证据：[原生安装测试 35371751461](https://github.com/zhaocaimao008/touliao/actions/runs/35371751461)。Android 26 完整升级：[35373461004 中的 API 26 job](https://github.com/zhaocaimao008/touliao/actions/runs/35373461004)。该运行整体为失败，因为其他 API 34 job 的脚本尚不能识别 Android 14 Settings 的 Compose 授权开关；不能把整体运行标成全通过。早期测试亦曾遇脚本 NSIS 路径、离屏菜单定位和测试驱动 `require` 用法问题；修正的是审计脚本，不是旧安装包。失败运行与截图完整保留。

Android 34 三项完整通过：[35374103956](https://github.com/zhaocaimao008/touliao/actions/runs/35374103956)。物理 Windows 电脑、手机、真实生产账号、附件历史、系统权限/OEM 安装器矩阵及四端真实音视频均未验证，不能用以上 VM/模拟器结论替代。

Android 29 外部过渡安装完整通过：[35374868953](https://github.com/zhaocaimao008/touliao/actions/runs/35374868953)。之前的 `35374439870` 停在测试驱动未识别系统 Files 的 CONTINUE 提示；修正脚本对真实确认界面的定位后重跑，没有跳过系统安装器或签名校验。

用户操作与生效时间：已验证组合可打开“我 → 设置 → 检查更新”，下载后按系统提示授权并确认安装，再打开客户端使用新 UI；无需卸载或重新登录（登录保留仅在上述隔离账号实测）。Android 10 受影响组合不能靠反复点更新解决；候选外部覆盖流程另测，不向生产用户自动推送。Windows 8.1.26 目前检查仍返回本版，用户不会因此得到尚未发布的 8.1.27 UI。

## 最小过渡方案与材料

1. **当前 UI 一次性过渡**：Windows 继续用兼容旧版的 NSIS + 原 Ed25519 清单协议，正式签名材料补齐后才能生成完整 8.1.27；Android 用同包名、同密钥、更大 code 的原生 APK。受旧证书读取缺陷影响的设备只能从系统层进行这一次覆盖安装。账号、登录存储和数据库路径不迁移、不清空；不指示卸载。
2. **后续 Windows 热更新**：需要在过渡安装包中先实现受签名保护的 renderer 加载器，按 Windows/native-build/renderer-ABI 隔离通道、大小和哈希限制、原子切换、启动健康确认、失败回退内置 renderer，并保持既有文件 origin 与 profile/IndexedDB 路径。之后才能覆盖兼容的 HTML/CSS/JS/图标/字体，原生桥、Electron 依赖和权限变化仍走安装包。这个加载器本轮未实现，不能把当前 renderer zip 投递给 8.1.26。
3. **后续 Android 最小热更范围**：沿用 Compose，仅可先实现严格 schema 的数据式主题 tokens、内置字体/图标选择；需要原生加载器、独立签名清单、native code 区间/主题 schema 隔离、最后已知正常配置与离线回退。Compose 布局、Kotlin 行为、原生 SDK 和权限仍须 APK；仅主题配置不可能覆盖本轮全部页面改版。此未来能力也未包含在 code 83 中。

已准备审阅用 Windows renderer zip、逐文件哈希、现网 Android 8.1.25 实物及清单；签名修复候选单独存放。材料 JSON 明确 `publishAllowed:false`、`compatibleLegacyHotUpdateVersions:[]`；没有把旧版无法加载的 zip 上传到公共更新目录。旧更新地址保留，未来资源按平台和兼容版本另行隔离，绝不复用 iOS 通道。

## 回退与证据保存

- 本轮无生产变更，现网 Windows 8.1.26 / Android 8.1.25 清单及签名在前后重新下载核对。上一版 APK、NSIS、blockmap 和清单继续保存在 `/home/ubuntu/touliao-release-20260918/before`；服务器已有 Android 8.1.24 备份 `/var/www/downloads/.release-backups/android/35364703651-1/` 不变。
- code 83 候选未发布，丢弃审阅候选不会影响用户；若将来已安装更大 code，不能用旧小 code 当作普通覆盖回退，应制作同签名更高 code 的修复包。恢复下载入口也不会自动降级已经安装的手机。
- 源码恢复以独立基点 `d95d6903` 为依据，仅 `git revert` 本轮确需撤销的提交；不 reset UI 分支、不回退已交付改版、不清理其他工作区。原 UI 五次提交必须保留。
- 完整实物、截图、XML、logcat、Windows 主进程日志及后续审阅包在 `/home/ubuntu/touliao-legacy-update-evidence-20260918`。仓库内保留精简机器可读索引 [legacy-update-evidence/20260918](legacy-update-evidence/20260918)。

最终审阅入口：`/home/ubuntu/touliao-legacy-update-evidence-20260918/review/index.html`；可独立搬运的包为 `/home/ubuntu/touliao-legacy-update-review-20260918.zip`。内含真实前后截图、失败截图/界面树、机器结果、协议/签名依据、正式已发布 8.1.25 APK、未发布同签名 8.1.26 APK、Windows renderer 审阅 zip 和 SHA256SUMS。Windows 新安装包因凭据缺失不在包中，任何现存 APK/zip 都没有被称为已交付的热更新加载器。
