'use strict';
/**
 * 数据库连接（读写分离）
 *   db     —— 主写连接，主线程低频写 + 全部读
 *   readDb —— 只读连接，WAL 下与写连接完全并发，供 socket / 高频 SELECT 使用
 *
 * 高频消息写入走 worker thread（见 db/writer.js），主线程永不等写锁。
 */
const Database = require('better-sqlite3');
const config = require('../config');
const { applySchema, applyFts } = require('./schema');

function tunePragmas(conn, { readonly = false } = {}) {
  conn.pragma('busy_timeout = 5000');   // 并发锁等待 5s，避免高并发下立即 SQLITE_BUSY
  conn.pragma('cache_size = -32000');   // 32 MB page cache
  conn.pragma('temp_store = MEMORY');
  conn.pragma('mmap_size = 268435456'); // 256 MB mmap
  if (!readonly) {
    conn.pragma('journal_mode = WAL');
    conn.pragma('synchronous = NORMAL');
    conn.pragma('foreign_keys = ON');
  }
}

// ── 主写连接 ────────────────────────────────────────────────────
const db = new Database(config.dbPath);
tunePragmas(db);

applySchema(db);
applyFts(db);

// ── ID 生成器 ───────────────────────────────────────────────────
function generateGroupNumber() {
  for (let i = 0; i < 1000; i += 1) {
    const value = String(Math.floor(1000000 + Math.random() * 9000000));
    if (!db.prepare('SELECT 1 FROM conversations WHERE group_number=?').get(value)) return value;
  }
  throw new Error('群号已分配完');
}

function generateVxinId() {
  for (let i = 0; i < 1000; i += 1) {
    const value = String(Math.floor(100000 + Math.random() * 900000));
    if (!db.prepare('SELECT 1 FROM users WHERE wechat_id=?').get(value)) return value;
  }
  for (let n = 100000; n <= 999999; n += 1) {
    const value = String(n);
    if (!db.prepare('SELECT 1 FROM users WHERE wechat_id=?').get(value)) return value;
  }
  throw new Error('v信号已分配完');
}

// 生成一个未被占用的 6 位数字专属邀请码（用户级，避免与现有 invite_code 冲突）
function generateUserInviteCode() {
  for (let i = 0; i < 2000; i += 1) {
    const value = String(Math.floor(100000 + Math.random() * 900000));
    if (!db.prepare('SELECT 1 FROM users WHERE invite_code=?').get(value)) return value;
  }
  for (let n = 100000; n <= 999999; n += 1) {
    const value = String(n);
    if (!db.prepare('SELECT 1 FROM users WHERE invite_code=?').get(value)) return value;
  }
  throw new Error('专属邀请码已分配完');
}

// 为所有尚无专属邀请码的用户补发（幂等，仅回填缺失者）
function ensureInviteCodes() {
  const users = db.prepare("SELECT id FROM users WHERE invite_code IS NULL OR invite_code=''").all();
  if (!users.length) return;
  const update = db.prepare('UPDATE users SET invite_code=? WHERE id=?');
  db.transaction(() => {
    for (const u of users) update.run(generateUserInviteCode(), u.id);
  })();
}

// 确保所有用户都有 6 位纯数字 v信号（幂等：仅修补不合规者）
function ensureNumericVxinIds() {
  const users = db.prepare(`
    SELECT id FROM users
    WHERE wechat_id IS NULL OR wechat_id = ''
       OR length(wechat_id) != 6 OR wechat_id GLOB '*[^0-9]*'
  `).all();
  const update = db.prepare('UPDATE users SET wechat_id=? WHERE id=?');
  db.transaction(() => {
    for (const user of users) update.run(generateVxinId(), user.id);
    const dups = db.prepare(`
      SELECT wechat_id FROM users
      WHERE wechat_id IS NOT NULL AND wechat_id != ''
      GROUP BY wechat_id HAVING COUNT(*) > 1
    `).all();
    for (const { wechat_id } of dups) {
      const rows = db.prepare('SELECT id FROM users WHERE wechat_id=? ORDER BY created_at, id').all(wechat_id);
      for (const row of rows.slice(1)) update.run(generateVxinId(), row.id);
    }
  })();
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_id_unique ON users(wechat_id)').run();
}
ensureNumericVxinIds();
ensureInviteCodes();

// 启动时重置在线状态：进程刚起时没有任何活跃 socket，残留的 online 是脏数据。
// 客户端重连后 socket connection handler 会重新置 online，自愈。
db.prepare("UPDATE users SET status='offline' WHERE status='online'").run();

// ── 只读连接 ────────────────────────────────────────────────────
const readDb = new Database(config.dbPath, { readonly: true });
tunePragmas(readDb, { readonly: true });

module.exports = { db, readDb, generateGroupNumber, generateVxinId, generateUserInviteCode };
