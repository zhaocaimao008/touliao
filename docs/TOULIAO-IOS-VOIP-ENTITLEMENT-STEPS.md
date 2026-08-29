# 投聊 iOS — 恢复"App被杀后来电"能力：Apple Developer 后台操作步骤

## 当前代码里的证据

`ios/Touliao/Core/Push/VoipCallManager.swift` 文件头注释（非本轮新写，是此前某次审计留下的记录）：

> ⚠️ PushKit VoIP push 链路已整体移除（2026-08）：Apple 已从 App ID 移除 VoIP Services capability，
> 且 App Store Guideline 2.5.4 对无真实 VoIP 功能却使用 VoIP push 的 App 审核从严。

`ios/Touliao/Touliao.entitlements` 目前只有：
```xml
<key>aps-environment</key>
<string>production</string>
```
没有VoIP相关entitlement。`ios/project.yml` 的 `UIBackgroundModes` 只有 `remote-notification`，没有 `voip`。

**结论：不是代码没写，是 App ID 层面的能力被收回/从未配置，代码是照着"没有这个能力"的现实调整过的。**

---

## 需要你在 Apple Developer 后台做的（按顺序）

### 第1步：确认账号是否满足VoIP审核前提

App Store Review Guideline 2.5.4 要求：**申请VoIP Push必须App里有真实的、随时可能触发的语音/视频通话功能**（投聊有语音通话，满足条件），但Apple审核时会实际验证这一点，纯聊天软件"顺便加个通话"有时会被要求解释使用场景。这不是后台开关问题，是提交App Store审核/更新时可能被问到的问题，先心里有数。

### 第2步：打开 App ID 配置

1. 登录 https://developer.apple.com/account
2. 左侧菜单 **Certificates, Identifiers & Profiles**
3. 点 **Identifiers**
4. 找到并点击 `com.touliao.app`（投聊的 Bundle ID）

### 第3步：勾选/确认 Capabilities

在这个 App ID 的详情页，找到 Capabilities 列表，需要确认/勾选：

- ☑️ **Push Notifications**（大概率已经勾了，因为普通APNs推送已经在用）
- 检查是否有单独的 **VoIP Services** 相关项（不同Apple账号类型/App ID创建时间，界面呈现可能不同；如果看到类似字样但是灰色/不可勾选，说明账号层面被限制了，需要联系Apple Developer Support）

**如果列表里根本没有VoIP相关选项**：现代Apple Developer Portal通常不再单独列"VoIP Services"作为一个可勾选的capability——它是通过下面第4步（Xcode里勾Background Mode）+ Push Notifications capability 组合实现的。所以更可能的情况是：**Push Notifications 本身没问题，真正要做的是第4/5步**。

点击右上角 **Save**（如果有改动）。

### 第4步：Xcode侧开启 Background Mode（这一步我可以帮你在代码里做，等你确认这是你想要的方向后我加）

在 `ios/project.yml` 的 `UIBackgroundModes` 里加入 `voip`：
```yaml
UIBackgroundModes:
  - remote-notification
  - voip
```
这一步**我可以直接改**（属于代码改动），但我不会在没有你明确要求前主动加回来——因为：
1. 加了`voip`但App ID没有对应权限，会导致 **App Store 提交时被拒**（Guideline要求代码能力与后台声明的capability必须匹配）
2. `VoipCallManager.swift` 里 `PKPushRegistry`/`didReceiveIncomingPushWith` 相关代码在2026-08被**整体删除**了，不是注释掉——要恢复PushKit注册逻辑需要重新写这部分（工作量：中等，涉及重新实现 `PKPushRegistryDelegate`、后端 `sendVoipPush(platform=ios_voip)` 这条当前标记为"死链路"的后端代码路径也要一并核实是否还能用）

**所以正确顺序是：你先在后台把App ID的Push Notifications能力确认好 → 告诉我"可以恢复VoIP push代码了" → 我再动代码，而不是我先加代码再看行不行。**

### 第5步：重新生成 Provisioning Profile

App ID的capability变了之后：
1. **Certificates, Identifiers & Profiles → Profiles**
2. 找到投聊用于TestFlight/App Store发布的Distribution Profile
3. 如果Xcode/CI走的是自动签名（本项目CI是自动管理签名，见 `.github/workflows/ios-testflight.yml` 里的证书自动签发流程），一般**不需要你手动重新生成**——CI下次跑的时候会根据App ID当前的capability自动重新生成匹配的Profile
4. 如果之前是手动管理的Profile，需要手动点 **Edit** → 确认新capability被包含 → **Generate** 重新下载

### 第6步：是否需要重新签名

是的，但这一步是**自动的**：只要Provisioning Profile更新了，下一次CI构建（`iOS Build`/`iOS TestFlight` workflow）会自动用新Profile签名，不需要你手动操作证书文件。

### 第7步：是否需要重新上传TestFlight

是的——任何entitlement/capability变化都必须走一次新的构建+上传（不能给已经上传的旧build"补"权限）。等第4步代码改完、CI跑绿之后，我会照现在这个流程（`gh workflow run ios-testflight.yml`）重新触发一次。

---

## 完整顺序总结（给你一份可执行的checklist）

1. [ ] 你：登录 Apple Developer 后台，确认 `com.touliao.app` 的 Push Notifications capability 状态，截图/描述给我看到的内容
2. [ ] 你：告诉我"可以恢复VoIP push代码了"
3. [ ] 我：在 `project.yml` 加回 `voip` background mode，重新实现 `PKPushRegistry` 注册+回调逻辑，核实后端 `sendVoipPush` 路径
4. [ ] CI：自动生成新Provisioning Profile并签名（无需你手动操作）
5. [ ] 我：触发新的 `iOS TestFlight` build
6. [ ] 你：真机安装新build，测试"App被杀死后来电"

**在你完成第1步之前，我不会主动改这部分代码**——按你这轮"不要对已经通过CI的功能进行无依据重构"的要求，且这块目前的"移除VoIP"本身就是此前一次有意识的调整（避免审核风险），贸然加回去属于没有你确认就动了一个此前的产品决策。
