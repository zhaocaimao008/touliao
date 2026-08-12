/**
 * P9.2: 离线优先架构
 * 基于 Service Worker + IndexedDB 的离线优先同步
 */

class OfflineFirstSync {
  constructor() {
    this.queue = [];
    this.synced = new Map();
    this.conflictResolver = new Map();
  }

  /**
   * 排队操作 (离线时)
   */
  queueOperation(op) {
    this.queue.push({
      id: this.generateId(),
      operation: op,
      timestamp: Date.now(),
      synced: false,
    });
    return this.queue.length;
  }

  /**
   * 同步到服务器
   */
  async syncToServer(endpoint) {
    if (this.queue.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const item of this.queue) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify(item.operation),
        });

        if (response.ok) {
          item.synced = true;
          synced++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
      }
    }

    // 清理已同步的项
    this.queue = this.queue.filter(item => !item.synced);

    return { synced, failed, pending: this.queue.length };
  }

  /**
   * 检测冲突
   */
  detectConflict(localOp, serverOp) {
    return localOp.id === serverOp.id && 
           localOp.timestamp !== serverOp.timestamp;
  }

  /**
   * 解决冲突 (最后写入者获胜)
   */
  resolveConflict(localOp, serverOp) {
    return serverOp.timestamp > localOp.timestamp ? serverOp : localOp;
  }

  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }
}

module.exports = OfflineFirstSync;
