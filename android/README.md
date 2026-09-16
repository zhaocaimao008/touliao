# v信 Android（Kotlin + Jetpack Compose）

原生 Android 客户端,复用 Web 端同一套后端 API(Bearer token 鉴权)。

## 技术栈
- Kotlin 1.9.22 + Jetpack Compose（BOM 2024.02）
- Hilt（DI）· Retrofit + OkHttp · Kotlinx Serialization
- EncryptedSharedPreferences（token 安全存储）
- Navigation Compose · Coroutines/Flow（MVVM）
- AGP 8.1.4 / Gradle 8.3 / **JDK 17**

## 构建要求
- Android SDK（compileSdk 34）
- **JDK 17**（AGP 8.1 需要;用 JDK 21 会触发 jlink/JdkImageTransform 失败）
  - 在 `~/.gradle/gradle.properties` 设 `org.gradle.java.home=/path/to/jdk-17`,或导出 `JAVA_HOME`

## 运行
```bash
# 1. 指定 SDK（或在 Android Studio 打开自动生成 local.properties）
echo "sdk.dir=/path/to/android-sdk" > local.properties

# 2. 构建 Debug APK
./gradlew :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk

# 3. 安装到设备/模拟器
./gradlew :app:installDebug
```

## 无真实 Firebase 配置的 JVM 单测

仅在隔离开发/CI 工作区使用。需要上述 JDK/SDK 和已下载的 Gradle/依赖缓存：

```bash
./gradlew --offline --no-daemon --init-script gradle/offline-unit-tests.init.gradle testDebugUnitTest
```

显式入口为真实 `processDebugGoogleServices` 任务提供 `test-fixtures/google-services.offline.json` 的合成输入，仍执行包名检查、资源生成、应用/测试编译和全部 JVM 用例；不关闭任务或跳过检查。占位 `current_key` 不可认证，不是 Firebase 密钥，不要替换为真实凭据。

该入口只允许 `testDebugUnitTest`（或 `:app:testDebugUnitTest`），拒绝其他任务和排除任务参数。正常 APK/安装/发布构建不会自动使用它，仍需各自合法配置。不要使用本夹具打包或安装应用。

`--offline` 只约束 Gradle 依赖解析，不是测试进程的网络沙箱。运行环境仍须隔离网络、存储、账号和环境变量；不要给本地/CI 测试注入生产凭据。JVM 通过不能证明 Firebase、真机通话、系统权限或推送通过。

## 服务器地址
默认地址在 `app/build.gradle.kts` 的 `DEFAULT_SERVER_URL`。
登录页「切换服务器」可运行时修改并持久化(由 `HostSelectionInterceptor` 动态改写,无需重建 Retrofit)。

## 目录结构
```
core/
  network/   ApiErrors, AuthInterceptor(注入Bearer+401), HostSelectionInterceptor(动态baseURL)
  storage/   TokenStore(加密), ServerConfig(可切换地址)
  auth/      SessionManager(全局会话状态 + 启动 restoreSession)
  di/        AppModule(Hilt: OkHttp/Retrofit/Api/AppScope)
data/
  model/     User, AuthResponse, Login/Register Request …
  api/        AuthApi(login/register/me/logout)
  repository/ AuthRepository
feature/
  auth/      LoginScreen + LoginViewModel, RegisterScreen + RegisterViewModel
  home/      HomeScreen（登录后占位，待挂载 Tab 容器）
navigation/  AppNavigation（按 AuthState 切换 Splash/Auth/Home）
ui/theme/    Compose 主题（微信绿 #07C160）
```

## 认证流程
1. 启动 → `SessionManager` 用已存 token 调 `GET /api/auth/me` 恢复会话
2. 登录 → `POST /api/auth/login {phone,password}` → 存 token（加密）→ 全局状态切到主页
3. 任意请求 401 → `AuthInterceptor` 清 token 并广播 → 自动回登录页

## 实时聊天（已实现）
- `core/realtime/SocketManager`：socket.io-client，握手 `auth.token` 带 Bearer；
  收 `new_message`/`new_message_batch`，发 `send_message`（ack 返回落库消息）；
  心跳依赖 engine.io 内置 ping/pong + 自动重连
- `feature/chat`：会话列表（LazyColumn，实时更新最后消息/未读/置顶）、消息界面（气泡）

## 媒体消息（已实现）
- 上传：`POST /api/messages/{id}/upload`（multipart 字段名 `file`，≤50MB，服务端按 MIME 判类型）
- 图片：相册选择 → 本地预览占位（带进度）→ 成功后内联显示（Coil，URL 附 `?token=`）
- 语音：`RECORD_AUDIO` 权限 → MediaRecorder 录 m4a(audio/mp4) → 上传 → 气泡点按播放
- 文件：系统选择器 → 上传 → 气泡显示文件名，点按用系统应用打开
- 占位机制：`PendingUpload` 在 `ChatViewModel` 中维护，上传成功后由真实 `Message`（按 id 去重）替换
- 资源鉴权：`core/util/MediaUrlResolver` 把 `/uploads/...` 解析为绝对地址并附 `?token=`

## 后续扩展（已预留结构）
- 已读回执 / typing（socket `message_delivered` / typing 事件）
- `feature/contacts`、`feature/profile`、底部 Tab 容器
