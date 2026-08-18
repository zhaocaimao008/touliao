#!/usr/bin/env node
/**
 * perf_ruge_e2e.js —— 端到端真实链路性能测试（Hermes 在服务器本机执行）
 *
 * 用一个真实账号登录 → 找到指定好友 → 建/取私聊会话 → 连发 N 条消息，
 * 逐环节统计 p50/p95/max 延迟与错误率。可对比 localhost 与 https 真实链路。
 *
 * 用法:
 *   BASE=http://127.0.0.1:3002 PHONE=13900009999 PASS=qwe64932 FRIEND=如歌 N=30 node perf_ruge_e2e.js
 *   BASE=https://touliao.cc   ... （走 Nginx/TLS 真实链路）
 */
'use strict';
const http = require('http'), https = require('https');

const BASE   = process.env.BASE   || 'http://127.0.0.1:3002';
const PHONE  = process.env.PHONE  || '13900009999';
const PASS   = process.env.PASS   || 'qwe64932';
const FRIEND = process.env.FRIEND || '如歌';
const N      = parseInt(process.env.N || '30', 10);
const DRY    = process.env.DRY === '1'; // 只测登录/查好友/建会话，不真的发消息

const U = new URL(BASE);
const mod = U.protocol === 'https:' ? https : http;
const PORT = U.port || (U.protocol === 'https:' ? 443 : 80);

let TOKEN = null;
function req(method, p, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const t0 = process.hrtime.bigint();
    const r = mod.request({ host: U.hostname, port: PORT, path: p, method, headers, rejectUnauthorized: false, agent: false }, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        resolve({ status: res.statusCode, body: buf, ms });
      });
    });
    r.on('error', (e) => resolve({ status: 0, body: String(e), ms: 0 }));
    if (data) r.write(data); r.end();
  });
}
const stats = (arr) => {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), max: +s[s.length-1].toFixed(1), avg: +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(1) };
};

(async () => {
  console.log(`\n===== 性能测试 =====\n链路: ${BASE}\n账号: ${PHONE}  好友: ${FRIEND}  条数: ${N}${DRY?'  (DRY)':''}\n`);

  // 0) 健康检查
  const h = await req('GET', '/health');
  console.log(`[健康] /health  ${h.status}  ${h.ms.toFixed(1)}ms  ${h.body.slice(0,60)}`);

  // 1) 登录
  const lg = await req('POST', '/api/auth/login', { phone: PHONE, password: PASS });
  if (lg.status !== 200) { console.log(`❌ 登录失败 ${lg.status}: ${lg.body.slice(0,200)}`); process.exit(1); }
  const lj = JSON.parse(lg.body); TOKEN = lj.token;
  console.log(`[登录] 200  ${lg.ms.toFixed(1)}ms  me=${lj.user?.id} ${lj.user?.username||''}`);

  // 2) me
  const me = await req('GET', '/api/auth/me');
  console.log(`[me]   ${me.status}  ${me.ms.toFixed(1)}ms`);

  // 3) 联系人 → 找好友
  const ct = await req('GET', '/api/users/contacts');
  let list = []; try { list = JSON.parse(ct.body); } catch {}
  console.log(`[好友列表] ${ct.status}  ${ct.ms.toFixed(1)}ms  共 ${Array.isArray(list)?list.length:'?'} 人`);
  const friend = Array.isArray(list) && list.find(u => u.remark === FRIEND || u.username === FRIEND);
  if (!friend) {
    console.log(`❌ 未找到好友「${FRIEND}」。现有好友(remark|username):`);
    (list||[]).slice(0,30).forEach(u => console.log(`   - ${u.remark||''} | ${u.username||''} (id=${u.id})`));
    process.exit(1);
  }
  console.log(`   ✅ 命中: id=${friend.id} username=${friend.username} remark=${friend.remark||'(无)'}`);

  // 4) 建/取私聊会话
  const cv = await req('POST', '/api/messages/conversation/private', { userId: friend.id });
  if (cv.status !== 200) { console.log(`❌ 建会话失败 ${cv.status}: ${cv.body.slice(0,200)}`); process.exit(1); }
  const conv = JSON.parse(cv.body);
  const convId = conv.id || conv.conversationId || conv._id;
  console.log(`[建会话] 200  ${cv.ms.toFixed(1)}ms  convId=${convId}`);

  // 5) 拉历史（读路径基线）
  const hist = await req('GET', `/api/messages/${convId}?limit=20`);
  console.log(`[拉历史] ${hist.status}  ${hist.ms.toFixed(1)}ms`);

  if (DRY) { console.log('\n(DRY) 跳过实际发送。'); process.exit(0); }

  // 6) 连发 N 条，统计写延迟
  console.log(`\n[发送] 连发 ${N} 条 text 消息...`);
  const sendMs = [], errs = [];
  const stamp = new Date().toISOString().slice(11,19);
  for (let i = 1; i <= N; i++) {
    const r = await req('POST', `/api/messages/${convId}`, { content: `⏱️性能测试 #${i}/${N} @${stamp}`, type: 'text' });
    if (r.status === 200) sendMs.push(r.ms);
    else errs.push(`#${i} → ${r.status} ${r.body.slice(0,80)}`);
    await new Promise(r => setTimeout(r, 60)); // 温和节流，避开限流器
  }
  const st = stats(sendMs);
  console.log(`\n===== 发送结果 =====`);
  console.log(`成功: ${sendMs.length}/${N}  失败: ${errs.length}`);
  console.log(`延迟(ms): p50=${st.p50}  p95=${st.p95}  max=${st.max}  avg=${st.avg}`);
  if (errs.length) { console.log(`失败样例:`); errs.slice(0,8).forEach(e => console.log('   ' + e)); }
  console.log(`\n✅ 已给「${FRIEND}」发送 ${sendMs.length} 条测试消息。`);
})();
