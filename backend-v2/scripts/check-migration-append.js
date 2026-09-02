#!/usr/bin/env node
/**
 * migrations 数组「只允许尾部追加」CI 门禁（2026-09-02）
 *
 * 背景：schema_migrations 按数组下标(idx)记录已执行迁移。migrations 数组一旦
 * 中部插入/删除/重排/修改既有元素，存量库的 idx 语义即错位——新迁移的 idx 撞上
 * 已记录的旧 idx 会被启动跳过、永不执行（message_reads idx18 / ringtone idx102
 * 双雷即此机制，见 AUDIT.md）。故本门禁规则从严：
 *   1) 既有迁移（相对 base 版本）一个字都不能改
 *   2) 新迁移只能 append 到数组【末尾】
 *
 * 用法（CI）:
 *   node backend-v2/scripts/check-migration-append.js --base <git-sha>
 *     --base 取本次改动前的 sha（push: github.event.before；PR: base.sha）；
 *     比较当前工作区文件 vs `git show <base>:backend-v2/src/db/schema.js`
 * 用法（本地调试）:
 *   node scripts/check-migration-append.js --cur-file <a.js> --base-file <b.js>
 *
 * 退出码：0 = 合规（前 N 条与 base 一致 + 尾部追加）；1 = 违规（含原因与提示）。
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const baseSha = arg('--base');
const curFile = arg('--cur-file') || path.join(__dirname, '..', 'src', 'db', 'schema.js');
const baseFile = arg('--base-file');
const REL = 'backend-v2/src/db/schema.js';

// 用 vm 执行提取数组字面量（与 scripts/schema-audit.js 同法，实测可靠）。
function extract(src) {
  const start = src.indexOf('const migrations = [');
  if (start < 0) return [];                       // 数组不存在（首次引入）→ 视为空 base
  const end = src.indexOf('];', start);
  if (end < 0) throw new Error('无法定位 migrations 数组结束标记 "];"');
  const sandbox = {};
  vm.createContext(sandbox);
  return vm.runInContext(src.slice(start, end + 2) + '; migrations', sandbox);
}
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const brief = s => norm(s).slice(0, 90);

// ── 取 base 版本源码 ─────────────────────────────────────────────
let baseSrc;
if (baseFile) {
  baseSrc = fs.readFileSync(baseFile, 'utf8');
} else {
  const ref = baseSha || 'HEAD~1';
  try {
    baseSrc = execFileSync('git', ['show', `${ref}:${REL}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/exists on disk, but not in/i.test(msg)) baseSrc = '';   // base 无此文件 → 空 base
    else { console.error(`❌ 获取 base 版本失败 (git show ${ref}:${REL}):`, msg.slice(0, 300)); process.exit(1); }
  }
}

// ── 解析并前缀比对 ───────────────────────────────────────────────
let oldArr, curArr, curSrc;
try {
  oldArr = extract(baseSrc);
  curSrc = fs.readFileSync(curFile, 'utf8');
  curArr = extract(curSrc);
} catch (e) { console.error('❌ migrations 数组解析失败:', e.message); process.exit(1); }

const nOld = oldArr.length;
const nCur = curArr.length;
const problems = [];

if (nCur < nOld) problems.push(`迁移数量减少: ${nOld} → ${nCur}（禁止删除/合并既有迁移）`);
for (let k = 0; k < nOld; k++) {
  if (norm(curArr[k]) !== norm(oldArr[k])) {
    problems.push(`第 ${k} 条迁移与 base 不一致 —— 禁止中部插入/修改/重排（idx=${k} 在存量库可能已记录，改动不会生效）:`);
    problems.push(`  base [${k}]: ${brief(oldArr[k])}`);
    problems.push(`  当前 [${k}]: ${brief(curArr[k])}`);
    break;   // 前缀首个差异即违规点
  }
}

if (problems.length) {
  console.error('❌ migrations 数组违规 —— 只允许在数组【末尾】追加新迁移：');
  for (const p of problems) console.error('  ' + p);
  console.error('  请把新迁移 append 到 migrations 数组最后（新 idx 未被存量库记录，启动时才会真正执行）。');
  process.exit(1);
}
console.log(`✅ migrations 数组合规: 前 ${nOld} 条与 base 完全一致, 尾部追加 ${nCur - nOld} 条 (${nOld} → ${nCur})`);
