#!/usr/bin/env node
'use strict';
/**
 * full_test.js —— 全量功能 + 性能测试
 * 账号A: 13900009999 / qwe64932   账号B: 13900008888 / qwe64932 (如歌)
 */
const http = require('http');
const { assertTouliaoBackend } = require('./_envGuard');
const BASE = process.env.BASE || 'http://127.0.0.1:3002';
const U = new URL(BASE);
assertTouliaoBackend(BASE);
let passCount = 0, failCount = 0, warnCount = 0;

function req(method, path, opts) {
  const { body, token } = opts || {};
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const t0 = process.hrtime.bigint();
    const r = http.request(
      { host: U.hostname, port: U.port || 3002, path: encodeURI(path), method, headers, agent: false },
      (res) => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          let json = null; try { json = JSON.parse(buf); } catch (_) {}
          resolve({ status: res.statusCode, raw: buf, json, ms });
        });
      }
    );
    r.on('error', (e) => resolve({ status: 0, raw: String(e), json: null, ms: 0 }));
    if (data) r.write(data);
    r.end();
  });
}

function check(r, label, opts) {
  const { expect: exp = 200, warnOnly = false } = opts || {};
  const ok = (exp === '2xx') ? (r.status >= 200 && r.status < 300) : r.status === exp;
  const note = r.json && r.json.error ? '  ' + r.json.error : '';
  const ms = r.ms.toFixed(1) + 'ms';
  if (ok)            { passCount++; console.log('✅  [' + r.status + ']  ' + label + '  ' + ms); }
  else if (warnOnly) { warnCount++; console.log('⚠️   [' + r.status + ']  ' + label + '  ' + ms + note); }
  else               { failCount++; console.log('❌  [' + r.status + ']  ' + label + '  ' + ms + note); }
  return ok;
}

function sec(t) { console.log('\n' + '─'.repeat(52) + '\n  ' + t + '\n' + '─'.repeat(52)); }

function stats(arr) {
  if (!arr.length) return { p50: 0, p95: 0, max: 0, avg: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)
  };
}

