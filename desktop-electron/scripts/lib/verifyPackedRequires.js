'use strict';
const path = require('path');
const asar = require('@electron/asar');

// 只关心 CommonJS 的相对路径 require('./x') / require('../x')——
// 这类才可能因为 build.files 打包范围配置遗漏而在产物里缺失。
// 裸模块名（require('electron')、require('fs')）由 Node 内置模块或
// node_modules 解析，不是这道检查要覆盖的问题（8.1.0 那次事故的根因，
// 是"源码里存在、但打包范围没覆盖"的相对路径依赖）。
const RELATIVE_REQUIRE_RE = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;

// 把 asar listPackage() 返回的路径（带前导 '/'）归一化成本文件里统一使用的
// "不带前导斜杠"形式，跟 extractFile 的调用约定保持一致。
function normalize(p) {
  return p.replace(/^\/+/, '');
}

// 简化版 Node 模块解析：精确路径 → 补 .js → 补 /index.js。
// 足以覆盖这个仓库里实际出现的写法（都是显式相对路径 require 到具体文件）。
function resolveInAsar(fromFile, requirePath, packedSet) {
  const fromDir = path.posix.dirname(normalize(fromFile));
  const target = normalize(path.posix.normalize(path.posix.join(fromDir, requirePath)));

  const candidates = [target, `${target}.js`, path.posix.join(target, 'index.js')];
  for (const c of candidates) {
    if (packedSet.has(c)) return c;
  }
  return null;
}

/**
 * 递归校验：从 entryFile（相对 asar 根，如 'src/main.js'）出发，沿着本地相对
 * require() 依赖链，确认每一个都真的能在打包产物里找到对应文件。
 *
 * 返回缺失列表（可能为空数组）；不在内部 throw，由调用方（afterPack.js）
 * 决定失败时的错误信息格式，保持这个模块本身单一职责、易单测。
 *
 * @param {string} asarPath 打包产物 app.asar 的绝对路径
 * @param {string} entryFile 起点文件，相对 asar 根，如 'src/main.js'
 * @returns {Array<{ file: string, require: string }>}
 */
function verifyPackedRequires(asarPath, entryFile) {
  const packedList = asar.listPackage(asarPath).map(normalize);
  const packedSet = new Set(packedList);

  const entry = normalize(entryFile);
  if (!packedSet.has(entry)) {
    return [{ file: '(entry)', require: entry }];
  }

  const missing = [];
  const visited = new Set();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);

    let content;
    try {
      content = asar.extractFile(asarPath, file).toString('utf8');
    } catch (e) {
      // 文件明明在 listPackage() 里出现却解不出来，说明 asar 本身有问题，
      // 而不是"依赖缺失"这类问题——如实记录，交给上层统一报错。
      missing.push({ file, require: `(无法读取该文件本身：${e.message})` });
      continue;
    }

    // 先去掉块注释再扫描：实测发现 JSDoc 里用反引号写"历史上出过问题的
    // require('../scripts/lib/xxx')"这种说明文字，会被正则误当成真实
    // require() 调用，产生假阳性（把这个检查工具自己的说明注释当成缺失依赖）。
    content = content.replace(/\/\*[\s\S]*?\*\//g, '');

    let m;
    RELATIVE_REQUIRE_RE.lastIndex = 0;
    while ((m = RELATIVE_REQUIRE_RE.exec(content)) !== null) {
      const requirePath = m[1];
      const resolved = resolveInAsar(file, requirePath, packedSet);
      if (!resolved) {
        missing.push({ file, require: requirePath });
        continue;
      }
      if (!visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return missing;
}

module.exports = { verifyPackedRequires };
