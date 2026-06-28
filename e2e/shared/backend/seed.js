/**
 * 造测试账号 —— 走后端 HTTP /api/auth/register。
 * 测试后端以 DISABLE_RATE_LIMIT=1 启动(见 fixture.js),故不受注册限流;
 * 走 HTTP 而非直开 sqlite,避免与运行中的后端争 DB 写锁(better-sqlite3)。
 */
'use strict';
const http = require('http');
const env = require('../env');

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      env.BACKEND_URL + pathname,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          let json; try { json = JSON.parse(buf); } catch { json = null; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`${pathname} → ${res.statusCode}: ${buf.slice(0, 200)}`));
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * 批量造号。specs: [{username, phone, password?}]
 * 返回 [{username, phone, password, token, id}]
 */
async function seedUsers(specs) {
  const out = [];
  for (const s of specs) {
    const password = s.password || env.TEST_PASSWORD;
    const res = await post('/api/auth/register', {
      username: s.username, phone: s.phone, password, inviteCode: env.INVITE_CODE,
    });
    out.push({ username: res.user.username, phone: s.phone, password, token: res.token, id: res.user.id });
  }
  return out;
}

/** 生成不撞库的唯一 11 位手机号 */
let _seq = 0;
function uniquePhone() {
  _seq += 1;
  const base = String(process.pid % 100000).padStart(5, '0');
  return `1${base}${String(_seq).padStart(5, '0')}`.slice(0, 11);
}

module.exports = { seedUsers, uniquePhone, post };
