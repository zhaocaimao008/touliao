'use strict';
/**
 * OSS 文件上传工具
 * 支持阿里云 OSS / 腾讯云 COS / AWS S3
 */

const crypto = require('crypto');
const path = require('path');

class OSSUploader {
  constructor() {
    this.enabled = !!process.env.OSS_ACCESS_KEY_ID;
    this.cdnDomain = process.env.OSS_CDN_DOMAIN || '';
    
    if (this.enabled) {
      try {
        const OSS = require('ali-oss');
        this.client = new OSS({
          region: process.env.OSS_REGION || 'oss-cn-hangzhou',
          accessKeyId: process.env.OSS_ACCESS_KEY_ID,
          accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
          bucket: process.env.OSS_BUCKET || 'vxin-media',
        });
        console.log('[OSS] 初始化成功');
      } catch (err) {
        console.warn('[OSS] ali-oss 未安装，OSS 上传功能将被禁用');
        this.enabled = false;
      }
    } else {
      console.log('[OSS] 未配置，使用本地存储');
    }
  }

  /**
   * 生成唯一文件名
   * @param {string} originalFilename - 原始文件名
   * @param {string} type - 文件类型 (avatar/image/file/video)
   * @returns {string} OSS 存储路径
   */
  generateKey(originalFilename, type = 'file') {
    const ext = path.extname(originalFilename);
    const hash = crypto.randomBytes(16).toString('hex');
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    return `${type}/${year}/${month}/${Date.now()}-${hash}${ext}`;
  }

  /**
   * 上传文件到 OSS
   * @param {Buffer|Stream} fileContent - 文件内容
   * @param {string} originalFilename - 原始文件名
   * @param {string} type - 文件类型
   * @param {Object} options - 额外选项
   * @returns {Promise<string>} CDN URL 或本地 URL
   */
  async upload(fileContent, originalFilename, type = 'file', options = {}) {
    if (!this.enabled) {
      // 未启用 OSS，返回本地存储路径
      return `/uploads/${type}/${originalFilename}`;
    }

    try {
      const key = this.generateKey(originalFilename, type);
      
      const headers = {
        'Cache-Control': options.cacheControl || 'max-age=31536000', // 默认 1 年
      };

      // 根据文件类型设置 Content-Type
      if (originalFilename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        headers['Content-Type'] = 'image/' + path.extname(originalFilename).slice(1);
      }

      const result = await this.client.put(key, fileContent, {
        headers,
        timeout: 60000, // 60 秒超时
      });

      // 返回 CDN 地址
      const url = this.cdnDomain 
        ? `${this.cdnDomain}/${key}` 
        : result.url;

      console.log(`[OSS] 上传成功: ${url}`);
      return url;

    } catch (err) {
      console.error('[OSS] 上传失败:', err.message);
      throw new Error('文件上传失败');
    }
  }

  /**
   * 批量上传文件
   * @param {Array} files - 文件数组 [{buffer, originalname, type}]
   * @returns {Promise<Array<string>>} URL 数组
   */
  async batchUpload(files) {
    return Promise.all(
      files.map(file => 
        this.upload(file.buffer, file.originalname, file.type || 'file')
      )
    );
  }

  /**
   * 删除文件
   * @param {string} url - 文件 URL
   */
  async delete(url) {
    if (!this.enabled) return;

    try {
      // 提取 key
      let key = url;
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        key = urlObj.pathname.slice(1); // 移除开头的 /
      }

      await this.client.delete(key);
      console.log(`[OSS] 删除成功: ${key}`);
    } catch (err) {
      console.error('[OSS] 删除失败:', err.message);
    }
  }

  /**
   * 批量删除文件
   * @param {Array<string>} urls - URL 数组
   */
  async batchDelete(urls) {
    if (!this.enabled || !urls || urls.length === 0) return;

    const keys = urls.map(url => {
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        return urlObj.pathname.slice(1);
      }
      return url;
    });

    try {
      const result = await this.client.deleteMulti(keys, { quiet: true });
      console.log(`[OSS] 批量删除成功: ${keys.length} 个文件`);
      return result;
    } catch (err) {
      console.error('[OSS] 批量删除失败:', err.message);
    }
  }

  /**
   * 生成临时访问 URL（用于私有文件）
   * @param {string} key - 文件 key
   * @param {number} expires - 过期时间（秒）
   * @returns {string} 临时 URL
   */
  async getSignedUrl(key, expires = 3600) {
    if (!this.enabled) {
      return `/uploads/${key}`;
    }

    try {
      const url = this.client.signatureUrl(key, {
        expires,
        method: 'GET',
      });
      return url;
    } catch (err) {
      console.error('[OSS] 生成签名 URL 失败:', err.message);
      throw err;
    }
  }

  /**
   * 检查文件是否存在
   * @param {string} key - 文件 key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    if (!this.enabled) return false;

    try {
      await this.client.head(key);
      return true;
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        return false;
      }
      throw err;
    }
  }
}

// 导出单例
module.exports = new OSSUploader();
