# v信 落地页（vxin-landing）

v信 营销落地页。**Next.js 14（App Router）+ TypeScript + Tailwind CSS**，静态导出（`output: 'export'`）→ 产出纯静态 `out/`，可托管到任意静态主机（Cloudflare Pages / Vercel / Nginx）。

## 开发

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 产出静态站点到 out/
```

## 页面结构（6 区块）

`app/page.tsx` 按序组装，组件在 `components/sections/`：

1. **Header** — 吸顶导航 + CTA
2. **Hero** — 主标题 / 副标题 / 下载按钮 + 手机界面占位（`PhoneMock`）
3. **ValueProps** — 4 个核心价值卡片
4. **Features** — 功能亮点（图文交替）
5. **Security** — 安全与信任（深色区，对应真实后端能力：日志脱敏 / requestId / 限流 / 拉黑举报）
6. **Download** — Web / Android / iOS 三端
7. **Footer** — 链接 + 版权 + 备案占位

## 改文案

所有文案集中在 **`lib/content.ts`**，改这一个文件即可，无需动组件。
结构按区块组织，未来加 i18n 时把对象包成 `{ zh, en }` 即可。

## 设计 token

视觉契约集中在 **`tailwind.config.ts`**：品牌色 `brand`（teal/emerald）、深色系 `ink`、字体栈（含中文 PingFang/YaHei/Noto fallback）、圆角、阴影、动效。

## 下载链接 / 素材

- 下载与体验入口在 `lib/content.ts` 的 `site.links`（webApp / android / ios / email），按需替换为真实地址。
- Android APK 放 `public/downloads/`（`.apk` 已 gitignore，生产单独托管或走 Git LFS）。
- 手机界面与功能配图当前为纯 CSS / emoji 占位，有真实 App 截图后替换 `PhoneMock` 与 `Features` 的视觉块即可。

## 部署

```bash
npm run build      # → out/
# 将 out/ 整目录上传到静态主机；trailingSlash 已开启，目录式路由对 Nginx/CF Pages 友好
```
