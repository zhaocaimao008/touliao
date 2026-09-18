'use strict';
const fs = require('node:fs');
const path = require('node:path');
const tokens = require('../web/src/ui-kit/tokens.json');
const kebab = text => text.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const lines = ['/* Generated from ui-kit/tokens.json. Run node scripts/generate-ui-tokens.cjs. */'];
for (const theme of ['light', 'dark']) {
  lines.push(theme === 'light' ? 'html.touliao-ui body {' : 'html.touliao-ui body.dark-mode {');
  for (const [name, value] of Object.entries(tokens.color[theme])) lines.push(`  --tl-${kebab(name)}: ${value};`);
  for (const [name, value] of Object.entries(tokens.elevation[theme])) lines.push(`  --tl-shadow-${name}: ${value};`);
  lines.push(`  color-scheme: ${theme};`, '}');
}
lines.push('html.touliao-ui {');
for (const [group, values] of Object.entries({ space: tokens.spacing, radius: tokens.radius, size: tokens.typography.size })) {
  for (const [key, value] of Object.entries(values)) lines.push(`  --tl-${group}-${kebab(key)}: ${value}px;`);
}
for (const [key, value] of Object.entries(tokens.motion.duration)) lines.push(`  --tl-duration-${key}: ${value}ms;`);
for (const [key, value] of Object.entries(tokens.layout.desktop)) lines.push(`  --tl-layout-${kebab(key)}: ${value}px;`);
lines.push(`  --tl-font: ${tokens.typography.fontFamily.web};`, `  --tl-font-windows: ${tokens.typography.fontFamily.windows};`, '}');
const output = lines.join('\n') + '\n';
const file = path.join(__dirname, '../web/src/ui-kit/tokens.css');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(file, 'utf8') !== output) throw new Error('UI tokens are stale');
} else fs.writeFileSync(file, output);
