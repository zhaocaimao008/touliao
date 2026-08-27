# 🚀 v信 全平台构建指南（Electron + Capacitor）

## 📋 项目结构

```
v信/
├── web/                          # 🎯 主项目目录 (Monorepo中心)
│   ├── src/                      # React源代码 (Web + 移动共用)
│   ├── dist/                     # Web生产构建输出
│   ├── dist-electron/            # Electron构建输出
│   ├── electron/                 # Electron主进程代码
│   ├── package.json              # ✅ 已更新 (包含三端脚本)
│   ├── capacitor.config.json     # ✅ 移动端配置
│   ├── ios.plist.template        # iOS Info.plist样板
│   ├── android-build.gradle.template  # Android构建配置样板
│   ├── vite.config.js            # Vite构建配置
│   └── MULTIPLATFORM.md          # 📄 本文件
│
├── backend-v2/                   # 后端服务（与前端独立）
│
└── (在首次npx cap init后自动生成)
    ├── ios/                      # 🍎 iOS Xcode项目
    └── android/                  # 🤖 Android Studio项目
```

---

## 🖥️ Windows 桌面端构建

### 前提条件

```bash
# 1. Node.js 16+ 和 npm
node --version   # >= 16.0.0
npm --version    # >= 8.0.0

# 2. Electron 依赖已在 package.json 中（无需额外安装）
npm install

# 3. (可选) 代码签名：在 electron/main.js 中配置
```

### 构建步骤

```bash
# Step 1: 打包 Web 应用为静态资源
npm run build
# 输出: dist/index.html + dist/assets/*

# Step 2: 使用 Electron Builder 生成 Windows 安装程序
cd ../desktop-electron && npm run build:win
# 输出: dist-electron/v信 Setup 1.0.0.exe (≈150MB)
#       dist-electron/v信 Setup 1.0.0.exe.blockmap (增量更新)

# Step 3: (可选) 构建便携式版本 (无需安装)
npx electron-builder --win --portable
# 输出: dist-electron/v信 1.0.0.exe (单文件可执行)
```

### Windows 特性

- ✅ **Mica 毛玻璃材质** (Windows 11): 自动启用高斯模糊质感
- ✅ **无边框窗口**: 自定义标题栏，最小化/最大化/关闭按钮
- ✅ **NSIS 安装程序**: 支持自定义安装路径
- ✅ **自动更新**: 通过 .blockmap 增量更新 (可选)

### 验证构建

```bash
# 检查 exe 文件
ls -lh dist-electron/*.exe

# 在测试机上运行
./dist-electron/v信\ Setup\ 1.0.0.exe
```

---

## 📱 Android 移动端构建

### 前提条件

```bash
# 1. Java JDK 11+
java -version     # openjdk version "11.x.x" or higher

# 2. Android SDK (通过 Android Studio 安装)
# 设置环境变量:
export ANDROID_SDK_ROOT=/path/to/android-sdk
export PATH=$ANDROID_SDK_ROOT/platform-tools:$PATH

# 3. Gradle (通常随 Android SDK 一起)
gradle --version  # >= 7.0

# 4. 安装 Capacitor CLI
npm install -g @capacitor/cli
# 或
npx @capacitor/cli --version
```

### 初始化步骤（第一次）

```bash
# Step 1: 初始化 Capacitor 项目
npx cap init vxin com.vxin.app

# Step 2: 添加 Android 平台
npx cap add android
# 自动生成: android/ 目录（Gradle 项目）

# Step 3: 同步 Web 资源到 Android
npx cap sync android
```

### 构建步骤

```bash
# Step 1: 构建 Web 资源 (必须先做)
npm run build

# Step 2: 同步到 Android 平台
npx cap sync android

# Step 3: 打开 Android Studio
npx cap open android
# 或手动打开: android/ 目录

# Step 4: 在 Android Studio 中编译
# 菜单: Build → Build Bundle(s) / APK(s) → Build APK(s)
# 或命令行:
cd android && ./gradlew assembleRelease

# 输出: android/app/build/outputs/apk/release/app-release.apk
```

### 签名配置（生产）

