'use strict';
/**
 * F1 功能批（2026-09-05，8.1.16）后端 8 项验收测试：
 *   #1 朋友圈发视频（video/cover 字段 + 上传 + 互斥校验 + 列表透出）
 *   #2 合并转发 merged 消息类型（透传 + 长度放宽 + 撤回一致 + 实时广播）
 *   #3 群邀请链接（同群复用 token + join + 过期/黑名单）
 *   #4 已读状态查询 GET read-states（私聊 message_reads + 群聊 last_read_at）
 *   #5 会话归档（archived 标志 + 列表过滤 + 未读不聚合 + 退群清理）
 *   #6 加好友验证流程（申请列表/同意/拒绝 + requireVerify 设置 + 拉黑拒绝）
 *   #7 群主转让（旧主降 admin、新主接管 owner-only 权限）
 *   #8 消息搜索分类筛选（type/from/to/senderId，向后兼容）
 */
require('./testEnv');
const http = require('http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');
const request = require('supertest');
const app = require('../src/app');
const setupRealtime = require('../src/realtime');
const { db } = require('../src/db/connection');
const { makeUser, befriend, privateConversation } = require('./helpers');

// 最小合法 MP4（ftyp/isom box，过 file-type 魔数识别）与 1x1 PNG
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftyp'),
  Buffer.from('isom'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isomiso2'),
]);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let server, io, baseUrl;

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioc(baseUrl, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 2000,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
// 收一条（合并广播下单条是 new_message、多条合并成 new_message_batch 数组）
function nextMessage(socket) {
  return new Promise(resolve => {
    const onSingle = d => finish([d]);
    const onBatch = arr => finish(arr);
    const finish = msgs => {
      socket.off('new_message', onSingle);
      socket.off('new_message_batch', onBatch);
      resolve(msgs);
    };
    socket.on('new_message', onSingle);
    socket.on('new_message_batch', onBatch);
  });
}
const authOf = u => ({ Authorization: `Bearer ${u.token}` });

// markRead 的 conversation_settings 写入经 worker 异步落库（最终一致，毫秒级），
// read-states 断言前轮询等待，避免与写队列竞态
async function pollReadStates(user, convId, msgId, expectUid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await request(app)
      .get(`/api/messages/conversation/${convId}/read-states?msgIds=${msgId}`)
      .set(authOf(user));
    if (last.status === 200 && (last.body.readStates[msgId] || []).includes(expectUid)) return last;
    await new Promise(r => setTimeout(r, 50));
  }
  return last;
}

