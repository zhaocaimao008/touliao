# 投聊 Android 个推(GeTui)推送修复全记录

> 日期: 2026-08-28 ~ 08-29
> 症状: 国产 ROM(无 GMS)Android 设备收不到锁屏推送,个推诊断工具显示「初始化后CID: 仍为空!」
> 结论: 根因是 **SDK 版本过旧**(gtsdk 3.2.15.0 + gtc 3.2.1.0 组合存在注册兼容性问题),升级后立即生效。
> 过程中还发现并修复了 2 个配置缺陷 + 1 个诊断链路缺陷。

---

## 一、最终结论(一句话)

**升级个推 SDK 到 gtsdk 3.3.15.0 + 显式 gtc 3.3.3.0 后,`Login Successed with cid=xxx` 立即成功。**

之前所有配置(密钥/包名/manifest)其实都是对的,但旧版 SDK(2023-02 发布)与个推服务端的注册兼容性有问题,导致 SDK 能初始化、checkManifest 能通过,却永远连不上注册流程、CID 拿不到。

---

## 二、排查过程(按时间线)

### 第 1 步:确认症状
用户发来个推诊断弹窗截图:
```
manifest: APPID=yjoaubSt.… APPKEY=Z0m8Rb.…. APPSECRET=gcMAzH..…
checkManifest异常: 未找到继承 com.igexin.sdk.PushService 的子类
初始化后CID: 仍为空!
```

### 第 2 步:修复 manifest 缺 PushService 子类
- 新建 `android/app/src/main/java/com/touliao/app/core/push/TouliaoPushService.kt`(空实现继承 `com.igexin.sdk.PushService`)
- manifest 声明 `<service android:name=".core.push.TouliaoPushService" android:exported="false" android:process=":pushservice" tools:replace="android:exported" />`
- 效果: checkManifest 通过 ✅ 但 **CID 仍空**

### 第 3 步:核对配置
- 用户从个推控制台截图确认: APPID/APPKEY/APPSECRET/包名(com.touliao.app)/MasterSecret 与后端 .env 完全一致 → 排除密钥/包名问题
- 后端用三件套调个推 REST API `/auth` 成功 → 后端凭证有效

### 第 4 步:加主进程过滤
- 反编译 SDK 发现 `initialize` 强制要求主进程(`Must be called in main process!`)
- `TouliaoApp.onCreate()` 会在所有进程执行(含个推自己的 `:pushservice` 进程),非主进程重复 initialize 会导致注册错乱
- 加 `isMainProcess()` 判断,仅主进程初始化
- 效果: **CID 仍空**(但这是正确修复,必须保留)

### 第 5 步:诊断增强(关键转折)
- `setDebugLogger` 抓 SDK 内部日志,但**仅 FLAG_DEBUGGABLE 构建输出**,release 包只回一句 `only run in debug mode`
- 临时给 release 构建设 `isDebuggable = true`,重打包
- 诊断弹窗终于显示 SDK 内部日志:
  ```
  SDK: [GT-PUSH] [LoginInteractor] Start login appid = yjoaubSteR9mKP6YM2eif9
  SDK: [GT-PUSH] [LoginResult] Login Successed with cid = b469704b40ea…
  ```
  → 说明某一步改动起了作用

### 第 6 步:确认真凶 = SDK 版本
- 对比改动: 上一步同时把 SDK 升级到了 3.3.15.0 + gtc 3.3.3.0
- 官方更新日志佐证: **Android SDK 3.2.17.0 起要求 GTC ≥ 3.2.4.0**,3.2.18.0 起要求 ≥ 3.2.5.0
- 项目此前是 gtsdk 3.2.15.0(2023-02-16)+ gtc 3.2.1.0(2022-12),双双过旧
- 单独验证: 把 SDK 升级作为独立提交,复测 CID 稳定生成 → 真凶确认

### 第 7 步:端到端验证
- 用户登录 App → CID 上报后端入库(`device_tokens` 表, platform='getui')
- 后端调个推 API 推送 → `successed_online`(前台)/ `successed_offline`(锁屏)
- 锁屏实测手机收到通知 ✅

---

## 三、修复清单(6 个 commit)

| Commit | 内容 |
|---|---|
| `e7e47dd` | 补 TouliaoPushService 子类 + manifest 声明 |
| `5379161` | 后端补 `/api/push/getui-diag` 诊断路由(此前 App 上报 404 全部丢失) |
| `5d7b6e3` | initialize 仅主进程执行 + 诊断加 SDK 版本,轮询 8s→15s |
| `09931bb` | 提交 MainActivity 诊断弹窗遗留代码 |
| `78d7c99` | 加 setDebugLogger 抓 SDK 内部日志 |
| `4bf4e27` | **SDK 升级 3.2.15→3.3.15.0 + gtc 3.3.3.0(真凶修复)** |
| `3d042c7` | 移除临时 debuggable,恢复正式 release 配置 |

---

## 四、经验沉淀(下次直接照此排查)

### 个推 CID 为空排查顺序(按优先级)
1. **SDK 版本**: 确认 gtsdk ≥ 3.2.17.0 且 gtc ≥ 3.2.4.0(官方 2023-05 起的要求)。旧组合即使 checkManifest 通过、CID 也可能永远为空 —— 这是最隐蔽的坑
2. **manifest 必须声明继承 PushService 的子类**(空实现即可,process=:pushservice)
3. **initialize 必须只在主进程调用**(Application.onCreate 在所有进程执行,含 :pushservice 进程)
4. 密钥三件套与个推后台一致(APPID/APPKEY/APPSECRET)
5. 包名与个推后台配置一致
6. 后端凭证用 `GETUI_MASTER_SECRET` 调 `/auth` 验证

### 调试技巧
- `PushManager.setDebugLogger()` 抓 SDK 内部日志,但**仅 debuggable 构建输出** → 临时给 release 加 `isDebuggable = true`,定位后必须改回
- 后端诊断上报路由: `POST /api/push/getui-diag`(app.js 独立挂载,绕 CSRF,带 `X-Diag-Token: diag2026`),日志落 `backend-v2/push-diag.log`
- 验证推送: `pushToCid(cid, {title, body})` 返回 `successed_online`/`successed_offline`
- ⚠️ 个推 API 敏感词: 标题/正文**不能含「个推」二字**(code=20001 param contains sensitive word)

### 前台 vs 后台行为(设计如此,勿当 bug)
- App **前台**时,个推透传通知被忽略(`if (appForeground) return`),因为正常消息走 socket 实时显示,避免重复弹通知
- App **后台/锁屏**时,走通知渠道展示,锁屏可见
- 所以测试推送一定要**锁屏或退后台**再发

### 打包注意
- 后台打包必须**显式 export** GETUI_APP_ID/KEY/SECRET(后台进程不继承 Hermes shell 环境变量,否则打进 APK 的是空串)
- 打包命令模板见 skill `touliao-project-ops` → 个推 GeTui 推送章节

---

## 五、涉及文件

- `android/app/src/main/java/com/touliao/app/core/push/TouliaoPushService.kt`(新增)
- `android/app/src/main/java/com/touliao/app/TouliaoApp.kt`(主进程过滤 + 诊断 + setDebugLogger)
- `android/app/src/main/java/com/touliao/app/MainActivity.kt`(诊断弹窗)
- `android/app/src/main/AndroidManifest.xml`(PushService 声明)
- `android/gradle/libs.versions.toml`(SDK 版本升级)
- `android/app/build.gradle.kts`(gtc 显式依赖)
- `backend-v2/src/app.js` + `notifications.controller.js`(诊断路由)
