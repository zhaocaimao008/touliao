'use strict';
/**
 * electron-builder afterPack 钩子：每个平台各自打包完、生成安装包之前跑一次。
 *
 * 做两件事，任一失败都会 throw，让 electron-builder 以非零退出码终止整个构建：
 *   1. 校验 UPDATE_PRIVATE_KEY 环境变量已配置且指向合法 Ed25519 私钥——尽早失败，
 *      不浪费时间把安装包打完才发现签不了名（真正签名发生在 afterAllArtifactBuild.js）。
 *   2. 从刚打好的产物 app.asar 里实际解出 src/update-public-key.pem 并校验，证明
 *      "公钥真的被装进了这次构建的产物里、且合法"，而不是只检查打包前的源文件
 *      （源文件对，不代表 package.json 的 files/asar 规则以后被改动后产物里还有它）。
 *
 * 本地（Mac/Linux 手动打包）与 CI（Windows）走同一份 electron-builder 配置，
 * 这个钩子在两条路径下都会执行，不需要分别维护两套校验逻辑。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const asar = require('@electron/asar');
const { validatePublicKeyPem } = require('./lib/validatePublicKeyPem');

function checkPrivateKeyEnv() {
  const p = process.env.UPDATE_PRIVATE_KEY;
  if (!p) {
    throw new Error(
      '[afterPack] 未配置 UPDATE_PRIVATE_KEY 环境变量，构建已终止，不允许产出无签名的包。\n' +
      '  本地：export UPDATE_PRIVATE_KEY=/path/to/update-private-key.pem\n' +
      '  CI：从 GitHub Secret 写入临时文件后设置该环境变量。'
    );
  }
  if (!fs.existsSync(p)) {
    throw new Error(`[afterPack] UPDATE_PRIVATE_KEY 指向的文件不存在：${p}`);
  }
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`[afterPack] UPDATE_PRIVATE_KEY 文件内容不是合法私钥：${e.message}`);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`[afterPack] UPDATE_PRIVATE_KEY 不是 Ed25519 私钥（实际：${privateKey.asymmetricKeyType}）`);
  }
}

// app.asar 在不同平台的产物目录结构里位置不同：macOS 在 .app 包内部，Windows/Linux
// 直接在输出目录下的 resources/。
function resourcesPathFor(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

module.exports = async function afterPack(context) {
  checkPrivateKeyEnv();

  const asarPath = path.join(resourcesPathFor(context), 'app.asar');
  if (!fs.existsSync(asarPath)) {
    throw new Error(`[afterPack] 找不到打包产物 app.asar：${asarPath}`);
  }

  let pemBuf;
  try {
    pemBuf = asar.extractFile(asarPath, 'src/update-public-key.pem');
  } catch (e) {
    throw new Error(`[afterPack] 产物 app.asar 中找不到 src/update-public-key.pem：${e.message}`);
  }

  const { valid, reason } = validatePublicKeyPem(pemBuf.toString('utf8'));
  if (!valid) {
    throw new Error(`[afterPack] 产物中的 update-public-key.pem 校验失败：${reason}`);
  }

  console.log(`[afterPack] 更新公钥+签名私钥均校验通过（${context.electronPlatformName}/${context.arch}）`);
};
