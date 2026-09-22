/**
 * P9.4: 内容安全审核
 * 本地文本示例；图片能力未配置时明确返回 unavailable。
 */

class ContentModerator {
  constructor() {
    this.badwords = new Set([
      // 示例敏感词
      'bad', 'hate', 'violence',
    ]);
    this.stats = { checked: 0, flagged: 0, blocked: 0 };
  }

  /**
   * 检测文本内容
   */
  moderateText(content) {
    this.stats.checked++;

    // 1. 敏感词检测
    const hasBadword = Array.from(this.badwords).some(word =>
      content.toLowerCase().includes(word)
    );

    if (hasBadword) {
      this.stats.flagged++;
      return {
        status: 'flagged',
        reason: '包含敏感词',
        severity: 'medium',
      };
    }

    // 2. 简单的垃圾评论检测
    if (content.length < 2) {
      this.stats.flagged++;
      return {
        status: 'flagged',
        reason: '内容过短',
        severity: 'low',
      };
    }

    return { status: 'approved', severity: 'none' };
  }

  /**
   * 本机裸露内容筛查；调用者传入本地文件，不接受远程 URL。
   */
  async moderateImage(filePath) {
    this.stats.checked++;
    try {
      return await require('../modules/moderation/localMediaScanner').scanFile(filePath, 'image');
    } catch {
      return { status: 'unavailable', reason: 'MEDIA_MODERATION_UNAVAILABLE' };
    }
  }

  /**
   * 获取审核统计
   */
  getStats() {
    return {
      ...this.stats,
      flagRate: (this.stats.flagged / this.stats.checked * 100).toFixed(2) + '%',
    };
  }
}

module.exports = ContentModerator;
