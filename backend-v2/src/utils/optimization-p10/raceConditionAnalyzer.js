/**
 * P10.2: 竞态条件分析与防护
 * 检测数据不一致、脏读、双重写入
 */

class RaceConditionAnalyzer {
  constructor(db) {
    this.db = db;
    this.transactions = new Map();
    this.locks = new Map();
    this.conflicts = [];
  }

  /**
   * 乐观锁实现
   */
  async optimisticLockRead(table, id) {
    const result = await this.db.prepare(
      `SELECT *, version FROM ${table} WHERE id = ?`
    ).get(id);
    
    return {
      data: result,
      version: result?.version || 0,
    };
  }

  /**
   * 乐观锁更新（版本检查）
   */
  async optimisticLockUpdate(table, id, data, expectedVersion) {
    try {
      const result = await this.db.prepare(`
        UPDATE ${table} 
        SET ${Object.keys(data).map(k => `${k} = ?`).join(', ')}, version = version + 1
        WHERE id = ? AND version = ?
      `).run(...Object.values(data), id, expectedVersion);
      
      if (result.changes === 0) {
        this.conflicts.push({
          table,
          id,
          timestamp: Date.now(),
          reason: 'version_mismatch',
        });
        return { success: false, conflict: true };
      }
      
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 分布式锁
   */
  async acquireDistributedLock(resource, ttl = 5000) {
    const lockId = `lock:${resource}:${Date.now()}:${Math.random()}`;
    
    // 非阻塞式获取锁
    if (this.locks.has(resource)) {
      return { acquired: false, lockId: null };
    }
    
    this.locks.set(resource, {
      lockId,
      acquiredAt: Date.now(),
      ttl,
    });
    
    // 自动释放
    setTimeout(() => this.releaseLock(resource), ttl);
    
    return { acquired: true, lockId };
  }

  /**
   * 释放锁
   */
  releaseLock(resource) {
    this.locks.delete(resource);
  }

  /**
   * 事务隔离级别设置
   */
  async setIsolationLevel(level = 'SERIALIZABLE') {
    // SQLite 支持的隔离级别
    const validLevels = ['SERIALIZABLE', 'REPEATABLE_READ', 'READ_COMMITTED'];
    
    if (!validLevels.includes(level)) {
      return { error: 'Invalid isolation level' };
    }
    
    // SQLite 默认为 SERIALIZABLE，通过 PRAGMA 控制
    await this.db.prepare(`PRAGMA read_uncommitted = ${level === 'READ_COMMITTED' ? 1 : 0}`).run();
    
    return { success: true, level };
  }

  /**
   * 检测并发冲突
   */
  getConflictReport(minutes = 10) {
    const cutoff = Date.now() - minutes * 60 * 1000;
    const recentConflicts = this.conflicts.filter(c => c.timestamp > cutoff);
    
    return {
      totalConflicts: recentConflicts.length,
      byTable: Array.from(new Set(recentConflicts.map(c => c.table))).length,
      conflictRate: recentConflicts.length > 0 
        ? `${(recentConflicts.length / (minutes * 6)).toFixed(2)} conflicts/min`
        : '0',
    };
  }
}

module.exports = RaceConditionAnalyzer;
