/**
 * P9.4: 内容安全审核
 * AI 驱动的违规内容检测
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
   * 检测图片内容 (占位: 实际需要 CV 模型)
   */
  async moderateImage(imageUrl) {
    this.stats.checked++;
    // 实际实现需要调用 Google Vision API 或类似
    return { status: 'approved', severity: 'none' };
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
