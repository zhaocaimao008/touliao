'use strict';
const crypto = require('crypto');
const fs = require('fs');
const yaml = require('js-yaml');
function fail(message) { throw new Error(`更新已阻止：${message}`); }
function version(v) {
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) fail('不支持的版本');
  return v.split('.').map(Number);
}
function newer(a, b) { const x=version(a), y=version(b); for(let i=0;i<3;i++) { if(x[i]!==y[i]) return x[i]>y[i]; } return false; }
function manifestFiles(info) {
  if (!Array.isArray(info.files) || info.files.length !== 1 || info.packages) fail('仅允许单文件离线安装包');
  const f = info.files[0];
  if (typeof f.url !== 'string' || !/^[a-zA-Z0-9._-]+\.exe$/.test(f.url) || !/^[A-Za-z0-9+/]{86}==$/.test(f.sha512 || '')
      || !Number.isSafeInteger(f.size) || f.size <= 0) fail('安装包元数据无效');
  if ((info.path && info.path !== f.url) || (info.sha512 && info.sha512 !== f.sha512)) fail('旧字段与文件清单不一致');
  return { url: f.url, sha512: f.sha512, size: f.size };
}
function bindManifest({ bytes, signature, publicKey, info, currentVersion, platform, arch, channel }) {
  if (!publicKey || crypto.createPublicKey(publicKey).asymmetricKeyType !== 'ed25519' || !signature || signature.length !== 64
      || !crypto.verify(null, bytes, publicKey, signature)) fail('清单签名无效或缺失');
  const manifest = yaml.load(bytes.toString('utf8'), { schema: yaml.JSON_SCHEMA });
  if (!manifest || !newer(manifest.version, currentVersion) || manifest.version !== info.version) fail('版本不一致或回退');
  const context = manifest.touliao;
  if (!context || context.platform !== platform || context.arch !== arch || context.channel !== channel || platform !== 'win32') fail('平台、架构或渠道不一致');
  const file = manifestFiles(manifest);
  if (JSON.stringify(file) !== JSON.stringify(manifestFiles(info)) || JSON.stringify(info.touliao) !== JSON.stringify(context)) fail('下载清单与签名清单不一致');
  return Object.freeze({ ...file, version: manifest.version, platform, arch, channel });
}
function verifyFile(filename, binding) {
  if (!binding || !filename) fail('缺少已验证下载');
  const st = fs.lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink() || st.size !== binding.size) fail('安装包大小或类型不一致');
  const fd = fs.openSync(filename, 'r');
  try {
    const hash=crypto.createHash('sha512'), buffer=Buffer.alloc(1024*1024);
    let n; while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,n));
    if (hash.digest('base64') !== binding.sha512) fail('安装包摘要不一致');
  } finally { fs.closeSync(fd); }
}
function publishers(policy) {
  if (!Array.isArray(policy.publisherThumbprints) || !policy.publisherThumbprints.length
    || policy.publisherThumbprints.some(p => !/^[A-F0-9]{40}$/.test(p))) fail('尚未配置可信 Windows 发布者证书');
  return policy.publisherThumbprints;
}
// The Windows helper repeats digest + Authenticode checks while holding a non-write/non-delete handle.
// This JS preflight is deliberately NOT the final trust boundary.
async function installVerified({ filename, binding, policy, launch }) {
  publishers(policy);
  verifyFile(filename, binding);
  return launch({ filename, sha512: Buffer.from(binding.sha512, 'base64').toString('hex'), publishers: publishers(policy) });
}
module.exports = { bindManifest, verifyFile, installVerified, publishers };
