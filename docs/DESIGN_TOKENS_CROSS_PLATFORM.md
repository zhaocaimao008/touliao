# v信 跨端设计 Token 对照

三端(Web / Android / iOS)设计 token 的单一真相源与对照表。任何硬编码的颜色、圆角、字号在提交前都应先在此找到对应 token;若确实无对应,再评估是否新增语义档。

## 真相源文件

| 维度 | Web | Android | iOS |
|---|---|---|---|
| 颜色 | `web/src/design-tokens.css` | `android/.../ui/theme/Color.kt` | `ios/Vxin/UI/Theme/Theme.swift` |
| 圆角 | `web/src/design-tokens.css` `--radius-*` | `android/.../ui/theme/Dimens.kt` `VxinRadius` | `ios/Vxin/UI/Theme/Dimens.swift` `VxinRadius` |
| 字号 | `web/src/design-tokens.css` `--text-*` | `android/.../ui/theme/TextSize.kt` `VxinTextSize` | `ios/Vxin/UI/Theme/FontSize.swift` `VxinFontSize` |

约定:Web 为基准,原生端命名/取值向 Web 对齐。移动端历史值(圆角 thumb=8 / pill=25)暂保留以零视觉回归。

## 一、颜色

### 品牌与语义色(跨端一致)

| 语义 | 值 | Web | Android | iOS |
|---|---|---|---|---|
| 主品牌色 极光靛 | `#6D5AE6` | `--brand-500` | `VxinBrand` | `vxinBrand` |
| 品牌浅(渐变浅端) | `#8A78EB` | `--brand-400` | `VxinBrandLight` | `vxinBrandLight` |
| 品牌深(按下态) | `#5A47D6` | `--brand-600` | `VxinBrandDark` | `vxinBrandDark` |
| 成功/正向 | `#00B42A` | `--color-success` | `VxinSuccess` | `vxinSuccess` |
| 错误/危险 | `#F53F3F`(web) / `#FA5151`(徽标) | `--color-danger` / `--color-badge` | `VxinError` | `vxinError` |
| 支付绿(转账/收款) | `#07C160` | `--pay-green` | `VxinPay` | `vxinPay` |
| 在线状态点 | `#44C464` | `--status-online` | — | `vxinOnline` |

说明:支付绿为货币语义固定色,明暗一致,不随品牌主色变化。错误色 web 正文用 `#F53F3F`,未读徽标用 `#FA5151`;原生端统一用 `#FA5151`。

### 功能入口图标底色(`--icon-bg-*`,Web)

散落的功能行/入口图标底色收敛为语义 token,ContactList 与 GlobalSearch 共用同一真相源:

| 语义 | 值 | Token |
|---|---|---|
| 钱包/金币 | `#F0A020` | `--icon-bg-wallet` |
| 邀请好友 | `#17B8A6` | `--icon-bg-invite` |
| 中性功能项(设置/隐私/黑名单…) | `#8A93A6` | `--icon-bg-neutral` |
| 文件传输助手(微信天蓝) | `#10AEFF` | `--icon-bg-filehelper` |
| 新的朋友(暖橙) | `#FA9D3B` | `--icon-bg-newfriend` |
| 群聊(青碧) | `#17B8A6` | `--icon-bg-group` |
| 好友标签(珊瑚橙) | `#FF6B35` | `--icon-bg-label` |

### 有意保留的字面量(不 token 化)

- `var(--token, #hex)` 形式的**回退值** — 本身已用 token,hex 仅兜底。
- 主题预览色块(Profile 日/夜模式示意)、标签调色板(ContactList `COLORS`,值会持久化到后端)、SVG 插画填充(空态/Logo)。
- 原因:这些是内容/用户数据/装饰字面量,token 化会引入语义错误或破坏功能。

## 二、圆角

三端建立单一真相源,命名/取值对齐:

