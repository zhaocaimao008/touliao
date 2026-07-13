# iOS TestFlight 签名配置指南

`ios-testflight.yml` 卡在「导入发布证书」的唯一原因：**7 个签名相关 GitHub Secrets 未配置**。
本文教你准备材料并一键写入。准备工作需在一台 **Mac** + 一个 **付费 Apple 开发者账号**（$99/年）上完成。

## 需要配置的 7 个 Secret

| Secret 名 | 内容 | 来源 |
|-----------|------|------|
| `IOS_CERTIFICATE_P12_BASE64` | 发布证书 `.p12` 的 base64 | 钥匙串导出（步骤2） |
| `IOS_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 | 你自定义（步骤2） |
| `IOS_PROVISIONING_PROFILE_BASE64` | 描述文件 `.mobileprovision` 的 base64 | 开发者后台（步骤3） |
| `IOS_KEYCHAIN_PASSWORD` | CI 临时钥匙串口令 | 任意≥6位字符串（随便设） |
| `ASC_KEY_ID` | App Store Connect API Key ID | ASC 后台（步骤4） |
| `ASC_ISSUER_ID` | App Store Connect Issuer ID | ASC 后台（步骤4） |
| `ASC_API_KEY_BASE64` | ASC API Key `.p8` 的 base64 | ASC 后台（步骤4） |

> 工作流里已硬编码：Bundle ID = `com.vxin.app`，描述文件名 = `vxin_distribution`，
> 签名身份 = `iPhone Distribution`。**步骤3 创建描述文件时命名必须叫 `vxin_distribution`**，否则要改工作流。

---

## 步骤 1：注册 App（一次性）
App Store Connect → 我的 App → ＋ → 新建 App：
- 平台 iOS，Bundle ID 选 `com.vxin.app`（若没有，先去 Developer 后台 Identifiers 注册这个 App ID）。

## 步骤 2：发布证书（Distribution Certificate → .p12）
1. Apple Developer → Certificates → ＋ → **Apple Distribution**（或 iOS Distribution）。
2. 按提示用「钥匙串访问 → 证书助理 → 从证书颁发机构请求证书」生成 CSR，上传，下载 `.cer`，双击导入钥匙串。
3. 钥匙串访问里找到该证书 → 右键「导出」→ 存成 `distribution.p12` → **设置一个导出密码**（记住它 = `IOS_CERTIFICATE_PASSWORD`）。

## 步骤 3：描述文件（Provisioning Profile）
1. Apple Developer → Profiles → ＋ → **App Store**（Distribution）。
2. App ID 选 `com.vxin.app`，证书选步骤2 的发布证书。
3. **Profile 名称填 `vxin_distribution`**（务必一致）→ 生成 → 下载 `vxin_distribution.mobileprovision`。

## 步骤 4：App Store Connect API Key（用于上传 TestFlight）
1. App Store Connect → 用户与访问 → 集成 → **App Store Connect API** → 生成密钥。
2. 角色选 **App Manager**（或以上）。
3. 记下 **Key ID**（=`ASC_KEY_ID`）与页面上的 **Issuer ID**（=`ASC_ISSUER_ID`）。
4. 下载 `AuthKey_XXXXXX.p8`（**只能下载一次**，务必保存好）。

---

## 一键写入 Secrets
把 3 个文件放到本机（可以是这台 Linux 机器，只要 `gh` 已登录），然后：

```bash
export IOS_CERTIFICATE_PASSWORD='步骤2设的p12密码'
export IOS_KEYCHAIN_PASSWORD='随便设个≥6位口令'   # 仅CI内部临时用
export ASC_KEY_ID='步骤4的Key ID'
export ASC_ISSUER_ID='步骤4的Issuer ID'

bash scripts/setup-ios-secrets.sh \
  ./distribution.p12 \
  ./vxin_distribution.mobileprovision \
  ./AuthKey_XXXXXX.p8
```

脚本会把 7 个 Secret 全部 `gh secret set` 写入仓库，并列出结果。

> 也可手动在 GitHub → Settings → Secrets and variables → Actions → New repository secret 逐个添加，
> base64 生成：`base64 -w0 文件 | pbcopy`（macOS 用 `base64 -i 文件 | pbcopy`）。

## 触发发版
```bash
gh workflow run ios-testflight.yml --ref main -f version=1.0.9
gh run watch   # 或到 Actions 页看进度
```
跑通后 IPA 会自动上传到 TestFlight；同时该 run 的 Artifacts 里也有 `vxin-ios-ipa`。

## 常见坑
- **描述文件名不叫 `vxin_distribution`** → 归档/导出报 profile 不匹配。改名或改工作流二选一。
- **.p8 只能下载一次**：丢了只能重新生成新 Key。
- **证书类型不对**：必须是「Distribution / Apple Distribution」，不是 Development。
- **Bundle ID 不一致**：证书/描述文件/工程都必须是 `com.vxin.app`。
