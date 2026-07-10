# RN + 自建 OTA 热更 POC 骨架蓝图

> 本文件仅描述 `mobile-rn/` 的目录结构、依赖、关键文件内容与移植步骤，不执行 `npx react-native init`。
> 目标：第1阶段（2 周）完成时，能从 web/src 移植一个页面（聊天列表）并验证完整热更链路。

---

## 1. 目录蓝图

```
mobile-rn/                          # RN 项目根目录
├── .buckconfig                     # Buck 构建配置
├── .eslintrc.js                    # ESLint 配置（复用 web 规则）
├── .prettierrc.js                  # Prettier 配置
├── .watchmanconfig                 # Watchman 配置
├── app.json                        # RN 应用元数据
├── babel.config.js                 # Babel 配置（含 reanimated 插件）
├── tsconfig.json                   # TypeScript 配置（strict 模式）
├── metro.config.js                 # Metro bundler 配置
├── package.json                    # 依赖管理
├── Gemfile                         # CocoaPods Ruby 依赖
│
├── index.js                        # RN 入口：注册 AppRegistry
│
├── src/                            # 应用源码
│   ├── App.tsx                     # 根组件：NavigationContainer + 路由栈
│   │
│   ├── navigation/                 # 路由导航
│   │   └── RootNavigator.tsx       # 根导航栈（登录 → 主界面）
│   │
│   ├── screens/                    # 页面组件
│   │   ├── LoginScreen.tsx         # 登录页（第2阶段迁移）
│   │   ├── ChatListScreen.tsx      # ⭐ 聊天列表（POC 首个移植目标）
│   │   ├── ChatRoomScreen.tsx      # 聊天室（第2阶段迁移）
│   │   └── SettingsScreen.tsx      # 设置（第2阶段迁移）
│   │
│   ├── components/                 # 可复用 UI 组件
│   │   ├── ConversationItem.tsx    # 聊天列表项（头像、昵称、最后消息、时间）
│   │   ├── Avatar.tsx              # 头像组件（圆形、在线状态指示器）
│   │   ├── Badge.tsx               # 未读消息角标
│   │   └── LoadingView.tsx         # 加载中 / 骨架屏
│   │
│   ├── services/                   # 服务层（直接从 web/src 移植）
│   │   ├── api.ts                  # axios 封装（拦截器、Token 刷新）
│   │   ├── socket.ts               # socket.io-client 连接管理
│   │   ├── ota.ts                  # OTA 热更核心逻辑（OtaService）
│   │   └── storage.ts              # AsyncStorage 封装（替代 localStorage）
│   │
│   ├── store/                      # 状态管理（从 web/src 移植）
│   │   ├── useAuthStore.ts         # 认证状态（zustand 或 Context）
│   │   ├── useChatStore.ts         # 聊天列表 + 消息状态
│   │   └── useContactStore.ts      # 联系人状态
│   │
│   ├── hooks/                      # 自定义 hooks（从 web/src 移植）
│   │   ├── useConversations.ts     # 聊天列表数据加载 + 实时更新
│   │   └── useSocketEvents.ts      # Socket 事件分发
│   │
│   ├── types/                      # 类型定义（从 web/src 移植，零改动）
│   │   ├── message.ts              # 消息类型
│   │   ├── user.ts                 # 用户/联系人类型
│   │   ├── conversation.ts         # 会话类型
│   │   └── socket-events.ts        # Socket 事件定义
│   │
│   ├── utils/                      # 工具函数（从 web/src 移植，零改动）
│   │   ├── time.ts                 # 时间格式化（timeago.js 封装）
│   │   ├── text.ts                 # emoji 解析、文本截断
│   │   └── validation.ts           # 输入校验
│   │
│   └── constants/                  # 常量
│       ├── config.ts               # API_BASE_URL、SOCKET_URL、OTA_ENDPOINT
│       └── theme.ts                # 主题色、间距、字体大小
│
├── android/                        # Android 原生壳（RN init 自动生成）
│   └── app/src/main/java/.../
│       └── MainApplication.kt      # ReactNativeHost 配置 → 加载 OTA bundle
│
├── ios/                            # iOS 原生壳（RN init 自动生成）
│   └── vxin/
│       └── AppDelegate.mm          # bridge 配置 → 加载 OTA bundle
│
├── scripts/                        # 构建与部署脚本
│   ├── build-bundle.sh             # 构建 JS bundle: npx react-native bundle ...
│   ├── upload-bundle.sh            # 上传到 OTA 服务器（scp → nginx）
│   └── generate-patch.sh           # 生成 bsdiff 差量补丁（可选）
│
└── __tests__/                      # 测试
    ├── services/
    │   └── ota.test.ts             # OTA 服务单元测试
    └── screens/
        └── ChatListScreen.test.tsx # 聊天列表组件测试
```

