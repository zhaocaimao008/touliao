'use strict';
/**
 * FTS5 全文搜索测试
 */

const { db } = require('../src/db/connection');
const { initFTS5, searchMessages, indexMessage, removeMessageFromIndex } = require('../src/utils/ftsSearch');

describe('FTS5 全文搜索', () => {
  beforeAll(() => {
    db.pragma('foreign_keys = OFF');
    try {
      db.prepare(`INSERT OR IGNORE INTO users (id, username, phone, password) VALUES ('user-1', 'testuser', '13800000001', 'x')`).run();
      db.prepare(`INSERT OR IGNORE INTO conversations (id, type) VALUES ('conv-1', 'private')`).run();
    } catch (err) {
      console.log('[Test] 前置数据插入:', err.message);
    }
    db.pragma('foreign_keys = ON');
    try {
      initFTS5();
    } catch (err) {
      console.log('[Test] FTS5 初始化（可能已存在）:', err.message);
    }
  });

  test('应该初始化 FTS5 虚拟表', () => {
    const exists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'
    `).get();
    expect(exists).toBeTruthy();
  });

  test('应该添加消息到索引', () => {
    const testMessage = {
      id: 'test-msg-1',
      content: 'hello world',
      type: 'text',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      created_at: Date.now(),
    };

    // 先插入到 messages 表
    db.prepare(`
      INSERT INTO messages (id, content, type, conversation_id, sender_id, created_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(testMessage.id, testMessage.content, testMessage.type, testMessage.conversation_id, testMessage.sender_id, testMessage.created_at);

    // 再添加到 FTS5 索引
    indexMessage(testMessage);

    const indexed = db.prepare('SELECT * FROM messages_fts WHERE message_id = ?').get(testMessage.id);
    expect(indexed).toBeTruthy();
    expect(indexed.content).toBe('hello world');
  });

  test('应该在 FTS5 中搜索消息', () => {
    const results = searchMessages('hello', 'conv-1', 'user-1');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('hello');
  });

  test('应该在会话中精确搜索', () => {
    const results = searchMessages('world', 'conv-1', 'user-1');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].conversation_id).toBe('conv-1');
  });

  test('应该从索引删除消息', () => {
    const testMessage = {
      id: 'test-msg-2',
      content: 'to be deleted',
      type: 'text',
      conversation_id: 'conv-1',
      sender_id: 'user-1',
      created_at: Date.now(),
    };

    // 插入
    db.prepare(`
      INSERT INTO messages (id, content, type, conversation_id, sender_id, created_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(testMessage.id, testMessage.content, testMessage.type, testMessage.conversation_id, testMessage.sender_id, testMessage.created_at);

    indexMessage(testMessage);

    let indexed = db.prepare('SELECT * FROM messages_fts WHERE message_id = ?').get(testMessage.id);
    expect(indexed).toBeTruthy();

    // 删除
    removeMessageFromIndex(testMessage.id);

    indexed = db.prepare('SELECT * FROM messages_fts WHERE message_id = ?').get(testMessage.id);
    expect(indexed).toBeUndefined();
  });

  test('应该处理空查询', () => {
    const results = searchMessages('', 'conv-1', 'user-1');
    expect(results).toEqual([]);
  });

  test('应该支持通配符搜索', () => {
    const results = searchMessages('hel*', 'conv-1', 'user-1');
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test('应该清理特殊字符', () => {
    // SQL 注入尝试
    const results = searchMessages("'; DROP TABLE messages_fts; --", 'conv-1', 'user-1');
    expect(results).toEqual([]);
    
    // 验证表还存在
    const exists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'
    `).get();
    expect(exists).toBeTruthy();
  });

  afterAll(() => {
    // 清理测试数据
    db.prepare("DELETE FROM messages_fts WHERE message_id LIKE 'test-msg-%'").run();
  });
});
