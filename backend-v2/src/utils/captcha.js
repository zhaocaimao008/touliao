'use strict';
/**
 * 自建图形验证码：SVG 渲染 + 进程内 Map 存储，一次性核销。
 * 不依赖 reCAPTCHA/hCaptcha 等第三方服务 —— 不需要 API key，也不受"国内网络访问
 * 第三方验证服务不稳定"影响（见 AUDIT.md 十节"登录限流/验证码"🟡）。
 * 单进程 pm2 部署（当前生产形态）下内存存储足够；若未来横向扩多实例，
 * 需要把 store 换成 Redis（用法与 utils/tokenBlacklist.js 的降级模式一致）。
 */
const crypto = require('crypto');

const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // 排除易混淆的 0/o/1/l/i
const CODE_LEN = 5;
const TTL_MS = 5 * 60 * 1000;
const WIDTH = 140;
const HEIGHT = 50;

const store = new Map(); // captchaId -> { text, expiresAt }

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CHARS[crypto.randomInt(CHARS.length)];
  return s;
}

function renderSvg(text) {
  const charWidth = WIDTH / text.length;
  let glyphs = '';
  for (let i = 0; i < text.length; i++) {
    const x = Math.round(charWidth * i + charWidth / 2 + (crypto.randomInt(7) - 3));
    const y = Math.round(HEIGHT / 2 + (crypto.randomInt(11) - 5));
    const rotate = crypto.randomInt(41) - 20; // -20..20 度，防止规整字形被 OCR 轻易识别
    const fontSize = 26 + crypto.randomInt(6);
    const hue = crypto.randomInt(360);
    glyphs += `<text x="${x}" y="${y}" font-size="${fontSize}" fill="hsl(${hue},60%,35%)" ` +
      `text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotate} ${x} ${y})" ` +
      `font-family="monospace" font-weight="bold">${text[i]}</text>`;
  }
  let noise = '';
  for (let i = 0; i < 6; i++) {
    noise += `<line x1="${crypto.randomInt(WIDTH)}" y1="${crypto.randomInt(HEIGHT)}" ` +
      `x2="${crypto.randomInt(WIDTH)}" y2="${crypto.randomInt(HEIGHT)}" ` +
      `stroke="hsl(${crypto.randomInt(360)},50%,70%)" stroke-width="1"/>`;
  }
  for (let i = 0; i < 30; i++) {
    noise += `<circle cx="${crypto.randomInt(WIDTH)}" cy="${crypto.randomInt(HEIGHT)}" r="1" ` +
      `fill="hsl(${crypto.randomInt(360)},50%,60%)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="#f4f4f6"/>${noise}${glyphs}</svg>`;
}

/** 生成一个新验证码，返回 { captchaId, svgDataUrl }（data URL，四端都能直接当图片 src 用）。 */
function generate() {
  const text = randomCode();
  const id = crypto.randomUUID();
  store.set(id, { text, expiresAt: Date.now() + TTL_MS });
  const svg = renderSvg(text);
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  return { captchaId: id, svgDataUrl };
}

/**
 * 校验验证码文本，不区分大小写。不管校验成功还是失败都立即核销（从 store 删除），
 * 防止同一张验证码图片被反复尝试暴力猜测——猜错一次就必须换一张新图。
 */
function verify(captchaId, text) {
  if (!captchaId || !text) return false;
  const entry = store.get(captchaId);
  store.delete(captchaId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  return entry.text.toLowerCase() === String(text).trim().toLowerCase();
}

// 惰性清理过期未核销的条目（用户取了图但从未提交），防 Map 无限增长
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of store) if (now > e.expiresAt) store.delete(id);
}, 60 * 1000).unref();

module.exports = {
  generate,
  verify,
  // 仅供测试用：读出某个 captchaId 对应的明文（正常业务代码/HTTP 路由都不会、也不应该调用它——
  // 验证码的价值就在于图片以外没有别的地方能拿到明文）。
  _peekTextForTests: (id) => store.get(id)?.text,
};