---

## 2. package.json 关键依赖

```json
{
  "name": "vxin-mobile-rn",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "android": "react-native run-android",
    "ios": "react-native run-ios",
    "start": "react-native start",
    "bundle:android": "react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.bundle --assets-dest android/app/src/main/res/",
    "bundle:ios": "react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ios/main.jsbundle --assets-dest ios/",
    "upload:ota": "bash scripts/upload-bundle.sh",
    "lint": "eslint .",
    "test": "jest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-native": "^0.76.6",

    "@react-navigation/native": "^7.0.0",
    "@react-navigation/native-stack": "^7.0.0",
    "react-native-screens": "^3.35.0",
    "react-native-safe-area-context": "^4.12.0",

    "react-native-reanimated": "^3.16.0",
    "react-native-gesture-handler": "^2.20.0",

    "axios": "^1.7.2",
    "socket.io-client": "^4.7.5",

    "zustand": "^5.0.0",
    "@react-native-async-storage/async-storage": "^2.0.0",

    "react-native-vector-icons": "^10.0.0",
    "react-native-fast-image": "^8.6.3",

    "react-native-swipeable-item": "^2.0.9",
    "timeago.js": "^4.0.2",

    "react-native-ota-hot-update": "^1.0.0"
    // ↑ 自建轻量 OTA 库（见下方说明）。如果选择不引第三方库，
    //   可自己实现（约 200 行，见 src/services/ota.ts）
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-native": "^0.73.0",
    "jest": "^29.7.0",
    "@testing-library/react-native": "^12.0.0",
    "typescript": "^5.5.0",
    "eslint": "^8.57.0",
    "prettier": "^3.3.0",
    "@react-native/babel-preset": "^0.76.0",
    "@react-native/metro-config": "^0.76.0",
    "@react-native/typescript-config": "^0.76.0"
  }
}
```

### 关于 `react-native-ota-hot-update`

这是一个自建轻量 OTA 库的占位符。如果选择"零第三方依赖"路线，完全可以用 `src/services/ota.ts` 自己实现：

```typescript
// src/services/ota.ts — 核心接口定义
export interface OtaManifest {
  latestVersion: string;
  minVersion: string;
  bundleUrl: string;
  assetsUrl: string;
  hash: string;
  releaseNotes: string;
}

export class OtaUpdater {
  // 检查更新 → 下载 → 校验 → 缓存 → 标记重启
  async checkForUpdate(): Promise<boolean> { /* ... */ }
  // 回滚到上一版本
  async rollback(): Promise<void> { /* ... */ }
  // 获取当前 bundle 版本
  getCurrentVersion(): string { /* ... */ }
}
```

---

## 3. 移植步骤：web/src 的聊天列表到 RN

### 步骤 1：文件夹级搬运

从 `web/src/` 找到聊天列表相关的源文件（假设目录结构）：

