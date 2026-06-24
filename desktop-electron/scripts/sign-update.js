#!/usr/bin/env node
'use strict';
/**
 * 用 Ed25519 私钥对更新元数据(latest*.yml)签名，产出同名 *.sig（原始 64 字节签名）。
 * 发布流程：electron-builder 打包 → 运行本脚本 → 把 *.yml 与 *.sig 一并上传更新源。
 *
 *   node scripts/sign-update.js [distDir]
 *     distDir  待签名 yml 所在目录，默认 ./dist
 *
 * 私钥默认读 desktop-electron/update-private-key.pem，可用环境变量 UPDATE_PRIVATE_KEY
 * 指定其它路径（CI 中从 secret 写入临时文件）。私钥缺失则报错退出。
 *
 * 客户端侧由 src/main.js verifyUpdateSignature() 用内置公钥 crypto.verify(null, yml, pub, sig)
 * 校验；故此处必须输出与该调用匹配的「原始签名 Buffer」（非 base64/hex 文本）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const distDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const privPath = process.env.UPDATE_PRIVATE_KEY
  || path.join(__dirname, '..', 'update-private-key.pem');

if (!fs.existsSync(privPath)) {
  console.error('找不到私钥:', privPath);
  console.error('先运行 `node scripts/gen-update-keys.js` 生成密钥对，或用 UPDATE_PRIVATE_KEY 指定路径。');
  process.exit(1);
}
if (!fs.existsSync(distDir)) {
  console.error('找不到产物目录:', distDir);
  process.exit(1);
}

let privateKey;
try {
  privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8'));
} catch (e) {
  console.error('私钥解析失败:', e.message);
  process.exit(1);
}

// electron-builder 各平台/通道可能产出的更新元数据文件
const candidates = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
let signed = 0;
for (const name of candidates) {
  const ymlPath = path.join(distDir, name);
  if (!fs.existsSync(ymlPath)) continue;
  const data = fs.readFileSync(ymlPath);
  const sig = crypto.sign(null, data, privateKey); // Ed25519：algorithm 传 null
  const sigPath = `${ymlPath}.sig`;
  fs.writeFileSync(sigPath, sig);
  console.log(`✅ 已签名 ${name} → ${path.basename(sigPath)} (${sig.length} bytes)`);
  signed++;
}

if (signed === 0) {
  console.error('未找到任何 latest*.yml，未生成签名。请确认 distDir 是否正确:', distDir);
  process.exit(1);
}
console.log(`\n完成：${signed} 个元数据已签名。把 *.yml 与对应 *.sig 一并上传到更新源。`);
