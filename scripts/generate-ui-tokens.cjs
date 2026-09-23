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
for (const [key, value] of Object.entries(tokens.motion.easing)) lines.push(`  --tl-easing-${key}: ${value};`);
for (const [key, value] of Object.entries(tokens.typography.weight)) lines.push(`  --tl-weight-${key}: ${value};`);
for (const [key, value] of Object.entries(tokens.typography.lineHeight)) lines.push(`  --tl-leading-${key}: ${value};`);
for (const [key, role] of Object.entries(tokens.typography.roles)) {
  lines.push(`  --tl-type-${key}-size: var(--tl-size-${kebab(role.desktopSize || role.size)});`,
    `  --tl-type-${key}-weight: var(--tl-weight-${role.weight});`,
    `  --tl-type-${key}-leading: var(--tl-leading-${role.lineHeight});`);
}
for (const [key, value] of Object.entries(tokens.layout.desktop)) lines.push(`  --tl-layout-${kebab(key)}: ${value}px;`);
lines.push(`  --tl-font: ${tokens.typography.fontFamily.web};`, `  --tl-font-windows: ${tokens.typography.fontFamily.windows};`, '}');
// Preserve the deployed stacking order, including Electron's native chrome.
lines.push(':root {');
for (const [key, value] of Object.entries(tokens.layout.zIndex)) lines.push(`  --z-${kebab(key)}: ${value};`);
lines.push('}', 'html.touliao-ui body {');
const c = tokens.components;
for (const [key, value] of Object.entries({
  'control-height': c.button.defaultDesktopHeight + 'px', 'touch-target': c.control.touchTarget + 'px',
  'control-font': 'var(--tl-size-body-desktop)', 'setting-height': tokens.platforms.web.settingsRowMinimum + 'px',
  'control-border': c.control.borderWidth + 'px', 'disabled-opacity': c.control.disabledOpacity,
  'dialog-width': c.dialog.desktopWidth + 'px', 'skeleton-duration': c.skeleton.animationDuration + 'ms',
})) lines.push(`  --tl-${key}: ${value};`);
for (const [key, value] of Object.entries(c.media)) lines.push(`  --tl-media-${kebab(key)}: ${typeof value === 'number' ? value + (key.endsWith('Duration') ? 'ms' : 'px') : value};`);
lines.push('}', `@media (max-width: ${tokens.layout.breakpoints.mobileMax}px) {`, '  html.touliao-ui body {',
  `    --tl-control-height: ${c.button.defaultMobileHeight}px;`, '    --tl-control-font: var(--tl-size-body-mobile);',
  `    --tl-setting-height: ${c.control.mobileSettingsRowMinimum}px;`, '    --tl-type-body-size: var(--tl-size-body-mobile);', '  }', '}');
const output = lines.join('\n') + '\n';
const file = path.join(__dirname, '../web/src/ui-kit/tokens.css');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(file, 'utf8') !== output) throw new Error('UI tokens are stale');
} else fs.writeFileSync(file, output);