async function main() {
  console.log('\n' + '═'.repeat(52));
  console.log('  全量功能 + 性能测试  ' + new Date().toLocaleString());
  console.log('  后端: ' + BASE);
  console.log('═'.repeat(52));

  // ── 0. 健康检查 ──────────────────────────────────────
  sec('0. 健康检查');
  check(await req('GET', '/health'), 'GET /health');

  // ── 1. 认证 ──────────────────────────────────────────
  sec('1. 认证 (Auth)');

  // 主登录
  const lgA = await req('POST', '/api/auth/login', { body: { phone: '13900009999', password: 'qwe64932' } });
  check(lgA, 'POST /api/auth/login (账号A)');
  const tokA = lgA.json && lgA.json.token;
  const uidA = lgA.json && lgA.json.user && lgA.json.user.id;
  if (!tokA) { console.log('❌ 账号A登录失败，中止'); process.exit(1); }

  const lgB = await req('POST', '/api/auth/login', { body: { phone: '13900008888', password: 'qwe64932' } });
  check(lgB, 'POST /api/auth/login (账号B 如歌)');
  const tokB = lgB.json && lgB.json.token;
  const uidB = lgB.json && lgB.json.user && lgB.json.user.id;

  check(await req('GET', '/api/auth/me', { token: tokA }), 'GET /api/auth/me');
  check(await req('GET', '/api/auth/sessions', { token: tokA }), 'GET /api/auth/sessions');

  // refresh 用独立登录的 token 测试，避免吊销 tokA
  const lgTmp = await req('POST', '/api/auth/login', { body: { phone: '13900009999', password: 'qwe64932' } });
  const tokTmp = lgTmp.json && lgTmp.json.token;
  if (tokTmp) {
    const rfR = await req('POST', '/api/auth/refresh', { token: tokTmp });
    check(rfR, 'POST /api/auth/refresh (独立session)', { expect: '2xx' });
  }

  // ── 2. 用户资料 ──────────────────────────────────────
  sec('2. 用户资料 (Profile)');
  check(await req('GET', '/api/users/' + uidA, { token: tokA }), 'GET /api/users/:id');
  check(await req('GET', '/api/users/me/settings', { token: tokA }), 'GET /users/me/settings');
  check(await req('PUT', '/api/users/me/settings', { token: tokA, body: { addByPhone: true, addByVxinId: true } }), 'PUT /users/me/settings', { expect: '2xx' });
  check(await req('PUT', '/api/users/profile', { token: tokA, body: { bio: '测试签名 ' + Date.now() } }), 'PUT /users/profile', { expect: '2xx' });
  check(await req('GET', '/api/users/me/qrcode', { token: tokA }), 'GET /users/me/qrcode', { warnOnly: true });
  check(await req('GET', '/api/users/me/invite', { token: tokA }), 'GET /users/me/invite', { warnOnly: true });

  // ── 3. 联系人 / 好友 ────────────────────────────────
  sec('3. 联系人 / 好友 (Contacts)');
  const ctR = await req('GET', '/api/users/contacts', { token: tokA });
  check(ctR, 'GET /users/contacts');
  console.log('   好友数: ' + (Array.isArray(ctR.json) ? ctR.json.length : '?'));

  // 搜索用 encodeURIComponent 手动编码 query
  const srR = await req('GET', '/api/users/search?q=' + encodeURIComponent('如歌'), { token: tokA });
  check(srR, 'GET /users/search?q=如歌', { warnOnly: true });

  check(await req('GET', '/api/users/friend-requests', { token: tokA }), 'GET /users/friend-requests');
  check(await req('GET', '/api/users/friend-requests/sent', { token: tokA }), 'GET /users/friend-requests/sent');
  check(await req('GET', '/api/users/me/blocked', { token: tokA }), 'GET /users/me/blocked');
  if (uidB) {
    check(await req('PUT', '/api/users/contacts/' + uidB + '/remark', { token: tokA, body: { remark: '如歌_备注' } }), 'PUT /contacts/:id/remark', { expect: '2xx' });
    check(await req('POST', '/api/users/block/' + uidB, { token: tokA }), 'POST /users/block/:id (拉黑)', { expect: '2xx' });
    check(await req('DELETE', '/api/users/block/' + uidB, { token: tokA }), 'DELETE /users/block/:id (解除)', { expect: '2xx' });
  }

  // ── 4. 消息 / 会话 ───────────────────────────────────
  sec('4. 消息 / 会话 (Messages)');
  check(await req('GET', '/api/messages/conversations', { token: tokA }), 'GET /messages/conversations');
  check(await req('GET', '/api/messages/unread-counts', { token: tokA }), 'GET /messages/unread-counts');

  const cvR = await req('POST', '/api/messages/conversation/private', { token: tokA, body: { userId: uidB } });
  check(cvR, 'POST /messages/conversation/private');
  const convId = cvR.json && (cvR.json.id || cvR.json.conversationId);
  let msgId = null;

  if (convId) {
    check(await req('GET', '/api/messages/' + convId + '?limit=20', { token: tokA }), 'GET /messages/:convId (历史)');

    const sR = await req('POST', '/api/messages/' + convId, { token: tokA, body: { content: '功能测试 ' + Date.now(), type: 'text' } });
    check(sR, 'POST /messages/:convId (发文字)');
    msgId = sR.json && (sR.json.id || (sR.json.message && sR.json.message.id));

    if (msgId) {
      check(await req('PUT', '/api/messages/' + msgId + '/edit', { token: tokA, body: { content: '已编辑 ' + Date.now() } }), 'PUT /messages/:msgId/edit', { expect: '2xx' });
      check(await req('POST', '/api/messages/' + msgId + '/react', { token: tokA, body: { emoji: '👍' } }), 'POST /messages/:msgId/react', { expect: '2xx' });
      check(await req('POST', '/api/messages/' + msgId + '/collect', { token: tokA }), 'POST /messages/:msgId/collect', { expect: '2xx', warnOnly: true });
    }

    check(await req('GET', '/api/messages/search?q=' + encodeURIComponent('测试') + '&limit=5', { token: tokA }), 'GET /messages/search (全局)');
    check(await req('GET', '/api/messages/conversation/' + convId + '/search?q=' + encodeURIComponent('测试'), { token: tokA }), 'GET /messages/conversation/:convId/search', { warnOnly: true });
    check(await req('POST', '/api/messages/conversation/' + convId + '/read', { token: tokA }), 'POST /messages/conversation/:convId/read', { expect: '2xx', warnOnly: true });
    check(await req('POST', '/api/messages/conversation/' + convId + '/mute', { token: tokA, body: { mute: true } }), 'POST /messages/conversation/:convId/mute', { expect: '2xx', warnOnly: true });
    check(await req('POST', '/api/messages/conversation/' + convId + '/pin', { token: tokA, body: { pin: true } }), 'POST /messages/conversation/:convId/pin', { expect: '2xx', warnOnly: true });
    check(await req('POST', '/api/messages/conversation/' + convId + '/burn-after', { token: tokA, body: { seconds: 0 } }), 'POST /messages/conversation/:convId/burn-after', { expect: '2xx', warnOnly: true });
    check(await req('GET', '/api/messages/conversation/' + convId + '/info', { token: tokA }), 'GET /messages/conversation/:convId/info', { warnOnly: true });
    check(await req('GET', '/api/messages/file-helper', { token: tokA }), 'GET /messages/file-helper', { warnOnly: true });
    const afterTs = Math.floor(Date.now() / 1000) - 86400;
    check(await req('GET', '/api/messages/missed?after=' + afterTs, { token: tokA }), 'GET /messages/missed?after=<ts>');
    check(await req('GET', '/api/messages/media', { token: tokA }), 'GET /messages/media');

    if (msgId) {
      check(await req('POST', '/api/messages/forward', { token: tokA, body: { msgId: msgId, conversationIds: [convId] } }), 'POST /messages/forward', { expect: '2xx' });
    }
  }

  // ── 5. 群组 ──────────────────────────────────────────
  sec('5. 群组 (Groups)');
  check(await req('GET', '/api/messages/my-groups', { token: tokA }), 'GET /messages/my-groups');
  const grpR = await req('POST', '/api/messages/conversation/group', {
    token: tokA,
    body: { name: 'TestGroup_' + Date.now(), memberIds: uidB ? [uidB] : [] }
  });
  check(grpR, 'POST /messages/conversation/group (建群)', { expect: '2xx' });
  const grpId = grpR.json && (grpR.json.id || grpR.json.conversationId);
  if (grpId) {
    check(await req('GET', '/api/messages/conversation/' + grpId + '/members', { token: tokA }), 'GET /messages/conversation/:grpId/members');
    check(await req('PUT', '/api/messages/conversation/' + grpId + '/nickname', { token: tokA, body: { nickname: 'TestNick' } }), 'PUT /messages/conversation/:grpId/nickname', { expect: '2xx', warnOnly: true });
    const gmR = await req('POST', '/api/messages/' + grpId, { token: tokA, body: { content: 'group test msg', type: 'text' } });
    check(gmR, 'POST /messages/:grpId (发群消息)');
    const gmId = gmR.json && (gmR.json.id || (gmR.json.message && gmR.json.message.id));
    if (gmId) {
      check(await req('POST', '/api/messages/conversation/' + grpId + '/pin-message', { token: tokA, body: { msgId: gmId } }), 'POST /messages/conversation/:grpId/pin-message', { expect: '2xx' });
      check(await req('GET', '/api/messages/conversation/' + grpId + '/pinned-messages', { token: tokA }), 'GET /messages/conversation/:grpId/pinned-messages', { warnOnly: true });
    }
    check(await req('POST', '/api/messages/conversation/' + grpId + '/dissolve', { token: tokA }), 'POST /messages/conversation/:grpId/dissolve (解散)', { expect: '2xx', warnOnly: true });
  }

  // ── 6. 朋友圈 ────────────────────────────────────────
  sec('6. 朋友圈 (Moments)');
  check(await req('GET', '/api/moments/', { token: tokA }), 'GET /moments (时间线)');
  const momR = await req('POST', '/api/moments/', { token: tokA, body: { content: 'AutoTest_' + Date.now(), visibility: 'public' } });
  check(momR, 'POST /moments (发动态)', { expect: '2xx' });
  const momId = momR.json && momR.json.id;
  if (momId) {
    check(await req('GET', '/api/moments/' + momId, { token: tokA }), 'GET /moments/:id');
    check(await req('GET', '/api/moments/user/' + uidA, { token: tokA }), 'GET /moments/user/:userId');
    check(await req('POST', '/api/moments/' + momId + '/like', { token: tokA }), 'POST /moments/:id/like', { expect: '2xx' });
    check(await req('GET', '/api/moments/' + momId + '/likes', { token: tokA }), 'GET /moments/:id/likes');
    const cmtR = await req('POST', '/api/moments/' + momId + '/comment', { token: tokA, body: { content: 'auto_comment' } });
    check(cmtR, 'POST /moments/:id/comment', { expect: '2xx' });
    const cmtId = cmtR.json && cmtR.json.id;
    check(await req('GET', '/api/moments/' + momId + '/comments', { token: tokA }), 'GET /moments/:id/comments');
    check(await req('GET', '/api/moments/notifications', { token: tokA }), 'GET /moments/notifications');
    check(await req('GET', '/api/moments/notifications/unread-count', { token: tokA }), 'GET /moments/notifications/unread-count');
    if (cmtId) check(await req('DELETE', '/api/moments/comments/' + cmtId, { token: tokA }), 'DELETE /moments/comments/:id', { expect: '2xx', warnOnly: true });
    check(await req('DELETE', '/api/moments/' + momId, { token: tokA }), 'DELETE /moments/:id (清理)', { expect: '2xx', warnOnly: true });
  }

  // ── 7. 收藏 ──────────────────────────────────────────
  sec('7. 收藏 (Collections)');
  check(await req('GET', '/api/users/me/collections', { token: tokA }), 'GET /users/me/collections');
  const colR = await req('POST', '/api/users/me/collections', { token: tokA, body: { type: 'text', content: 'AutoCollect_' + Date.now() } });
  check(colR, 'POST /users/me/collections', { expect: '2xx' });
  const colId = colR.json && colR.json.id;
  if (colId) {
    check(await req('GET', '/api/users/me/collections/' + colId, { token: tokA }), 'GET /users/me/collections/:id');
    check(await req('GET', '/api/users/me/collections/search?q=Auto', { token: tokA }), 'GET /users/me/collections/search');
    check(await req('DELETE', '/api/users/me/collections/' + colId, { token: tokA }), 'DELETE /users/me/collections/:id', { expect: '2xx', warnOnly: true });
  }

  // ── 8. 通知 ──────────────────────────────────────────
  sec('8. 通知 (Notifications)');
  check(await req('GET', '/api/notifications/status', { token: tokA }), 'GET /notifications/status');
  check(await req('GET', '/api/notifications/vapid-public-key', { token: tokA }), 'GET /notifications/vapid-public-key', { warnOnly: true });

  // ── 9. 表情包 ────────────────────────────────────────
  sec('9. 表情包 (Stickers)');
  check(await req('GET', '/api/stickers/', { token: tokA }), 'GET /stickers');

  // ── 10. 红包 ─────────────────────────────────────────
  sec('10. 红包 (Red Packets)');
  if (convId) {
    const rpR = await req('POST', '/api/redpackets/send', { token: tokA, body: { conversationId: convId, totalAmount: 1, totalCount: 1, greeting: 'TestPacket' } });
    check(rpR, 'POST /redpackets/send', { expect: '2xx', warnOnly: true });
    const rpId = rpR.json && (rpR.json.id || rpR.json.redPacketId);
    if (rpId) {
      check(await req('GET', '/api/redpackets/' + rpId, { token: tokA }), 'GET /redpackets/:id', { warnOnly: true });
      if (tokB) check(await req('POST', '/api/redpackets/' + rpId + '/claim', { token: tokB }), 'POST /redpackets/:id/claim (如歌领红包)', { expect: '2xx', warnOnly: true });
    }
  }

  // ── 11. 钱包 ─────────────────────────────────────────
  sec('11. 钱包 (Wallet)');
  check(await req('GET', '/api/wallet/', { token: tokA }), 'GET /wallet (余额)', { warnOnly: true });
  check(await req('GET', '/api/wallet/transactions', { token: tokA }), 'GET /wallet/transactions', { warnOnly: true });

  // ── 12. 通话记录 ─────────────────────────────────────
  sec('12. 通话记录 (Call Logs)');
  check(await req('GET', '/api/users/me/call-logs', { token: tokA }), 'GET /users/me/call-logs');

  // ── 13. 性能测试 ─────────────────────────────────────
  sec('13. 性能测试 (Performance)');
  if (convId) {
    const N = 40;
    console.log('\n  [写] 连发 ' + N + ' 条消息...');
    const wTimes = [], wErrs = [], wRateLimited = [];
    const stamp = new Date().toISOString().slice(11, 19);
    for (let i = 1; i <= N; i++) {
      const r = await req('POST', '/api/messages/' + convId, { token: tokA, body: { content: 'perf#' + i + '@' + stamp, type: 'text' } });
      if (r.status === 200)      wTimes.push(r.ms);
      else if (r.status === 429) wRateLimited.push(i);
      else                       wErrs.push('#' + i + '->' + r.status);
      await new Promise(r2 => setTimeout(r2, 80));
    }
    const ws = stats(wTimes);
    console.log('  成功: ' + wTimes.length + '/' + N + '  限流(429): ' + wRateLimited.length + '  其他错误: ' + wErrs.length);
    if (wTimes.length > 0) {
      console.log('  写延迟(ms): p50=' + ws.p50 + ' p95=' + ws.p95 + ' max=' + ws.max + ' avg=' + ws.avg);
      if (ws.p95 < 100)      { passCount++; console.log('✅  写 p95 < 100ms  ' + ws.p95 + 'ms'); }
      else if (ws.p95 < 300) { warnCount++; console.log('⚠️   写 p95 偏高  ' + ws.p95 + 'ms'); }
      else                   { failCount++; console.log('❌  写 p95 过高  ' + ws.p95 + 'ms'); }
    }
    if (wRateLimited.length > 0) { warnCount++; console.log('⚠️   限流 ' + wRateLimited.length + ' 条(429)，属正常限速，非功能故障'); }
    if (wErrs.length > 0)        { failCount++; console.log('❌  发送错误: ' + wErrs.join(', ')); }

    console.log('\n  [读] 10路并发拉历史...');
    const reads = await Promise.all(
      Array.from({ length: 10 }, () => req('GET', '/api/messages/' + convId + '?limit=20', { token: tokA }))
    );
    const rs = stats(reads.map(r => r.ms));
    console.log('  并发读(ms): p50=' + rs.p50 + ' p95=' + rs.p95 + ' max=' + rs.max);
    if (rs.p95 < 200)      { passCount++; console.log('✅  读 p95 < 200ms  ' + rs.p95 + 'ms'); }
    else if (rs.p95 < 500) { warnCount++; console.log('⚠️   读 p95 偏高  ' + rs.p95 + 'ms'); }
    else                   { failCount++; console.log('❌  读 p95 过高  ' + rs.p95 + 'ms'); }
  }

  // ── 汇总 ─────────────────────────────────────────────
  console.log('\n' + '═'.repeat(52));
  console.log('  ✅ ' + passCount + ' 通过   ⚠️  ' + warnCount + ' 警告   ❌ ' + failCount + ' 失败');
  console.log('═'.repeat(52) + '\n');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error('崩溃:', e.message, e.stack); process.exit(2); });
