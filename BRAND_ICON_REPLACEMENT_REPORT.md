# 投聊品牌图标替换报告（BRAND_ICON_REPLACEMENT_REPORT）

SOURCE_ICON=/home/ubuntu/uploads/img_62c7d6db1d60.png

- 分支 / PR：`feat/brand-icon-v3` / 草稿 PR #66（**未合并、未发布、未推生产、未热更新**）
- 出图源：`assets/brand/touliao/master/touliao-master-clean.png`（clean master）；原始母版保留于 `master/touliao-icon-master.png`
- 生成脚本：`assets/brand/touliao/generate.py`（可重复执行；只做尺寸适配、格式转换、透明处理、安全区、单色、光学尺寸简化）
- 审计：`BRAND_ASSET_AUDIT.md`；备份：`BRAND_ASSET_BACKUP_MANIFEST.md`（47 个原文件，含 SHA256）

## 1. Clean master

| 项 | 结果 |
|---|---|
| 左下角孤立杂点 | 连同淡光晕共 487px（321–351 × 1185–1207）已透明化；另清除 154 个 alpha=1 的不可见底噪 |
| 主体像素 | 未改动（alpha>0 主体 698,794px、alpha>20 主体 669,898px，与原图一致；可见改动 1058px 全在杂点区） |
| 重新扫描 | alpha>0 与 alpha>20 均只剩 1 个连通块；四边/四角 alpha=0；原杂点区 alpha=0，无残影/黑边/紫边 |

**MASTER_ARTIFACT_DOT = REMOVED**

## 2. 光学尺寸（≤48px 不做机械缩小）

| 等效尺寸 | 处理 |
|---|---|
| 16、20 | 隐藏柱状图，保留 T + 气泡 + 上升箭头；对比 ×1.25、饱和 ×1.15 |
| 24、29 | 只保留最高一根柱子（极简柱状图），箭头与柱之间留负空间 |
| 32、40、48 | 完整柱状图 |
| 共同 | 去 alpha<60 的淡外发光；亮度>215 的高光压至 86%；缩小前轻微平滑、缩小后轻锐化 |
| ≥64 | clean master 直接缩小（预乘 alpha + LANCZOS） |

按主体**实际渲染尺寸**选级别，iOS 20/29/40、安卓 mdpi、通知图标、单色层等小尺寸资源自动使用光学版本。独立尺寸：`assets/brand/touliao/sizes/touliao-{16,20,24,29,32,40,48,64,128,256,512,1024}.png`。

## 3. 各平台结果

| 平台 | 资源 | 验证 |
|---|---|---|
| iOS | AppIcon 13 尺寸（20~1024）、LaunchLogo@1/2/3x、LaunchBackground #140A24 | 全部 RGB 无 alpha、尺寸精确、与 Contents.json 一一对应；1024 主体边距 212/218/213/217px，主体外无孤立像素；CI iOS 构建（含 xcode26）通过，Asset Catalog 编译无错 |
| Android | mipmap ×5 密度：ic_launcher / round / foreground / background / monochrome；drawable ×5 ic_notification；drawable-nodpi splash_logo；adaptive xml 加 monochrome；SplashScreen 背景 #140A24 | Circle / Squircle / Rounded Square 三种 mask 下主体均在 66dp 安全圆内；CI Android debug 构建通过 |
| Windows | icon.ico（7 尺寸）、icon.png 512、icon-1024.png | 实际解析 ICO 目录；从 CI 构建的安装包取出资源逐字节比对（见下） |
| Web/PWA | favicon.ico(16/32/48)、favicon-16/32、favicon.png、apple-touch-icon 180、icons/192、512、512-maskable、登录页 icon.png/webp；manifest maskable 独立；SW CACHE_NAME v2.0.22 | 逐像素核对：favicon 与光学版一致、四角透明；PWA/apple-touch 全不透明、主体居中（偏差 1px）；maskable 最远点 0.379w ≤ 0.40；vite build 通过 |
| 启动页 | iOS UILaunchScreen（LaunchBackground + LaunchLogo）、Android 12 SplashScreen、预览 splash-phone-390x844 | 深紫黑背景、新图标居中、少量金色光晕；素材四边 alpha=0（无方形亮框） |

WINDOWS_ICO_EMBEDDED_SIZES = [16, 24, 32, 48, 64, 128, 256]

