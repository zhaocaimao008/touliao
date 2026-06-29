# v信 四端全功能自动化测试

[![E2E Web Tests](https://github.com/zhaocaimao008/vxin-1.0/actions/workflows/e2e-web.yml/badge.svg)](https://github.com/zhaocaimao008/vxin-1.0/actions/workflows/e2e-web.yml)

Web / Windows(Electron) / Android / iOS 四端端到端自动化测试。
Web+Electron 用 **Playwright**,Android+iOS 用 **Appium**。四端共用一份**锚点字典**和**测试后端**。

> **CI**: push 到 main(改 web/backend-v2/e2e)时,GitHub Actions 自动跑 Playwright **web 24 用例**
> (起隔离后端+chromium headless 实跑),见 `.github/workflows/e2e-web.yml`。移动端需真机/模拟器,本地跑。

## 设计要点
- **锚点统一**:`shared/anchors.js` 是唯一真相源。四端 `data-testid` / Compose `testTag` / iOS `accessibilityIdentifier` 值**完全相同** → 同一用例跨端一致。Python 侧用 `node shared/gen-anchors-py.js` 生成 `appium/anchors.py` 镜像。
- **隔离后端**:每次测试起一个独立 `backend-v2` 实例(独立 sqlite + 测试端口 3099 + 固定邀请码 123456),用三个测试开关使其可被自动化驱动:
  - `DISABLE_RATE_LIMIT=1` 关注册/发消息限流
  - `DISABLE_CSRF=1` 关 CSRF 双提交(跨端口前端读不到 csrf cookie)
  - `CORS_ORIGINS=<web origin>` 放行跨端口浏览器
  这三个开关**生产默认不开**,只在测试 fixture 里设置。
- **造号**:走 HTTP `/api/auth/register`(关限流后不被挡),自动建 A↔B 好友 + 私聊会话供 CHAT 用例。

## Test Case 矩阵
端: W=Web E=Electron A=Android I=iOS。等级: [A]全自动 / [M]需注入或mock / [S]跳过仅手测。

状态: ✅web实跑通过 / 🟡骨架(A/I待设备跑) / ⬜待补

| ID | 用例 | 端 | 等级 | spec 文件 | 状态 |
|----|------|----|------|----------|------|
| AUTH-01 | 登录成功→主界面 | W E A I | [A] | web/auth, appium/test_auth | ✅web 🟡A/I |
| AUTH-02 | 错误密码→错误提示 | W E A I | [A] | web/auth, appium/test_auth | ✅web 🟡A/I |
| AUTH-06 | 登出→回登录页 | W E A I | [A] | web/account | ✅web 🟡A/I |
| CHAT-02 | 发送文本→气泡 | W E A I | [A] | web/chat, appium/test_chat | ✅web 🟡A/I |
| CHAT-04 | 已读回执(双账号) | W E A I | [A] | web/read | ✅web 🟡A/I |
| CHAT-05 | 发图片→图片气泡 | W E | [A] | web/chat | ✅web(setInputFiles) |
| CHAT-05 | 发图片 | A I | [M] | — | ⬜需 push_file 注入沙盒 |
| CHAT-07 | 发语音 | W E A I | [M] | — | ⬜注入voice消息验渲染 |
| CHAT-08 | 编辑消息→已编辑+新文本 | W E A I | [A] | web/edit-recall, appium/test_edit_recall | ✅web 🟡A/I |
| CHAT-09 | 撤回消息→撤回提示 | W E A I | [A] | web/edit-recall, appium/test_edit_recall | ✅web 🟡A/I |
| LB-01 | 灯箱开关(Esc) | W E A I | [A] | web/lightbox | ✅web 🟡A/I |
| LB-02 | 画廊翻页(→切图) | W E A I | [A] | web/lightbox | ✅web(验证画廊bug已修) 🟡A/I |
| CALL-01 | 语音通话→通话窗→挂断 | W E A I | [M] | web/call, appium/test_call | ✅web(fake media) 🟡A/I |
| CALL-02 | 视频通话→通话窗 | W E A I | [M] | web/call, appium/test_call | ✅web 🟡A/I |
| CALL-03 | 群通话 | W E A I | [S] | — | 跳过(媒体,手测) |
| GRP-01/02 | 建群→群发文本 | W E A I | [A] | web/group, appium/test_group | ✅web 🟡A/I |
| GRP-05 | 退群→会话移除 | W E A I | [A] | web/group, appium/test_group | ✅web 🟡A/I |
| ACC-01 | 添加账号→切换(不被登出) | W E A I | [A] | web/account-switch, appium/test_account | ✅web 🟡A/I |
| NET-01 | 断网发消息→发送失败 | W E A | [M] | web/network, appium/test_account | ✅web 🟡A(Android driver) |
| NET-02 | 恢复网络→重连 | W E | [M] | web/network | ✅web |
| WIN-01/02 | 窗口控制/服务器切换 | E | [A] | — | ⬜骨架,root环境跳过 |

**已实跑通过(web): 16 用例** — AUTH-01/02/06, CHAT-02/04/05/08/09, LB-01/02, CALL-01/02,
GRP-01/02/05, ACC-01, NET-01/02。
Electron 共用 web POM+spec(root 环境跳过,非 root 可跑)。Android/iOS 同名锚点已就位,
test_auth/test_chat/test_edit_recall/test_call/test_group/test_account 骨架可在设备/模拟器上跑。

**自动化策略**:文件上传 W/E 用 `setInputFiles` 绕系统框=全自动;A/I 需 `driver.push_file` 注入沙盒。语音不模拟麦克风,改"后端注入voice消息→验渲染"。通话只测 signaling/UI,不验媒体流。

## 目录
```
e2e/
├── shared/      anchors.js(锚点真相源) env.js gen-anchors-py.js
│   └── backend/ fixture.js(起停后端) seed.js(造号+建会话)
├── playwright/  global-setup/teardown fixtures.js
│   ├── pages/   LoginPage.js ChatPage.js (POM)
│   ├── web/     auth.spec.js chat.spec.js
│   └── electron/ launch.js smoke.spec.js
├── appium/      conftest.py pages.py anchors.py(生成) test_auth.py test_chat.py
├── fixtures/    sample.png(测试素材)
├── playwright.config.js  package.json  requirements.txt
```

---

## 运行 — Web (Playwright,本机已验证)
```bash
cd e2e
npm install
npm run pw:install          # 装 chromium
npm run build:web           # 构建 web/dist(供静态serve + electron)
npm run test:web            # globalSetup 自动起后端+造号+静态serve,跑 web spec
```
已实跑通过: AUTH-01/02 + CHAT-02/05。

## 运行 — Electron (Playwright)
```bash
npm run build:web           # 必须先有 web/dist
npm run test:electron       # 本机 headless 需: xvfb-run -a npm run test:electron
```
**注意**: desktop-electron 的 `main.js` 调用 `app.enableSandbox()`,在 **root 环境**下与 Electron 沙箱限制冲突会 FATAL → 测试自动跳过(见 `electron/launch.js: skipReason`)。**用非 root 用户运行**即可正常。Electron 与 Web 共用 web/dist + 锚点,业务逻辑已由 web 测试覆盖。

## 运行 — Android (Appium) — 完整指南

### ⚡ 一键脚本(推荐)
```bash
bash e2e/scripts/setup-appium.sh                    # 初始化环境(仅首次)
bash e2e/scripts/run-android.sh                     # 自动找 APK + 起模拟器 + 跑全部用例
bash e2e/scripts/run-android.sh --real              # 使用已连接真机
bash e2e/scripts/run-android.sh --edge-only         # 只跑 EDGE-A 边界用例
bash e2e/scripts/run-android.sh --app path/to.apk  # 指定 APK
```

### 0. 环境准备(手动/一次性)
```bash
# Java 17 + Android SDK(含 platform-tools / emulator / 一个 system image)
#   推荐用 Android Studio 装,或命令行 sdkmanager:
#   sdkmanager "platform-tools" "emulator" "platforms;android-34" \
#              "system-images;android-34;google_apis;x86_64"
# 环境变量(加到 ~/.bashrc):
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator

# Node + Appium + Python
npm i -g appium
appium driver install uiautomator2          # UiAutomator2 driver
cd e2e && pip install -r requirements.txt
```

### 1. 起模拟器(或接真机)
```bash
# 创建 AVD(一次性):
avdmanager create avd -n vxin-test -k "system-images;android-34;google_apis;x86_64"
# 启动:
emulator -avd vxin-test -no-snapshot -no-audio &
adb wait-for-device
adb devices                                  # 确认有设备 online
```
真机:USB 调试打开 + `adb devices` 确认即可。

### 2. 构建并安装 APK
```bash
cd ../android
./gradlew assembleDebug                       # 产物: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
APK 已含测试锚点(MainActivity 设 `testTagsAsResourceId=true`,使 Compose 元素可被 `AppiumBy.ID` 定位)。

### 3. 让 App 连测试后端
App 登录页 → "切换服务器" → 填 **`http://10.0.2.2:3099`**(模拟器里 `10.0.2.2`=宿主机 localhost;
真机填宿主机局域网 IP 如 `http://192.168.x.x:3099`,并确保后端 PORT_V2=3099 监听 0.0.0.0)。
> conftest 起的测试后端默认 127.0.0.1,真机访问需改 fixture 绑定 0.0.0.0(见"真机注意")。

### 4. 起 Appium + 跑测试
```bash
appium &                                      # 默认 :4723
cd ../e2e/appium
node ../shared/gen-anchors-py.js              # 生成/更新 anchors.py

# conftest 自动起隔离测试后端 + 造号 + 建会话
# 全部用例(含 EDGE-A 边界)
pytest test_auth.py test_chat.py test_edit_recall.py test_call.py \
       test_group.py test_account.py test_edge.py \
  --platform=android -v \
  --app=../../android/app/build/outputs/apk/debug/app-debug.apk

# 只跑边界用例
pytest test_edge.py --platform=android -v --app=<apk>
```

### 真机注意
- 后端绑定:`e2e/shared/backend/fixture.js` 起的后端走 backend-v2 默认 `127.0.0.1`。真机需后端监听
  `0.0.0.0` — 临时改 `backend-v2/src/server.js` 的 `server.listen(config.port, '0.0.0.0', ...)`,
  或用反向代理 `adb reverse tcp:3099 tcp:3099`(真机访问 `http://127.0.0.1:3099`,免改后端)。
  **推荐 `adb reverse`**:`adb reverse tcp:3099 tcp:3099` 后真机也填 `http://127.0.0.1:3099`。
- 权限:capabilities 已设 `autoGrantPermissions=true`(麦克风/相机/存储自动授权)。

---

## 运行 — iOS (Appium,需 macOS) — 完整指南

### ⚡ 一键脚本(推荐)
```bash
bash e2e/scripts/setup-appium.sh                    # 初始化环境(仅首次,macOS 含 xcuitest)
bash e2e/scripts/run-ios.sh                         # 自动找 .app + 起模拟器 + 跑全部用例
bash e2e/scripts/run-ios.sh --edge-only             # 只跑 EDGE-A 边界用例
bash e2e/scripts/run-ios.sh --device "iPhone 16"   # 指定模拟器
```

### 0. 环境准备(手动/一次性,仅 macOS)
```bash
# Xcode(App Store) + 命令行工具
xcode-select --install
# XcodeGen(生成工程) + Appium XCUITest
brew install xcodegen
npm i -g appium
appium driver install xcuitest
cd e2e && pip install -r requirements.txt
```

### 1. 生成并构建 .app
```bash
cd ../ios
xcodegen generate                             # 由 project.yml 生成 Vxin.xcodeproj(锚点已在源码)
xcodebuild -project Vxin.xcodeproj -scheme Vxin -sdk iphonesimulator \
           -configuration Debug -derivedDataPath build
#   产物: build/Build/Products/Debug-iphonesimulator/Vxin.app
```

### 2. 起模拟器
```bash
xcrun simctl list devices                     # 看可用模拟器及 UDID
xcrun simctl boot "iPhone 15"                 # 启动(或在 Simulator.app 里开)
open -a Simulator
```

### 3. 连测试后端 + 跑测试
App 登录页 → "切换服务器" → 填 **`http://127.0.0.1:3099`**(iOS 模拟器与宿主共享网络栈,直接 localhost)。
```bash
appium &
cd ../e2e/appium
node ../shared/gen-anchors-py.js
pytest test_auth.py test_chat.py test_edit_recall.py test_call.py \
       test_group.py test_account.py test_edge.py \
  --platform=ios -v \
  --app=../../ios/build/Build/Products/Debug-iphonesimulator/Vxin.app
# 指定模拟器型号/版本: IOS_DEVICE="iPhone 16" IOS_VERSION="18.0" pytest test_edge.py --platform=ios
```
capabilities 已设 `autoAcceptAlerts=true`(权限弹窗自动允许)。元素用 `AppiumBy.ACCESSIBILITY_ID` 定位。

---

## 设备/后端地址速查
| 端 | 后端地址 | 定位方式 | 运行环境 |
|----|----------|----------|----------|
| Web | localStorage.vxin_server_url=测试后端(fixture 注入) | data-testid | 任意(含 CI) |
| Electron | 同 web(渲染层注入) | data-testid | 非 root 桌面 |
| Android 模拟器 | `http://10.0.2.2:3099` | AppiumBy.ID(testTagsAsResourceId) | 有 SDK+模拟器 |
| Android 真机 | `adb reverse` 后 `http://127.0.0.1:3099` | 同上 | 有真机 |
| iOS 模拟器 | `http://127.0.0.1:3099` | AppiumBy.ACCESSIBILITY_ID | macOS+Xcode |

## 故障排查
- **Android `AppiumBy.ID` 找不到元素**: 确认 MainActivity 的 `testTagsAsResourceId=true` 已生效(本仓库已设),且 APK 是含锚点的最新构建。
- **App 连不上后端**: 模拟器用 `10.0.2.2`(android)/`127.0.0.1`(ios);真机用 `adb reverse tcp:3099 tcp:3099`。
- **造号失败/限流**: 测试后端已 `DISABLE_RATE_LIMIT=1`;若手动起后端记得带该环境变量。
- **iOS 编译失败**: 先 `xcodegen generate` 再 `xcodebuild`;新文件由 `sources: Vxin` 自动纳入。
- **EDGE-A01 Android set_network_connection 失败**: 部分 API 34 镜像需 `--no-snapshot` 启动模拟器才能切网络连接。真机无此问题。
- **EDGE-A03 系统文件选择器找不到元素**: DocumentsUI 版本因 ROM 而异,可改用 `adb shell am start -a android.intent.action.VIEW -d file:///sdcard/Download/sample.png` 手动验证。
- **EDGE-A06 通话 60s 保活失败**: 确认模拟器已授麦克风权限(`autoGrantPermissions=true`);部分 API 30- 模拟器媒体服务不稳定,改用 API 34。
- **background_app 不唤回(EDGE-A05)**: Appium 2.x 的 `background_app(N)` 在 iOS 上有效;Android 某些厂商 ROM 可能限制后台唤回,用 `activate_app()` 补一次。

## 扩展用例
1. 在 `shared/anchors.js` 加锚点(若需新元素),四端 UI 加同名锚点,`gen-anchors-py.js` 重生成。
2. Playwright: 在 `playwright/pages/` 加 POM 方法,`playwright/web/*.spec.js` 加用例。
3. Appium: `appium/pages.py` 加方法,`appium/test_*.py` 加用例。
4. 人工验证: 执行 `e2e/scripts/manual-checklist.md`(多设备 · 多网络 · 安全 · 稳定性 55 条)。

---

## 最终交付清单

### ✅ 已交付且 web 实跑通过(24 用例)
| 模块 | 文件 |
|------|------|
| 锚点真相源 | `shared/anchors.js` + `appium/anchors.py`(生成器 `gen-anchors-py.js`) |
| 隔离后端 | `shared/backend/fixture.js`(起停)+`seed.js`(造号/建好友会话) |
| 环境常量 | `shared/env.js` |
| Playwright 配置 | `playwright.config.js` + `global-setup/teardown.js` + `fixtures.js` |
| Web POM | `playwright/pages/LoginPage.js` + `ChatPage.js` |
| **Web spec(10 文件 24 用例)** | auth / chat / edit-recall / lightbox / read / call / group / account-switch / network / **edge / edge-net** |
| Electron driver | `playwright/electron/launch.js`(root 跳过)+ `smoke.spec.js` |
| Appium 框架 | `appium/conftest.py` + `pages.py`(含 push_file/后台/回复/气泡计数) |
| **Appium spec(7 文件)** | test_auth / test_chat / test_edit_recall / test_call / test_group / test_account / **test_edge** |
| 一键脚本 | `scripts/setup-appium.sh` / `run-android.sh` / `run-ios.sh` |
| 人工 checklist | `scripts/manual-checklist.md`(55 条,含安全/稳定性/多平台一致性) |
| CI | `.github/workflows/e2e-web.yml`(push 自动跑 web **24** 用例,timeout 35min) |
| 文档 | 本 README |

### 四端测试锚点(已埋入产品代码,纯增属性不改逻辑)
- **Web**(=Electron): Login/Register/Home/ChatList/ChatWindow/MessageItem/ImagePreview/CallModal/GroupInfo/toast `data-testid`
- **Android**: feature/auth, feature/chat, AppNavigation `Modifier.testTag` + MainActivity `testTagsAsResourceId=true`
- **iOS**: LoginView/RegisterView/MainTabView/ConversationListView/ChatView `.accessibilityIdentifier`

### 后端测试支持开关(生产默认不开)
`DISABLE_RATE_LIMIT` / `DISABLE_CSRF` / `CORS_ORIGINS` — 仅 e2e fixture 设置,使隔离后端可被自动化驱动。

### 一句话上手
```bash
# Web(CI 自动跑)
cd e2e && npm install && npm run pw:install && npm run build:web && npm run test:web

# Android(本地)
bash e2e/scripts/setup-appium.sh && bash e2e/scripts/run-android.sh

# iOS(macOS 本地)
bash e2e/scripts/setup-appium.sh && bash e2e/scripts/run-ios.sh
```
