'use strict';
const express = require('express');
const router = express.Router();

const VERSION = '2.0.0';

// 平台 SVG 图标（24x24，currentColor）
const ICONS = {
  windows: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.48l7.2-.98v6.96H3V5.48zm0 13.04l7.2.98v-6.86H3v5.88zm8.04 1.09L21 21V12.6h-9.96v6.0zM11.04 3L21 3.6V11.4h-9.96V3z"/></svg>',
  android: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 9.48l1.84-3.18a.39.39 0 00-.14-.53.39.39 0 00-.53.14l-1.86 3.22a11.46 11.46 0 00-9.82 0L5.23 5.91a.39.39 0 00-.53-.14.39.39 0 00-.14.53L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.23 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.28-1.27 3.13-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13zM14.6 4.74c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44z"/></svg>',
};

const FEATURES = [
  { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>', title: '全程加密传输', desc: '消息经 HTTPS/TLS 全程加密传输，配合私有化部署，数据自主可控' },
  { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>', title: '多端同步', desc: '手机、电脑、网页实时同步，无缝切换' },
  { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', title: '极速送达', desc: '毫秒级消息推送，稳定可靠不掉线' },
];

const DOWNLOADS = [
  {
    platform: 'windows', icon: ICONS.windows,
    name: 'Windows 安装版',
    desc: 'Windows 7 / 10 / 11 · 64 位 · 含安装向导',
    file: 'vxin-windows-latest-setup.exe', size: '74 MB', tag: '推荐',
  },
  {
    platform: 'android', icon: ICONS.android,
    name: 'Android',
    desc: 'Android 5.0 及以上 · 需允许安装未知来源',
    file: 'vxin-android-latest.apk', size: '12 MB',
  },
  {
    platform: 'ios', icon: ICONS.apple,
    name: 'iOS',
    desc: 'App Store 审核中，敬请期待',
    file: null, size: '',
  },
];

router.get('/', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const cards = DOWNLOADS.map((d, i) => {
    const url = d.file ? `${base}/downloads/${d.file}` : null;
    return `
    <div class="card${url ? '' : ' disabled'}" data-platform="${d.platform}" style="animation-delay:${i * 60}ms">
      <div class="card-icon">${d.icon}</div>
      <div class="card-info">
        <div class="card-name">${d.name}${d.tag ? `<span class="card-tag">${d.tag}</span>` : ''}</div>
        <div class="card-desc">${d.desc}</div>
      </div>
      <div class="card-meta">${d.size ? `<span class="card-size">${d.size}</span>` : ''}
      ${url
        ? `<a class="btn" href="${url}" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>下载</a>`
        : `<span class="btn-disabled">敬请期待</span>`}
      </div>
    </div>`;
  }).join('');

  const features = FEATURES.map(f => `
    <div class="feature">
      <div class="feature-icon">${f.icon}</div>
      <div class="feature-title">${f.title}</div>
      <div class="feature-desc">${f.desc}</div>
    </div>`).join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>v信 · 下载中心</title>
<meta name="description" content="v信 客户端下载 — 安全、私密、多端同步的企业级即时通讯"/>
<style>
:root{
  --green:#07C160; --green-light:#09D96C; --green-dark:#06AD56;
  --bg:#0D1117; --bg2:#161D2E; --card:rgba(255,255,255,.04);
  --border:rgba(255,255,255,.09); --text:#EAEEF5; --text2:rgba(234,238,245,.55);
  --text3:rgba(234,238,245,.32);
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  background:var(--bg);color:var(--text);min-height:100vh;
  display:flex;flex-direction:column;align-items:center;padding:0 20px 60px;
  position:relative;overflow-x:hidden;
}
.bg-glow{position:fixed;border-radius:50%;pointer-events:none;filter:blur(40px);z-index:0}
.bg-glow.g1{width:600px;height:600px;background:radial-gradient(circle,rgba(7,193,96,.18),transparent 65%);top:-260px;right:-160px}
.bg-glow.g2{width:520px;height:520px;background:radial-gradient(circle,rgba(40,110,230,.13),transparent 65%);top:120px;left:-200px}
.wrap{position:relative;z-index:1;width:100%;max-width:600px;display:flex;flex-direction:column;align-items:center}

/* Header */
.header{text-align:center;padding:72px 0 44px}
.logo{
  width:84px;height:84px;border-radius:24px;
  background:linear-gradient(135deg,var(--green),var(--green-dark));
  display:inline-flex;align-items:center;justify-content:center;margin-bottom:22px;
  box-shadow:0 12px 40px rgba(7,193,96,.45),inset 0 1px 0 rgba(255,255,255,.25);
  animation:pop .5s cubic-bezier(.2,.9,.3,1.4) both;
}
.logo svg{width:44px;height:44px}
h1{font-size:34px;font-weight:800;letter-spacing:-.5px;margin-bottom:10px}
.tagline{font-size:15px;color:var(--text2);letter-spacing:.3px}
.version-pill{
  display:inline-flex;align-items:center;gap:6px;margin-top:18px;padding:5px 14px;
  background:rgba(7,193,96,.12);border:1px solid rgba(7,193,96,.28);border-radius:100px;
  font-size:12.5px;color:var(--green-light);font-weight:600;
}
.version-pill .dot{width:6px;height:6px;border-radius:50%;background:var(--green-light);box-shadow:0 0 8px var(--green-light)}

/* Section label */
.sec-label{align-self:flex-start;font-size:12px;font-weight:600;letter-spacing:1px;color:var(--text3);text-transform:uppercase;margin:10px 0 14px 4px}

/* Cards */
.cards{display:flex;flex-direction:column;gap:12px;width:100%}
.card{
  background:var(--card);border:1px solid var(--border);border-radius:16px;
  padding:18px 20px;display:flex;align-items:center;gap:16px;
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  transition:transform .18s,border-color .18s,background .18s;
  animation:rise .5s cubic-bezier(.2,.8,.3,1) both;
}
.card:hover{transform:translateY(-2px);border-color:rgba(7,193,96,.4);background:rgba(7,193,96,.05)}
.card.disabled{opacity:.5}
.card.disabled:hover{transform:none;border-color:var(--border);background:var(--card)}
.card.recommended{border-color:rgba(7,193,96,.5);background:rgba(7,193,96,.07);box-shadow:0 0 0 1px rgba(7,193,96,.2),0 8px 30px rgba(7,193,96,.12)}
.card-icon{
  width:50px;height:50px;border-radius:13px;flex-shrink:0;
  background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;color:var(--text);
}
.card-icon svg{width:27px;height:27px}
.card-info{flex:1;min-width:0}
.card-name{font-size:15.5px;font-weight:650;display:flex;align-items:center;gap:8px}
.card-tag{font-size:10.5px;font-weight:700;color:#fff;background:var(--green);padding:2px 8px;border-radius:6px;letter-spacing:.5px}
.card-desc{font-size:12.5px;color:var(--text2);margin-top:4px;line-height:1.4}
.card-meta{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0}
.card-size{font-size:11.5px;color:var(--text3);font-variant-numeric:tabular-nums}
.btn{
  display:inline-flex;align-items:center;gap:6px;padding:9px 18px;
  background:linear-gradient(135deg,var(--green),var(--green-dark));color:#fff;
  border-radius:10px;text-decoration:none;font-size:13.5px;font-weight:650;white-space:nowrap;
  box-shadow:0 4px 16px rgba(7,193,96,.35);transition:transform .15s,box-shadow .15s;
}
.btn svg{width:15px;height:15px}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 22px rgba(7,193,96,.5);background:linear-gradient(135deg,var(--green-light),var(--green))}
.btn:active{transform:translateY(0)}
.btn-disabled{padding:9px 16px;background:rgba(255,255,255,.06);color:var(--text3);border-radius:10px;font-size:12.5px;white-space:nowrap;border:1px solid var(--border)}

/* Features */
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%;margin-top:34px}
.feature{
  background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px 16px;text-align:center;
}
.feature-icon{width:40px;height:40px;margin:0 auto 12px;border-radius:11px;background:rgba(7,193,96,.12);
  display:flex;align-items:center;justify-content:center;color:var(--green-light)}
.feature-icon svg{width:21px;height:21px}
.feature-title{font-size:14px;font-weight:650;margin-bottom:5px}
.feature-desc{font-size:11.5px;color:var(--text2);line-height:1.5}

/* Footer */
.footer{margin-top:48px;text-align:center;font-size:12.5px;color:var(--text3);line-height:2}
.footer a{color:var(--green-light);text-decoration:none;font-weight:600}
.footer a:hover{text-decoration:underline}
.footer .web-cta{
  display:inline-flex;align-items:center;gap:7px;padding:11px 26px;margin-bottom:20px;
  background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:12px;
  color:var(--text);font-size:14px;font-weight:600;transition:.15s;
}
.footer .web-cta:hover{background:rgba(255,255,255,.09);border-color:rgba(7,193,96,.4);text-decoration:none}
.footer .web-cta svg{width:17px;height:17px;color:var(--green-light)}

@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

@media(max-width:560px){
  .header{padding:52px 0 36px}
  h1{font-size:28px}
  .features{grid-template-columns:1fr;gap:10px}
  .feature{display:flex;align-items:center;gap:14px;text-align:left;padding:16px}
  .feature-icon{margin:0;flex-shrink:0}
  .card{padding:16px}
  .card-meta{flex-direction:row;align-items:center}
}
</style>
</head>
<body>
<div class="bg-glow g1"></div>
<div class="bg-glow g2"></div>
<div class="wrap">
  <div class="header">
    <div class="logo">
      <svg viewBox="0 0 40 40" fill="none">
        <path d="M5 7a3 3 0 013-3h16a3 3 0 013 3v12a3 3 0 01-3 3H14l-5 5V7z" fill="rgba(255,255,255,.32)"/>
        <path d="M17 15a3 3 0 013-3h11a3 3 0 013 3v10a3 3 0 01-3 3h-3v4l-5-4h-3a3 3 0 01-3-3V15z" fill="#fff"/>
      </svg>
    </div>
    <h1>v信</h1>
    <p class="tagline">安全 · 私密 · 多端同步的即时通讯</p>
    <div class="version-pill"><span class="dot"></span>最新版本 v${VERSION}</div>
  </div>

  <div class="sec-label">选择你的设备</div>
  <div class="cards">${cards}</div>

  <div class="features">${features}</div>

  <div class="footer">
    <a class="web-cta" href="/">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/></svg>
      无需下载，网页版直接使用
    </a>
    <div>© ${new Date().getFullYear()} v信 · All rights reserved</div>
  </div>
</div>

<script>
// 自动识别当前系统，高亮推荐对应客户端
(function(){
  var ua = navigator.userAgent;
  var p = /Android/i.test(ua) ? 'android'
        : /iPhone|iPad|iPod/i.test(ua) ? 'ios'
        : /Win/i.test(ua) ? 'windows'
        : /Mac/i.test(ua) ? 'ios' : '';
  if(!p) return;
  var cards = document.querySelectorAll('.card[data-platform="'+p+'"]');
  if(cards.length){
    cards[0].classList.add('recommended');
    cards[0].scrollIntoView({block:'nearest'});
  }
})();
</script>
</body>
</html>`);
});

module.exports = router;
