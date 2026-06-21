# v信 iOS（Swift + SwiftUI）

原生 iOS 客户端,复用 Web/Android 同一套后端 API(Bearer token 鉴权),架构与 Android 对称。

> ⚠️ 需在 **macOS + Xcode 15+** 上构建(Linux 无法编译 SwiftUI)。本目录是源码与工程配置,按下方步骤生成 Xcode 工程即可运行。

## 技术栈
- Swift 5.9 + SwiftUI(iOS 16+)
- URLSession + async/await(网络)· Keychain(token)
- Socket.IO-Client-Swift(实时,聊天阶段使用)· Kingfisher(图片,媒体阶段使用)
- MVVM:`ObservableObject` ViewModel + Repository + 单例服务

## 生成并运行工程

### 方式一：XcodeGen（推荐，一条命令）
```bash
brew install xcodegen          # 如未安装
cd ios
xcodegen generate             # 依据 project.yml 生成 Vxin.xcodeproj（自动接入 SPM 依赖）
open Vxin.xcodeproj           # Xcode 中选模拟器运行
```

### 方式二：手动建工程
1. Xcode → New Project → iOS App,名称 `Vxin`,Interface=SwiftUI,删掉自动生成的 `ContentView`/`App`
2. 把 `Vxin/` 下所有 `.swift` 拖入工程(Create groups)
3. File → Add Package Dependencies 添加:
   - `https://github.com/socketio/socket.io-client-swift`
   - `https://github.com/onevcat/Kingfisher`
4. Info.plist 增加:`NSAppTransportSecurity → NSAllowsArbitraryLoads = YES`(开发期)、
   `NSMicrophoneUsageDescription`、`NSPhotoLibraryUsageDescription`

## 服务器地址
默认 `ServerConfig.defaultURL`。登录页「切换服务器」可运行时修改并持久化(UserDefaults),
后续请求即生效。

## 目录结构（与 Android 对称）
```
App/        VxinApp(@main) · RootView(按会话状态切换)
Core/
  Network/  APIClient(URLSession+Bearer+401) · APIError · AnyEncodable
  Storage/  KeychainStore(token) · ServerConfig(可切换地址)
  Session/  SessionStore(全局会话状态 + 启动 restoreSession + 401 自动登出)
Data/
  Models/   User · AuthDTO
  Repositories/ AuthRepository
Features/
  Auth/     AuthViewModel · LoginView · RegisterView
UI/Theme/   品牌色(微信绿 #07C160)
```

## 认证流程（对齐 Android）
1. 启动 → `SessionStore` 用 Keychain 中的 token 调 `GET /api/auth/me` 恢复会话
2. 登录 → `POST /api/auth/login {phone,password}` → 存 token(Keychain)→ 全局状态切主页
3. 任意请求 401 → `APIClient` 清 token + 发通知 → `SessionStore` 切登录页
4. 不处理 CSRF(无 cookie,后端对 Bearer 放行)

## 实时聊天（已实现：会话列表 + Socket）
- `Core/Realtime/SocketService`：封装 Socket.IO-Client-Swift
  - 连接：`socket.connect(withPayload: ["token": token])`，服务端从 `handshake.auth.token` 读取
  - 仅 websocket（`.forceWebsockets(true)`），心跳依赖 engine.io 内置 ping/pong + 自动重连
  - 接收：`new_message`/`new_message_batch` → 统一转 `Message`（Combine `incoming` 流）
  - 发送：`emitWithAck("send_message", …)` 已封装（消息收发阶段使用）
- `SessionStore` 在登录/恢复会话后 `connect()`，登出/401 时 `disconnect()`
- `Features/Chat`：`ConversationListView`（List，实时更新最后消息/未读/置顶，顶栏显示连接状态）

## 消息收发 + 媒体消息（已实现）
- `Features/Chat/ChatView` + `ChatViewModel`：消息气泡(文本/图片/语音/文件)、输入栏、自动滚到底
- 发送文本：`SocketService.sendMessage`（emitWithAck → 落库 Message）
- 媒体上传：`POST /api/messages/{id}/upload`（multipart 字段 `file`，`APIClient.upload`）
  - 图片：PhotosPicker → 转 JPEG 上传 → 本地预览占位(带进度) → Kingfisher 显示
  - 语音：`AudioRecorder`(AVFoundation 录 m4a/audio/mp4) → 上传 → 气泡点按播放(`AudioPlayerService`)
  - 文件：`.fileImporter` → 读取 Data + UTType 推断 MIME → 上传 → 点按用系统打开
- 占位机制：`PendingUpload` 上传中显示,成功后由真实 `Message`(按 id 去重)替换,失败可点击移除
- 资源鉴权：`MediaUrlResolver` 把 `/uploads/...` 解析为绝对地址并附 `?token=`
- 权限：Info.plist 已含 `NSMicrophoneUsageDescription` / `NSPhotoLibraryUsageDescription`（见 project.yml）

> 至此 iOS 与 Android 功能基本对齐：登录/restoreSession、会话列表+实时、消息收发、媒体消息。
