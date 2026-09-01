'use strict';
/**
 * 自建图形验证码：SVG 渲染 + Redis 存储，Redis 不可用时自动降级进程内 Map。
 * 不依赖 reCAPTCHA/hCaptcha 等第三方服务 —— 不需要 API key，也不受"国内网络访问
 * 第三方验证服务不稳定"影响（见 AUDIT.md 十节"登录限流/验证码"🟡）。
 *
 * 存储策略（与 tokenBlacklist 的降级思路一致，但走 redisCache 单例的 db5 通道，
 * 与 vxin(日服 3002, db1) 零冲突）：
 *   - Redis 可用（server.js 启动时 redisCache.connect() 成功）→ SETEX 存储，
 *     TTL 300s 自动过期，跨 pm2 重启 / 多实例共享；
 *   - Redis 不可用（连接失败/未初始化）→ 回退进程内 Map（单进程形态下等效），
 *     由惰性清理定时器兜底防无限增长。
 */
const crypto = require('crypto');

const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // 排除易混淆的 0/o/1/l/i
const CODE_LEN = 5;
const TTL_MS = 5 * 60 * 1000;
const WIDTH = 140;
const HEIGHT = 50;
const KEY_PREFIX = 'captcha:';

// ── 存储层 ─────────────────────────────────────────────────────
const memStore = new Map(); // captchaId -> { text, expiresAt }（Redis 不可用时的兜底）

// 每次调用实时读 redisCache 连接态（ioredis 事件维护 isConnected），
// 连接恢复后自动从内存模式切回 Redis，无需重启。
function getRedis() {
  try {
    const { redisCache } = require('../integrations/redisCache');
    if (redisCache && redisCache.isConnected && redisCache.client) return redisCache.client;
  } catch { /* redisCache 初始化失败 → 内存模式 */ }
  return null;
}

// 原子"取出即删"：一次性核销必须保证并发下同一 captchaId 只能被消费一次。
// 不用 GET+DEL 两步（非原子，竞态下可能被并发消费两次）。
// Redis 6.0 无 GETDEL 命令，用 Lua 脚本实现等价语义。
const GETDEL_LUA = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`;

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
async function generate() {
  const text = randomCode();
  const id = crypto.randomUUID();
  const redis = getRedis();
  if (redis) {
    // 存小写明文，SETEX 自带 300s TTL，过期自动删除
    await redis.setex(KEY_PREFIX + id, Math.floor(TTL_MS / 1000), text).catch(() => {});
  } else {
    memStore.set(id, { text, expiresAt: Date.now() + TTL_MS });
  }
  const svg = renderSvg(text);
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  return { captchaId: id, svgDataUrl };
}

/**
 * 校验验证码文本，不区分大小写。不管校验成功还是失败都立即核销（取出即删），
 * 防止同一张验证码图片被反复尝试暴力猜测——猜错一次就必须换一张新图。
 * Redis 模式下用 Lua GETDEL 保证原子核销；内存模式为 delete + 判空。
 */
async function verify(captchaId, text) {
  if (!captchaId || !text) return false;
  const want = String(text).trim().toLowerCase();
  const redis = getRedis();
  if (redis) {
    const stored = await redis.eval(GETDEL_LUA, 1, KEY_PREFIX + captchaId).catch(() => null);
    // Lua 返回 nil → null；key 不存在或已过期（TTL 清除）→ 失败
    return stored !== null && stored !== undefined && String(stored).toLowerCase() === want;
  }
  const entry = memStore.get(captchaId);
  memStore.delete(captchaId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  return entry.text.toLowerCase() === want;
}

// 惰性清理过期未核销的内存条目（用户取了图但从未提交，且 Redis 不可用时的兜底），
// 防 Map 无限增长；Redis 模式下靠 TTL，此定时器只清内存 Map，无副作用。
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of memStore) if (now > e.expiresAt) memStore.delete(id);
}, 60 * 1000).unref();

module.exports = {
  generate,
  verify,
  // 仅供测试用：读出某个 captchaId 对应的明文（正常业务代码/HTTP 路由都不会、也不应该调用它——
  // 验证码的价值就在于图片以外没有别的地方能拿到明文）。
  _peekTextForTests: async (id) => {
    const redis = getRedis();
    if (redis) return redis.get(KEY_PREFIX + id);
    return memStore.get(id)?.text || null;
  },
};
