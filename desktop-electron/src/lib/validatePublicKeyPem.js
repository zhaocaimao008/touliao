'use strict';
const crypto = require('crypto');

/**
 * 校验一段 PEM 文本是否是合法、非占位的 Ed25519 公钥。
 *
 * 主进程运行时自检（src/main.js 的 checkUpdateKeyStatus）与打包后校验
 * （scripts/afterPack.js）共用同一份判断标准，避免"什么算合法公钥"这条定义
 * 在两处各自维护、逐渐漂移出不一致的结果。
 *
 * 2026-08-30：从 scripts/lib/ 移到这里（src/lib/）——原路径导致 main.js 用
 * `require('../scripts/lib/validatePublicKeyPem')` 引用它，而 electron-builder
 * 的 build.files 只打包 src/**、不含 scripts/，产物启动时直接崩溃
 * （Cannot find module，8.1.0 发版后在真实 Windows 机器上复现）。src/ 是唯一
 * "会被打进产物"的运行时代码边界，运行时依赖必须放在这里，不能放 scripts/
 * （那是只在构建机器上跑一次的工具目录）。scripts/afterPack.js 作为构建脚本，
 * 反过来 require 这里的文件是安全的——它运行在构建机器本机，直接读源码，
 * 不受打包范围限制。
 *
 * @param {string} pem
 * @returns {{ valid: boolean, reason: string }}
 */
function validatePublicKeyPem(pem) {
  if (typeof pem !== 'string' || !pem.trim()) {
    return { valid: false, reason: '内容为空或不可读' };
  }
  if (pem.includes('PLACEHOLDER')) {
    return { valid: false, reason: '仍是生成脚本留的占位文本，尚未生成真实密钥对' };
  }
  if (!pem.includes('BEGIN PUBLIC KEY')) {
    return { valid: false, reason: '内容不是合法的 PEM 公钥格式' };
  }
  let key;
  try {
    key = crypto.createPublicKey(pem);
  } catch (e) {
    return { valid: false, reason: `PEM 内容无法解析为公钥：${e.message}` };
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    return { valid: false, reason: `密钥类型不是 Ed25519（实际：${key.asymmetricKeyType}）` };
  }
  return { valid: true, reason: '' };
}

module.exports = { validatePublicKeyPem };
