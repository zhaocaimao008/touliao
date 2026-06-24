#!/usr/bin/env node
'use strict';
/**
 * 生成更新元数据签名用 Ed25519 密钥对（只需运行一次）。
 *   node scripts/gen-update-keys.js
 *
 * 产出：
 *   src/update-public-key.pem      公钥 —— 随客户端内置，应提交入库
 *   update-private-key.pem         私钥 —— 发布方离线保管，已被 .gitignore，切勿提交/外发
 *
 * 私钥泄露 = 他人可伪造"更新元数据"。请妥善保存（密码管理器/HSM/离线介质）。
 * 已存在公钥时默认不覆盖，避免误废已发行客户端内置的公钥；如确需轮换请加 --force。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pubPath = path.join(__dirname, '..', 'src', 'update-public-key.pem');
const privPath = path.join(__dirname, '..', 'update-private-key.pem');
const force = process.argv.includes('--force');

if (fs.existsSync(pubPath) && !fs.readFileSync(pubPath, 'utf8').includes('PLACEHOLDER') && !force) {
  console.error('已存在公钥:', pubPath);
  console.error('如需轮换密钥请加 --force（注意：旧客户端将无法校验新私钥签名的更新）。');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

fs.writeFileSync(pubPath, pubPem);
fs.writeFileSync(privPath, privPem, { mode: 0o600 });

console.log('✅ 已生成 Ed25519 密钥对');
console.log('   公钥(提交入库):', pubPath);
console.log('   私钥(离线保管):', privPath);
console.log('\n⚠️  立即把 update-private-key.pem 移到安全处保存，切勿提交到仓库或外发。');
console.log('    发布时用 scripts/sign-update.js 生成 *.sig。');
