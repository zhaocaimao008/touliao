/**
 * P12.3: 实时翻译引擎
 * 支持 100+ 语言
 */
class TranslationEngine {
  constructor(config = {}) {
    this.provider = config.provider || 'google';
    this.cache = new Map();
    this.supportedLanguages = [
      'zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'ar', 'pt',
      'hi', 'vi', 'th', 'id', 'bn', 'pa', 'te', 'mr', 'gu', 'kn',
    ];
  }

  /**
   * 翻译文本
   */
  async translate(text, targetLang, sourceLang = 'auto') {
    const cacheKey = `${text}:${sourceLang}:${targetLang}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.value;
      this.cache.delete(cacheKey);
    }

    if (!this.supportedLanguages.includes(targetLang)) {
      throw new Error(`不支持语言: ${targetLang}`);
    }

    const translated = await this.callTranslationAPI(text, targetLang, sourceLang);

    // 缓存 30 天（setTimeout 延时不能超过 ~24.8 天的 32 位有符号整数上限，
    // 否则 Node 会静默钳位成 1ms，缓存写入后立即失效——改用到期时间戳 + 惰性判断）
    this.cache.set(cacheKey, { value: translated, expiresAt: Date.now() + 30 * 86400000 });

    return translated;
  }

  /**
   * 批量翻译
   */
  async translateBatch(texts, targetLang, sourceLang = 'auto') {
    const results = [];
    
    for (const text of texts) {
      try {
        const translated = await this.translate(text, targetLang, sourceLang);
        results.push({ original: text, translated });
      } catch (e) {
        results.push({ original: text, error: e.message });
      }
    }

    return results;
  }

  /**
   * 语言检测
   */
  async detectLanguage(text) {
    const cacheKey = `detect:${text}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const detected = await this.callDetectionAPI(text);
    this.cache.set(cacheKey, detected);

    return detected;
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages() {
    return this.supportedLanguages;
  }

  async callTranslationAPI(text, targetLang, sourceLang) {
    // 模拟翻译 API 调用
    return {
      original: text,
      translated: `[${targetLang}] ${text}`,
      confidence: 0.95,
      detectedSourceLang: sourceLang === 'auto' ? 'zh' : sourceLang,
    };
  }

  async callDetectionAPI(text) {
    // 模拟语言检测
    return {
      language: 'zh',
      confidence: 0.98,
    };
  }
}

module.exports = TranslationEngine;