| 语义 | 值 | Web | Android `VxinRadius` | iOS `VxinRadius` |
|---|---|---|---|---|
| 标签/角标(B端) | `4` | `--radius-tag` / `--radius-button-sm` | `tag` | `tag` |
| 小卡片/图片 | `6` | `--radius-sm` | `sm` | `sm` |
| 缩略图(移动端历史值) | `8` | — | `thumb` | `thumb` |
| 气泡/徽标/常规卡片 | `10` | `--radius-badge` | `badge` | `badge` |
| 输入框/按钮/中卡片 | `12` | `--radius-md` / `--radius-input` / `--radius-button` | `md` | `md` |
| 头像(圆润方形) | `14` | `--radius-avatar` | `avatar` | `avatar` |
| 内容大卡片 | `16` | `--radius-card` | `card` | `card` |
| 弹窗/大卡片 | `18` | `--radius-lg` | `lg` | `lg` |
| 大头像/超大卡片 | `20` | `--radius-avatar-lg` | `xl` | `xl` |
| 认证按钮胶囊(移动端历史值) | `25` | — | `pill` | `pill` |
| 胶囊/圆形 | `9999` / `50%` | `--radius-full` | `full`(50%) | — (用 `.clipShape(Circle())`) |

说明:`thumb(8)` / `pill(25)` 为移动端历史取值,暂保留以零视觉回归,后续如需对齐 Web(输入/按钮=12、胶囊=full)再单独走视觉验证。内联 `borderRadius: '50%'` 为圆形惯用法,与方形元素等价 `radius-full` 但语义不同,保留。

## 三、字号

三端建立单一真相源。通用字阶对齐 Web `--text-*`;展示字阶(品牌名/大数字/认证标题)跨端一致。

### 通用字阶

| 语义 | 值 | Web | Android `VxinTextSize` | iOS `VxinFontSize` |
|---|---|---|---|---|
| 角标/极小标注 | `10` | `--text-2xs` | `xs2` | `xs2` |
| 时间戳/系统消息 | `11` | `--text-xs` | `xs` | `xs` |
| 标签/说明文字 | `12` | `--text-sm` | `sm` | `sm` |
| 次要正文/资料项(高频) | `13` | `--text-sm2` | `sm2` | `sm2` |
| 正文/消息气泡 | `14` | `--text-base` | `base` | `base` |
| 名称/对话标题 | `15` | `--text-md` | `md` | `md` |
| 页面标题 | `16` | `--text-lg` | `lg` | `lg` |
| 模态标题 | `18` | `--text-xl` | `xl` | `xl` |
| 个人主页名字/大标题 | `20` | `--text-2xl` | `xxl` | `xxl` |
| 大标题 | `24` | `--text-3xl` | —(未用) | `xxxl` |

Web 另有半像素微调档(`--text-tiny 11.5` / `--text-note 12.5` / `--text-meta 13.5` / `--text-name 14.5` / `--text-h5 17`),贴合微信 PC 端精细排版,原生端不设。

### 展示字阶(品牌名/大数字/认证标题)

| 语义 | 值 | Web | Android `VxinTextSize` | iOS `VxinFontSize` |
|---|---|---|---|---|
| 通话对方名/资料大字 | `22` | `--text-display-sm` | `displaySm` | `displaySm` |
| 认证页标题(注册/忘记密码) | `26` | `--text-display` | `display` | `display`* |
| 登录品牌名 | `30` | `--text-display-lg`(`.auth-brand-name--brand`) | `displayLg` | `displayLg` |
| 钱包余额大数字 | `40` | `--text-display-xl` | `displayXl` | `displayXl` |

*iOS 认证页标题实际用 `.font(.title.bold())`(Dynamic Type 语义字体,优于固定值),`display` token 备用。

### 有意保留原值(不并入字阶)

- emoji / SF Symbol 图标 glyph(如 emoji 26/28、图标 30-56)属内容字形,非排版字号。
- 计算值/响应式:头像首字母(`size * 0.42`)、GroupCallModal 响应式三元。
- Web 邀请人数 `28`、字体预览动态 `size` 等无跨端对应的一次性展示号。

## 维护须知

- 改动任一端 token 值时,同步更新其余两端与本表,保持单一真相源一致。
- 新增硬编码前先查本表是否已有对应 token;确无对应且属通用语汇,先在三端 token 源新增再引用。
- 内容字面量(用户可选色、插画、emoji、图标 glyph)不 token 化。
