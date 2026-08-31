'use strict';

const path = require('path');
const { mkdirSync } = require('fs');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const cacheRoot = process.env.TOULIAO_BUILD_CACHE || path.join(projectRoot, '.build-cache');
const electronCache = path.join(cacheRoot, 'electron');
const builderCache = path.join(cacheRoot, 'electron-builder');
mkdirSync(electronCache, { recursive: true });
mkdirSync(builderCache, { recursive: true });

const cli = require.resolve('electron-builder/out/cli/cli.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_CACHE: electronCache, ELECTRON_BUILDER_CACHE: builderCache },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