- 每帧均为独立导出的 32bpp PNG（16~48 为光学版，与 256 缩小结果不同），不是单张 256 封装
- CI Windows 构建（deploy=false，run 36433477183，发布步骤 skipped）产物 `touliao-8.1.39-setup.exe`：
  - 安装程序 `.rsrc/ICON` 7 帧 = 新 icon.ico 7 帧（逐字节一致），无旧帧
  - 主程序 `touliao.exe` `.rsrc/ICON` 7 帧 = 新 icon.ico，无旧帧 → exe、桌面快捷方式、任务栏图标
  - app.asar 内 `assets/icon.png` 与仓库一致 → 窗口图标、托盘图标

## 4. 文件清单

- **修改 45 个**：iOS AppIcon 13 PNG、`ios/project.yml`；Android mipmap 15 PNG、adaptive xml 2、themes.xml 2；Windows icon.ico/icon.png/icon-1024.png；Web favicon.png、icon.png、icon.webp、icon-512.png、icons/icon-192/512.png、manifest.json、index.html、sw.js
- **新增 154 个**：Android monochrome/background/notification/splash 16 个；iOS LaunchLogo/LaunchBackground 5 个；Web favicon.ico、16/32、apple-touch-icon、maskable 5 个；品牌资源包 `assets/brand/touliao/`（master、sizes、ios、android、windows、web、splash、monochrome、preview、generate.py）；备份 `backup/brand-assets-before-new-icon/` 47 个；审计/备份/本报告
- **删除 0 个**（Android 旧矢量通知图标 `drawable/ic_notification.xml` 保留作兜底，各密度 PNG 优先）
- 品牌资源包包含：标准紫金版、透明背景 PNG、深色背景版、浅色背景版、单色白版、单色黑版；**SVG 按决定不生成**

## 5. 业务代码

未修改任何 `.kt` / `.swift` / `.jsx` / 后端代码、接口、数据库、Bundle ID、applicationId、签名、证书、推送配置、热更新逻辑。`web/public/sw.js` 仅改 `CACHE_NAME` 常量（品牌资源缓存版本），缓存策略未动。

## 6. 旧品牌残留（只报告，未修改）

- 新盛讯 0、toulliao 0
- 「V信」26 个文件：运维脚本、Grafana 面板标题、压测脚本、代码注释——不在用户界面
- 「vxin」约 290 个文件：代码标识符/设计令牌、登录 Cookie 名 `vxin_token`（协议）、localStorage 迁移键——属协议与兼容，禁止修改
- 旧图标图片：已全部替换；`design-assets/` 内旧方案（紫色气泡版、蓝底「投聊」稿）作为历史资料保留，不参与任何构建

## 7. 未处理项与风险

1. **安卓/iOS 登录页 Logo**：为代码绘制的品牌徽章（品牌色方块 + 通用聊天图标），替换需改界面代码，本次未改；Web 登录页已随 icon.png 换新，三端暂不一致
2. **Web 首屏 loading**：原本不存在，未新增
3. **Windows 启动页**：Electron 无 splash，N/A
4. **16px**：已做光学简化，可辨认「紫色气泡中的金色 T」与右上箭头，但 16×16 细节有限，请以预览图人工确认
5. **iOS 启动页**：原注释称此前「按要求移除品牌图」，本次按新要求恢复为品牌启动页
6. 实机效果（安卓各品牌启动器 mask、iOS 主屏、Windows 任务栏 DPI 缩放、PWA 安装后图标）需真机/实机确认

## 8. 预览

- `assets/brand/touliao/preview/ICON_OPTICAL_SIZE_PREVIEW.png`（16~512，浅/深背景，小尺寸最近邻放大）
- `assets/brand/touliao/preview/ANDROID_MASK_PREVIEW.png`（Circle / Squircle / Rounded Square + 66dp 安全圆）
- `assets/brand/touliao/preview/ios-squircle-512.png`、`splash-phone-390x844.png`、`small-sizes-light-dark-x4.png`

## 9. 结论

MASTER_ARTIFACT_DOT = REMOVED
ICON_16PX = PASS
ICON_24PX = PASS
ICON_32PX = PASS
WINDOWS_ICO = PASS
ANDROID_MASK = PASS
IOS_APPICON = PASS
WEB_FAVICON = PASS
SPLASH_BRANDING = PASS
OLD_BRAND_RESIDUE = FOUND（仅运维文案/注释/协议标识，均属只报告范围，用户界面无残留）
BUSINESS_CODE_CHANGED = NO
READY_FOR_VISUAL_REVIEW = YES
