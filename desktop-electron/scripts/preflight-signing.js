'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function preflight(env = process.env, publicPath = path.join(__dirname, '../src/update-public-key.pem')) {
  if (!env.UPDATE_PRIVATE_KEY) throw new Error('签名预检失败：缺少 UPDATE_PRIVATE_KEY；请配置发布签名材料');
  let key;
  try { key = crypto.createPrivateKey(fs.readFileSync(env.UPDATE_PRIVATE_KEY)); }
  catch { throw new Error('签名预检失败：私钥文件不可读取或格式无效'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('签名预检失败：必须使用 Ed25519 私钥');
  const expected = crypto.createPublicKey(fs.readFileSync(publicPath)).export({ type: 'spki', format: 'der' });
  const actual = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  if (!actual.equals(expected)) throw new Error('签名预检失败：私钥与客户端更新公钥不匹配');
  return true;
}
if (require.main === module) {
  try { preflight(); console.log('签名预检通过'); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { preflight };