```bash
# 1. 生成签名密钥（首次）
keytool -genkey -v -keystore signing-key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias vxin

# 2. 将签名文件放入 android/app/
cp signing-key.jks android/app/

# 3. 设置环境变量
export ANDROID_KEY_PASSWORD="your-password"
export ANDROID_STORE_PASSWORD="your-password"

# 4. 构建带签名的 APK
cd android && ./gradlew assembleRelease
```

### 上传 Google Play

```bash
# 1. 生成 App Bundle (Google Play 推荐格式)
cd android && ./gradlew bundleRelease
# 输出: app/build/outputs/bundle/release/app-release.aab

# 2. 上传到 Google Play Console
# https://play.google.com/console
# - 创建应用
# - 上传 app-release.aab
# - 设置应用信息、截图、描述
# - 提交审核

# 3. 本地测试 (在真机上)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Android 特性

- ✅ **深色主题**: 自动适配系统深色模式
- ✅ **刘海屏适配**: Capacitor 自动处理 SafeArea
- ✅ **后台通知**: Firebase Cloud Messaging 集成
- ✅ **权限管理**: Camera, Storage, Location, Microphone
- ✅ **文件访问**: 相机胶卷、相册、下载目录

---

## 🍎 iOS 移动端构建

### 前提条件

```bash
# 1. macOS (10.15+)
sw_vers  # 检查 macOS 版本

# 2. Xcode 13+ (命令行工具)
xcode-select --install
xcode-select --version

# 3. CocoaPods (Ruby包管理器)
sudo gem install cocoapods
pod --version

# 4. iOS SDK
xcrun --version

# 5. (可选) Apple Developer Account (用于真机测试和上传 App Store)
```

### 初始化步骤（第一次）

```bash
# Step 1: 初始化 Capacitor 项目 (如还未初始化)
npx cap init vxin com.vxin.app

# Step 2: 添加 iOS 平台
npx cap add ios
# 自动生成: ios/ 目录（Xcode 项目）

# Step 3: 同步 Web 资源到 iOS
npx cap sync ios

# Step 4: 安装 Pod 依赖
cd ios && pod install && cd ..
```

### 构建步骤

```bash
# Step 1: 构建 Web 资源
npm run build

# Step 2: 同步到 iOS 平台
npx cap sync ios

# Step 3: 打开 Xcode
npx cap open ios
# 或手动打开: ios/App/App.xcworkspace

# Step 4: 在 Xcode 中配置签名
# - 选择 Target > Signing & Capabilities
# - 设置 Team ID (需要 Apple Developer Account)
# - 选择 Development Certificate

# Step 5: 编译
# 菜单: Product → Build / Build & Run
# 或命令行 (模拟器):
cd ios && xcodebuild -workspace App/App.xcworkspace -scheme App -configuration Release

# 或命令行 (真机):
cd ios && xcodebuild -workspace App/App.xcworkspace -scheme App -configuration Release -destination generic/platform=iOS
```

### 上传 App Store

```bash
# 1. 生成 Archive
cd ios && xcodebuild archive -workspace App/App.xcworkspace \
  -scheme App -archivePath build/App.xcarchive

# 2. 导出 IPA
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/

# 3. 使用 Transporter 上传到 App Store Connect
# https://apps.apple.com/app/transporter/id1450874784
# - 打开 Transporter
# - 选择生成的 .ipa 文件
# - 点击 Deliver

# 或使用命令行:
xcrun altool --upload-app -f build/App.ipa \
  -u your-apple-id@icloud.com -p your-app-password \
  --type ios
```

### iOS 特性

- ✅ **刘海屏安全区域**: 自动 Inset 处理 (Safe Area)
- ✅ **状态栏样式**: 深色文本/浅色背景自适应
- ✅ **启动屏**: 自定义 LaunchScreen.storyboard
- ✅ **通知权限**: 推送通知、本地通知
- ✅ **后台模式**: VoIP、消息同步、音频播放
- ✅ **App Store 合规**: 网络安全 (App Transport Security)

---

## 🔄 跨平台工作流

### 日常开发

```bash
# 🔵 Web 开发 (实时热更新)
npm run dev
# 访问 http://localhost:3000

