'use strict';
/**
 * AI 助手入口列表：GET /api/config → features.aiAssistants
 * 数据来自 assistant.service BOTS 路由表 + users 表,与 .env botId 联动。
 * 测试库可能无 bot 账号行 → username 回退 name,字段结构必须齐全。
 */
const { request, app } = require('./helpers');

describe('AI 助手入口列表', () => {
  test('GET /api/config 返回 features.aiAssistants 数组(结构完整)', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    const list = res.body.features?.aiAssistants;
    expect(Array.isArray(list)).toBe(true);
    for (const b of list) {
      expect(typeof b.id).toBe('string');
      expect(b.id.length).toBeGreaterThan(0);
      expect(typeof b.name).toBe('string');
      expect(typeof b.provider).toBe('string');
      expect(typeof b.username).toBe('string');
      expect(typeof b.wechat_id).toBe('string');
      expect(typeof b.avatar).toBe('string');
      expect(['openclaw', 'hermes']).toContain(b.provider);
    }
  });
});
