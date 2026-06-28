/**
 * 从 anchors.js 生成 appium/anchors.py 镜像,使 Python(Appium)与 JS(Playwright)
 * 用同一份锚点真相源。运行: node e2e/shared/gen-anchors-py.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./anchors');

const lines = [
  '"""自动生成,勿手改。源: e2e/shared/anchors.js。重生成: node e2e/shared/gen-anchors-py.js"""',
  '',
];
for (const [k, v] of Object.entries(A)) {
  // 驼峰转下划线(navTab → NAV_TAB),与 Python 常量风格一致
  const name = k.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  if (typeof v === 'function') {
    // 动态锚点导出为 lambda
    const sample = v('X');                       // 探测模板,如 nav-tab-X
    const tmpl = sample.replace(/X$/, '');        // → nav-tab-
    lines.push(`${name} = lambda x: ${JSON.stringify(tmpl)} + str(x)`);
  } else {
    lines.push(`${name} = ${JSON.stringify(v)}`);
  }
}
const out = path.join(__dirname, '..', 'appium', 'anchors.py');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log('已生成', out);
