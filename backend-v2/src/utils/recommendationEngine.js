/**
 * P9.3: 智能推荐系统
 * 基于协同过滤和内容特征的推荐
 */

class RecommendationEngine {
  constructor() {
    this.userProfiles = new Map();
    this.itemFeatures = new Map();
    this.interactions = [];
  }

  /**
   * 记录用户交互
   */
  recordInteraction(userId, itemId, interaction) {
    this.interactions.push({
      userId,
      itemId,
      interaction, // 'view', 'like', 'share', 'forward'
      timestamp: Date.now(),
      weight: this.getWeight(interaction),
    });
  }

  /**
   * 计算用户相似度 (协同过滤)
   */
  getUserSimilarity(userId1, userId2) {
    const profile1 = this.userProfiles.get(userId1) || {};
    const profile2 = this.userProfiles.get(userId2) || {};

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (const key in profile1) {
      if (profile2[key] !== undefined) {
        dotProduct += profile1[key] * profile2[key];
      }
      magnitude1 += profile1[key] ** 2;
    }

    for (const key in profile2) {
      magnitude2 += profile2[key] ** 2;
    }

    return dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2) || 1);
  }

  /**
   * 推荐内容
   */
  recommendItems(userId, limit = 10) {
    const scores = new Map();

    // 1. 协同过滤: 基于相似用户的偏好
    for (const [otherUserId, profile] of this.userProfiles) {
      if (otherUserId === userId) continue;

      const similarity = this.getUserSimilarity(userId, otherUserId);
      if (similarity > 0.5) {
        for (const [itemId, score] of Object.entries(profile)) {
          scores.set(itemId, (scores.get(itemId) || 0) + similarity * score);
        }
      }
    }

    // 2. 内容特征: 推荐相似内容
    const userLikes = this.userProfiles.get(userId) || {};
    for (const [itemId, features] of this.itemFeatures) {
      let featureSimilarity = 0;
      for (const feature in features) {
        if (userLikes[feature]) {
          featureSimilarity += userLikes[feature] * features[feature];
        }
      }
      scores.set(itemId, (scores.get(itemId) || 0) + featureSimilarity);
    }

    // 排序并返回
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([itemId]) => itemId);
  }

  getWeight(interaction) {
    const weights = { view: 1, like: 3, share: 5, forward: 7 };
    return weights[interaction] || 1;
  }
}

module.exports = RecommendationEngine;
