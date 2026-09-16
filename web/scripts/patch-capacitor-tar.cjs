'use strict';
const fs = require('node:fs');
// Capacitor 4 assumes a default export; maintained node-tar 7 exposes named CJS exports.
// Keep native bridges on 4.x while using the security-patched archive parser.
const file = require.resolve('@capacitor/cli/dist/util/template.js');
const before = 'const tar_1 = tslib_1.__importDefault(require("tar"));';
const after = 'const tar_1 = { default: require("tar") };';
const source = fs.readFileSync(file, 'utf8');
if (!source.includes(before) && !source.includes(after)) {
  throw new Error('Capacitor template importer changed; review the tar compatibility patch');
}
if (source.includes(before)) fs.writeFileSync(file, source.replace(before, after));
