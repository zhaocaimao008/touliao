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
  conn.pragma('cache_size = -64000');   // 64 MB page cache（提升至 2x）
  conn.pragma('temp_store = MEMORY');
  conn.pragma('mmap_size = 536870912'); // 512 MB mmap（提升至 2x）
  conn.pragma('page_size = 8192');      // 8KB 页（适配现代 SSD，减少碎片）
  if (!readonly) {
    conn.pragma('journal_mode = WAL');
    conn.pragma('synchronous = NORMAL');
    conn.pragma('foreign_keys = ON');
    conn.pragma('wal_autocheckpoint = 2000'); // 每 2000 页检查点（减少检查点频率）
  }
  // 只读连接优化：线程安全 + 无锁查询
  if (readonly) {
    conn.pragma('query_only = ON');
    conn.pragma('locking_mode = NORMAL'); // 允许多读并发
  }
  // 额外性能优化
  conn.pragma('journal_size_limit = 67108864'); // 限制 WAL 日志到 64MB
  conn.pragma('cache_spill = OFF');             // 禁用缓存溢出（全内存缓存）
}

// ── 主写连接 ────────────────────────────────────────────────────
const db = new Database(config.dbPath);
tunePragmas(db);

applySchema(db);
applyFts(db);

// ── ID 生成器 ───────────────────────────────────────────────────
// 优化：先从 DB 计算当前已用数量，据此估算冲突概率。
// 空间使用率 < 80% 时纯随机（平均不到2次SELECT即命中）；
// ≥ 80% 时改为「从随机起点顺序扫描」，O(剩余空间)而非最坏 O(N)随机重试。
// 这避免了高密度下随机尝试退化为近全表扫描的问题。

function generateGroupNumber() {
  // 群号 7 位：[1000000, 9999999]，共 9000000 个
  const total = 9000000;
  const used = db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE group_number != '' AND group_number IS NOT NULL").get().n;
  if (used >= total) throw new Error('群号已分配完');
  if (used / total < 0.8) {
    // 随机模式：低密度下碰撞率极低，平均 1/(1-fill) 次即命中
    for (let i = 0; i < 2000; i++) {
      const value = String(Math.floor(1000000 + Math.random() * 9000000));
      if (!db.prepare('SELECT 1 FROM conversations WHERE group_number=?').get(value)) return value;
    }
  }
  // 顺序扫描模式：从随机起点找第一个空位
  const start = Math.floor(1000000 + Math.random() * 9000000);
  for (let i = 0; i < total; i++) {
    const value = String(1000000 + ((start - 1000000 + i) % total));
    if (!db.prepare('SELECT 1 FROM conversations WHERE group_number=?').get(value)) return value;
  }
  throw new Error('群号已分配完');
}

function generateVxinId() {
  // v信号 6 位：[100000, 999999]，共 900000 个
  const total = 900000;
  const used = db.prepare("SELECT COUNT(*) AS n FROM users WHERE wechat_id != '' AND wechat_id IS NOT NULL AND length(wechat_id)=6").get().n;
  if (used >= total) throw new Error('v信号已分配完');
  if (used / total < 0.8) {
    for (let i = 0; i < 2000; i++) {
      const value = String(Math.floor(100000 + Math.random() * 900000));
      if (!db.prepare('SELECT 1 FROM users WHERE wechat_id=?').get(value)) return value;
    }
  }
  const start = Math.floor(100000 + Math.random() * 900000);
  for (let i = 0; i < total; i++) {
    const value = String(100000 + ((start - 100000 + i) % total));
    if (!db.prepare('SELECT 1 FROM users WHERE wechat_id=?').get(value)) return value;
  }
  throw new Error('v信号已分配完');
}

// 生成一个未被占用的 6 位数字专属邀请码（用户级，避免与现有 invite_code 冲突）
function generateUserInviteCode() {
  const total = 900000;
  const used = db.prepare("SELECT COUNT(*) AS n FROM users WHERE invite_code IS NOT NULL AND invite_code != ''").get().n;
  if (used >= total) throw new Error('专属邀请码已分配完');
  if (used / total < 0.8) {
    for (let i = 0; i < 2000; i++) {
      const value = String(Math.floor(100000 + Math.random() * 900000));
      if (!db.prepare('SELECT 1 FROM users WHERE invite_code=?').get(value)) return value;
    }
  }
  const start = Math.floor(100000 + Math.random() * 900000);
  for (let i = 0; i < total; i++) {
    const value = String(100000 + ((start - 100000 + i) % total));
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