# 🟢 Electron 开发 (与 Vite 并行)
cd ../desktop-electron && npm run dev
# 自动监听源代码变化，刷新 Electron 窗口

# 🟡 移动端本地测试 (不需要真机)
npm run dev:mobile
# 在浏览器模拟 iOS/Android
```

### 构建和部署

```bash
# 🔵 Web 版本
npm run build                    # 构建静态文件 (dist/)
# 上传 dist/ 到服务器 (91aigu.com)

# 🖥️ Windows 版本
cd ../desktop-electron && npm run build:win        # 生成 exe 文件
# 上传到 Windows 下载页面

# 🤖 Android 版本
npm run build:android            # 生成 APK
npx cap build android --release  # 或完整构建

# 🍎 iOS 版本
npm run build:ios                # 生成 Xcode 项目
# 在 Xcode 中手动编译并上传 App Store
```

### 版本管理

所有平台的版本在 `package.json` 中统一管理：

```json
{
  "version": "1.0.0",  // 更新这里，所有平台自动同步
  "build": {
    "appId": "com.vxin.desktop",
    "productName": "v信"
  }
}
```

更新版本：
```bash
npm version patch    # 1.0.0 → 1.0.1 (修复)
npm version minor    # 1.0.0 → 1.1.0 (新功能)
npm version major    # 1.0.0 → 2.0.0 (破坏性更新)
```

---

## 🐛 常见问题和排查

### Electron 问题

**问题**: "Cannot find module"
```bash
# 解决
npm install
npm run build
cd ../desktop-electron && npm run build:win
```

**问题**: Windows 打包超大 (>300MB)
```bash
# 优化: 启用代码压缩
# vite.config.js:
build: {
  minify: 'terser',
  terserOptions: {
    compress: { drop_console: true }
  }
}
```

### Android 问题

**问题**: "Could not find gradle"
```bash
# 解决
export ANDROID_SDK_ROOT=/path/to/android-sdk
export GRADLE_HOME=/path/to/gradle
export PATH=$GRADLE_HOME/bin:$PATH
```

**问题**: "Permission Denied" 安装 APK
```bash
# 解决: 给予执行权限
adb install -r app/build/outputs/apk/release/app-release.apk
```

### iOS 问题

**问题**: "Code signing" 错误
```bash
# 解决: 在 Xcode 中设置正确的 Team ID
# Xcode → Signing & Capabilities → Team
```

**问题**: Pod 版本冲突
```bash
# 解决
cd ios
rm Podfile.lock
pod repo update
pod install
cd ..
npx cap sync ios
```

---

## 📦 持续集成 (CI/CD)

### GitHub Actions 配置示例

创建 `.github/workflows/multiplatform.yml`:

```yaml
name: Build All Platforms

on:
  push:
    branches: [main, release/*]
  pull_request:
    branches: [main]

jobs:
  build-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - uses: actions/upload-artifact@v3
        with:
          name: web-dist
          path: dist/

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: cd ../desktop-electron && npm run build:win
      - uses: actions/upload-artifact@v3
        with:
          name: windows-exe
          path: dist-electron/*.exe

  build-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-java@v3
        with:
          java-version: '11'
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build:android
      - uses: actions/upload-artifact@v3
        with:
          name: android-apk
          path: android/app/build/outputs/apk/**/*.apk
```

---

## 🚀 部署清单

- [ ] 更新 `package.json` 中的版本号
- [ ] 运行 `npm install` 安装最新依赖
- [ ] 运行 `npm run build` 编译 Web 资源
- [ ] Windows: `cd ../desktop-electron && npm run build:win` → 生成 exe
- [ ] Android: `npm run build:android` → 生成 APK
- [ ] iOS: `npm run build:ios` → 用 Xcode 编译
- [ ] 在各平台进行集成测试
- [ ] 上传到对应应用商店
- [ ] 发布公告

---

## 📞 支持

遇到问题？

1. 查看本指南的 "常见问题和排查"
2. 检查 Electron/Capacitor 官方文档
3. 运行 `npm run build` 检查构建日志

祝上线顺利! 🎉

---

**最后更新**: 2026-06-10
**版本**: 1.0.0
