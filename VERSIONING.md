# 版本与发布规范（VERSIONING）

> 目的：终结历史上「一个裸 `v*` tag 同时误触发桌面端 + 安卓 + iOS 发布」和
> 「tag 数字与实际产物版本对不上」的混乱。本规范为唯一真相来源。

## 1. 各端版本号 = 各自的 manifest（单一真相源 / SSOT）

各端是**独立产品线**，版本号**不强行统一成同一个数字**，各以自己的 manifest 为准：

| 端 | 版本真相源文件 | 字段 | 当前版本 |
|----|--------------|------|---------|
| 桌面端（Windows/Mac/Linux） | `desktop-electron/package.json` | `version` | 2.0.8 |
| 桌面端渲染层内嵌 | `desktop-electron/src/package.json` | `version` | 与上一致 |
| Web 前端 | `web/package.json` | `version` | 2.0.2 |
| 后端 | `backend-v2/package.json` | `version` | 2.0.0 |
| Android | `android/app/build.gradle.kts` | `versionName` / `versionCode` | 1.0.19 / code 20 |
| iOS | `ios/project.yml` | `MARKETING_VERSION` | 1.0.10 |
| 后端发现配置 | `vxin-config/config.json` | `version` | 2.0.1 |

> 桌面端走 electron-updater：`latest.yml` 的 `version` **必须**等于
> `desktop-electron/package.json` 的 `version`，且每次发布**必须递增**，否则客户端认为「无更新」。

## 2. Tag 命名规范：带端前缀，各触发各的发布

**禁止再打裸 `v*` tag。** 一律用端前缀，让发布工作流只认自己那一端：

| tag 形态 | 触发的工作流 | 用途 |
|---------|------------|------|
| `desktop-v<版本>`（如 `desktop-v2.0.5`） | `.github/workflows/windows-build.yml` | 桌面端打包 + 部署更新源 |
| `android-v<版本>`（如 `android-v1.0.2`） | `.github/workflows/android-release.yml` | 安卓签名 APK + 部署 |
| `ios-v<版本>`（如 `ios-v1.0.10`） | `.github/workflows/ios-testflight.yml` | iOS 构建 + 上传 TestFlight + 自动送外部 Beta 审核 |

版本号部分**与该端 manifest 的版本号一致**（如 `desktop-v2.0.5` ↔ desktop package.json `2.0.5`）。

## 3. 发布流程（以桌面端为例）

1. 改 `desktop-electron/package.json` 的 `version`（递增）。
2. 提交合并到 `main`。
3. 打 tag：`git tag -a desktop-v<新版本> -m "..." && git push origin desktop-v<新版本>`。
4. `windows-build.yml` 自动：Windows 打包 → 上传 `.exe`/`latest.yml`/`.blockmap`
   → SCP 部署到香港服务器 `/var/www/downloads/updates/`。
5. 验证 `https://dipsin.com/downloads/updates/latest.yml` 的 `version` 已是新版本。

安卓同理，改 `versionName`/`versionCode` → 打 `android-v<版本>` tag。

## 4. 历史遗留 tag 说明（保留但已废弃语义，勿再套用）

以下早期 tag 是「里程碑随手名」，**与任何端的实际产物版本号不对应**，且 commit 日期甚至早于
`v2.0.0`，切勿据此推断发布顺序。保留仅为历史留痕，新发布一律用第 2 节的端前缀 tag：

| 历史 tag | 实际含义 |
|---------|---------|
| `v1.0.0` | 早期移动端对齐里程碑 |
| `v2.0` / `v2.1` | 早期视觉/功能里程碑名（非产物版本） |
| `v2.0.0` | 首个三端构建 |
| `v2.0.1` | remote runtime server config |
| `v2.0.5` | 桌面端 2.0.5 白屏修复发布（**已由 `desktop-v2.0.5` 取代其语义**） |
| `v2.2.0` | 8 功能特性里程碑（非发布产物） |

> ⚠️ `v2.0.5` 这个裸 tag 曾同时误触发了一次安卓构建（run 29077152693），正是本规范
> 要杜绝的问题。自本规范起，桌面端发布用 `desktop-v*`。
