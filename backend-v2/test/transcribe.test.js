'use strict';
/**
 * 语音转文字：POST /api/messages/:msgId/transcribe
 *
 * 说明：本测试用 jest.mock 桩掉 asrClient（仅验证 Node 侧逻辑——权限/类型/幂等缓存/503），
 *       ASR 引擎本身的「真转写」由独立服务 /asr 单独验证（见任务报告），不在单测内跑重模型。
 */

// ── 桩掉 ASR 客户端：可切换「正常返回」与「服务不可用」两种行为 ──
let mockAsrBehavior = { mode: 'ok', text: '你好今天天气不错' };
jest.mock('../src/utils/asrClient', () => {
  class AsrUnavailableError extends Error {
    constructor(msg) { super(msg); this.name = 'AsrUnavailableError'; this.asrUnavailable = true; }
  }
  return {
    AsrUnavailableError,
    health: jest.fn(async () => mockAsrBehavior.mode === 'ok'),
    transcribe: jest.fn(async () => {
      if (mockAsrBehavior.mode === 'down') throw new AsrUnavailableError('转写超时');
      return { text: mockAsrBehavior.text, language: 'zh', duration: 2.5 };
    }),
  };
});

require('./testEnv');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const { v4: uuid } = require('uuid');

// 在 uploadsRoot/files 下写一个占位音频文件，使 readVoiceAudio 能读到（内容不参与 mock 转写）
function writeVoiceFile() {
  const dir = path.join(config.uploadsRoot, 'files');
  fs.mkdirSync(dir, { recursive: true });
  const name = `test-voice-${uuid()}.webm`;
  fs.writeFileSync(path.join(dir, name), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]));
  return `/uploads/files/${name}`;
}

describe('语音转文字 transcribe', () => {
  let u1, u2, convId, voiceMsgId, textMsgId, cleanupFiles = [];

  beforeAll(async () => {
    u1 = await makeUser();
    u2 = await makeUser();
    await befriend(u1, u2);
    convId = await privateConversation(u1, u2);

    const now = Math.floor(Date.now() / 1000);
    const fileUrl = writeVoiceFile();
    cleanupFiles.push(path.join(config.uploadsRoot, fileUrl.replace(/^\/uploads\//, '')));

    voiceMsgId = uuid();
    textMsgId = uuid();
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(voiceMsgId, convId, u1.userId, 'voice', 'voice.webm', fileUrl, now);
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(textMsgId, convId, u1.userId, 'text', '普通文本', '', now + 1);
  });

  afterAll(() => {
    cleanupFiles.forEach(f => { try { fs.unlinkSync(f); } catch { /* ignore */ } });
  });

  beforeEach(() => { mockAsrBehavior = { mode: 'ok', text: '你好今天天气不错' }; });

  test('会话成员转写语音：返回真实文本，cached=false', async () => {
    const res = await request(app)
      .post(`/api/messages/${voiceMsgId}/transcribe`)
      .set('Authorization', `Bearer ${u2.token}`);
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('你好今天天气不错');
    expect(res.body.cached).toBe(false);
  });

  test('二次转写：命中缓存 cached=true，不再调用 ASR', async () => {
    const asr = require('../src/utils/asrClient');
    asr.transcribe.mockClear();
    const res = await request(app)
      .post(`/api/messages/${voiceMsgId}/transcribe`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('你好今天天气不错');
    expect(res.body.cached).toBe(true);
    expect(asr.transcribe).not.toHaveBeenCalled();
  });

  test('非语音消息：返回 400', async () => {
    const res = await request(app)
      .post(`/api/messages/${textMsgId}/transcribe`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(400);
  });

  test('非会话成员：返回 403', async () => {
    const stranger = await makeUser();
    const res = await request(app)
      .post(`/api/messages/${voiceMsgId}/transcribe`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });

  test('消息不存在：返回 404', async () => {
    const res = await request(app)
      .post(`/api/messages/${uuid()}/transcribe`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(404);
  });

  test('未登录：返回 401', async () => {
    const res = await request(app).post(`/api/messages/${voiceMsgId}/transcribe`);
    expect(res.status).toBe(401);
  });

  test('ASR 服务不可用：返回 503，不落假数据', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fileUrl = writeVoiceFile();
    cleanupFiles.push(path.join(config.uploadsRoot, fileUrl.replace(/^\/uploads\//, '')));
    const mid = uuid();
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(mid, convId, u1.userId, 'voice', 'voice.webm', fileUrl, now);

    mockAsrBehavior = { mode: 'down' };
    const res = await request(app)
      .post(`/api/messages/${mid}/transcribe`)
      .set('Authorization', `Bearer ${u1.token}`);
    expect(res.status).toBe(503);
    // 未把假数据写进库
    const row = db.prepare('SELECT transcript FROM messages WHERE id=?').get(mid);
    expect(row.transcript == null || row.transcript === '').toBe(true);
  });
});
