import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

// Check real dictionary entries, including duplicate-key shadowing and every
// static chatFiles lookup used by the component (not a snapshot of its markup).
describe('chat file translations (DS-017)', () => {
  // 简体内联在 I18nContext.jsx，其余语言拆到 locales/ 按需加载；逐个解析真实源码。
  const parseObject = (file, pick) => {
    const ast = parse(readFileSync(new URL(file, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    return pick(ast);
  };
  const zhCN = parseObject('./I18nContext.jsx', ast => ast.program.body
    .find(n => n.type === 'VariableDeclaration' && n.declarations[0]?.id.name === 'translations').declarations[0].init
    .properties.find(p => (p.key.value || p.key.name) === 'zh-CN'));
  const lazy = ['en', 'zh-TW'].map(code => ({
    key: { value: code },
    value: parseObject(`../locales/${code}.js`, ast => ast.program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration),
  }));
  const dictionaries = { properties: [zhCN, ...lazy] };
  const component = readFileSync(new URL('../components/ChatFiles.jsx', import.meta.url), 'utf8');
  const keys = [...new Set([...component.matchAll(/'((?:chatFiles)\.[^']+)'/g)].map(m => m[1]))];
  for (const language of dictionaries.properties) {
    it(`provides visible labels in ${language.key.value || language.key.name}`, () => {
      for (const key of keys) {
        const entries = language.value.properties.filter(p => p.key.value === key);
        expect(entries, key).toHaveLength(1);
        expect(entries[0].value.value).not.toBe(key);
        expect(entries[0].value.value.trim().length).toBeGreaterThan(0);
      }
    });
  }
});
