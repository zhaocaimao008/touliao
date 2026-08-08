/**
 * 真实端到端验证脚本（不跑 mock，ASR 服务必须运行）。
 * 手动执行：node test/_realE2E.manual.js
 */
'use strict';
require('./testEnv');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const config = require('../src/config');
const app = require('../src/app');
const { v4: uuid } = require('uuid');
const { db } = require('../src/db/connection');

(async () => {
  // 注册两个用户 + 加好友 + 建私聊
  const makeUser = async (suffix) => {
    const ts = Date.now().toString().slice(-9);
    const phone = `+86-1${ts}${suffix}`.slice(0, 18);
    const r = await request(app).post('/api/auth/register').send({
      phone, password: 'Pass1234!', username: `re_${ts}_${suffix}`, inviteCode: '123456',
    });
    if (r.status >= 400) throw new Error(`register: ${JSON.stringify(r.body)}`);
    return { token: r.body.token, userId: r.body.user.id };
  };

  const u1 = await makeUser(1);
  const u2 = await makeUser(2);

  // 加好友
  const fr = await request(app).post('/api/users/friend-request').set('Authorization', `Bearer ${u1.token}`).send({ toId: u2.userId });
  const frs = await request(app).get('/api/users/friend-requests').set('Authorization', `Bearer ${u2.token}`);
  await request(app).post(`/api/users/friend-request/${frs.body[0].id}/handle`).set('Authorization', `Bearer ${u2.token}`).send({ action: 'accept' });
  const convRes = await request(app).post('/api/messages/conversation/private').set('Authorization', `Bearer ${u1.token}`).send({ userId: u2.userId });
  const convId = convRes.body.conversationId;

  // 把真实 webm 音频写进 uploadsRoot
  const webm = fs.readFileSync('/tmp/test_voice.webm');
  const fname = `e2e-voice-${uuid()}.webm`;
  const fdir = path.join(config.uploadsRoot, 'files');
  fs.mkdirSync(fdir, { recursive: true });
  fs.writeFileSync(path.join(fdir, fname), webm);
  const fileUrl = `/uploads/files/${fname}`;

  // 插入语音消息
  const mid = uuid();
  db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(mid, convId, u1.userId, 'voice', 'voice.webm', fileUrl, Math.floor(Date.now()/1000));

  // 调 transcribe 接口（真实 ASR，无 mock）
  const r1 = await request(app).post(`/api/messages/${mid}/transcribe`).set('Authorization', `Bearer ${u2.token}`);
  console.log('\n=== 第一次转写（真实 ASR） ===');
  console.log('status:', r1.status, 'body:', r1.body);
  if (r1.status !== 200 || !r1.body.text) throw new Error('转写失败');
  if (r1.body.cached !== false) throw new Error('首次应 cached=false');
  console.log('✅ 真实转写文本:', r1.body.text);

  // 第二次调用应命中缓存
  const r2 = await request(app).post(`/api/messages/${mid}/transcribe`).set('Authorization', `Bearer ${u1.token}`);
  console.log('\n=== 第二次转写（缓存命中） ===');
  console.log('status:', r2.status, 'cached:', r2.body.cached, 'text:', r2.body.text);
  if (r2.body.cached !== true) throw new Error('第二次应命中缓存');
  console.log('✅ 缓存命中');

  // 清理测试文件
  try { fs.unlinkSync(path.join(fdir, fname)); } catch {}
  process.exit(0);
})().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); });

