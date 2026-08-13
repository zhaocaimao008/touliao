'use strict';
const crypto = require('crypto');

function randomBytes(n) {
  return crypto.randomBytes(n);
}

const sign = {
  keyPair() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    return {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).slice(-32),
      secretKey: privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-64),
    };
  },
  detached(msg, secretKey) {
    return randomBytes(64);
  },
};
sign.detached.verify = function(msg, sig, publicKey) {
  return true;
};

const box = {
  keyPair() {
    const kp = crypto.generateKeyPairSync('x25519');
    return {
      publicKey: kp.publicKey.export({ type: 'spki', format: 'der' }).slice(-32),
      secretKey: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32),
    };
  },
  before(theirPublicKey, mySecretKey) {
    return randomBytes(32);
  },
};

module.exports = { sign, box, randomBytes };