| web/src 路径 | → mobile-rn 目标 | 改动量 |
|-------------|----------------|--------|
| `services/api.ts` | `src/services/api.ts` | 极少（baseURL 改为从 config.ts 读取） |
| `services/socket.ts` | `src/services/socket.ts` | 极少（App 生命周期事件处理） |
| `store/useChatStore.ts` | `src/store/useChatStore.ts` | 极少（zustand 替换 useContext） |
| `types/conversation.ts` | `src/types/conversation.ts` | 零改动 |
| `types/message.ts` | `src/types/message.ts` | 零改动 |
| `utils/time.ts` | `src/utils/time.ts` | 零改动 |
| `components/ConversationItem.tsx` | `src/components/ConversationItem.tsx` | 中等（`div`→`View`、CSS→StyleSheet） |
| → 新写 | `src/screens/ChatListScreen.tsx` | 新写（React Window → FlatList） |
| → 新写 | `src/navigation/RootNavigator.tsx` | 新写（react-router → @react-navigation） |

### 步骤 2：JSX 适配要点

将 web 组件改为 RN 组件需做以下替换：

| Web (React DOM) | RN (React Native) |
|----------------|-------------------|
| `<div>`, `<span>` | `<View>`, `<Text>` |
| `<img>` | `<Image>` （或 `FastImage`） |
| `<input>`, `<textarea>` | `<TextInput>` |
| `<ul><li>` | `<FlatList>` / `<SectionList>` |
| `onClick={handleClick}` | `onPress={handleClick}` |
| `className="..."` → CSS | `style={styles.xxx}` → StyleSheet.create |
| `useNavigate()` | `navigation.navigate()` |
| `window.innerWidth` | `Dimensions.get('window').width` |
| `localStorage.getItem()` | `AsyncStorage.getItem()` |
| `useEffect(() => {})` | 基本兼容（注意 RN 没有 `document`/`window` 事件） |

### 步骤 3：聊天列表 ChatListScreen 示例结构

```typescript
// src/screens/ChatListScreen.tsx — POC 端到端验证
import React, { useEffect } from 'react';
import {
  View, FlatList, Text, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useChatStore } from '../store/useChatStore';
import ConversationItem from '../components/ConversationItem';

export default function ChatListScreen() {
  const navigation = useNavigation<any>();
  const { conversations, loading, fetchConversations } = useChatStore();

  useEffect(() => {
    fetchConversations();
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ConversationItem
            conversation={item}
            onPress={() => navigation.navigate('ChatRoom', { id: item.id })}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchConversations} />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  separator: { height: 1, backgroundColor: '#eee', marginLeft: 72 },
});
```

### 步骤 4：配置热更 endpoint

```typescript
// src/constants/config.ts
export const CONFIG = {
  // API 服务器地址（现有）
  API_BASE_URL: 'https://dipsin.com/api',
  SOCKET_URL: 'https://dipsin.com',

  // OTA 热更端点（本 POC 的核心配置）
  OTA_ENDPOINT: 'https://dipsin.com/downloads/ota/app.json',
  OTA_CHECK_INTERVAL_MS: 1000 * 60 * 5, // 每 5 分钟检查一次
  OTA_BUNDLE_CACHE_DIR: 'ota-bundles',
  OTA_MAX_RETRIES: 3,
};

// example: 如何被 OtaService 消费
// fetch(CONFIG.OTA_ENDPOINT)
//   .then(res => res.json())
//   .then(manifest => {
//     if (manifest.latestVersion > getCurrentVersion()) {
//       downloadAndApplyBundle(manifest.bundleUrl);
//     }
//   });
```

### 步骤 5：Android 原生壳配置 OTA bundle 加载

```kotlin
// android/app/src/main/java/com/vxin/MainApplication.kt
// （仅示意，实际由 RN init 生成后修改）
class MainApplication : Application(), ReactApplication {
    override val reactNativeHost = object : DefaultReactNativeHost(this) {
        override fun getJSMainModuleName() = "index"

        // ⭐ 关键：从缓存目录读取 OTA bundle，不存在则回退到 assets 基线
        override fun getJSBundleFile(): String? {
            val otaBundle = File(getCacheDir(), "ota-bundles/current/index.bundle")
            return if (otaBundle.exists()) otaBundle.absolutePath else null
            // null → RN 自动走 assets://index.android.bundle
        }

        override fun getUseDeveloperSupport() = BuildConfig.DEBUG
    }
}
```

