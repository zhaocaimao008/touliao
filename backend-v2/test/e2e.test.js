'use strict';
/**
 * E2E 集成测试 —— 端到端业务流程（对齐当前真实 API）。
 * 覆盖：注册/登录/鉴权 → 加好友 → 私聊收发/已读 → 搜索 → 群组 → 消息编辑/表情/撤回
 *       → 钱包充值/红包发领 → 错误处理。
 * 全程 Bearer token 鉴权（免 CSRF），隔离测试库，限流已关（见 testEnv.js）。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');

describe('v信 后端 E2E 集成测试', () => {
  let u1, u2;
  let conversationId, groupId, messageId;

  beforeAll(async () => {
    u1 = await makeUser({ username: 'e2e_user1' });
    u2 = await makeUser({ username: 'e2e_user2' });
  });

  describe('用户认证流程', () => {
    test('注册返回 token 与 user', () => {
      expect(u1.token).toBeTruthy();
      expect(u1.userId).toBeTruthy();
    });

    test('登录成功', async () => {
      const res = await request(app).post('/api/auth/login')
        .send({ phone: u1.phone, password: u1.password });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.id).toBe(u1.userId);
    });

    test('错误密码登录 400', async () => {
      const res = await request(app).post('/api/auth/login')
        .send({ phone: u1.phone, password: 'wrong-password-1' });
      expect(res.status).toBe(400);
    });

    test('获取当前用户信息', async () => {
      const res = await request(app).get('/api/auth/me')
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(u1.userId);
    });
  });

  describe('好友与私聊', () => {
    test('加为好友后建立私聊会话', async () => {
      await befriend(u1, u2);
      conversationId = await privateConversation(u1, u2);
      expect(conversationId).toBeTruthy();
    });

    test('用户1发送消息', async () => {
      const res = await request(app).post(`/api/messages/${conversationId}`)
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ content: '你好，这是一条测试消息', type: 'text' });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('你好，这是一条测试消息');
      expect(res.body.sender_id).toBe(u1.userId);
      messageId = res.body.id;
    });

    test('获取消息历史（数组）', async () => {
      const res = await request(app).get(`/api/messages/${conversationId}?limit=20`)
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some(m => m.content.includes('测试消息'))).toBe(true);
    });

    test('非法游标 before 回退到最近消息（不返回空）', async () => {
      const res = await request(app).get(`/api/messages/${conversationId}?before=notanumber`)
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0); // 非法游标不应把历史吞空
    });

    test('用户2可见该会话消息', async () => {
      const res = await request(app).get(`/api/messages/${conversationId}?limit=20`)
        .set('Authorization', `Bearer ${u2.token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('用户2标记已读', async () => {
      const res = await request(app).post(`/api/messages/conversation/${conversationId}/read`)
        .set('Authorization', `Bearer ${u2.token}`).send({});
      expect(res.status).toBe(200);
    });
  });

  describe('搜索', () => {
    test('全局搜索返回 { results, total } 信封', async () => {
      const res = await request(app).get('/api/messages/search?q=测试')
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('results');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.results)).toBe(true);
    });

    test('会话内搜索返回数组', async () => {
      const res = await request(app).get(`/api/messages/conversation/${conversationId}/search?q=测试`)
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('搜索无结果时 results 为空', async () => {
      const res = await request(app).get('/api/messages/search?q=绝不存在的关键词zzz')
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBe(0);
    });
  });

  describe('群组', () => {
    test('创建群组（含好友 u2）', async () => {
      const res = await request(app).post('/api/messages/conversation/group')
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ name: 'E2E 测试群组', memberIds: [u2.userId] });
      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBeTruthy();
      groupId = res.body.conversationId;
    });

    test('群信息', async () => {
      const res = await request(app).get(`/api/messages/conversation/${groupId}/info`)
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('E2E 测试群组');
      expect(res.body.type).toBe('group');
    });

    test('群成员含群主与 u2', async () => {
      const res = await request(app).get(`/api/messages/conversation/${groupId}/members`)
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    test('群内发消息', async () => {
      const res = await request(app).post(`/api/messages/${groupId}`)
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ content: '这是群组内的测试消息', type: 'text' });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('这是群组内的测试消息');
    });
  });

  describe('消息操作', () => {
    let opMsgId;
    test('发送待操作消息', async () => {
      const res = await request(app).post(`/api/messages/${conversationId}`)
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ content: '这条消息将被编辑', type: 'text' });
      expect(res.status).toBe(200);
      opMsgId = res.body.id;
    });

    test('编辑消息', async () => {
      const res = await request(app).put(`/api/messages/${opMsgId}/edit`)
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ content: '这条消息已被编辑' });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('这条消息已被编辑');
    });

    test('表情反应返回 { reactions }', async () => {
      const res = await request(app).post(`/api/messages/${opMsgId}/react`)
        .set('Authorization', `Bearer ${u2.token}`)
        .send({ emoji: '👍' });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.reactions)).toBe(true);
    });

    test('撤回消息', async () => {
      const res = await request(app).delete(`/api/messages/${opMsgId}`)
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ forEveryone: true });
      expect(res.status).toBe(200);
    });
  });

  describe('钱包与红包', () => {
    // 充值接口目前为禁用占位（未接支付网关），返回 503；红包测试直接为发送者入账。
    const wallet = require('../src/modules/wallet/wallet.service');

    test('充值接口暂未开放（503 占位）', async () => {
      const res = await request(app).post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ amount: 100 });
      expect(res.status).toBe(503);
    });

    test('查询余额', async () => {
      wallet.applyDelta(u1.userId, 1000, 'test_seed', null, '测试入账');
      const res = await request(app).get('/api/wallet')
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(200);
      expect(res.body.balance).toBeGreaterThanOrEqual(1000);
    });

    test('发红包并被领取', async () => {
      const sendRes = await request(app).post('/api/messages/red-packet/send')
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ conversationId, totalAmount: 10, totalCount: 1, greeting: '恭喜' });
      expect(sendRes.status).toBe(200);
      expect(sendRes.body.packetId).toBeTruthy();

      const claimRes = await request(app).post(`/api/messages/red-packet/${sendRes.body.packetId}/claim`)
        .set('Authorization', `Bearer ${u2.token}`).send({});
      expect(claimRes.status).toBe(200);
      expect(claimRes.body.amount).toBe(10);
    });

    test('发红包者不能领自己的红包', async () => {
      const sendRes = await request(app).post('/api/messages/red-packet/send')
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ conversationId, totalAmount: 5, totalCount: 1 });
      const claimRes = await request(app).post(`/api/messages/red-packet/${sendRes.body.packetId}/claim`)
        .set('Authorization', `Bearer ${u1.token}`).send({});
      expect(claimRes.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('错误处理', () => {
    test('未授权访问 401', async () => {
      const res = await request(app).get('/api/messages/conversations');
      expect(res.status).toBe(401);
    });

    test('无效 token 401', async () => {
      const res = await request(app).get('/api/messages/conversations')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
    });

    test('非成员访问会话 403', async () => {
      const res = await request(app).get('/api/messages/nonexistent-conv-id')
        .set('Authorization', `Bearer ${u1.token}`);
      expect(res.status).toBe(403);
    });

    test('发送空消息 400', async () => {
      const res = await request(app).post(`/api/messages/${conversationId}`)
        .set('Authorization', `Bearer ${u1.token}`)
        .send({ content: '', type: 'text' });
      expect(res.status).toBe(400);
    });
  });
});
