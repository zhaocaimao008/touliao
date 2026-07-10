#!/usr/bin/env node
/**
 * 依赖一致性守护：@capacitor/cli 的主版本必须与运行时 @capacitor/* 平台包一致。
 *
 * 背景（真实事故）：CLI 曾是 ^8.4.1 而 @capacitor/android 是 ^4.8.2，
 * v8 CLI 的 `cap sync` 把 capacitor.build.gradle 生成成 JavaVersion.VERSION_21，
 * 与 Gradle 7.4.2 / AGP 7.2.1 工具链不兼容 → Android 打包 BUILD FAILED。
 * 本脚本在 CI 提前拦截这类主版本漂移，避免"本地不打包就潜伏"的问题。
 *
 * 退出码：0=一致，1=不一致（CI 红）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

const major = (range) => {
  if (!range) return null;
  const m = String(range).replace(/^[\^~>=<\s]+/, '').match(/^(\d+)/);
  return m ? Number(m[1]) : null;
};

const cliMajor = major(deps['@capacitor/cli']);
// 运行时平台包（这些的主版本要与 CLI 对齐）
const runtime = ['@capacitor/core', '@capacitor/android', '@capacitor/ios',
  '@capacitor/app', '@capacitor/camera', '@capacitor/filesystem',
  '@capacitor/geolocation', '@capacitor/network', '@capacitor/push-notifications'];

if (cliMajor == null) {
  console.log('ℹ️  未声明 @capacitor/cli，跳过检查');
  process.exit(0);
}

const mismatches = [];
for (const name of runtime) {
  if (!deps[name]) continue;
  const m = major(deps[name]);
  if (m != null && m !== cliMajor) mismatches.push(`  ${name}: ^${m}.x  (CLI 是 ^${cliMajor}.x)`);
}

if (mismatches.length) {
  console.error(`❌ Capacitor 主版本不一致：@capacitor/cli 是 ^${cliMajor}.x，但以下包不匹配：`);
  console.error(mismatches.join('\n'));
  console.error('\n修复：把 @capacitor/cli 与平台包对齐到同一主版本（例如 npm i -D @capacitor/cli@^' + (major(deps['@capacitor/core']) ?? cliMajor) + ')');
  process.exit(1);
}

console.log(`✅ Capacitor 版本一致（全部 ^${cliMajor}.x）`);
process.exit(0);