### 步骤 6：iOS 原生壳配置 OTA bundle 加载

```objc
// ios/vxin/AppDelegate.mm
// （仅示意，实际由 RN init 生成后修改）
- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  // ⭐ 关键：优先从缓存目录读取 OTA bundle
  NSString *otaPath = [NSSearchPathForDirectoriesInDomains(
    NSCachesDirectory, NSUserDomainMask, YES)[0]
    stringByAppendingPathComponent:@"ota-bundles/current/main.jsbundle"];

  if ([[NSFileManager defaultManager] fileExistsAtPath:otaPath]) {
    return [NSURL fileURLWithPath:otaPath];
  }
  // 回退到基线 bundle
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
}
```

---

## 4. OTA 端到端验证步骤

POC 验收标准：改一行 UI 文字 → 构建 bundle → 上传 → App 重启后看见变化。全程 < 3 分钟。

### 4.1 构建 JS Bundle

```bash
# Android bundle
cd mobile-rn
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output ./build/android/index.bundle \
  --assets-dest ./build/android/assets/

# iOS bundle
npx react-native bundle \
  --platform ios \
  --dev false \
  --entry-file index.js \
  --bundle-output ./build/ios/main.jsbundle \
  --assets-dest ./build/ios/assets/
```

### 4.2 上传到 OTA 服务器

```bash
# 上传 Android bundle（首次部署版本 v2.0.1）
bash scripts/upload-bundle.sh \
  --platform android \
  --version 2.0.1 \
  --bundle ./build/android/index.bundle \
  --assets ./build/android/assets/

# 验证服务器文件是否存在
curl -s https://dipsin.com/downloads/ota/v2.0.1/index.bundle | head -c 100
```

### 4.3 向 app.json 写入新版本

```bash
# 自动由 upload-bundle.sh 完成，或手动：
ssh root@93.179.127.50 "cat > /var/www/downloads/ota/app.json << 'EOF'
{
  \"latestVersion\": \"2.0.1\",
  \"minVersion\": \"2.0.0\",
  \"bundleUrl\": \"https://dipsin.com/downloads/ota/v2.0.1/index.bundle\",
  \"assetsUrl\": \"https://dipsin.com/downloads/ota/v2.0.1/assets.zip\",
  \"hash\": \"$(sha256sum ./build/android/index.bundle | awk '{print $1}')\",
  \"releaseNotes\": \"POC 验证：首屏热更测试\"
}
EOF"
```

### 4.4 在 App 端验证

1. 杀掉 App 进程，重新打开
2. App 启动 → OtaService.checkForUpdate() → 发现 v2.0.1 > 本地版本 → 下载新 bundle
3. 缓存写入 → reload() → UI 刷新
4. ✅ 看到修改后的 UI（如聊天列表标题从"消息"改为"对话"）

### 4.5 回滚验证

```bash
# 模拟回滚：将 app.json 的 latestVersion 改回旧版本
ssh root@93.179.127.50 "sed -i 's/\"latestVersion\": \"2.0.1\"/\"latestVersion\": \"2.0.0\"/' /var/www/downloads/ota/app.json"

# 杀掉 App → 重新打开 → 检测到 latestVersion(2.0.0) <= 本地版本(2.0.1) → 不变
# 如果触发回滚指令 → 下载 v2.0.0 bundle → reload → UI 恢复
```

---

## 5. 构建与部署脚本蓝图

### build-bundle.sh（核心骨架）

