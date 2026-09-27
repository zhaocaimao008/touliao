import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 代码里用到的每个文案键都必须在三种语言词典中存在：缺失时界面会直接显示键名
// （如回复提示条曾显示「composeBar.replyingToTemplate」）。
const SRC = path.resolve(__dirname);
function usedKeys() {
  const used = new Map();
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(name) || /\.test\./.test(name) || p.includes(`${path.sep}locales${path.sep}`) || name === 'I18nContext.jsx') continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bt\(\s*['"]([a-zA-Z]\w*\.[\w.]+)['"]/g)) {
        if (!used.has(m[1])) used.set(m[1], path.relative(SRC, p));
      }
    }
  })(SRC);
  return used;
}
const dictKeys = file => new Set([...fs.readFileSync(path.join(SRC, file), 'utf8')
  .matchAll(/^\s*['"]([a-zA-Z]\w*\.[\w.]+)['"]\s*:/gm)].map(m => m[1]));

describe('i18n 文案键完整性', () => {
  const used = usedKeys();
  for (const file of ['contexts/I18nContext.jsx', 'locales/en.js', 'locales/zh-TW.js']) {
    it(`${file} 包含代码用到的全部文案键`, () => {
      const dict = dictKeys(file);
      const missing = [...used].filter(([k]) => !dict.has(k)).map(([k, f]) => `${k} ← ${f}`);
      expect(missing).toEqual([]);
    });
  }
});
