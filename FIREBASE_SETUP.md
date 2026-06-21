# Firebase 推送配置指南（FCM）

后端只通过 **firebase-admin（FCM）** 下发推送;Android 直接用 FCM,iOS 的 FCM 底层走 APNs。
**两端都注册 FCM token**,统一由 `POST /api/notifications/device-token` 上报。

> 自动化程度:除"在 Firebase 控制台创建项目/下载配置文件/生成服务账号私钥"必须用你的 Google 账号手动完成外,
> **其余全部脚本化**。任何时候运行 `bash scripts/check-firebase-config.sh` 查看还差哪几项。

---

## 总览(5 步)

| 步骤 | 谁来做 | 说明 |
|------|--------|------|
| 1. 建 Firebase 项目 | 你（控制台） | 一次性 |
| 2. Android 配置 | 你下载 + 放到固定路径 | `android/app/google-services.json` |
| 3. iOS 配置 | 你下载 + 放到固定路径 + 上传 APNs Key | `ios/Vxin/GoogleService-Info.plist` |
| 4. 后端服务账号 | 你下载 JSON → **脚本自动写入 .env** | `node scripts/setup-firebase-admin.js xxx.json` |
| 5. 自检 + 测试 | **脚本** | `bash scripts/check-firebase-config.sh` |

---

## 1. 创建 Firebase 项目（控制台，约 2 分钟）
1. 打开 https://console.firebase.google.com/ → 「添加项目」,名称随意(如 `vxin`)。
2. 创建后进入项目。

## 2. Android 应用
1. 项目概览 → 添加应用 → **Android**。
2. **Android 包名填**:`com.vxin.app`（必须与 `android/app/build.gradle.kts` 的 `applicationId` 一致）。
3. 下载 `google-services.json`。
4. **放到**(替换占位文件):
   ```
   android/app/google-services.json
   ```

## 3. iOS 应用
1. 项目概览 → 添加应用 → **iOS**。
2. **Bundle ID 填**:`com.vxin.app`（与 `ios/project.yml` 的 `PRODUCT_BUNDLE_IDENTIFIER` 一致）。
3. 下载 `GoogleService-Info.plist`。
4. **放到**(替换占位文件):
   ```
   ios/Vxin/GoogleService-Info.plist
   ```
5. **APNs 鉴权(iOS 推送必须)**:Apple Developer → Keys 生成 **APNs Auth Key (.p8)** →
   Firebase 控制台 → 项目设置 → Cloud Messaging → Apple 应用配置 → 上传该 `.p8`(填 Key ID + Team ID)。
6. Xcode 里给 target 开启 **Push Notifications** 能力 + **Background Modes → Remote notifications**(签名时需 Apple 开发者账号)。

## 4. 后端服务账号（脚本自动配）
1. Firebase 控制台 → 项目设置 → **服务账号** → 「生成新的私钥」→ 下载 JSON(如 `vxin-firebase-adminsdk.json`)。
2. 运行(**自动写入 `backend-v2/.env`**,无需手改):
   ```bash
   cd backend-v2
   node scripts/setup-firebase-admin.js /绝对路径/vxin-firebase-adminsdk.json
   ```
   它会写入 `FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY`。
3. 重启后端,启动日志应出现:
   ```
   [Push] Firebase Admin 初始化成功
   ```
   > `.env` 已被 `.gitignore` 忽略,私钥不会进仓库。服务账号 JSON 用完请妥善保管/删除,**切勿提交**。

## 5. 自检 + 测试
```bash
bash scripts/check-firebase-config.sh   # 全 ✅ 即配置就绪
```

---

## 最小推送测试

> 注意:**iOS 真机才能收推送**(模拟器不支持 APNs);Android 用带 Google Play 的模拟器或真机。

### 方式 A:Firebase 控制台对单设备发测试(最快、隔离验证)
1. 运行 App 并登录,看日志拿到 FCM token:
   - Android:`adb logcat | grep "FCM token"`
   - iOS:Xcode 控制台搜 `FCM token`
2. Firebase 控制台 → Cloud Messaging →「发送测试消息」→ 粘贴该 token → 发送。
3. App 退到后台应收到通知。

### 方式 B:真实业务链路
1. 两个账号 A、B 互为好友。
2. A 在 App 登录并退到后台(token 已上报)。
3. B 给 A 发消息。
4. A 收到「新消息」推送(标题=发送者昵称,点击进入会话)。

### 排查
- 后端日志无「Firebase Admin 初始化成功」→ 重跑第 4 步,确认 `.env` 三个变量。
- 收不到 → 确认设备已 `device-token` 上报:`GET /api/notifications/status`(带登录态)或查 `device_tokens` 表。
- iOS 收不到 → 多半是 APNs Key 未上传 Firebase,或未开 Push 能力/未用真机。