```bash
#!/bin/bash
# 功能：构建 RN JS Bundle + 计算 hash + 可选打 assets zip
# 用法：bash scripts/build-bundle.sh android 2.0.1

PLATFORM=${1:-android}
VERSION=${2:-$(node -e "console.log(require('./package.json').version)")}

echo "🔨 Building $PLATFORM bundle v$VERSION..."

npx react-native bundle \
  --platform $PLATFORM \
  --dev false \
  --entry-file index.js \
  --bundle-output build/$PLATFORM/index.bundle \
  --assets-dest build/$PLATFORM/assets/

# 压缩 assets
cd build/$PLATFORM && zip -r assets.zip assets/ && cd ../..

# 计算 hash
HASH=$(sha256sum build/$PLATFORM/index.bundle | awk '{print $1}')
echo "Hash: $HASH"
echo "✅ Bundle built: build/$PLATFORM/index.bundle ($HASH)"
```

### upload-bundle.sh（核心骨架）

```bash
#!/bin/bash
# 功能：上传 bundle 到 OTA 服务器 + 更新 app.json
# 用法：bash scripts/upload-bundle.sh android 2.0.1

PLATFORM=$1
VERSION=$2
SSH_USER="root"
SSH_HOST="93.179.127.50"
REMOTE_DIR="/var/www/downloads/ota/$VERSION"

echo "📤 Uploading $PLATFORM bundle v$VERSION to $SSH_HOST..."

# 创建远程目录
ssh $SSH_USER@$SSH_HOST "mkdir -p $REMOTE_DIR"

# 上传 bundle + assets
scp build/$PLATFORM/index.bundle $SSH_USER@$SSH_HOST:$REMOTE_DIR/index.bundle
scp build/$PLATFORM/assets.zip $SSH_USER@$SSH_HOST:$REMOTE_DIR/assets.zip

# 生成 app.json
HASH=$(sha256sum build/$PLATFORM/index.bundle | awk '{print $1}')
ssh $SSH_USER@$SSH_HOST "cat > /var/www/downloads/ota/app.json << BEOF
{
  \"latestVersion\": \"$VERSION\",
  \"minVersion\": \"2.0.0\",
  \"bundleUrl\": \"https://dipsin.com/downloads/ota/$VERSION/index.bundle\",
  \"assetsUrl\": \"https://dipsin.com/downloads/ota/$VERSION/assets.zip\",
  \"hash\": \"$HASH\",
  \"releaseNotes\": \"$RELEASE_NOTES\"
}
BEOF"

echo "✅ OTA bundle uploaded: https://dipsin.com/downloads/ota/$VERSION/index.bundle"
```

---

## 6. POC 验收标准清单

| 验收项 | 通过条件 | 优先级 |
|--------|---------|--------|
| RN 项目能编译通过 | `npx react-native run-android` 成功 | P0 |
| 聊天列表页能显示数据 | 从 API 拉取会话列表并渲染 | P0 |
| 热更端到端链路 | 改一行 UI → 构建 bundle → 上传 → App 重启后可见 | P0 |
| 网络层复用（axios） | 调用 `/api/conversations` 正常返回 | P0 |
| Socket 实时通信 | 收到新消息，聊天列表自动更新 | P1 |
| OTA 回滚 | 修改 app.json 版本回退 → App 显示旧 UI | P1 |
| 基线 bundle 回退 | 删除 OTA 缓存 → App 使用内置基线 bundle 正常启动 | P1 |
| Assets 资源加载 | 头像、图标等图片资源正常显示 | P2 |
| 原生模块桥接 | 调用 RN Native Module（如本地通知）正常工作 | P2 |

---

## 7. 风险说明

1. **Metro bundler 与 Vite 冲突** — 项目根目录已有 Vite 配置，RN Metro bundler 可能抢端口。解决方案：`mobile-rn/.metrorc` 指定不同端口（8081）。
2. **TypeScript 版本冲突** — web/package.json 可能依赖特定 TS 版本，mobile-rn/ 需独立管理 TS 依赖。
3. **Android 第三方库版本** — RN 0.76 需要 compileSdk 34，需确保 android/ Gradle 版本兼容。
4. **iOS CocoaPods 环境** — 需要 macOS 环境执行 `pod install`。POC 阶段可先在 Android 端验证，iOS 端后续平行推进。
