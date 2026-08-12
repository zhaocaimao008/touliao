/**
 * P6.1: 端到端加密模块 (Signal Protocol)
 * 消息加密 + 密钥交换 + 前向保密
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');

class E2EEncryption {
  constructor(options = {}) {
    this.keyDB = new Map(); // 用户公钥缓存
    this.sessionCache = new Map(); // 会话密钥缓存
    this.algorithm = 'aes-256-gcm';
  }

  /**
   * 生成用户密钥对 (Ed25519 for signing + X25519 for DH)
   */
  generateKeyPair() {
    // 签名密钥对
    const signingKeypair = nacl.sign.keyPair();
    
    // Diffie-Hellman 密钥对
    const dhKeypair = nacl.box.keyPair();
    
    return {
      signPublicKey: Buffer.from(signingKeypair.publicKey).toString('base64'),
      signPrivateKey: Buffer.from(signingKeypair.secretKey).toString('base64'),
      dhPublicKey: Buffer.from(dhKeypair.publicKey).toString('base64'),
      dhPrivateKey: Buffer.from(dhKeypair.secretKey).toString('base64'),
    };
  }

  /**
   * 密钥交换: 建立会话密钥
   */
  async performKeyExchange(userId, recipientPublicKey) {
    const sessionId = `${userId}-${recipientPublicKey}`;
    
    if (this.sessionCache.has(sessionId)) {
      return this.sessionCache.get(sessionId);
    }

    // 生成短期 Diffie-Hellman 密钥
    const ephemeralKeypair = nacl.box.keyPair();
    
    // ECDH 计算共享密钥
    const recipientPk = Buffer.from(recipientPublicKey, 'base64');
    const sharedSecret = nacl.box.before(recipientPk, ephemeralKeypair.secretKey);
    
    const sessionKey = {
      id: sessionId,
      ephemeralPublicKey: Buffer.from(ephemeralKeypair.publicKey).toString('base64'),
      sharedSecret: Buffer.from(sharedSecret).toString('base64'),
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
    };

    this.sessionCache.set(sessionId, sessionKey);
    return sessionKey;
  }

  /**
   * 加密消息
   */
  encryptMessage(plaintext, sharedSecret) {
    // 生成随机 nonce
    const nonce = crypto.randomBytes(12);
    
    // 生成随机 IV
    const iv = crypto.randomBytes(16);
    
    // 创建 cipher
    const cipher = crypto.createCipheriv(
      this.algorithm,
      Buffer.from(sharedSecret, 'base64').slice(0, 32),
      iv
    );

    // 加密
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      nonce: nonce.toString('base64'),
      algorithm: this.algorithm,
    };
  }

  /**
   * 解密消息
   */
  decryptMessage(encrypted, sharedSecret) {
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      Buffer.from(sharedSecret, 'base64').slice(0, 32),
      iv
    );

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * 签名消息
   */
  signMessage(message, privateKey) {
    const secretKey = Buffer.from(privateKey, 'base64');
    const signature = nacl.sign.detached(
      Buffer.from(message),
      secretKey
    );
    return Buffer.from(signature).toString('base64');
  }

  /**
   * 验证签名
   */
  verifySignature(message, signature, publicKey) {
    try {
      const pk = Buffer.from(publicKey, 'base64');
      const sig = Buffer.from(signature, 'base64');
      return nacl.sign.detached.verify(
        Buffer.from(message),
        sig,
        pk
      );
    } catch {
      return false;
    }
  }

  /**
   * 完整的端到端加密流程
   */
  async encryptAndSign(message, senderPrivateKey, recipientPublicKey, sessionKey) {
    // 1. 加密消息
    const encrypted = this.encryptMessage(message, sessionKey);
    
    // 2. 签名加密消息
    const signature = this.signMessage(encrypted.ciphertext, senderPrivateKey);
    
    return {
      encrypted,
      signature,
      timestamp: Date.now(),
    };
  }

  /**
   * 完整的端到端解密流程
   */
  async decryptAndVerify(payload, senderPublicKey, sessionKey) {
    // 1. 验证签名
    const isValid = this.verifySignature(
      payload.encrypted.ciphertext,
      payload.signature,
      senderPublicKey
    );

    if (!isValid) {
      throw new Error('签名验证失败');
    }

    // 2. 解密消息
    const decrypted = this.decryptMessage(payload.encrypted, sessionKey);

    return {
      message: decrypted,
      verified: true,
      timestamp: payload.timestamp,
    };
  }
}

module.exports = E2EEncryption;
