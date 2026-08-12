/**
 * P10.3: 并发控制优化
 */
class ConcurrencyControl {
  constructor(db) {
    this.db = db;
    this.writeQueues = new Map();
    this.readWriteLocks = new Map();
  }

  /**
   * 读写锁
   */
  async acquireReadLock(resource) {
    if (!this.readWriteLocks.has(resource)) {
      this.readWriteLocks.set(resource, { readers: 0, writers: 0, waitingWriters: 0 });
    }
    
    const lock = this.readWriteLocks.get(resource);
    while (lock.writers > 0 || lock.waitingWriters > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    lock.readers++;
    
    return {
      release: () => { lock.readers--; }
    };
  }

  /**
   * 写入队列
   */
  async queueWrite(resource, writeFunc) {
    if (!this.writeQueues.has(resource)) {
      this.writeQueues.set(resource, []);
    }
    
    const queue = this.writeQueues.get(resource);
    queue.push(writeFunc);
    
    if (queue.length === 1) {
      return this.processWriteQueue(resource);
    }
  }

  async processWriteQueue(resource) {
    const queue = this.writeQueues.get(resource);
    
    while (queue.length > 0) {
      const writeFunc = queue.shift();
      try {
        await writeFunc();
      } catch (e) {
        console.error('Write failed:', e);
      }
    }
  }

  /**
   * 分片写入
   */
  getShardId(key, shardCount = 16) {
    return Math.abs(require('crypto')
      .createHash('md5')
      .update(key)
      .digest('hex')
      .charCodeAt(0)) % shardCount;
  }

  /**
   * 并发性能报告
   */
  getConcurrencyReport() {
    const locks = {};
    for (const [resource, lock] of this.readWriteLocks.entries()) {
      locks[resource] = {
        activeReaders: lock.readers,
        activeWriters: lock.writers,
        waitingWriters: lock.waitingWriters,
      };
    }
    
    return locks;
  }
}

module.exports = ConcurrencyControl;
