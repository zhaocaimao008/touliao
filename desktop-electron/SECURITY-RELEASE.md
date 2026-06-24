# v信 桌面端 — 发布安全要求

> 本文件记录**生产发布前必须满足**的安全前置条件。代码层加固已在 `src/main.js`
> 完成；以下为无法在代码内解决、依赖证书/基础设施的部分。

## P0 ── 自动更新必须代码签名（阻断发布项）

当前 `electron-builder` 配置**未配置任何代码签名**，产物未签名。后果：

- Windows 上 `electron-updater` 的 `verifyUpdateCodeSignature`（校验新安装包发布者
  签名是否与已安装版本一致）**形同虚设**——没有签名可校验。
- `latest.yml` 只携带 `sha512`，仅防传输损坏，**不防伪造**：攻击者一旦能写入或接管
  `https://dipsin.com/downloads/updates`（服务器入侵 / 子路径接管 / CDN 配置失误），
  会同时控制 `latest.yml` 与安装包，哈希自洽。
- 即可向**全部客户端**下发任意可执行文件 → 供应链 RCE。

### 必须做

**Windows（NSIS）**——使用 OV/EV 代码签名证书：

```jsonc
// package.json → build.win
"win": {
  "target": ["nsis"],
  "icon": "assets/icon.ico",
  "publisherName": "<证书中的主体名，必须与证书一致>",
  "signtoolOptions": {
    "certificateSubjectName": "<EV 证书主体>",   // 或 certificateFile + 环境变量密码
    "signingHashAlgorithms": ["sha256"],
    "rfc3161TimeStampServer": "http://timestamp.digicert.com"
  }
}
```
> EV 证书存于硬件令牌/HSM，CI 上用厂商 KSP 调用。OV 证书可走云签名（如 Azure Trusted Signing）。
> 签名后保持 `publisherName` 与证书主体一致，`verifyUpdateCodeSignature`（默认开启）才生效。

**macOS**——签名 + 公证（notarization）：

```jsonc
"mac": {
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "notarize": { "teamId": "<APPLE_TEAM_ID>" }
}
// 环境变量：APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
```

**Linux**——AppImage/deb 无系统级签名链，建议对发布产物附 GPG `.asc` 分发校验。

### 纵深防御 —— latest.yml Ed25519 二次签名（已在代码层完成，待启用密钥）

客户端 `src/main.js`（`verifyUpdateSignature()`）已实现：`update-available` 时关闭
`autoDownload`，先从更新源拉取 `latest*.yml` 与同名 `.sig`，用内置公钥
`src/update-public-key.pem` 做 Ed25519 验签，通过后才 `downloadUpdate()`；签名无效
判定为篡改并阻止下载。使更新真实性不单纯依赖 TLS + 服务器目录可信。

**启用步骤（发布前一次性）：**

1. `node scripts/gen-update-keys.js` —— 生成 Ed25519 密钥对：
   - `src/update-public-key.pem`（公钥，覆盖占位文件后**提交入库**，随客户端内置）；
   - `update-private-key.pem`（私钥，已被 `.gitignore`，**离线/HSM/CI secret 保管，切勿提交外发**）。
2. 每次发布：`electron-builder` 打包后运行
   `node scripts/sign-update.js dist`，为 `dist/latest*.yml` 生成 `*.sig`。
3. 把 `latest*.yml` 与对应 `*.sig` **一并**上传到更新源
   （`https://dipsin.com/downloads/updates`）。

> 公钥仍为 `PLACEHOLDER` 占位（或 `.sig` 缺失/网络失败）时，客户端自动跳过验签、
> 回退仅 TLS 信任，不阻断合法更新；故可先发版、后启用密钥而不破坏在网客户端。
> 私钥泄露 = 可伪造更新元数据，轮换公钥需加 `--force` 且会使旧客户端无法校验新签名。

- 更新目录所在主机最小权限，写入走单独的发布流水线，禁止人工直接覆盖。

## 已在代码层完成（本次）

- `autoUpdater.autoInstallOnAppQuit = false`：取消"退出即静默安装"；并在 `update-downloaded`
  时由主进程弹原生确认框，用户同意后才 `quitAndInstall`（渲染层暂无安装按钮，此举保证
  更新可落地且必经确认）。
- `config:setServerUrl`：仅接受 `https`，且切换后端需经主进程原生确认弹窗，阻止渲染
  进程被注入后静默重定向后端（保留私有化部署所需的任意域名能力）。
- `file:readAsBase64`：收窄到本应用生成的 `vxin-screenshot-*.png`，并加 20MB 上限。
- `webPreferences.devTools = !app.isPackaged`：生产构建禁用 DevTools；`spellcheck=false`
  避免输入内容外发拼写服务。
- `Store({ clearInvalidConfig: true })` + 启动时校验 `serverUrl`：被篡改/损坏的本地配置
  不会污染 CSP `connect-src` 与 origin 推导，回退默认值。
- 删除 `src/package.json` 的冗余 `build` 段，消除与根 `package.json` 的配置漂移。

## 评估后未改动（残留，附理由）

- **限制 `file://` 导航到 web/dist 内**：未做。XSS→`file:///etc/passwd` 的本地读已被
  `frame-src 'none'`（禁 iframe 读）+ 拒绝 window.open + Chromium 禁止 `fetch(file://)` +
  整页导航会丢失攻击者脚本 共同压制；而按路径前缀放行的 file URL 匹配对编码敏感，可能误伤
  页面刷新（无法在此环境做 GUI 验证）。收益 < 破坏风险，故保留。
- **`dialog:selectFile` 返回绝对路径**：未改。渲染层 `selectFiles` 当前无任何调用方、
  也不读取 `.path`，仅属轻微信息泄露；改返回结构反而给未来代码埋意外。
- **`screenshot:capture` / `update:install` 可被渲染进程无手势触发**：未加节流，属轻量
  滋扰/隐私面，截图过程窗口最小化/恢复对用户可见，收益有限。

## 残留 / 已知取舍

- CSP `script-src`：已去除 `'unsafe-inline'` —— `setupSecurity()` 启动时按本次构建实际
  随包发行的 `web/dist/index.html` 现算各内联 `<script>` 的 `sha256`，以哈希白名单放行
  （`inlineScriptHashes()`，无需打包钩子，天然匹配构建）；现算失败才回退 `'unsafe-inline'`。
  `'unsafe-eval'` 暂保留：打包产物 grep 未见 `eval`/`new Function`，可在 GUI 验证无白屏后
  移除。在 sandbox + contextIsolation + 关闭 nodeIntegration + `connect-src` 收敛前提下，
  残留风险为渲染层 XSS，不可触达 Node。
- 构建请**固定从 `desktop-electron/` 根目录执行**（使用根 `package.json`）；`src/package.json`
  的冗余 `build` 段已删除，避免从错误目录构建产出错配安装包。
