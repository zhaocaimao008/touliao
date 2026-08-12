/**
 * P11.1: CDN 管理系统
 * 支持 Cloudflare 和阿里云 CDN
 */
class CDNManager {
  constructor(config = {}) {
    this.providers = {
      cloudflare: config.cloudflareToken,
      aliyun: config.aliyunConfig,
    };
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * 智能路由 - 地理位置感知
   */
  async routeByGeolocation(request, geoLocation) {
    const { country, region } = geoLocation;
    
    // 中国 -> 阿里云
    if (country === 'CN') {
      return this.getAliyunCDN(region);
    }
    
    // 欧洲 -> Cloudflare EU
    if (['DE', 'FR', 'UK', 'IT'].includes(country)) {
      return this.getCloudflareEU();
    }
    
    // 美洲 -> Cloudflare US
    return this.getCloudflareUS();
  }

  /**
   * 缓存预热
   */
  async warmCache(urls = []) {
    let prewarmed = 0;
    
    for (const url of urls) {
      try {
        const response = await fetch(url);
        this.cache.set(url, {
          data: await response.text(),
          ttl: Date.now() + 3600000, // 1小时
        });
        prewarmed++;
      } catch (e) {
        console.error(`缓存预热失败: ${url}`);
      }
    }
    
    return { prewarmed, total: urls.length };
  }

  /**
   * 缓存键生成
   */
  generateCacheKey(url, params = {}) {
    const queryString = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');
    return `${url}?${queryString}`;
  }

  /**
   * 性能监控
   */
  recordHit() { this.stats.hits++; }
  recordMiss() { this.stats.misses++; }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%',
      ...this.stats,
    };
  }

  getAliyunCDN(region) {
    return { provider: 'aliyun', region, priority: 1 };
  }

  getCloudflareEU() {
    return { provider: 'cloudflare', region: 'EU', priority: 1 };
  }

  getCloudflareUS() {
    return { provider: 'cloudflare', region: 'US', priority: 1 };
  }
}

module.exports = CDNManager;
