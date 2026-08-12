/**
 * P14.8: 前端离线和 PWA 能力
 * 离线优先 + PWA 增强
 */
class OfflinePWA {
  constructor() {
    this.offlineDb = new Map();
    this.syncQueue = [];
    this.serviceWorker = null;
    this.cacheStrat = 'network-first';
  }

  /**
   * 离线优先策略
   */
  initializeOfflineFirst() {
    return {
      strategy: 'offline-first',
      components: {
        indexedDB: this.initIndexedDB(),
        serviceWorker: this.registerServiceWorker(),
        syncManager: this.initSyncManager(),
        appShell: this.cacheAppShell(),
      },
      offline: {
        readCapability: 'full',
        writeCapability: 'queue',
        syncWhenOnline: true,
      },
    };
  }

  /**
   * IndexedDB 管理
   */
  initIndexedDB() {
    const stores = {
      messages: { keyPath: 'id', indexes: ['timestamp', 'userId'] },
      users: { keyPath: 'id', indexes: ['email'] },
      cache: { keyPath: 'url', indexes: ['timestamp'] },
      syncQueue: { keyPath: 'id', indexes: ['priority'] },
    };

    return {
      dbName: 'vxin-offline',
      version: 1,
      stores,
      estimatedSize: '50MB',
      features: {
        fullTextSearch: true,
        indexing: true,
        transactions: true,
      },
    };
  }

  /**
   * Service Worker 注册
   */
  registerServiceWorker() {
    return {
      scope: '/',
      cacheStrategies: {
        'api': 'network-first',
        'images': 'cache-first',
        'stylesheets': 'cache-first',
        'documents': 'network-first',
      },
      backgroundSync: {
        enabled: true,
        syncTags: ['sync-messages', 'sync-profile'],
      },
      pushNotifications: {
        enabled: true,
        vapidPublicKey: 'your_public_key',
      },
    };
  }

  /**
   * 后台同步管理
   */
  initSyncManager() {
    return {
      enabled: true,
      syncTags: {
        'sync-messages': { priority: 'high', retries: 3, timeout: 30000 },
        'sync-profile': { priority: 'medium', retries: 2, timeout: 60000 },
        'sync-media': { priority: 'low', retries: 1, timeout: 300000 },
      },
      onlineDetection: 'automatic',
      adaptiveSync: {
        enabled: true,
        powerSaving: true,
        connectionQuality: 'adaptive',
      },
    };
  }

  /**
   * App Shell 缓存
   */
  cacheAppShell() {
    return {
      resources: [
        '/index.html',
        '/app.js',
        '/app.css',
        '/manifest.json',
        '/icons/logo-192x192.png',
        '/icons/logo-512x512.png',
      ],
      strategy: 'precache-and-network',
      updateStrategy: 'background-sync',
      invalidationPeriod: 7 * 24 * 60 * 60 * 1000, // 7天
    };
  }

  /**
   * PWA 增强功能
   */
  enhancePWA() {
    return {
      manifest: {
        name: 'v信',
        shortName: 'vXin',
        description: '全功能社交应用',
        startUrl: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme: {
          primaryColor: '#007AFF',
          backgroundColor: '#FFFFFF',
        },
        screenshots: [
          { src: '/screenshots/1.png', sizes: '540x720', type: 'image/png' },
          { src: '/screenshots/2.png', sizes: '1080x1440', type: 'image/png' },
        ],
        categories: ['social', 'productivity'],
      },
      capabilities: {
        installable: true,
        responsive: true,
        workOffline: true,
        pushNotifications: true,
        backgroundSync: true,
        shareTarget: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'media', accept: ['image/*', 'video/*'] }],
          },
        },
      },
      performance: {
        firstContentfulPaint: '< 1s',
        timeToInteractive: '< 3s',
        lightenhouseScore: 95,
      },
    };
  }

  /**
   * 同步队列管理
   */
  queueForSync(action, data, priority = 'normal') {
    const item = {
      id: `sync_${Date.now()}`,
      action,
      data,
      priority,
      timestamp: Date.now(),
      status: 'queued',
      retries: 0,
    };
    this.syncQueue.push(item);
    return item;
  }

  /**
   * 离线指标
   */
  getOfflineMetrics() {
    return {
      cacheSize: this.calculateCacheSize(),
      syncQueueSize: this.syncQueue.length,
      pendingActions: this.syncQueue.filter(s => s.status === 'queued').length,
      failedActions: this.syncQueue.filter(s => s.status === 'failed').length,
      lastSyncTime: this.getLastSyncTime(),
      dataReadyForOffline: this.isDataReadyForOffline(),
    };
  }

  calculateCacheSize() {
    let size = 0;
    for (const [, value] of this.offlineDb) {
      size += JSON.stringify(value).length;
    }
    return size;
  }

  getLastSyncTime() {
    const completed = this.syncQueue.filter(s => s.status === 'completed');
    return completed.length > 0 ? completed[completed.length - 1].timestamp : null;
  }

  isDataReadyForOffline() {
    return this.offlineDb.size > 0 && this.syncQueue.length >= 0;
  }
}

module.exports = OfflinePWA;