beforeAll(async () => {
  server = http.createServer(app);
  io = new Server(server, { transports: ['websocket'], cors: { origin: '*' } });
  app.set('io', io);
  setupRealtime(io, app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise(r => io.close(r));
  await new Promise(r => server.close(r));
});

// ── #1 朋友圈发视频 ────────────────────────────────────────────────
describe('#1 朋友圈发视频', () => {
  let a, b;

  test('上传视频+封面 → 发视频动态 → DB 落 video/cover，好友时间线透出', async () => {
    a = await makeUser({ username: 'f1_mv_a' });
    b = await makeUser({ username: 'f1_mv_b' });
    await befriend(a, b);

    const up = await request(app).post('/api/moments/video').set(authOf(a)).attach('video', MP4, 'v.mp4');
    expect(up.status).toBe(200);
    expect(up.body.url).toMatch(/^\/uploads\/moments\/[\w-]+\.\w+$/);

    const cov = await request(app).post('/api/moments/images').set(authOf(a)).attach('images', PNG, 'c.png');
    expect(cov.status).toBe(200);

    const create = await request(app).post('/api/moments')
      .set(authOf(a)).send({ content: '视频动态', video: up.body.url, cover: cov.body.urls[0] });
    expect(create.status).toBe(200);
    expect(create.body.video).toBe(up.body.url);
    expect(create.body.cover).toBe(cov.body.urls[0]);
    expect(create.body.images).toEqual([]);

    const row = db.prepare('SELECT video, cover FROM moments WHERE id=?').get(create.body.id);
    expect(row.video).toBe(up.body.url);
    expect(row.cover).toBe(cov.body.urls[0]);

    // 好友时间线原样透出 video 字段（老客户端多字段无害）
    const tl = await request(app).get('/api/moments').set(authOf(b));
    const mine = tl.body.find(m => m.id === create.body.id);
    expect(mine && mine.video).toBe(up.body.url);
  });

  test('纯图文动态老行为不变（video/cover 恒空串）', async () => {
    const plain = await request(app).post('/api/moments').set(authOf(a)).send({ content: '纯图文' });
    expect(plain.status).toBe(200);
    expect(plain.body.video).toBe('');
    expect(plain.body.cover).toBe('');
  });

  test('校验：视频与图片互斥 / 非白名单 URL / 伪装视频被魔数拒绝', async () => {
    const up = await request(app).post('/api/moments/video').set(authOf(a)).attach('video', MP4, 'v.mp4');
    const mixed = await request(app).post('/api/moments')
      .set(authOf(a)).send({ video: up.body.url, images: ['/uploads/moments/x.png'] });
    expect(mixed.status).toBe(400);

    const badUrl = await request(app).post('/api/moments')
      .set(authOf(a)).send({ video: 'http://evil.example/x.mp4' });
    expect(badUrl.status).toBe(400);

    // 伪装视频（文本内容 + .mp4 扩展名 + 浏览器会带的 video/mp4 声明）被魔数拒绝
    const fake = await request(app).post('/api/moments/video')
      .set(authOf(a)).attach('video', Buffer.from('plain text not a video'), { filename: 'fake.mp4', contentType: 'video/mp4' });
    expect(fake.status).toBe(400);
  });
});

// ── #2 合并转发 merged ─────────────────────────────────────────────
describe('#2 合并转发 merged', () => {
  let a, b, convId;

  beforeAll(async () => {
    a = await makeUser({ username: 'f1_mg_a' });
    b = await makeUser({ username: 'f1_mg_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
  });

  test('HTTP 发送 type=merged → 对方 history 收到原文；socket 实时收到', async () => {
    const payload = {
      title: '聊天记录',
      items: [
        { mid: 'm1', type: 'text', sender: a.userId, senderName: 'A', text: '第一条', snippet: '第一条', ts: 1757000000 },
        { mid: 'm2', type: 'image', sender: b.userId, senderName: 'B', text: '', snippet: '[图片]', ts: 1757000001 },
      ],
    };
    const sb = await connect(b.token);
    try {
      const pending = nextMessage(sb);
      const sent = await request(app).post(`/api/messages/${convId}`)
        .set(authOf(a)).send({ type: 'merged', content: JSON.stringify(payload) });
      expect(sent.status).toBe(200);
      expect(sent.body.type).toBe('merged');
      expect(sent.body.content).toBe(JSON.stringify(payload));

      const batch = await Promise.race([
        pending,
        new Promise((_, rej) => setTimeout(() => rej(new Error('socket 超时未收到 merged 消息')), 4000)),
      ]);
      const live = batch.find(m => m.id === sent.body.id);
      expect(live && live.type).toBe('merged');
      expect(live.content).toBe(JSON.stringify(payload));

      const h = await request(app).get(`/api/messages/${convId}`).set(authOf(b));
      const inHistory = h.body.find(x => x.id === sent.body.id);
      expect(inHistory.content).toBe(JSON.stringify(payload));
    } finally {
      sb.close();
    }
  });

  test('撤回对 merged 与普通文本一致', async () => {
    const sent = await request(app).post(`/api/messages/${convId}`)
      .set(authOf(a)).send({ type: 'merged', content: JSON.stringify({ title: 't', items: [] }) });
    const del = await request(app).delete(`/api/messages/${sent.body.id}`)
      .set(authOf(a)).send({ forEveryone: true });
    expect(del.status).toBe(200);
    const h = await request(app).get(`/api/messages/${convId}`).set(authOf(b));
    expect(h.body.find(x => x.id === sent.body.id)).toBeUndefined();
  });

  test('长度上限：merged 放宽到 20000，超出拒绝；text 仍是 2000', async () => {
    const ok = await request(app).post(`/api/messages/${convId}`)
      .set(authOf(a)).send({ type: 'merged', content: 'x'.repeat(20000) });
    expect(ok.status).toBe(200);
    const tooBig = await request(app).post(`/api/messages/${convId}`)
      .set(authOf(a)).send({ type: 'merged', content: 'x'.repeat(20001) });
    expect(tooBig.status).toBe(400);
    const textTooBig = await request(app).post(`/api/messages/${convId}`)
      .set(authOf(a)).send({ type: 'text', content: 'x'.repeat(2001) });
    expect(textTooBig.status).toBe(400);
  });
});

// ── #3 群邀请链接 ──────────────────────────────────────────────────
describe('#3 群邀请链接', () => {
  let owner, m1, outsider, blocked, convId, token;

  beforeAll(async () => {
    owner = await makeUser({ username: 'f1_il_o' });
    m1 = await makeUser({ username: 'f1_il_m' });
    outsider = await makeUser({ username: 'f1_il_x' });
    blocked = await makeUser({ username: 'f1_il_b' });
    await befriend(owner, m1);
    const g = await request(app).post('/api/messages/conversation/group')
      .set(authOf(owner)).send({ name: 'F1邀请链接群', memberIds: [m1.userId] });
    convId = g.body.conversationId;
  });

  test('群主生成 invite-link：base64url token、7 天有效期、同群复用同一 token', async () => {
    const r1 = await request(app).post(`/api/messages/conversation/${convId}/invite-link`).set(authOf(owner));
    expect(r1.status).toBe(200);
    token = r1.body.token;
    expect(token).toMatch(/^[\w-]{22}$/);              // 16 字节 base64url = 22 字符
    expect(r1.body.link).toContain(`/join/${token}`);  // 规格字段 link
    expect(r1.body.url).toContain(token);              // 老字段 url 兼容
    expect(r1.body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 6.5 * 86400);

    const r2 = await request(app).post(`/api/messages/conversation/${convId}/invite-link`).set(authOf(owner));
    expect(r2.body.token).toBe(token);                 // 有效期内复用
  });

  test('次号 join → 入群成功、双方收到 group_updated；重复 join 幂等 alreadyMember 且带群信息', async () => {
    const so = await connect(owner.token);
    const sx = await connect(outsider.token);
    try {
      const pendingGroupUpdated = new Promise(resolve => {
        let n = 0;
        const done = () => { if (++n === 2) resolve(true); };
        so.on('group_updated', d => d.id === convId && done());
        sx.on('group_updated', d => d.id === convId && done());
      });
      const join = await request(app).post(`/api/messages/join/${token}`).set(authOf(outsider));
      expect(join.status).toBe(200);
      expect(join.body.success).toBe(true);
      expect(join.body.conversationId).toBe(convId);
      expect(join.body.conversation.name).toBe('F1邀请链接群');
      await Promise.race([
        pendingGroupUpdated,
        new Promise((_, rej) => setTimeout(() => rej(new Error('未收到 group_updated')), 4000)),
      ]);

      const again = await request(app).post(`/api/messages/join/${token}`).set(authOf(outsider));
      expect(again.status).toBe(200);
      expect(again.body.alreadyMember).toBe(true);
      expect(again.body.conversation.id).toBe(convId);
      const memberRow = db.prepare(
        'SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?'
      ).get(convId, outsider.userId);
      expect(memberRow.role).toBe('member');
    } finally {
      so.close(); sx.close();
    }
  });

  test('过期 token → 404 明确错误', async () => {
    db.prepare('UPDATE group_invite_tokens SET expires_at=? WHERE token=?')
      .run(Math.floor(Date.now() / 1000) - 1, token);
    const r = await request(app).post(`/api/messages/join/${token}`).set(authOf(m1));
    expect(r.status).toBe(404);
    expect(r.body.error).toContain('过期');
  });

  test('被群主拉黑的账号 join → 403 明确错误', async () => {
    // 重新生成一个有效 token（上一个已过期）
    const link = await request(app).post(`/api/messages/conversation/${convId}/invite-link`).set(authOf(owner));
    const fresh = link.body.token;
    await request(app).post('/api/users/contacts/block/' + blocked.userId) // 若路由不同见下方 fallback
      .set(authOf(owner)).catch(() => {});
    // 直接写库保证拉黑关系成立（block 端点路径以 contacts.routes 为准，这里不依赖它）
    db.prepare('INSERT OR IGNORE INTO blocked_users (id, user_id, blocked_id) VALUES (?, ?, ?)')
      .run(`f1blk-${Date.now()}`, owner.userId, blocked.userId);
    const r = await request(app).post(`/api/messages/join/${fresh}`).set(authOf(blocked));
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('拉黑');
  });
});

// ── #4 已读状态查询 ────────────────────────────────────────────────
describe('#4 已读状态查询 read-states', () => {
  let a, b, convId, m1, m2;

  beforeAll(async () => {
    a = await makeUser({ username: 'f1_rs_a' });
    b = await makeUser({ username: 'f1_rs_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
    const s1 = await request(app).post(`/api/messages/${convId}`).set(authOf(a)).send({ content: 'rs-1' });
    const s2 = await request(app).post(`/api/messages/${convId}`).set(authOf(a)).send({ content: 'rs-2' });
    m1 = s1.body.id; m2 = s2.body.id;
  });

  test('B 读到 m2 → A 查 read-states：m1/m2 均含 B（私聊 message_reads+水位兜底）', async () => {
    const read = await request(app).post(`/api/messages/conversation/${convId}/read`)
      .set(authOf(b)).send({ messageId: m2 });
    expect(read.status).toBe(200);

    await pollReadStates(a, convId, m1, b.userId);
    const rs = await request(app)
      .get(`/api/messages/conversation/${convId}/read-states?msgIds=${m1},${m2}`)
      .set(authOf(a));
    expect(rs.status).toBe(200);
    expect(rs.body.readStates[m1]).toContain(b.userId);
    expect(rs.body.readStates[m2]).toContain(b.userId);
  });

  // Q10 全修：markRead 原来把 message_reads 回填条件写成 `id <= readMsgId`——id 是
  // uuidv4，字典序跟发送顺序毫无关系。这里直接插两条 id 顺序被"反着"排的消息
  // （复现审计报告原文："M1 ID 以 8 开头、时间 300；M2 ID 以 1 开头、时间 400"），
  // 标记较早的 m1 已读后，字典序更小、但实际更晚发送/未读的 m2 绝不能被一起标已读。
  test('Q10 UUID 字典序不能冒充已读边界：标记较早消息已读不会误标字典序更小的更晚消息', async () => {
    const olderId = '80000000-0000-4000-8000-000000000001'; // 以 '8' 开头，字典序大
    const newerId = '10000000-0000-4000-8000-000000000002'; // 以 '1' 开头，字典序小，但真实发送更晚
    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at)
      VALUES (?, ?, ?, 'text', ?, ?)`).run(olderId, convId, a.userId, 'q10-older', 300);
    db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at)
      VALUES (?, ?, ?, 'text', ?, ?)`).run(newerId, convId, a.userId, 'q10-newer', 400);

    const read = await request(app).post(`/api/messages/conversation/${convId}/read`)
      .set(authOf(b)).send({ messageId: olderId });
    expect(read.status).toBe(200);

    // message_reads 是 markRead 内同步写的（不像 conversation_settings 走 worker），
    // 不需要轮询；直接查表验证只有 olderId 被回填。
    const readRows = db.prepare('SELECT message_id FROM message_reads WHERE user_id=? AND message_id IN (?,?)')
      .all(b.userId, olderId, newerId).map(r => r.message_id);
    expect(readRows).toContain(olderId);
    expect(readRows).not.toContain(newerId);
  });

  test('群聊：成员 read 后 readBy 含该成员、不含发送者', async () => {
    const o = await makeUser({ username: 'f1_rs_g' });
    const m = await makeUser({ username: 'f1_rs_gm' });
    await befriend(o, m);
    const g = await request(app).post('/api/messages/conversation/group')
      .set(authOf(o)).send({ name: 'read-states群', memberIds: [m.userId] });
    const gid = g.body.conversationId;
    const sent = await request(app).post(`/api/messages/${gid}`).set(authOf(o)).send({ content: '群已读' });
    await request(app).post(`/api/messages/conversation/${gid}/read`)
      .set(authOf(m)).send({ messageId: sent.body.id });

    await pollReadStates(o, gid, sent.body.id, m.userId);
    const rs = await request(app)
      .get(`/api/messages/conversation/${gid}/read-states?msgIds=${sent.body.id}`)
      .set(authOf(o));
    expect(rs.status).toBe(200);
    expect(rs.body.readStates[sent.body.id]).toContain(m.userId);
    expect(rs.body.readStates[sent.body.id]).not.toContain(o.userId); // 发送者不计入已读
  });

  test('非会话成员查询 → 403', async () => {
    const stranger = await makeUser({ username: 'f1_rs_s' });
    const rs = await request(app)
      .get(`/api/messages/conversation/${convId}/read-states?msgIds=${m1}`)
      .set(authOf(stranger));
    expect(rs.status).toBe(403);
  });
});

// ── #5 会话归档 ────────────────────────────────────────────────────
describe('#5 会话归档', () => {
  let a, b, convId;

  beforeAll(async () => {
    a = await makeUser({ username: 'f1_ar_a' });
    b = await makeUser({ username: 'f1_ar_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
  });

  const listHas = async (user, id, includeArchived) => {
    const r = await request(app)
      .get(`/api/messages/conversations${includeArchived ? '?includeArchived=1' : ''}`)
      .set(authOf(user));
    return (r.body || []).find(c => c.id === id);
  };

  test('归档 → 默认列表消失；includeArchived=1 出现且带 archived 标志', async () => {
    const arc = await request(app).post(`/api/messages/conversation/${convId}/archive`)
      .set(authOf(a)).send({ archived: true });
    expect(arc.status).toBe(200);
    expect(await listHas(a, convId, false)).toBeUndefined();
    const inArchived = await listHas(a, convId, true);
    expect(inArchived && inArchived.archived).toBe(1);
    // 对方列表不受影响（归档仅本人可见）
    expect(await listHas(b, convId, false)).toBeTruthy();
  });

  test('归档会话来新消息：仍入库，归档列表带未读；unread-counts 不聚合归档会话', async () => {
    await request(app).post(`/api/messages/${convId}`).set(authOf(b)).send({ content: '归档后来信' });
    const inArchived = await listHas(a, convId, true);
    expect(inArchived.unreadCount).toBeGreaterThanOrEqual(1);

    const unread = await request(app).get('/api/messages/unread-counts').set(authOf(a));
    expect(unread.body[convId]).toBeUndefined();
  });

  test('取消归档 → 回主列表', async () => {
    await request(app).post(`/api/messages/conversation/${convId}/archive`)
      .set(authOf(a)).send({ archived: false });
    expect(await listHas(a, convId, false)).toBeTruthy();
  });

  test('退群时清理归档（个人会话设置）行', async () => {
    const o = await makeUser({ username: 'f1_ar_g' });
    const m = await makeUser({ username: 'f1_ar_gm' });
    await befriend(o, m);
    const g = await request(app).post('/api/messages/conversation/group')
      .set(authOf(o)).send({ name: '归档清理群', memberIds: [m.userId] });
    const gid = g.body.conversationId;
    await request(app).post(`/api/messages/conversation/${gid}/archive`).set(authOf(m)).send({ archived: true });
    expect(db.prepare(
      'SELECT archived FROM conversation_settings WHERE conversation_id=? AND user_id=?'
    ).get(gid, m.userId).archived).toBe(1);

    await request(app).post(`/api/messages/conversation/${gid}/leave`).set(authOf(m));
    expect(db.prepare(
      'SELECT 1 FROM conversation_settings WHERE conversation_id=? AND user_id=?'
    ).get(gid, m.userId)).toBeUndefined();
  });
});

// ── #6 加好友验证流程 ──────────────────────────────────────────────
describe('#6 加好友验证流程', () => {
  test('默认需验证：申请 → 待处理列表可见 → 同意 → 互为好友；拒绝路径可用', async () => {
    const a = await makeUser({ username: 'f1_fr_a' });
    const b = await makeUser({ username: 'f1_fr_b' });
    const send = await request(app).post('/api/users/friend-request')
      .set(authOf(a)).send({ toId: b.userId, message: '我是F1测试' });
    expect(send.status).toBe(200);

    const list = await request(app).get('/api/users/friend-requests').set(authOf(b));
    const reqRow = (list.body || []).find(r => r.from_id === a.userId);
    expect(reqRow).toBeTruthy();
    expect(reqRow.message).toBe('我是F1测试');

    const accept = await request(app).post(`/api/users/friend-request/${reqRow.id}/handle`)
      .set(authOf(b)).send({ action: 'accept' });
    expect(accept.status).toBe(200);
    const contactsA = await request(app).get('/api/users/contacts').set(authOf(a));
    expect((contactsA.body || []).some(c => c.id === b.userId)).toBe(true);

    // 拒绝路径
    const c = await makeUser({ username: 'f1_fr_c' });
    await request(app).post('/api/users/friend-request').set(authOf(c)).send({ toId: b.userId });
    const list2 = await request(app).get('/api/users/friend-requests').set(authOf(b));
    const req2 = (list2.body || []).find(r => r.from_id === c.userId);
    const decline = await request(app).post(`/api/users/friend-request/${req2.id}/handle`)
      .set(authOf(b)).send({ action: 'decline' });
    expect(decline.status).toBe(200);
    const contactsC = await request(app).get('/api/users/contacts').set(authOf(c));
    expect((contactsC.body || []).some(x => x.id === b.userId)).toBe(false);
  });

  test('requireVerify=0：加好友立即成功（autoAccepted），设置经 me/settings 读写', async () => {
    const b = await makeUser({ username: 'f1_fr_nov' });
    const before = await request(app).get('/api/users/me/settings').set(authOf(b));
    expect(before.body.requireVerify).toBe(true); // 默认 1=需验证

    const upd = await request(app).put('/api/users/me/settings').set(authOf(b)).send({ requireVerify: false });
    expect(upd.status).toBe(200);
    expect(upd.body.requireVerify).toBe(false);

    const c = await makeUser({ username: 'f1_fr_d' });
    const send = await request(app).post('/api/users/friend-request')
      .set(authOf(c)).send({ toId: b.userId });
    expect(send.status).toBe(200);
    expect(send.body.autoAccepted).toBe(true);
    const contactsC = await request(app).get('/api/users/contacts').set(authOf(c));
    expect((contactsC.body || []).some(x => x.id === b.userId)).toBe(true);
  });

  test('被对方拉黑 → 申请被拒（403）', async () => {
    const a = await makeUser({ username: 'f1_fr_bl_a' });
    const b = await makeUser({ username: 'f1_fr_bl_b' });
    db.prepare('INSERT INTO blocked_users (id, user_id, blocked_id) VALUES (?, ?, ?)')
      .run(`f1frblk-${Date.now()}`, b.userId, a.userId);
    const r = await request(app).post('/api/users/friend-request').set(authOf(a)).send({ toId: b.userId });
    expect(r.status).toBe(403);
  });
});

// ── #7 群主转让 ────────────────────────────────────────────────────
describe('#7 群主转让', () => {
  let owner, m, convId;

  beforeAll(async () => {
    owner = await makeUser({ username: 'f1_to_o' });
    m = await makeUser({ username: 'f1_to_m' });
    await befriend(owner, m);
    const g = await request(app).post('/api/messages/conversation/group')
      .set(authOf(owner)).send({ name: '转让群', memberIds: [m.userId] });
    convId = g.body.conversationId;
  });

  test('转让后：新 owner 可改群名/再转让/解散；旧 owner 降为 admin 失去 owner-only 权限', async () => {
    const tr = await request(app).post(`/api/messages/conversation/${convId}/transfer-owner`)
      .set(authOf(owner)).send({ userId: m.userId });
    expect(tr.status).toBe(200);

    const info = await request(app).get(`/api/messages/conversation/${convId}/info`).set(authOf(m));
    expect(info.body.owner_id).toBe(m.userId);
    expect(info.body.myRole).toBe('owner');
    const oldInfo = await request(app).get(`/api/messages/conversation/${convId}/info`).set(authOf(owner));
    expect(oldInfo.body.myRole).toBe('admin');

    // 新 owner 改群名 ✓
    const rename = await request(app).put(`/api/messages/conversation/${convId}`)
      .set(authOf(m)).send({ name: '转让后的群' });
    expect(rename.status).toBe(200);

    // 旧 owner 不能再转让 / 不能解散（owner-only）
    const oldTransfer = await request(app).post(`/api/messages/conversation/${convId}/transfer-owner`)
      .set(authOf(owner)).send({ userId: m.userId });
    expect(oldTransfer.status).toBe(403);
    const oldDissolve = await request(app).post(`/api/messages/conversation/${convId}/dissolve`)
      .set(authOf(owner));
    expect(oldDissolve.status).toBe(403);

    // 新 owner 可再转让（转回来，保持资源可复用）
    const back = await request(app).post(`/api/messages/conversation/${convId}/transfer-owner`)
      .set(authOf(m)).send({ userId: owner.userId });
    expect(back.status).toBe(200);
  });

  test('非群主转让 → 403；转让给自己 → 400', async () => {
    const r1 = await request(app).post(`/api/messages/conversation/${convId}/transfer-owner`)
      .set(authOf(m)).send({ userId: owner.userId });
    expect(r1.status).toBe(403);
    const r2 = await request(app).post(`/api/messages/conversation/${convId}/transfer-owner`)
      .set(authOf(owner)).send({ userId: owner.userId });
    expect(r2.status).toBe(400);
  });
});

// ── #8 消息搜索分类筛选 ────────────────────────────────────────────
describe('#8 消息搜索分类筛选', () => {
  let a, b, convId, textMsg, imgMsg;

  beforeAll(async () => {
    a = await makeUser({ username: 'f1_se_a' });
    b = await makeUser({ username: 'f1_se_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
    const t = await request(app).post(`/api/messages/${convId}`).set(authOf(a)).send({ content: '苹果手机' });
    textMsg = t.body;
    await request(app).post(`/api/messages/${convId}`).set(authOf(b)).send({ content: '苹果派' });
    const img = await request(app).post(`/api/messages/${convId}/upload`)
      .set(authOf(a)).attach('file', PNG, { filename: '手机截图.png', contentType: 'image/png' });
    imgMsg = img.body;
    expect(imgMsg.type).toBe('image');
  });

  test('?type=image 只回图片；type=text 只回文本；多值 text,image 两者都回', async () => {
    const onlyImg = await request(app)
      .get(`/api/messages/conversation/${convId}/search?type=image`).set(authOf(a));
    expect(Array.isArray(onlyImg.body)).toBe(true);
    expect(onlyImg.body.every(m => m.type === 'image')).toBe(true);
    expect(onlyImg.body.some(m => m.id === imgMsg.id)).toBe(true);

    const onlyText = await request(app)
      .get(`/api/messages/conversation/${convId}/search?type=text`).set(authOf(a));
    expect(onlyText.body.every(m => m.type === 'text')).toBe(true);

    const both = await request(app)
      .get(`/api/messages/conversation/${convId}/search?type=text,image`).set(authOf(a));
    expect(both.body.some(m => m.type === 'image')).toBe(true);
    expect(both.body.some(m => m.type === 'text')).toBe(true);
  });

  test('from/to 时间范围生效', async () => {
    const ts = textMsg.created_at;
    const hit = await request(app)
      .get(`/api/messages/conversation/${convId}/search?type=text&from=${ts - 5}&to=${ts + 300}`)
      .set(authOf(a));
    expect(hit.body.some(m => m.id === textMsg.id)).toBe(true);

    const miss = await request(app)
      .get(`/api/messages/conversation/${convId}/search?type=text&from=${ts + 10}&to=${ts + 300}`)
      .set(authOf(a));
    expect(miss.body.some(m => m.id === textMsg.id)).toBe(false);
  });

  test('senderId 过滤生效', async () => {
    const onlyB = await request(app)
      .get(`/api/messages/conversation/${convId}/search?senderId=${b.userId}`).set(authOf(a));
    expect(onlyB.body.length).toBeGreaterThan(0);
    expect(onlyB.body.every(m => m.sender_id === b.userId)).toBe(true);
  });

  test('全局搜索同样支持 type 过滤', async () => {
    const r = await request(app)
      .get(`/api/messages/search?type=image&q=${encodeURIComponent('手机')}`).set(authOf(a));
    expect(r.status).toBe(200);
    expect(r.body.results.every(m => m.type === 'image')).toBe(true);
    expect(r.body.results.some(m => m.id === imgMsg.id)).toBe(true);
  });

  test('不传过滤参数时行为不变（?q= 仍走原路径）', async () => {
    const r = await request(app)
      .get(`/api/messages/conversation/${convId}/search?q=${encodeURIComponent('苹果')}`).set(authOf(a));
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.some(m => m.content === '苹果手机')).toBe(true);
    expect(r.body.some(m => m.content === '苹果派')).toBe(true);
  });
});
