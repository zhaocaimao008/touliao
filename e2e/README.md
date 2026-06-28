# v信 四端全功能自动化测试

Web / Windows(Electron) / Android / iOS 四端端到端自动化测试。
Web+Electron 用 **Playwright**,Android+iOS 用 **Appium**。四端共用一份**锚点字典**和**测试后端**。

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
| GRP-01..05 | 群建/发/已读/改名/踢退 | W E A I | [A] | — | ⬜锚点部分就位,待补 spec |
| ACC-01 | 账户切换 | W E A I | [A] | — | ⬜锚点就位(已修登出bug),待补 |
| NET-01/02 | 断网超时/重连 | W E | [M] | — | ⬜Playwright setOffline,待补 |
| WIN-01/02 | 窗口控制/服务器切换 | E | [A] | — | ⬜骨架,root环境跳过 |

**已实跑通过(web): 12 用例** — AUTH-01/02/06, CHAT-02/04/05/08/09, LB-01/02, CALL-01/02。
Electron 共用 web POM+spec(root 环境跳过,非 root 可跑)。Android/iOS 同名锚点已就位,
test_auth/test_chat/test_edit_recall/test_call 骨架可在设备/模拟器上跑。

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

## 运行 — Android (Appium)
**前置**: Android SDK + 模拟器(或真机) + Appium。
```bash
pip install -r requirements.txt
npm i -g appium
appium driver install uiautomator2
node shared/gen-anchors-py.js          # 生成 appium/anchors.py

# 1. 起模拟器,确认: adb devices
# 2. 构建并装 APK: 
#    cd ../android && ./gradlew assembleDebug
#    adb install app/build/outputs/apk/debug/app-debug.apk
# 3. App 内登录页"切换服务器"填 http://10.0.2.2:3099 (10.0.2.2=模拟器访问宿主localhost)
# 4. 起 Appium server:
appium &                               # 默认 :4723
# 5. 跑测试(conftest 自动起测试后端+造号):
cd appium
pytest test_auth.py test_chat.py --platform=android -v \
  --app=../../android/app/build/outputs/apk/debug/app-debug.apk
```
**关键**: Compose 元素能用 `AppiumBy.ID` 定位,依赖 `MainActivity` 已设 `testTagsAsResourceId=true`(已就位)。

## 运行 — iOS (Appium,需 macOS)
**前置**: macOS + Xcode + 模拟器 + Appium。
```bash
pip install -r requirements.txt
appium driver install xcuitest
node shared/gen-anchors-py.js

# 1. 生成并构建 .app:
#    cd ../ios && xcodegen generate
#    xcodebuild -project Vxin.xcodeproj -scheme Vxin -sdk iphonesimulator \
#               -configuration Debug -derivedDataPath build
#    → build/Build/Products/Debug-iphonesimulator/Vxin.app
# 2. 模拟器: xcrun simctl list
# 3. App 登录页"切换服务器"填 http://127.0.0.1:3099
appium &
cd appium
pytest test_auth.py test_chat.py --platform=ios -v \
  --app=../../ios/build/Build/Products/Debug-iphonesimulator/Vxin.app
```

## 设备/后端地址速查
| 端 | 后端地址 | 定位方式 |
|----|----------|----------|
| Web | localStorage.vxin_server_url=测试后端(fixture注入) | data-testid |
| Electron | 同 web(渲染层注入) | data-testid |
| Android 模拟器 | http://10.0.2.2:3099 | AppiumBy.ID(testTagsAsResourceId) |
| iOS 模拟器 | http://127.0.0.1:3099 | AppiumBy.ACCESSIBILITY_ID |

## 扩展用例
1. 在 `shared/anchors.js` 加锚点(若需新元素),四端 UI 加同名锚点,`gen-anchors-py.js` 重生成。
2. Playwright: 在 `playwright/pages/` 加 POM 方法,`playwright/web/*.spec.js` 加用例。
3. Appium: `appium/pages.py` 加方法,`appium/test_*.py` 加用例。
4. 同一用例四端共享步骤,只是 driver 实现不同。
