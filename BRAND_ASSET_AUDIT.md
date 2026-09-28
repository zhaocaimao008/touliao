# 投聊品牌资产审计（BRAND_ASSET_AUDIT）

- 新图标母版：`/home/ubuntu/uploads/img_62c7d6db1d60.png`（1254×1254 RGBA 透明底，SHA256 `1c6238c907a95e0564d8345c5c4a7751caf2eaaf88430691fb4544ba68a05b99`）
- 代码基线：main @ 6882f063（分支 feat/brand-icon-v3）
- 扫描范围：全仓库图片（png/jpg/webp/ico/icns/svg/gif）+ Android 矢量 drawable + 图标/启动页配置，排除 node_modules/.git/构建产物；共 379 个图片文件
- 仓库内无 .icns、无独立品牌 SVG Logo、无 Lottie、无 LaunchScreen.storyboard

## 1. 品牌相关资产

| 文件路径 | 平台 | 当前用途 | 当前尺寸 | 是否替换 | App Icon | 启动页 | 安装包 | favicon | 功能图标 |
|---|---|---|---|---|---|---|---|---|---|
| `android/app/src/main/res/drawable/ic_notification.xml` | Android | 通知小图标（矢量，保留为兜底） | vector-xml | 否（新增各密度 PNG 覆盖） | 否 | 否 | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | Android | 启动器图标 | 72x72 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png` | Android | 自适应图标前景层 | 162x162 | 是 | 是 | 是（旧启动页） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png` | Android | 启动器图标（圆形） | 72x72 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | Android | 启动器图标 | 48x48 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png` | Android | 自适应图标前景层 | 108x108 | 是 | 是 | 是（旧启动页） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png` | Android | 启动器图标（圆形） | 48x48 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | Android | 启动器图标 | 96x96 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png` | Android | 自适应图标前景层 | 216x216 | 是 | 是 | 是（旧启动页） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png` | Android | 启动器图标（圆形） | 96x96 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | Android | 启动器图标 | 144x144 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png` | Android | 自适应图标前景层 | 324x324 | 是 | 是 | 是（旧启动页） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png` | Android | 启动器图标（圆形） | 144x144 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | Android | 启动器图标 | 192x192 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` | Android | 自适应图标前景层 | 432x432 | 是 | 是 | 是（旧启动页） | 是 | 否 | 否 |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png` | Android | 启动器图标（圆形） | 192x192 | 是 | 是 | 是（旧启动页 AnimatedIcon） | 是 | 否 | 否 |
| `design-assets/ai/chatgpt-check.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1280x800 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/ai/icon-flux-realism.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 768x768 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/ai/icon-flux.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 768x768 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/app-icon-1024.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1024x1024 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/app-icon-192.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 192x192 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/app-icon-512.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 512x512 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/banner-preview.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 2334x625 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/banner-store-mascot.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1024x500 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/banner-store.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1024x500 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-preview.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 3802x1254 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v1-black-1024.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1024x1024 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v1-black-192.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 192x192 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v1-black-512.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 512x512 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v1-dark-1024.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1024x1024 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v1-dark-192.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 192x192 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v1-dark-512.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 512x512 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v2-purple-1024.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1024x1024 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v2-purple-192.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 192x192 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/icon-v2-purple-512.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 512x512 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/mascot-1024.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1024x1024 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/mascot-512.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 512x512 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/mascot-combo-preview.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1080x2460 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/mascot-preview.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 2078x1024 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/preview-all.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 890x1060 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/promo-1280x720.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1280x720 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/promo-preview.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 2590x720 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/splash-android-mascot.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1080x1920 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/splash-android.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1080x1920 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/splash-desktop.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1920x1080 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/splash-ios.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1170x2532 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/splash-preview.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 2445x900 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/splash-web-preview.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1280x720 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/splash-web.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 2560x1440 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `design-assets/web-splash-live.png` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1280x800 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `desktop-electron/assets/icon-1024.png` | Windows | 高分辨率图标 | 1024x1024 | 是 | 是 | 否 | 是 | 否 | 否 |
| `desktop-electron/assets/icon.ico` | Windows | exe/安装/卸载/快捷方式/任务栏/窗口/托盘 | ico:16,32,48,64,128,256 | 是 | 是 | 否 | 是 | 否 | 否 |
| `desktop-electron/assets/icon.png` | Windows | exe/安装/卸载/快捷方式/任务栏/窗口/托盘 | 512x512 | 是 | 是 | 否 | 是 | 否 | 否 |
| `docs/windows-auto-update-evidence/20260919/01-old-installed-session-and-cache.png` | 文档 | 截图证据 | 1024x720 | 否 | 否 | 否 | 否 | 否 | 否 |
| `docs/windows-auto-update-evidence/20260919/02-real-network-check-failure.png` | 文档 | 截图证据 | 1024x720 | 否 | 否 | 否 | 否 | 否 | 否 |
| `docs/windows-auto-update-evidence/20260919/03-production-update-downloaded-and-verified.png` | 文档 | 截图证据 | 1024x720 | 否 | 否 | 否 | 否 | 否 | 否 |
| `docs/windows-auto-update-evidence/20260919/04-new-ui-old-session-offline-history.png` | 文档 | 截图证据 | 1024x720 | 否 | 否 | 否 | 否 | 否 | 否 |
| `docs/windows-auto-update-evidence/20260919/nsis-native-wizard.png` | 文档 | 截图证据 | 1024x768 | 否 | 否 | 否 | 否 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | iOS | App 图标 | 1024x1024 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-120.png` | iOS | App 图标 | 120x120 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-152.png` | iOS | App 图标 | 152x152 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-167.png` | iOS | App 图标 | 167x167 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-180.png` | iOS | App 图标 | 180x180 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-20.png` | iOS | App 图标 | 20x20 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-29.png` | iOS | App 图标 | 29x29 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-40.png` | iOS | App 图标 | 40x40 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-58.png` | iOS | App 图标 | 58x58 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-60.png` | iOS | App 图标 | 60x60 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-76.png` | iOS | App 图标 | 76x76 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-80.png` | iOS | App 图标 | 80x80 | 是 | 是 | 否 | 是 | 否 | 否 |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-87.png` | iOS | App 图标 | 87x87 | 是 | 是 | 否 | 是 | 否 | 否 |
| `splash-design.jpg` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1280x720 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `touliao-icon.jpg` | 设计资料 | 历史设计稿/宣传图（含旧版紫色气泡图标、蓝底「投聊」稿） | 1254x1254 | 否（保留作资料） | 否 | 否 | 否 | 否 | 否 |
| `web/public/favicon.png` | Web/PWA | favicon | 64x64 | 是 | 是（PWA） | 否 | 否 | 是 | 否 |
| `web/public/icon-512.png` | Web/PWA | 512 图标 | 512x512 | 是 | 是（PWA） | 否 | 否 | 否 | 否 |
| `web/public/icon.png` | Web/PWA | 登录页 Logo + SW 预缓存 | 192x192 | 是 | 是（PWA） | 否 | 否 | 否 | 否 |
| `web/public/icon.webp` | Web/PWA | 登录页 Logo | 192x192 | 是 | 是（PWA） | 否 | 否 | 否 | 否 |
| `web/public/icons/icon-192.png` | Web/PWA | PWA 192 + apple-touch-icon | 192x192 | 是 | 是（PWA） | 否 | 否 | 否 | 否 |
| `web/public/icons/icon-512.png` | Web/PWA | PWA 512 | 512x512 | 是 | 是（PWA） | 否 | 否 | 否 | 否 |

## 2. 功能图标（不替换）

- `ios/Touliao/Assets.xcassets/DesignIcons/`：150 个（聊天、发送、语音、视频、设置、联系人、群聊等）——**功能图标：是，替换：否**
- `web/src/` 下 150 个图片（ui-kit 功能图标等）——**功能图标：是，替换：否**
- Android `TouliaoIcons.*`（Compose 代码矢量）、iOS SF Symbols / touliaoIcon——**功能图标：是，替换：否**

## 3. 图标/启动页配置

| 位置 | 现状 | 处理 |
|---|---|---|
| `ios/.../AppIcon.appiconset/Contents.json` | 13 个尺寸（20~1024），文件名 AppIcon-<尺寸>.png | 文件名不变，仅替换图片 |
| `ios/project.yml` `UILaunchScreen: {}` | 系统默认纯色，无品牌图（注释称此前「按要求移除」） | 按本次要求改为品牌启动页 |
| `android/.../mipmap-anydpi-v26/ic_launcher*.xml` | 纯色背景 + 前景，无 monochrome | 加背景图层与 monochrome 层 |
| `android/.../values*/themes.xml` | SplashScreen 背景浅 #F4F6FA / 深 #10151E，图标 @mipmap/ic_launcher | 改深紫黑 + 专用启动图 |
| `desktop-electron/package.json`、`electron-builder.yml`、`src/main.js` | exe/安装/卸载用 assets/icon.ico；窗口/托盘用 assets/icon.png | 仅替换文件，配置不变 |
| `desktop-electron`（无 build/ 目录、无 splash.html） | Windows 无独立启动页 | N/A |
| `web/index.html` | apple-touch-icon=/icons/icon-192.png；favicon=/favicon.png；无 favicon.ico/16/32 | 补齐引用 |
| `web/public/manifest.json` | 512 同一文件兼作 maskable | maskable 改用独立安全区版本 |
| `web/public/sw.js` | CACHE_NAME touliao-v2.0.21，预缓存 /icon.png | 升版本号 |
| Web 首屏/loading | index.html 无 Logo/loading 图 | 不存在，未新增 |
| 安卓 `LoginScreen.kt:96`、iOS `LoginView.swift:~30` | 登录页品牌徽章为代码绘制（品牌色方块 + 通用聊天图标） | 改需动界面代码，本次未改，见替换报告 |

## 4. 旧品牌残留（只报告，不修改）

| 关键词 | 命中 | 性质 |
|---|---|---|
| 新盛讯 | 0 | — |
| toulliao | 0 | — |
| V信 | 26 个文件 | 运维脚本、Grafana 面板、压测脚本、代码注释；不在用户界面 |
| vxin/Vxin/VXIN | 约 290 个文件 | 代码标识符、设计令牌、登录 Cookie 名 `vxin_token`（协议）、localStorage 迁移键——禁止修改 |
