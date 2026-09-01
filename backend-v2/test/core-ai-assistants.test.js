'use strict';
/**
 * AI 助手入口列表：GET /api/config → features.aiAssistants
 * 数据来自 assistant.service BOTS 路由表 + users 表,与 .env botId 联动。
 * 测试库可能无 bot 账号行 → username 回退 name,字段结构必须齐全。
 */
const { request, app } = require('./helpers');
const { db } = require('../src/db/connection');
const config = require('../src/config');

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

  test('与 AI 助手(bot)建私聊免好友(通讯录入口点卡片即进会话)', async () => {
    const botId = config.ai?.hermesBotId || config.ai?.botId;
    if (!botId) { console.warn('测试环境未配置 botId,跳过'); return; }
    // 测试库需先存在该 bot 用户行(getOrCreatePrivate 会校验用户存在性)
    db.prepare("INSERT OR IGNORE INTO users (id,username,phone,password,wechat_id,invite_code) VALUES (?,?,?,?,?,?)")
      .run(botId, 'Hermes', '+86 13900000000', 'x', '416603', '123456');

    const { makeUser } = require('./helpers');
    const u = await makeUser({ username: 'ai_bot_conv' });
    const res = await request(app)
      .post('/api/messages/conversation/private')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ userId: botId });
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBeTruthy();
  });

  test('与普通用户建私聊仍需先加好友(非 bot 不放行)', async () => {
    const { makeUser } = require('./helpers');
    const a = await makeUser({ username: 'ai_norm_a' });
    const b = await makeUser({ username: 'ai_norm_b' });
    const res = await request(app)
      .post('/api/messages/conversation/private')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ userId: b.userId });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/先添加对方为好友/);
  });
});
