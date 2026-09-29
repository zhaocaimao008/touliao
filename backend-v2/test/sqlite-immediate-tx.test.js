'use strict';
// 主线程与 dbWorker 线程各持一个 SQLite 连接。deferred 事务先读后写时，若 worker 恰好在
// 两步之间提交，读→写升级直接抛 "database is locked"（SQLITE_BUSY_SNAPSHOT，busy_timeout
// 不生效）——CI 曾在「用户解散群」上真实复现为 500。业务代码的事务必须 .immediate()
// （或 .exclusive()）开局即拿写锁，拿不到按 busy_timeout 排队。
const fs = require('fs');
const path = require('path');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
}

// 找到 db.transaction( 对应的右括号，返回其后紧跟的文本
function transactionTails(src) {
  const tails = [];
  const re = /\bdb\.transaction\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1, quote = null;
    while (depth && i < src.length) {
      const c = src[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; }
      else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const line = src.slice(0, m.index).split('\n').length;
    const named = /(?:const|let)\s+(\w+)\s*=\s*$/.exec(src.slice(src.lastIndexOf('\n', m.index), m.index));
    tails.push({ line, tail: src.slice(i, i + 12), name: named && named[1] });
  }
  return tails;
}

test('业务代码的 SQLite 写事务都以 immediate/exclusive 开局', () => {
  const root = path.join(__dirname, '../src');
  const offenders = [];
  for (const file of files(root)) {
    if (file.includes(`${path.sep}db${path.sep}`)) continue; // 建表/迁移在启动期单线程执行
    const src = fs.readFileSync(file, 'utf8');
    for (const { line, tail, name } of transactionTails(src)) {
      if (/^\.(immediate|exclusive)\(/.test(tail)) continue;
      const where = `${path.relative(root, file)}:${line}`;
      if (tail.startsWith('(')) { offenders.push(`${where} 直接以 deferred 调用`); continue; }
      // 具名事务 const fn = db.transaction(...)：调用处必须写 fn.immediate(...)
      if (name && new RegExp(`(^|[^.\\w])${name}\\(`, 'm').test(src)) offenders.push(`${where} ${name}() 以 deferred 调用`);
    }
  }
  expect(offenders).toEqual([]);
});
