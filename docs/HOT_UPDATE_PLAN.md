# 三端真热更新技术方案书

> v信 热更新小队 · 机器人③ · 真热更新方案
> 日期：2026-07-10 | 版本：v0.1（方案评审稿）

---

## 目录

1. [两种热更新的定义与能力边界](#1-两种热更新的定义与能力边界)
2. [三端当前架构与热更新能力对照](#2-三端当前架构与热更新能力对照)
3. [路线对比：RN+CodePush vs Flutter+Shorebird vs 维持原生+静默覆盖](#3-路线对比)
4. [推荐方案：RN + 自建 OTA 热更系统](#4-推荐方案rn--自建-ota-热更系统)
5. [迁移清单：哪些退场、哪些复用、哪些新写](#5-迁移清单)
6. [分阶段路线图](#6-分阶段路线图)
7. [自建热更服务器方案](#7-自建热更服务器方案)
8. [工时与风险评估](#8-工时与风险评估)
9. [回滚策略](#9-回滚策略)
10. [附录：关键技术选型说明](#10-附录关键技术选型说明)

---

## 1. 两种热更新的定义与能力边界

### 1.1 JS Bundle 热更新（真·热更）

| 维度 | 说明 |
|------|------|
| **本质** | 应用启动时从远程下载最新 JS Bundle，替换本地 bundle，重新渲染界面 |
| **能改什么** | UI 布局、业务逻辑、API 调用、路由跳转、状态管理、socket 连接逻辑 |
| **不能改什么** | 原生平台代码（摄像头、通知、蓝牙等原生模块）、系统权限声明、Apple 审核所见的初始功能集 |
| **生效时机** | 下次重启应用或调用 `reload()` 后立即生效 |
| **分发通道** | 自己的 OTA 服务器（或 CodePush / Shorebird 等服务） |
| **适用端** | Android (✅ 完全), iOS (⚠️ 有限制), 桌面 (✅ 完全) |

### 1.2 整包静默覆盖更新（半·热更）

| 维度 | 说明 |
|------|------|
| **本质** | 后台下载完整 APK/IPA/安装包，静默安装，用户无感（或仅弹一次"重启"） |
| **能改什么** | 一切——包括原生代码、原生模块、权限声明等 |
| **不能改什么** | iOS 不允许后台静默安装（必须走 App Store 审核），Android 需用户确认安装 |
| **分发通道** | 自己的下载服务器 + 本地版本比对 |
| **适用端** | Android (✅ 完全, 但需用户点击"安装"), 桌面 (✅ 完全, electron-updater), iOS (❌ 不可行) |

### 1.3 iOS 苹果政策边界（最关键约束）

Apple App Store Review Guidelines 第 3.3.2 条明确：

> **允许**：通过 JavaScriptCore / WKWebView 下载并执行 JavaScript，用于更新应用的业务逻辑和 UI 呈现。
> **禁止**：下载包含新功能的代码，绕过 App Store 审核向用户推送「功能级更新」；对 App 的「核心功能」做重大变更而不经过审核。
> **禁止**：下载和执行原生代码（DLL / framework / dylib / 动态库）。

**v信 的合规做法**：
- 只能热更 JS Bundle（React Native 的 `main.jsbundle`），不能热更新原生 Swift/Kotlin 模块。
- 初始上架的 App 必须包含全部核心功能（聊天、好友、群组、音视频通话的入口）。
- 热更只能做 UI 优化、性能修复、业务逻辑调整，不能"新增审核时没有的功能"（如新增直播模块）。
- 每次 Store 版本提交时，提交的 JS Bundle 作为基线存储，审核人员启动 App 看到的就是基线版本。

---

## 2. 三端当前架构与热更新能力对照

| 维度 | Android | iOS | Desktop (Electron) |
|------|---------|-----|-------------------|
| **当前框架** | Kotlin/Compose (122文件) | Swift (83文件) | Electron 30 + electron-updater |
| **渲染引擎** | Android View/Compose | UIKit/SwiftUI | Chromium |
| **网络层** | 原生 HTTP 请求（各自实现） | URLSession | axios（与 web 共享） |
| **Socket** | 原生实现 | Starscream | socket.io-client（与 web 共享） |
| **热更能力（现状）** | ❌ 无 | ❌ 无 | ⚠️ 整包静默覆盖（electron-updater） |
| **真·热更（JS Bundle）** | ✅ 完全支持 | ⚠️ 受 Apple 政策约束 | ✅ 完全支持（已有 web 构建管线） |
| **整包静默覆盖** | ✅ 支持（需用户确认） | ❌ 不可行 | ✅ 支持（electron-updater 已有） |

**关键现状**：Android/iOS 各维护一套原生实现，与 web (React 18 + 1.26万行) 三套代码逻辑重复、bug 修复需三端同步修改、新功能上线要同时打包三端。

---

## 3. 路线对比

### 3.1 对比矩阵

| 维度 | A. RN + CodePush / 自建 OTA | B. Flutter + Shorebird | C. 维持原生 + 整包静默覆盖 |
|------|--------------------------|------------------------|------------------------|
| **现有 React 资产复用** | ✅ 1.26万行 web/src 可直接移植（React 18→RN 语法迁移极小） | ❌ 零复用，Figma 重绘、Dart 重写全部 UI 和逻辑 | ❌ 无复用（但也不需重写） |
| **学习成本** | 低（团队已掌握 React/JS） | 高（需学 Dart/Flutter 框架） | 低（维持现状） |
| **热更能力** | ✅ JS Bundle 真·热更 | ✅ Shorebird Dart VM Patch | ❌ 仅整包覆盖（iOS 不可热更） |
| **iOS 合规性** | ✅ 明确合法（JS bundle 更新） | ⚠️ 灰色地带（Dart VM 补丁） | ✅ 无热更，合规 |
| **性能** | ⚠️ JS Bridge 有开销 | ✅ 接近原生 | ✅ 原生性能 |
| **开发效率** | ✅ 一次写，三端跑 | ✅ 一次写，两端跑 | ❌ 三端分别开发 |
| **维护成本** | ⚠️ 中（需保留部分原生模块） | ✅ 低（单一代码库） | ❌ 高（三端独立维护） |
| **自建服务器** | ✅ 简单（nginx 托管 zip） | ✅ Shorebird 平台（需自建哨兵实例） | ❌ 不需要（靠应用商店/electron-updater） |
| **迁移风险** | ⚠️ 中（渐进式迁移，不影响现有端） | 🔴 高（全量重写，必须端到端可用再切换） | ✅ 无迁移风险 |
| **总工期（估）** | 6-8 周（POC 2周 + 逐屏 4-6周） | 14-20 周（全量重写 + 测试） | 0 周（但不解决问题） |

### 3.2 推荐：A. RN + 自建 OTA 热更系统

**理由**：
1. **资产复用力最强** — 已有 React 18 + axios + socket.io-client + react-router-dom（1.26万行），语法迁移量 < 5%（JSX 调整、`View`/`Text` 替换 `div`/`span`、样式从 CSS 切到 StyleSheet）。
2. **即插即用** — web/src 的逻辑层（网络请求、socket 连接、状态管理）几乎原封不动搬进 RN 项目。
3. **热更管线可在第1阶段就打通** — POC 阶段 2 周内即可验证"修改聊天列表 UI→保存 JS Bundle→上传服务器→App 重启后生效"。
4. **风险最低** — 原生端保持可用，RN 端以"新增移动端入口"的方式平行建设，不会影响现有用户。
5. **iOS 政策最清晰** — React Native 的 JS Bundle 热更被 Apple 明确允许，而 Shorebird 的 Dart VM Patch 在政策上处于灰色地带。
6. **自建 OTA 服务器成本极低** — 复用现有 nginx + `/var/www/downloads/` 即可承载。

**为什么不选 Flutter**：
- 现有 1.26 万行 React 零复用，需 Dart 全量重写。时间和风险都不可接受。
- 即使 Shorebird 提供 Dart VM Patch，在 iOS 上的政策合规性不如 RN 清晰。

**为什么不维持现状**：
- 一个 bug 要修三处（web、Android、iOS），新功能上线需要同时打包三端，热更能力为零。
- 三端代码逻辑已经出现分化（如 socket 重连策略、消息渲染不一致），维护成本持续上升。
- iOS 整包审核 1-2 天，Android 整包审核数小时，桌面 electron-updater 相对自主但仍然要用户下载完整安装包。

---

## 4. 推荐方案：RN + 自建 OTA 热更系统

### 4.1 架构总览

```
┌─────────────────────────────────────────────────────┐
│                  自建 OTA 服务器                       │
│  (https://dipsin.com/downloads/ota/)                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ app.json  │  │ bundle-v1/   │  │ bundle-v2/    │  │
│  │ (版本清单) │  │  index.bundle│  │  index.bundle │  │
│  │           │  │  assets/*    │  │  assets/*     │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────┬───────────────────────────────┘
                      │ HTTPS GET
┌─────────────────────▼───────────────────────────────┐
│                   移动端 App                          │
│  ┌──────────────────────────────────────────────┐   │
│  │  RN 容器 (React Native 壳)                    │   │
│  │  启动 → 请求 app.json → 比对版本 → 下载新 bundle │   │
│  │  → 缓存 → reload()  /  下次启动生效             │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  原生模块桥接层                                 │   │
│  │  (摄像头、推送、文件系统、音视频通话等已有模块)     │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 4.2 自建 OTA 协议

替代 react-native-code-push 后端，自建极简 OTA 协议：

**版本清单文件 `app.json`**
```json
{
  "latestVersion": "2.0.1",
  "minVersion": "2.0.0",
  "bundleUrl": "https://dipsin.com/downloads/ota/v2.0.1/index.bundle",
  "assetsUrl": "https://dipsin.com/downloads/ota/v2.0.1/assets.zip",
  "hash": "sha256:aabbccddeeff...",
  "releaseNotes": "修复消息气泡间距；优化长列表滚动性能",
  "rollback": {
    "previousVersion": "2.0.0",
    "rollbackBundleUrl": "https://dipsin.com/downloads/ota/v2.0.0/index.bundle"
  }
}
```

**客户端热更流程**
```
App 启动
  ├─ 读取本地缓存的 bundle 版本
  ├─ HTTP GET app.json
  ├─ 比对 latestVersion > 本地版本 && minVersion <= 本地原生版本号
  │   ├─ 是 → 下载新 bundle + assets（差量可选）
  │   │      → 校验 sha256
  │   │      → 写入本地缓存目录
  │   │      → 重启 RN 容器（热更生效）
  │   └─ 否 → 使用本地缓存 bundle 正常启动
  └─ 如果加载失败 → 回退到原生壳中内置的基线 bundle
```

---

## 5. 迁移清单

### 5.1 安卓/iOS 原生需退场的模块

这些模块在切换到 RN 后不再需要各自的原生实现（由 RN 统一接管）：

| 模块 | Android 文件 | iOS 文件 | 替代方案 |
|------|-------------|---------|---------|
| 聊天列表 UI | `ChatListScreen.kt` 等 | `ChatListViewController.swift` 等 | RN FlatList 统一渲染 |
| 消息气泡渲染 | `MessageBubble.kt`、`MessageAdapter.kt` | `MessageBubbleView.swift` 等 | RN 自定义组件统一渲染 |
| 联系人列表 | `ContactListScreen.kt` 等 | `ContactListViewController.swift` 等 | RN SectionList + 搜索栏 |
| 设置页面 | `SettingsScreen.kt` 等 | `SettingsViewController.swift` 等 | RN 单页组件 |
| 登录/注册 | `LoginActivity.kt` 等 | `LoginViewController.swift` 等 | RN 表单组件 |
| 网络请求层 | 各原生 HTTP 调用 | URLSession 各调用 | RN 统一用 axios（从 web/src 移植） |
| Socket 连接层 | 各原生 WebSocket | Starscream | RN 统一用 socket.io-client（从 web/src 移植） |
| 路由/导航 | Intent + NavGraph | NavigationController segues | RN react-navigation |

> ⚠️ **保留的原生模块**：摄像头 (CameraX / AVFoundation)、本地推送通知、文件下载服务、音视频通话（WebRTC 原生层）、指纹/面容认证、应用生命周期管理。这些通过 RN Native Module 桥接暴露给 JS 层。

### 5.2 web/src 可直接复用的逻辑层

| 文件/模块 | 说明 | 是否需改动 |
|-----------|------|-----------|
| `axios` 封装（API 拦截器、Token 刷新） | 网络层 | 仅改 baseURL 加载方式 |
| `socket.io-client` 连接管理 | 实时通信 | 需处理 App 前后台生命周期 |
| `react-router-dom` 路由结构 | 页面路由 | 替换为 `@react-navigation/native` |
| 消息数据模型 / 类型定义 | 类型接口 | 原封不动移植 |
| Socket 事件处理（消息收发、未读、已读） | 事件总线 | 几乎无改动 |
| 用户状态管理（useContext / 自定义 hooks） | 状态层 | 可复用，推荐迁移到 zustand 或 Redux Toolkit |
| 工具函数（时间格式化、emoji 解析、文本处理） | utils | 原封不动移植 |
| 时间线格式（timeago.js） | 格式化 | 原封不动移植 |
| `dompurify` 消息净化 | 安全层 | 原封不动移植 |

### 5.3 需要新写的 RN UI 组件

| 组件 | 工作量 | 说明 |
|------|--------|------|
| 聊天列表（ConversationList） | ⭐⭐ | 用 FlatList 替代 react-window；下拉刷新、Swipeable（滑动删除/置顶） |
| 消息气泡（MessageBubble） | ⭐⭐⭐ | 最复杂的组件——富文本、图片、文件、语音、引用消息、回复链 |
| 输入栏（MessageInput） | ⭐⭐ | @提及、表情面板、语音录制、附件菜单 |
| 联系人列表（ContactList） | ⭐⭐ | SectionList + 首字母索引 |
| 群组详情（GroupDetail） | ⭐⭐ | 成员列表 + 设置项 |
| 登录/注册流程 | ⭐ | 复用 web 表单逻辑 |
| 设置页 | ⭐ | 静态列表 + 开关 |

> **总计新写 UI 工作量：约 30-40 个 RN 组件，2 周左右。**

---

## 6. 分阶段路线图

### 第 0 阶段：止血止损（机器人①②成果）

| 任务 | 完成标准 |
|------|---------|
| Android/iOS 现有 bug 清理 | 已知崩溃 fix、内存泄漏修复 |
| 桌面端 electron-updater 配置验证 | 静默覆盖更新管线就绪 |
| 三端工程化统一 | 版本号同步、构建脚本统一、产物上传管线 |
| 后端热更 API 骨架 | OTA app.json 端点就绪（复用现有 nginx） |

**持续时间**：已完成（假设机器人①②已交付）

### 第 1 阶段：RN + OTA POC（2 周）

| 任务 | 预估工时 | 说明 |
|------|---------|------|
| 1.1 初始化 RN 项目 `mobile-rn/` | 0.5 天 | `npx react-native init` + TS 模板 |
| 1.2 搭建 OTA 热更核心类 | 1.5 天 | 下载 → 校验 → 缓存 → 切换 JS Bundle |
| 1.3 配置自建 OTA 服务器 | 0.5 天 | nginx 目录 + `app.json` 清单 + 上传脚本 |
| 1.4 从 web/src 移植聊天列表 | 2 天 | 数据层 + FlatList UI + 跳转 |
| 1.5 桥接已有原生模块 | 2 天 | 摄像头、文件访问、推送（native modules） |
| 1.6 端到端验证热更链路 | 1 天 | 改 UI → 构建 bundle → 上传 → 手机重启 → 效果可见 |
| 1.7 写第1阶段验收文档 | 0.5 天 | |

**交付物**：
- `mobile-rn/` 项目可运行，能打开聊天列表
- OTA 服务器端到端：修改一行 UI 文本 → 3 分钟内 App 上可见
- Android APK + iOS IPA 各一个（含 RN 壳 + 基线 bundle）

### 第 2 阶段：逐屏迁移（4-6 周）

按优先级从高到低逐屏迁移：

| 周次 | 模块 | 依赖 |
|------|------|------|
| 第1周 | **消息气泡** + **输入栏** | 第1阶段 POC 完成 |
| 第2周 | **联系人列表** + **搜索** | 消息 UI 就绪 |
| 第3周 | **群组详情** + **个人资料** | 联系人数据层就绪 |
| 第4周 | **登录/注册** + **设置** | 第1-3周完成 |
| 第5周 | **音视频通话入口** + **通知跳转** | 登录/注册就绪 |
| 第6周 | **性能优化** + **完整验收** | 所有模块就绪 |

> 迁移策略：每一屏使用 Feature Flag 切换（`USE_NATIVE_CHAT` → true/false），线上用户依旧走原生，QA 内测走 RN，逐屏验证通过后全量切到 RN。

### 第 3 阶段：三端统一 JS 热更管线（2 周）

| 任务 | 说明 |
|------|------|
| 3.1 OTA 服务器管理面板 | 上传 bundle、版本回滚、灰度分发、发布记录 |
| 3.2 桌面端加入同一 OTA 管线 | Electron 也走 RN bundle 下载（替代 electron-updater 整包更新） |
| 3.3 增量/差量更新 | 对比前后 bundle、下发 patch，减小下载体积 |
| 3.4 灰度发布能力 | 按设备 ID / 版本 / 地区灰度下发 |
| 3.5 监控与告警 | 热更成功率、崩溃率对比、回滚自动触发 |
| 3.6 最终原生模块清理 | Android/iOS 中被 RN 替代的 UI 代码归档移除 |

**交付物**：
- 一个 OTA 管理后台（简易 Web 界面）
- 三端统一的热更 SDK（npm 包）
- 灰度 + 回滚 + 监控就绪

---

## 7. 自建热更服务器方案

### 7.1 目录结构

```nginx
# 对应 https://dipsin.com/downloads/ota/
/var/www/downloads/ota/
├── app.json                    # 版本清单（最新版索引）
├── v2.0.0/
│   ├── index.bundle            # JS Bundle（RN 产物）
│   └── assets.zip              # 图片/字体等静态资源
├── v2.0.1/
│   ├── index.bundle
│   ├── assets.zip
│   └── patch_v2.0.0→v2.0.1    # bsdiff 差量补丁（可选）
├── v2.1.0/
│   ├── index.bundle
│   └── assets.zip
└── rollback/
    └── v2.0.0/                 # 上一个稳定版本备份
```

### 7.2 nginx 配置

```nginx
# /etc/nginx/sites-available/dipsin 添加
location /downloads/ota/ {
    alias /var/www/downloads/ota/;
    add_header Access-Control-Allow-Origin "*";
    add_header Cache-Control "public, max-age=60";  # 1分钟缓存——热更新需要短TTL
    expires 1m;
}
```

### 7.3 上传脚本（CI/CD 中调用）

```bash
# upload-bundle.sh
VERSION=$1
BUNDLE_PATH=$2
ASSETS_PATH=$3
SSH_USER="root"
SSH_HOST="93.179.127.50"
REMOTE_OTA_DIR="/var/www/downloads/ota"

# 1. 在服务器上创建版本目录
ssh $SSH_USER@$SSH_HOST "mkdir -p $REMOTE_OTA_DIR/$VERSION"

# 2. 上传 bundle + assets
scp $BUNDLE_PATH $SSH_USER@$SSH_HOST:$REMOTE_OTA_DIR/$VERSION/index.bundle
scp $ASSETS_PATH $SSH_USER@$SSH_HOST:$REMOTE_OTA_DIR/$VERSION/assets.zip

# 3. 可选：生成差量补丁（需服务器安装 bsdiff）
# ssh ... "bsdiff $REMOTE_OTA_DIR/previous/index.bundle $REMOTE_OTA_DIR/$VERSION/index.bundle $REMOTE_OTA_DIR/$VERSION/patch"

# 4. 更新 app.json（写入最新版本信息）
HASH=$(sha256sum $BUNDLE_PATH | awk '{print $1}')
ssh $SSH_USER@$SSH_HOST "cat > $REMOTE_OTA_DIR/app.json << 'EOF'
{
  \"latestVersion\": \"$VERSION\",
  \"minVersion\": \"2.0.0\",
  \"bundleUrl\": \"https://dipsin.com/downloads/ota/$VERSION/index.bundle\",
  \"assetsUrl\": \"https://dipsin.com/downloads/ota/$VERSION/assets.zip\",
  \"hash\": \"$HASH\",
  \"releaseNotes\": \"$RELEASE_NOTES\"
}
EOF"
```

### 7.4 客户端 SDK 核心逻辑

```typescript
// mobile-rn/src/services/OtaService.ts
class OtaService {
  private static OTA_ENDPOINT = 'https://dipsin.com/downloads/ota/app.json';
  private static BUNDLE_CACHE_DIR = 'ota-bundles';

  async checkForUpdate(): Promise<void> {
    const manifest = await this.fetchManifest();
    const currentVersion = await this.getCurrentBundleVersion();
    
    if (this.shouldUpdate(currentVersion, manifest)) {
      const bundlePath = await this.downloadBundle(manifest);
      await this.verifyHash(bundlePath, manifest.hash);
      await this.setNextBundle(bundlePath);
      // 标记需要重启
      await this.markPendingRestart();
    }
  }

  // 回滚：如果新 bundle 启动崩溃超过 N 次，自动切回旧版本
  async rollbackIfNeeded(): Promise<void> {
    const crashCount = await this.getCrashCount();
    if (crashCount >= 3) {
      await this.restorePreviousBundle();
    }
  }
}
```

### 7.5 差量更新（可选增强）

使用 `bsdiff` 算法生成前后 bundle 的二进制补丁。客户端下载 patch（通常 < 200KB）后应用生成新 bundle。差量可大幅节省用户流量。

```bash
# 生成补丁
bsdiff old.bundle new.bundle patch_old_to_new

# 客户端应用补丁
bspatch old.bundle new.bundle patch_old_to_new
```

---

## 8. 工时与风险评估

### 8.1 工时预估

| 阶段 | 工时（人周） | 说明 |
|------|-------------|------|
| 第0阶段（止血） | 已交付 | 机器人①②完成 |
| 第1阶段（POC） | 2 人周 | 1 名前端 + 1 名原生助手 |
| 第2阶段（逐屏） | 6-8 人周 | 1-2 名前端，每周交付 1-2 屏 |
| 第3阶段（管线） | 3 人周 | 1 名前端 + 1 名 DevOps |
| **合计** | **11-13 人周** | |

### 8.2 风险矩阵

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| iOS 审核被拒（认为热更绕过审查） | 低 | 高 | 保持初始功能完整 + 只做 UI/性能修复；提前准备"审核演示指南"文档 |
| RN 性能不如原生（长列表 10000+ 消息） | 中 | 中 | 使用 `react-native-reanimated` + `react-native-gesture-handler`；长列表用 FlatList `getItemLayout` 优化 |
| 现有原生模块与 RN 桥接困难（音视频通话、WebRTC） | 中 | 高 | 最复杂的原生模块保留原生实现，通过 RN Native Module 桥接暴露给 JS；后续再用 turbo module 优化 |
| 自建 OTA 服务器不可用 / 流量超支 | 低 | 低 | 兜底：bundle 附带基线包离线可用；CDN 缓存可降级到 jsDelivr |
| 团队 RN 经验不足 | 中 | 中 | 第1阶段用 2 周让前端快速上手 RN + 原生桥接基础 |
| web 端与 RN 端分化维护（同一业务逻辑需改两处） | 高 | 高 | 目标：web 与 RN 共享逻辑层代码（TypeScript + monorepo + shared 包） |

### 8.3 关键假设

1. iOS 审核团队接受 JS Bundle 热更（业界大量 App 已验证：Microsoft CodePush 在 Teams/Skype 中使用多年）
2. 现有原生模块（摄像头、推送、语音）只需桥接，不需重写
3. web/src 的 React 代码可 1:1 移植到 RN（JSX 语法兼容，仅 DOM API 需适配）

---

## 9. 回滚策略

### 9.1 原生老包并行保留

```
App 安装目录 /
├── base-bundle/              # 随 App 发布的基线 JS Bundle（不可删除）
│   └── index.bundle          # App Store / Google Play 审核时的版本
├── ota-cache/                # OTA 热更缓存（可删除）
│   ├── current/              # 当前生效的热更 bundle
│   └── previous/             # 上一个版本的 bundle（用于回滚）
└── ota-manifest.json         # OTA 状态记录
```

### 9.2 回滚触发条件

| 触发条件 | 动作 |
|---------|------|
| App 启动后 3 次连续崩溃 | 自动删除 `ota-cache/current/`，从 `previous/` 恢复 |
| 手动回滚（运维操作） | 修改 `app.json` 的 `latestVersion` 指回旧版 + 用户重启或推送"回滚指令" |
| 灰度发布发现崩溃率 > 5% | 自动执行全量回滚 |
| 网络错误导致 bundle 下载失败 | 跳过版本检查，使用当前 bundle 正常启动 |

### 9.3 回滚指令

```
客户端冷启动时检查 app.json 中的 rollback 字段：
{
  "latestVersion": "2.0.2",
  "rollback": {
    "previousVersion": "2.0.1",
    "rollbackBundleUrl": "https://dipsin.com/downloads/ota/v2.0.1/index.bundle"
  }
}
```

当运维发现 `v2.0.2` 有问题时，只需在 `app.json` 中将 `latestVersion` 改回 `2.0.1`，所有未升级或已升级的用户下次启动都会切到正确的版本：

- 已升级到 v2.0.2 的用户：检测到 latestVersion 回退，删除 v2.0.2 bundle，下载回 v2.0.1 bundle 重载
- 尚未升级的用户：保持不变（因为本地版本 >= latestVersion）

---

## 10. 附录：关键技术选型说明

### 10.1 为什么不用 react-native-code-push（微软服务）

| 使用 CodePush | 自建 OTA |
|-------------|---------|
| 需注册 App Center 账号 | 已有自有服务器 |
| App Center 2025 年后已不活跃（微软停运） | 完全自主可控 |
| 服务国外，国内访问慢 | 香港服务器，延迟低 |
| 免费额度有限 | 无限（仅消耗 nginx 带宽） |
| 无法自定义灰度 / 回滚策略 | 完全自定义 |

→ **推荐：自建 OTA，参考 CodePush 协议自行实现精简版。**

### 10.2 推荐 RN 版本及关键依赖

```json
{
  "react-native": "0.76.x",
  "react": "18.3.x",
  "@react-navigation/native": "^7.x",
  "@react-navigation/stack": "^7.x",
  "axios": "^1.7.x",           // 直接复用 web/src
  "socket.io-client": "^4.7.x", // 直接复用 web/src
  "react-native-reanimated": "^3.x",
  "react-native-gesture-handler": "^2.x",
  "react-native-safe-area-context": "^4.x",
  "react-native-screens": "^3.x"
}
```

### 10.3 桌面端（Electron）的热更策略

桌面端已有 electron-updater 做整包静默覆盖。建议桌面端也加入同一 JS 热更管线：

```
桌面端启动流程：
  1. Electron 加载 web 页面 (Vite 构建的 SPA)
  2. 页面内嵌入 OTA 检查逻辑（与 RN 端相同）
  3. 发现新版本 → 下载 JS bundle → localStorage 缓存 → 下次打开生效

这样桌面端也能享受"即时修复 UI/逻辑"的能力，
electron-updater 仍保留但仅用于 Electron 版本升级（Chromium 版本等大版本更新）。
```
