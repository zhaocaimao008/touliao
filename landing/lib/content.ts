/**
 * 全站文案与配置集中地。
 * 改文案只需动这里；结构按区块组织，未来加 i18n 时可把本对象包成
 * { zh: {...}, en: {...} } 而无需改动组件。
 */

// 站点基址：换服务器时只需设环境变量 NEXT_PUBLIC_SITE_URL=https://新域名
// （构建时注入），不填则默认 dipsin.com。下方所有下载/体验链接据此拼接，
// 与三端 App 的 vxin-config 一键切换机制对齐——换域名无需改本文件。
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://dipsin.com').replace(/\/$/, '');

export const site = {
  name: 'v信',
  tagline: '私有化部署的私密通讯',
  // 站点规范地址（用于 OG/canonical）。Web 应用部署在根路径，落地页挪到 /welcome。
  url: BASE,
  // 真实下载/体验入口（均由 BASE 拼接，随 NEXT_PUBLIC_SITE_URL 自动切换）
  links: {
    // 网页版 = 根路径的 Web 应用（同源 /api 反代，见 BUILD.md）
    webApp: `${BASE}/`,
    // 安卓/Windows 指向自托管下载（CDN 零依赖，出新版只需替换文件）
    android: `${BASE}/downloads/vxin-android-latest.apk`,
    windows: `${BASE}/downloads/vxin-windows-latest-setup.exe`,
    ios: '', // 留空 = 即将上线（暂无 TestFlight/App Store 链接）
    email: 'admin@vxin.app',
  },
} as const;

export const nav = {
  items: [
    { label: '核心价值', href: '#value' },
    { label: '功能', href: '#features' },
    { label: '安全', href: '#security' },
    { label: '下载', href: '#download' },
  ],
  cta: { label: '立即下载', href: '#download' },
} as const;

export const hero = {
  pill: '🔒 私有化部署 · 隐私优先',
  title: ['你的数据', '你做主'],
  subtitle:
    'v信 —— 私有化部署的私密通讯。聊天、朋友圈、收藏，三端实时同步，数据自主可控。',
  primary: { label: '立即下载', href: '#download' },
  secondary: { label: '网页版体验', href: site.links.webApp },
  trustBar: [
    { icon: '🔒', label: '全程加密传输' },
    { icon: '📱', label: '三端一致' },
    { icon: '🏠', label: '私有化部署' },
  ],
} as const;

export const valueProps = {
  heading: '为隐私而生的通讯方式',
  sub: '把安全做进底层，把体验做到顺手。',
  cards: [
    {
      icon: '🔐',
      title: '全程加密传输',
      desc: '消息经 HTTPS/TLS 全程加密传输，配合私有化部署，数据掌握在自己手里。',
    },
    {
      icon: '🔄',
      title: '三端一致',
      desc: 'Web、Android、iOS 实时同步，换设备也能无缝衔接。',
    },
    {
      icon: '🖼️',
      title: '朋友圈',
      desc: '分享生活、点赞评论，互动通知离线也不会丢。',
    },
    {
      icon: '⭐',
      title: '收藏',
      desc: '图文、文件一键收藏，按内容秒搜，随时回看。',
    },
  ],
} as const;

export const features = {
  heading: '强大，且恰到好处',
  sub: '日常要用的，一个不少；用不上的，绝不打扰。',
  items: [
    {
      tag: '聊天',
      title: '流畅到不像加密通讯',
      desc: '已读回执、消息撤回、引用回复、表情与红包——加密不以牺牲体验为代价。',
      bullets: ['已读 / 送达回执', '撤回与编辑', '引用回复', '红包与表情'],
    },
    {
      tag: '朋友圈',
      title: '干净的社交空间',
      desc: '可见性精细控制，点赞评论实时通知；拉黑与举报让你掌控自己的圈子。',
      bullets: ['公开 / 好友 / 私密', '互动通知（离线不丢）', '拉黑过滤', '一键举报'],
    },
    {
      tag: '收藏',
      title: '你的私人资料库',
      desc: '文本、图片、文件、视频统一收纳，关键词搜索秒达，去重不重复。',
      bullets: ['多类型统一管理', '关键词搜索', '自动去重', '跨端同步'],
    },
    {
      tag: '群组',
      title: '为协作而设计',
      desc: '群公告、@提醒、管理员权限、二维码进群，大群也井井有条。',
      bullets: ['群公告与 @提醒', '管理员体系', '二维码进群', '成员管理'],
    },
  ],
} as const;

export const security = {
  heading: '安全，不只是一句口号',
  sub: '这些能力已经落到我们的每一行后端代码里。',
  items: [
    {
      icon: '🔐',
      title: '全程加密传输',
      desc: '所有通信经 HTTPS/TLS 加密传输；支持私有化部署，数据掌握在你自己手里。',
    },
    {
      icon: '🧾',
      title: '日志脱敏',
      desc: '手机号、验证码、令牌等敏感字段永不以明文落入日志。',
    },
    {
      icon: '🧭',
      title: '全链路可追溯',
      desc: '每个请求带唯一 Request-Id，出问题能精确定位，而不靠猜。',
    },
    {
      icon: '🛡️',
      title: '主动防滥用',
      desc: '登录限流、拉黑与举报机制，从源头保护每一个用户。',
    },
  ],
} as const;

export const download = {
  heading: '现在就开始',
  sub: '选择你的平台，几秒钟即可体验。',
  platforms: [
    {
      key: 'web',
      icon: '🌐',
      name: '网页版',
      desc: '无需安装，打开即用',
      cta: '打开网页版',
      href: site.links.webApp,
      available: true,
    },
    {
      key: 'android',
      icon: '🤖',
      name: 'Android',
      desc: '直接下载安装包 APK',
      cta: '下载 APK',
      href: site.links.android,
      available: true,
    },
    {
      key: 'windows',
      icon: '🪟',
      name: 'Windows',
      desc: '桌面客户端安装包',
      cta: '下载 Windows 版',
      href: site.links.windows,
      available: true,
    },
    {
      key: 'ios',
      icon: '🍎',
      name: 'iOS',
      desc: 'App Store 即将上线',
      cta: '即将上线',
      href: site.links.ios,
      available: false,
    },
  ],
} as const;

export const footer = {
  brandLine: '隐私优先的通讯方式。',
  columns: [
    {
      title: '产品',
      links: [
        { label: '功能', href: '#features' },
        { label: '安全', href: '#security' },
        { label: '下载', href: '#download' },
        { label: '网页版', href: site.links.webApp },
      ],
    },
    {
      title: '关于',
      links: [
        { label: '隐私政策', href: '#' },
        { label: '用户协议', href: '#' },
        { label: '团队', href: '#' },
      ],
    },
    {
      title: '联系',
      links: [{ label: site.links.email, href: `mailto:${site.links.email}` }],
    },
  ],
  copyright: `© ${new Date().getFullYear()} ${site.name} · 隐私优先的通讯方式`,
  // 备案号：留空则页面不显示。拿到真实 ICP 备案号后填入，例如「京ICP备XXXXXXXX号-1」。
  // ⚠ 不要填占位/假号——ICP 备案号与具体域名绑定，虚假备案有合规风险。
  beian: '',
} as const;
