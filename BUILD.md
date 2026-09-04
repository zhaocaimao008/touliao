# 投聊 三端构建与运行

## 项目结构

```
touliao/
├── web/                          # React 前端（三端共享，含桌面端渲染）
│   ├── src/
│   │   ├── components/           # 公共组件
│   │   ├── contexts/             # Context 状态管理
│   │   ├── pages/                # 页面组件
│   │   ├── hooks/                # Hooks
│   │   ├── reducers/             # 状态 reducers
│   │   ├── utils/                # 工具函数
│   │   │   ├── electron.js       # Electron 桌面端桥接
│   │   │   ├── url.js
│   │   │   ├── time.js
│   │   │   └── toast.jsx
│   │   ├── App.jsx               # 路由入口
│   │   ├── main.jsx              # 渲染入口
│   │   ├── index.css
│   │   ├── mobile-adapt.css      # 移动端适配
│   │   └── design-tokens.css
│   ├── public/
│   │   ├── manifest.json         # PWA 配置
│   │   ├── icons/                # 应用图标
│   │   └── sw.js                 # Service Worker（离线回退 + Web Push；唯一被注册的那个）
│   ├── index.html
│   └── vite.config.js
│
├── desktop-electron/             # Windows 桌面客户端（Electron）
│   ├── src/
│   │   ├── main.js               # Electron 主进程
│   │   ├── preload.js            # 安全桥接
│   │   └── screenshot.js         # 截图模块
│   ├── assets/                   # electron-builder 资源
│   └── package.json              # 构建配置在 package.json「build」段
│
├── android/                      # Android 原生客户端（Kotlin + Jetpack Compose）
│   ├── app/                      # App 模块（build.gradle.kts）
│   └── gradlew                   # Gradle 包装器
│
├── ios/                          # iOS 原生客户端（Swift + SwiftUI，XcodeGen）
│   └── project.yml               # 工程定义（target/scheme: Touliao）
│
├── landing/                      # 营销落地页（Next.js 静态导出）
├── admin/                        # 管理后台（静态页）
├── backend-v2/                   # 后端服务（结构见下）
├── deploy/                       # 部署脚本
├── docs/                         # 项目文档
├── scripts/                      # 工具脚本
├── package.json                  # 工作区根配置（一键构建入口）
└── BUILD.md                      # 本文档
```

## 后端

```
backend-v2/
├── src/
│   ├── server.js                 # HTTP + Socket.io 启动
│   ├── app.js                    # Express 路由装配
│   ├── config/index.js           # 配置
│   ├── db/
│   │   ├── connection.js
│   │   ├── schema.js
│   │   ├── worker.js             # SQLite 写入 Worker
│   │   └── writer.js             # 写入调度器
│   ├── realtime/
│   │   ├── index.js              # Socket.io 握手+连接管理
│   │   ├── broadcaster.js        # 广播调度器（分片削峰）
│   │   ├── presence.js           # 在线状态
│   │   └── handlers/
│   │       ├── message.js        # 消息收发
│   │       ├── file.js           # 文件消息
│   │       ├── typing.js         # 正在输入
│   │       └── call.js           # WebRTC 信令
│   ├── modules/
│   │   ├── auth/                 # 登录注册
│   │   ├── users/                # 用户资料
│   │   ├── messages/             # 消息 REST
│   │   ├── conversations/        # 会话管理
│   │   ├── contacts/             # 联系人
│   │   ├── groups/               # 群组
│   │   ├── moments/              # 朋友圈
│   │   ├── upload/               # 文件上传
│   │   ├── admin/                # 管理后台
│   │   └── notifications/        # 推送通知
│   └── middleware/
│       ├── auth.js               # JWT 鉴权
│       ├── csrf.js               # CSRF 防护
│       └── rateLimiters.js       # 限流
```

## 运行命令

### 开发模式

```bash
# Web 端（本地开发，vite 默认端口 3000，API 代理到 localhost:3003）
cd web && npm run dev

# 桌面端 Electron
cd desktop-electron && npm run dev

# Android（需连接设备或模拟器，JDK 17）
cd android && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk

# iOS（需 macOS + Xcode；先 xcodegen generate 生成工程）
cd ios && xcodegen generate && open Touliao.xcodeproj
```

### 构建命令

```bash
# Windows 桌面安装包（根目录一键脚本）
npm run build:desktop:win
# 输出: desktop-electron/dist/touliao-<版本>-setup.exe

# Android APK（JDK 17，详见 android/README.md）
cd android && ./gradlew :app:assembleRelease
# 输出: android/app/build/outputs/apk/release/app-release.apk

# iOS（需 macOS + Xcode + Apple Developer 账号，详见 ios/README.md）
cd ios && xcodegen generate && xcodebuild -project Touliao.xcodeproj -scheme Touliao -configuration Release -sdk iphoneos build

# Web 端（部署到服务器）
cd web && npm run build
# 输出: web/dist/
```

### 一键构建

```bash
# 安装依赖（web + desktop-electron）
npm run setup:all

# 构建桌面端
npm run build:desktop:win   # Windows
npm run build:desktop:mac   # macOS
npm run build:desktop:linux # Linux

# Android / iOS 在各子目录构建（见上方「构建命令」）
```

## 三端功能对照

| 功能 | Web | Windows | Android | iOS |
|------|-----|---------|---------|-----|
| 消息收发 | ✅ | ✅ | ✅ | ✅ |
| 文件上传 | ✅ | ✅ | ✅ | ✅ |
| 图片发送 | ✅ | ✅ | ✅ | ✅ |
| 语音消息 | ✅ | ✅ | ✅ | ✅ |
| 群聊 | ✅ | ✅ | ✅ | ✅ |
| 朋友圈 | ✅ | ✅ | ✅ | ✅ |
| 视频/语音通话 | ✅（WebRTC） | ✅（WebRTC） | ✅（WebRTC） | ✅（WebRTC） |
| 系统托盘 | — | ✅ | — | — |
| 消息通知 | ✅（Web Push） | ✅（原生通知） | ✅（FCM） | ✅（APNS） |
| 开机启动 | — | ✅ | — | — |
| 文件拖拽发送 | — | ✅ | — | — |
| 图片粘贴发送 | — | ✅ | — | — |
| 截图发送 | — | ✅ | — | — |
| 自动更新 | — | ✅（electron-updater） | — | — |
| 相机拍照 | — | — | ✅ | ✅ |
| 相册选择 | — | — | ✅ | ✅ |
| 后台保活 | — | — | ✅ | ✅ |
| Socket 自动重连 | ✅ | ✅ | ✅ | ✅ |
| 安全区域适配 | — | — | ✅ | ✅ |
| 刘海屏适配 | — | — | ✅ | ✅ |
| 横竖屏 | ✅ | — | ✅ | ✅ |
| PWA 离线 | ✅ | — | — | — |

## 服务器配置

所有客户端默认连接 `https://touliao.cc`。

Electron 桌面端可在设置页面修改服务器地址（支持内网部署场景）。

## 更新机制

Windows 桌面端使用 `electron-updater`，更新包部署在 `https://touliao.cc/downloads/updates/`。
移动端通过各应用商店更新。
