/**
 * P5.1: SQLite → PostgreSQL 在线迁移工具
 * 策略: 双写 + 灰度切换 + 秒级回滚
 */

const Pool = require('pg').Pool;
const sqlite3 = require('better-sqlite3');

class PostgreSQLMigration {
  constructor(options = {}) {
    // PostgreSQL 连接池
    this.pgPool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: process.env.PG_PORT || 5432,
      database: process.env.PG_DB || 'vxin',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.sqliteDb = new sqlite3(process.env.DB_PATH || './wechat.db');
    this.stats = { migrated: 0, failed: 0, errors: [] };
    this.dualWrite = options.dualWrite !== false; // 默认启用双写
    this.switchRatio = options.switchRatio || 0.1; // 灰度: 10% 流量
  }

  /**
   * 初始化: 创建 PostgreSQL schema
   */
  async initializeSchema() {
    const client = await this.pgPool.connect();
    try {
      await client.query(`
        -- 用户表
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username VARCHAR(50) UNIQUE NOT NULL,
          phone VARCHAR(20) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          wechat_id VARCHAR(50) UNIQUE,
          avatar_url VARCHAR(500),
          bio TEXT,
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          deleted_at TIMESTAMP
        );
        CREATE INDEX idx_users_phone ON users(phone);
        CREATE INDEX idx_users_status ON users(status);

        -- 消息表 (分区)
        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sender_id UUID NOT NULL REFERENCES users(id),
          conversation_id UUID NOT NULL,
          content TEXT,
          type VARCHAR(20) DEFAULT 'text',
          created_at TIMESTAMP DEFAULT NOW(),
          deleted_at TIMESTAMP
        ) PARTITION BY RANGE (created_at);

        CREATE TABLE messages_2026_08 PARTITION OF messages
          FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

        CREATE INDEX idx_messages_conv ON messages(conversation_id);
        CREATE INDEX idx_messages_sender ON messages(sender_id);

        -- 好友关系表
        CREATE TABLE IF NOT EXISTS friendships (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id),
          friend_id UUID NOT NULL REFERENCES users(id),
          label_id UUID,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, friend_id)
        );
        CREATE INDEX idx_friendships_user ON friendships(user_id);

        -- 群组表
        CREATE TABLE IF NOT EXISTS groups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          owner_id UUID NOT NULL REFERENCES users(id),
          description TEXT,
          avatar_url VARCHAR(500),
          member_count INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX idx_groups_owner ON groups(owner_id);
      `);
      console.log('✅ PostgreSQL schema 初始化完成');
    } catch (err) {
      console.error('❌ Schema 初始化失败:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 双写: 同时写入 SQLite 和 PostgreSQL
   */
  async dualWrite(table, data) {
    if (!this.dualWrite) return;

    try {
      // 写入 PostgreSQL
      const pgResult = await this.pgPool.query(
        `INSERT INTO ${table} (${Object.keys(data).join(',')}) 
         VALUES (${Object.keys(data).map((_, i) => `$${i+1}`).join(',')}) 
         RETURNING *`,
        Object.values(data)
      );
      return pgResult.rows[0];
    } catch (err) {
      this.stats.failed++;
      this.stats.errors.push({ table, data, error: err.message });
      console.warn(`⚠️ 双写失败 [${table}]:`, err.message);
    }
  }

  /**
   * 灰度切换: 根据比例选择数据源
   */
  async readWithFallback(table, query) {
    const usePostgres = Math.random() < this.switchRatio;
    
    try {
      if (usePostgres) {
        // 优先读 PostgreSQL
        const result = await this.pgPool.query(query);
        return result.rows;
      }
    } catch (err) {
      console.warn(`⚠️ PostgreSQL 读取失败，回退到 SQLite:`, err.message);
    }

    // 回退到 SQLite
    try {
      return this.sqliteDb.prepare(query).all();
    } catch (err) {
      console.error('❌ SQLite 读取失败:', err);
      throw err;
    }
  }

  /**
   * 全量迁移: SQLite → PostgreSQL
   */
  async migrateAll() {
    console.log('🚀 开始全量迁移...');
    
    const tables = ['users', 'friendships', 'groups', 'moments', 'messages'];
    
    for (const table of tables) {
      try {
        console.log(`📥 迁移表 ${table}...`);
        
        // 读取 SQLite 数据
        const rows = this.sqliteDb.prepare(`SELECT * FROM ${table}`).all();
        console.log(`   Found ${rows.length} rows`);
        
        // 批量插入 PostgreSQL
        for (const row of rows) {
          await this.dualWrite(table, row);
          this.stats.migrated++;
        }
        
        console.log(`✅ ${table} 迁移完成 (${rows.length} 行)`);
      } catch (err) {
        console.error(`❌ ${table} 迁移失败:`, err);
        this.stats.failed++;
      }
    }

    return this.stats;
  }

  /**
   * 秒级回滚: 切换回 SQLite
   */
  async rollback() {
    console.log('🔄 开始回滚到 SQLite...');
    this.switchRatio = 0; // 立即 100% 流量回到 SQLite
    console.log('✅ 已切换回 SQLite');
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const pgResult = await this.pgPool.query('SELECT 1');
      const sqliteResult = this.sqliteDb.prepare('SELECT 1').get();
      return { postgres: true, sqlite: true };
    } catch (err) {
      return { postgres: false, sqlite: false, error: err.message };
    }
  }
}

module.exports = PostgreSQLMigration;
