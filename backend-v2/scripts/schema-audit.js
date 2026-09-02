#!/usr/bin/env node
/**
 * Schema Drift 核对脚本 —— 找出「迁移元数据已 applied、实际结构未生效」的漂移。
 *
 * 背景（2026-09-02 message_reads 事故）：schema_migrations 按数组下标记录已执行迁移，
 * 中部插入新迁移 → 新迁移 idx 撞上已记录的旧 idx → 启动跳过 → 建表/加列从未执行，
 * 线上查询 500。message_reads 是第二例（第一例 conversation_clears，见 schema.js:714）。
 *
 * 用法：cd backend-v2 && node scripts/schema-audit.js
 * 只读，不修改任何数据。
 */
'use strict';
const Database = require('better-sqlite3');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const config = require('../src/config');
const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.js');
const src = fs.readFileSync(schemaPath, 'utf8');

// ── 提取 migrations 数组 ────────────────────────────────────────
const start = src.indexOf('const migrations = [');
const end = src.indexOf('];', start);
if (start < 0 || end < 0) { console.error('无法定位 migrations 数组'); process.exit(1); }
const sandbox = {};
vm.createContext(sandbox);
const migrations = vm.runInContext(src.slice(start, end + 2) + '; migrations', sandbox);

const db = new Database(config.dbPath, { readonly: true });
const applied = new Set(db.prepare('SELECT idx FROM schema_migrations').all().map(r => r.idx));
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name));
const colCache = {};
function colsOf(t) {
  if (!colCache[t]) {
    try { colCache[t] = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)); }
    catch (e) { colCache[t] = null; }
  }
  return colCache[t];
}

// ── 解析单条迁移 SQL 的预期效果 ─────────────────────────────────
function expect(sql) {
  const one = s => s.replace(/["'`]/g, '');
  let m;
  if ((m = sql.match(/CREATE TABLE IF NOT EXISTS (\S+)/)))      return { type: 'table',  obj: one(m[1]) };
  if ((m = sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\S+)/))) return { type: 'index',  obj: one(m[1]) };
  if ((m = sql.match(/ALTER TABLE (\S+) ADD COLUMN (\S+)/)))    return { type: 'column', table: one(m[1]), obj: one(m[2]) };
  if ((m = sql.match(/ALTER TABLE (\S+) ADD (\S+) (\S+)/)))     return { type: 'column', table: one(m[1]), obj: one(m[2]) }; // 无 COLUMN 关键字变体
  return null;   // UPDATE/DELETE/INSERT 等数据语句或复杂 DDL —— 无法自动核对
}

console.log('═══ Schema Drift 核对 ═══════════════════════════════');
console.log(`migrations 数组总数: ${migrations.length}  |  schema_migrations 已记录: ${applied.size}`);
console.log('');

const drift = [];      // 已记录但实际缺失（雷）
const unrecorded = []; // 对象存在但迁移未记录（反向漂移，通常是历史中部插入的旧迁移被新代码 idx 跳过后的残留——无害但说明 idx 位移）
const unparsed = [];
let ok = 0;

migrations.forEach((sql, idx) => {
  const e = expect(sql);
  if (!e) { unparsed.push({ idx, sql: sql.replace(/\s+/g, ' ').slice(0, 100) }); return; }
  let present;
  if (e.type === 'table') present = tables.has(e.obj);
  else if (e.type === 'index') present = indexes.has(e.obj);
  else {
    const c = colsOf(e.table);
    present = c ? c.has(e.obj) : false;
  }
  const recorded = applied.has(idx);
  if (recorded && !present) drift.push({ idx, ...e, sql: sql.replace(/\s+/g, ' ').slice(0, 90) });
  else if (!recorded && present) unrecorded.push({ idx, ...e });
  else ok++;
});

console.log(`✅ 一致（记录且生效）: ${ok}`);
console.log('');
console.log(`🚨 【已记录但未生效 —— 漂移雷】: ${drift.length} 条`);
for (const d of drift) {
  console.log(`   idx=${d.idx}  ${d.type.padEnd(6)} ${d.obj}   ← ${d.sql}`);
}
console.log('');
console.log(`⚠️  【未记录但对象存在 —— 历史 idx 位移痕迹】: ${unrecorded.length} 条（无害，说明这些迁移曾以更早的 idx 执行过，新数组里位置变了）`);
for (const u of unrecorded.slice(0, 30)) {
  console.log(`   idx=${u.idx}  ${u.type.padEnd(6)} ${u.obj}`);
}
if (unrecorded.length > 30) console.log(`   … 还有 ${unrecorded.length - 30} 条`);
console.log('');
console.log(`❔ 【无法自动核对的语句】: ${unparsed.length} 条（数据修复类，需人工确认）`);
for (const u of unparsed) console.log(`   idx=${u.idx}  ${u.sql}`);

// ── 附加：schema.js 全文所有 CREATE TABLE 表名 vs 实际（基础区+migrations） ──
console.log('');
console.log('═══ 全表核对（schema.js 声明的所有表） ═══════════════');
const declaredTables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS ([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
const declaredSet = [...new Set(declaredTables)];
const missingTables = declaredSet.filter(t => !tables.has(t));
console.log(`schema.js 声明表: ${declaredSet.length}  | 缺失: ${missingTables.length}`);
for (const t of missingTables) console.log(`   ❌ 缺失表: ${t}`);
console.log('');
console.log('核对完成（只读，未修改任何数据）');
db.close();
