#!/usr/bin/env node
'use strict';
/**
 * 用 Ed25519 私钥对更新元数据(latest*.yml)签名，产出同名 *.sig（原始 64 字节签名）。
 *
 *   node scripts/sign-update.js [distDir] [expectedYmlName]
 *     distDir         待签名 yml 所在目录，默认 ./dist
 *     expectedYmlName 只签这一个文件名（不传则扫描默认候选列表里存在的所有文件）
 *
 * package.json 的 build:win/build:mac/build:linux 已各自接了对应的
 * `&& node scripts/sign-update.js dist latest*.yml`，打包后自动执行，不需要每次
 * 发布都记得手动跑。**特意做成"electron-builder 进程退出后再跑"的独立步骤**，
 * 不是 electron-builder 的 afterAllArtifactBuild 钩子——2026-08-30 实测发现该钩子
 * 与 electron-builder 自身写 latest*.yml 的内部发布任务队列之间存在真实竞态（钩子
 * 触发时 yml 可能还没被最终内容覆盖完，签的是半成品，事后 yml 又被重写导致签名失效），
 * 且 dist/ 是跨平台共用输出目录，旧构建残留的 latest*.yml 会被静态扫描误当成"这次
 * 也要签"。改成 shell `&&` 串行、且显式传入 expectedYmlName 后，两个问题都不存在：
 * `&&` 保证 electron-builder 进程已完全退出（内部所有异步写入必然已落盘）才开始签名；
 * 显式文件名保证只签"这次这个平台真正应该产出的那一份"，不会被同目录里的旧文件污染。
 *
 * 私钥默认读 desktop-electron/update-private-key.pem，可用环境变量 UPDATE_PRIVATE_KEY
 * 指定其它路径（CI 中从 secret 写入临时文件；本地开发从自己离线保管的位置指定）。
 * 私钥缺失/不合法则报错退出，不允许产出无签名的更新元数据。
 *
 * 客户端侧由 src/main.js verifyUpdateSignature() 用内置公钥 crypto.verify(null, yml, pub, sig)
 * 校验；故此处必须输出与该调用匹配的「原始签名 Buffer」（非 base64/hex 文本）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// electron-builder 各平台/通道可能产出的更新元数据文件
const CANDIDATES = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];

/**
 * 对 distDir 下存在的 latest*.yml 逐一签名，产出同名 .sig。
 * @param {string} distDir 待签名 yml 所在目录
 * @param {string} [privateKeyPath] 私钥文件路径，缺省读 UPDATE_PRIVATE_KEY 环境变量，
 *   两者都没有则读 desktop-electron/update-private-key.pem
 * @param {string[]} [onlyNames] 只签这些文件名（不传则用默认候选列表全扫）。
 *   package.json 里 build:win/build:mac/build:linux 各自都显式传了自己平台对应的
 *   文件名——dist/ 是跨平台共用输出目录，不同平台各自打包都写进同一个目录，如果不限定
 *   只签"这次构建实际产出的平台对应的 yml"，会把其它平台上次构建残留的旧 latest*.yml
 *   也一起签了（内容没变但重新盖了个"看起来是最新签名"的 .sig，掩盖了它其实是旧文件
 *   这件事）。不传 onlyNames 时（比如临时手动补签、不确定具体产出了哪个）退回扫描
 *   默认候选列表里存在的文件。
 * @returns {{ signed: string[] }} 实际签名成功的文件名列表
 * @throws {Error} 私钥缺失/不合法/产物目录不存在/一个签名都没产出时抛错
 */
function signAll(distDir, privateKeyPath, onlyNames) {
  const resolvedDist = path.resolve(distDir);
  const privPath = privateKeyPath
    || process.env.UPDATE_PRIVATE_KEY
    || path.join(__dirname, '..', 'update-private-key.pem');

  if (!fs.existsSync(privPath)) {
    throw new Error(
      `找不到私钥: ${privPath}\n` +
      '先运行 `node scripts/gen-update-keys.js` 生成密钥对，或用 UPDATE_PRIVATE_KEY 指定路径。'
    );
  }
  if (!fs.existsSync(resolvedDist)) {
    throw new Error(`找不到产物目录: ${resolvedDist}`);
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8'));
  } catch (e) {
    throw new Error(`私钥解析失败: ${e.message}`);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`私钥不是 Ed25519（实际：${privateKey.asymmetricKeyType}）`);
  }

  const candidates = onlyNames && onlyNames.length > 0 ? onlyNames : CANDIDATES;
  const signed = [];
  for (const name of candidates) {
    const ymlPath = path.join(resolvedDist, name);
    if (!fs.existsSync(ymlPath)) {
      if (onlyNames) {
        // 明确指定要签这个文件（这次构建理应产出它），但它不存在——不能静默跳过，
        // 否则会退化成"该签的没签，也没人知道"，直接报错让调用方（afterPack之后的
        // afterAllArtifactBuild）失败终止构建。
        throw new Error(`预期产出的更新元数据文件不存在: ${ymlPath}`);
      }
      continue;
    }
    const data = fs.readFileSync(ymlPath);
    const sig = crypto.sign(null, data, privateKey); // Ed25519：algorithm 传 null
    const sigPath = `${ymlPath}.sig`;
    fs.writeFileSync(sigPath, sig);
    console.log(`✅ 已签名 ${name} → ${path.basename(sigPath)} (${sig.length} bytes)`);
    signed.push(name);
  }

  if (signed.length === 0) {
    throw new Error(`未找到任何 latest*.yml，未生成签名。请确认 distDir 是否正确: ${resolvedDist}`);
  }
  return { signed };
}

// 命令行直接运行时的入口：node scripts/sign-update.js [distDir] [expectedYmlName]
if (require.main === module) {
  const distDir = process.argv[2] || path.join(__dirname, '..', 'dist');
  const expectedYmlName = process.argv[3];
  try {
    const { signed } = signAll(distDir, undefined, expectedYmlName ? [expectedYmlName] : undefined);
    console.log(`\n完成：${signed.length} 个元数据已签名。把 *.yml 与对应 *.sig 一并上传到更新源。`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { signAll };
