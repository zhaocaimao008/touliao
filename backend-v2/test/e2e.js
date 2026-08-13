'use strict';
/**
 * backend-v2 端到端联调（模拟前端真实行为）。
 * 注册两个临时用户 → 全流程断言 → 清理所有测试数据。
 */
const http = require('http');
const { io } = require('/root/投聊/web/node_modules/socket.io-client');
const Database = require('/root/投聊/backend/node_modules/better-sqlite3');

const BASE = process.env.E2E_BASE || 'http://localhost:3003';
const INVITE = '888888';
const A = { phone: '19911110001', username: 'e2e测试A_' + Date.now() % 100000, password: 'test1234' };
const B = { phone: '19911110002', username: 'e2e测试B_' + Date.now() % 100000, password: 'test1234' };

let pass = 0, fail = 0;
const created = { userIds: [], convIds: [] };

function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✅', msg); }
  else { fail++; console.log('  ❌', msg); }
}

// 极简带 cookie 的 HTTP 客户端
function req(method, path, { token, csrf, body, csrfCookieOnly } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    const cookies = [];
    if (token) cookies.push(`vxin_token=${token}`);
    if (csrfCookieOnly) { cookies.push(`csrf_token=${csrfCookieOnly}`); } // 带 cookie 不带 header → 应触发 403
    else if (csrf) { cookies.push(`csrf_token=${csrf}`); headers['X-CSRF-Token'] = csrf; }
    if (cookies.length) headers['Cookie'] = cookies.join('; ');
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(BASE + path, { method, headers }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        let json; try { json = JSON.parse(buf); } catch { json = buf; }
        // 提取 set-cookie 里的 token/csrf
        const setCookie = res.headers['set-cookie'] || [];
        const out = { status: res.statusCode, body: json };
        for (const c of setCookie) {
          const mt = c.match(/vxin_token=([^;]+)/); if (mt) out.token = mt[1];
          const mc = c.match(/csrf_token=([^;]+)/); if (mc) out.csrf = mc[1];
        }
        resolve(out);
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], reconnection: false, extraHeaders: { Cookie: `vxin_token=${token}` } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', e => reject(new Error('socket 连接失败: ' + e.message)));
    setTimeout(() => reject(new Error('socket 连接超时')), 5000);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n━━━ 1. 注册 + 登录 ━━━');
  let ra = await req('POST', '/api/auth/register', { body: { ...A, inviteCode: INVITE } });
  let rb = await req('POST', '/api/auth/register', { body: { ...B, inviteCode: INVITE } });
  ok(ra.status === 200 && ra.body.user?.id, `用户A 注册成功 (${ra.body.user?.id?.slice(0,8)})`);
  ok(rb.status === 200 && rb.body.user?.id, `用户B 注册成功 (${rb.body.user?.id?.slice(0,8)})`);
  const a = { id: ra.body.user.id, token: ra.token, csrf: ra.csrf, vxinId: ra.body.user.wechat_id };
  const b = { id: rb.body.user.id, token: rb.token, csrf: rb.csrf, vxinId: rb.body.user.wechat_id };
  created.userIds.push(a.id, b.id);
  ok(!!a.token, '注册即下发 vxin_token Cookie');

  // me —— 首次鉴权请求，由 auth 中间件下发 csrf_token（与原版一致）
  const meA = await req('GET', '/api/auth/me', { token: a.token });
  const meB = await req('GET', '/api/auth/me', { token: b.token });
  a.csrf = meA.csrf; b.csrf = meB.csrf;
  ok(meA.status === 200 && meA.body.phone === A.phone, '/auth/me 返回正确用户（含 phone）');
  ok(!!a.csrf && !!b.csrf, '首次鉴权请求下发 csrf_token Cookie');

  console.log('\n━━━ 2. 私聊会话 + Socket 实时收发 ━━━');
  const conv = await req('POST', '/api/messages/conversation/private', { token: a.token, csrf: a.csrf, body: { userId: b.id } });
  ok(conv.status === 200 && conv.body.conversationId, '创建私聊会话');
  const convId = conv.body.conversationId;
  created.convIds.push(convId);

  const sockA = await connectSocket(a.token);
  const sockB = await connectSocket(b.token);
  ok(true, '双方 Socket 均连接成功');

  // B 监听 new_message
  let bReceived = null;
  sockB.on('new_message', m => { bReceived = m; });
  await wait(300); // 等会话房间 join

  // A 通过 socket 发消息
  const ackA = await new Promise(res => sockA.emit('send_message', { conversationId: convId, content: 'hello from A' }, res));
  ok(ackA?.success && ackA.message?.content === 'hello from A', 'A socket 发送 → ack 成功');
  await wait(400);
  ok(bReceived?.content === 'hello from A', 'B 实时收到 new_message');
  const msg1Id = ackA.message.id;

  console.log('\n━━━ 3. HTTP 发送 + 表情 + 编辑 ━━━');
  const httpMsg = await req('POST', `/api/messages/${convId}`, { token: a.token, csrf: a.csrf, body: { content: '唯一搜索词xyzzy123' } });
  ok(httpMsg.status === 200 && httpMsg.body.id, 'HTTP POST 发消息成功');
  const msg2Id = httpMsg.body.id;

  const react = await req('POST', `/api/messages/${msg1Id}/react`, { token: b.token, csrf: b.csrf, body: { emoji: '👍' } });
  ok(react.status === 200 && react.body.reactions?.[0]?.emoji === '👍', 'B 给消息加表情 👍');

  const edit = await req('PUT', `/api/messages/${msg1Id}/edit`, { token: a.token, csrf: a.csrf, body: { content: 'hello edited' } });
  ok(edit.status === 200 && edit.body.content === 'hello edited', 'A 编辑自己的消息');

  const editForbidden = await req('PUT', `/api/messages/${msg1Id}/edit`, { token: b.token, csrf: b.csrf, body: { content: 'hack' } });
  ok(editForbidden.status === 403, 'B 无法编辑 A 的消息（403）');

  console.log('\n━━━ 4. 消息历史（批量装配）+ 会话列表 ━━━');
  const history = await req('GET', `/api/messages/${convId}?limit=50`, { token: a.token });
  ok(Array.isArray(history.body) && history.body.length >= 2, `历史消息返回 ${history.body.length} 条`);
  const edited = history.body.find(m => m.id === msg1Id);
  ok(edited?.content === 'hello edited' && edited?.edited === 1, '历史含编辑后内容 + edited 标记');
  ok(Array.isArray(edited?.reactions) && edited.reactions[0]?.emoji === '👍', '历史消息批量装配 reactions');

  const convList = await req('GET', '/api/messages/conversations', { token: b.token });
  ok(Array.isArray(convList.body) && convList.body.some(c => c.id === convId), 'B 的会话列表含该私聊');
  const item = convList.body.find(c => c.id === convId);
  ok(item?.unreadCount >= 1, `B 未读数 = ${item?.unreadCount}`);

  console.log('\n━━━ 5. FTS5 全文搜索 ━━━');
  await wait(300); // 等 worker flush + fts 触发器
  const search = await req('GET', '/api/messages/search?q=' + encodeURIComponent('xyzzy123'), { token: a.token });
  ok(search.body.total >= 1 && search.body.results?.[0]?.content?.includes('xyzzy123'), `FTS 搜到 ${search.body.total} 条`);

  console.log('\n━━━ 6. 建群 + @提及 + 红包 ━━━');
  let bGroupConv = null;
  sockB.on('new_conversation', c => { if (c.type === 'group') bGroupConv = c; });
  const group = await req('POST', '/api/messages/conversation/group', { token: a.token, csrf: a.csrf, body: { name: 'E2E测试群', memberIds: [b.id] } });
  ok(group.status === 200 && group.body.conversationId, `建群成功（群号 ${group.body.groupNumber}）`);
  const groupId = group.body.conversationId;
  created.convIds.push(groupId);
  await wait(400);
  ok(bGroupConv?.id === groupId, 'B 实时收到 new_conversation（入群通知）');

  // 红包：A 发，B 领
  const rpSend = await req('POST', '/api/messages/red-packet/send', { token: a.token, csrf: a.csrf, body: { conversationId: groupId, totalAmount: 100, totalCount: 2, greeting: '测试红包' } });
  ok(rpSend.status === 200 && rpSend.body.packetId, '发红包成功');
  const packetId = rpSend.body.packetId;

  const claimB = await req('POST', `/api/messages/red-packet/${packetId}/claim`, { token: b.token, csrf: b.csrf });
  ok(claimB.status === 200 && claimB.body.amount >= 1, `B 领到红包 ${claimB.body.amount} 金币`);
  const claimB2 = await req('POST', `/api/messages/red-packet/${packetId}/claim`, { token: b.token, csrf: b.csrf });
  ok(claimB2.status === 400 && claimB2.body.error === '已领取过' && claimB2.body.amount === claimB.body.amount, '重复领取被拒（带原金额）');

  console.log('\n━━━ 7. 群管理（踢人/退群 R2 修复）━━━');
  const kick = await req('DELETE', `/api/messages/conversation/${groupId}/members/${b.id}`, { token: a.token, csrf: a.csrf });
  ok(kick.status === 200, '群主踢出 B 成功');
  const kickSelf = await req('DELETE', `/api/messages/conversation/${groupId}/members/${a.id}`, { token: a.token, csrf: a.csrf });
  ok(kickSelf.status === 400, '群主不能踢自己（400）');

  console.log('\n━━━ 8. 隐私 / CSRF / 鉴权边界 ━━━');
  const contacts = await req('GET', '/api/users/contacts', { token: a.token });
  ok(Array.isArray(contacts.body) && !('phone' in (contacts.body[0] || {})), '联系人不泄露 phone（S3）');
  const noCsrf = await req('POST', `/api/messages/${convId}`, { token: a.token, csrfCookieOnly: a.csrf, body: { content: 'x' } });
  ok(noCsrf.status === 403, '有 csrf cookie 但缺 X-CSRF-Token header 的 POST 被拒（403）');
  const noAuth = await req('GET', '/api/messages/conversations', {});
  ok(noAuth.status === 401, '无 Token 访问被拒（401）');

  sockA.close(); sockB.close();

  // ── 清理 ──
  console.log('\n━━━ 清理测试数据 ━━━');
  const db = new Database('/root/投聊/backend/wechat.db');
  const convPh = created.convIds.map(() => '?').join(',');
  const userPh = created.userIds.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare(`DELETE FROM messages_fts WHERE conversation_id IN (${convPh})`).run(...created.convIds);
    db.prepare(`DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id IN (${convPh}))`).run(...created.convIds);
    db.prepare(`DELETE FROM message_deliveries WHERE message_id IN (SELECT id FROM messages WHERE conversation_id IN (${convPh}))`).run(...created.convIds);
    db.prepare(`DELETE FROM red_packet_claims WHERE packet_id IN (SELECT id FROM red_packets WHERE conversation_id IN (${convPh}))`).run(...created.convIds);
    db.prepare(`DELETE FROM red_packets WHERE conversation_id IN (${convPh})`).run(...created.convIds);
    db.prepare(`DELETE FROM messages WHERE conversation_id IN (${convPh})`).run(...created.convIds);
    db.prepare(`DELETE FROM conversation_members WHERE conversation_id IN (${convPh})`).run(...created.convIds);
    db.prepare(`DELETE FROM conversation_settings WHERE conversation_id IN (${convPh})`).run(...created.convIds);
    db.prepare(`DELETE FROM conversations WHERE id IN (${convPh})`).run(...created.convIds);
    db.prepare(`DELETE FROM contacts WHERE user_id IN (${userPh}) OR contact_id IN (${userPh})`).run(...created.userIds, ...created.userIds);
    db.prepare(`DELETE FROM friend_requests WHERE from_id IN (${userPh}) OR to_id IN (${userPh})`).run(...created.userIds, ...created.userIds);
    db.prepare(`DELETE FROM user_settings WHERE user_id IN (${userPh})`).run(...created.userIds);
    db.prepare(`DELETE FROM user_sessions WHERE user_id IN (${userPh})`).run(...created.userIds);
    db.prepare(`DELETE FROM users WHERE id IN (${userPh})`).run(...created.userIds);
  })();
  const leftUsers = db.prepare(`SELECT COUNT(*) n FROM users WHERE id IN (${userPh})`).get(...created.userIds).n;
  const leftConvs = db.prepare(`SELECT COUNT(*) n FROM conversations WHERE id IN (${convPh})`).get(...created.convIds).n;
  db.close();
  ok(leftUsers === 0 && leftConvs === 0, `清理完成（残留用户 ${leftUsers} / 会话 ${leftConvs}）`);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  通过 ${pass} / 失败 ${fail}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('\n💥 测试异常中断:', e.message, e.stack); process.exit(2); });
