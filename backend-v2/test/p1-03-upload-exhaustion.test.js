'use strict';
/**
 * P1-03 上传磁盘耗尽防护回归测试
 *
 * 修复前：分片上传 MAX_FILE 默认 Infinity（单文件无上限）、云直传 credential
 * 无上限、无单用户并发会话数限制、无磁盘空间阈值 → 可被恶意用户耗尽磁盘。
 * 修复后：统一 200MB 单文件上限（可配 MAX_UPLOAD_BYTES）、单用户并发分片会话
 * ≤5、磁盘剩余 <500MB 拒绝、chunk 顺序写 + 超 expectedSize 终止、24h 残留清理。
 */
require('./testEnv');
const crypto = require('crypto');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');

const chunkUp = require('../src/modules/upload/chunk');
const MAX = chunkUp.MAX_FILE; // 200MB 或环境配置
const CHUNK = chunkUp.MAX_CHUNK;

let seq = 0;
const uniqHash = (tag) => crypto.createHash('sha256').update(`${tag}-${Date.now()}-${(seq += 1)}`).digest('hex');

describe('P1-03 上传磁盘耗尽防护', () => {
  let u1, u2, convId;

  beforeAll(async () => {
    u1 = await makeUser({ username: 'p103_u1' });
    u2 = await makeUser({ username: 'p103_u2' });
    await befriend(u1, u2);
    convId = await privateConversation(u1, u2);
  });

  function init(body) {
    return request(app)
      .post(`/api/messages/${convId}/upload-init`)
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ filename: 'a.png', size: 1000, hash: uniqHash('init'), ...body });
  }
  function sendChunk(uploadId, body, offset) {
    return request(app)
      .put(`/api/messages/${convId}/upload-chunk/${uploadId}?offset=${offset}`)
      .set('Authorization', `Bearer ${u1.token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(body);
  }

  test('init 声明超上限（>200MB）→ 400', async () => {
    const res = await init({ size: MAX + 1 });
    expect(res.status).toBe(400);
  });

  test('init 声明非法大小（0/负数/非数字）→ 400', async () => {
    for (const size of [0, -5, 'abc', null]) {
      const res = await init({ size });
      expect(res.status).toBe(400);
    }
  });

  test('非会话成员 init → 403', async () => {
    const u3 = await makeUser({ username: 'p103_u3' });
    const res = await request(app)
      .post(`/api/messages/${convId}/upload-init`)
      .set('Authorization', `Bearer ${u3.token}`)
      .send({ filename: 'a.png', size: 1000, hash: crypto.createHash('sha256').update('x').digest('hex') });
    expect(res.status).toBe(403);
  });

  test('单片超过 8MB → 413', async () => {
    const r = await init({ size: CHUNK * 2 });
    expect(r.status).toBe(200);
    const res = await sendChunk(r.body.uploadId, Buffer.alloc(CHUNK + 1), 0);
    expect(res.status).toBe(413);
  });

  test('chunk 累计超过 expectedSize → 400（receivedSize>expectedSize 终止）', async () => {
    const r = await init({ size: 100 });
    const id = r.body.uploadId;
    const c1 = await sendChunk(id, Buffer.alloc(60), 0);
    expect(c1.status).toBe(200);
    // 第二片 60 字节，60+60=120 > 100
    const c2 = await sendChunk(id, Buffer.alloc(60), 60);
    expect(c2.status).toBe(400);
  });

  test('重复 chunk（offset 与 received 不一致）→ 409 幂等拒绝', async () => {
    const r = await init({ size: 100 });
    const id = r.body.uploadId;
    await sendChunk(id, Buffer.alloc(50), 0);
    // 同 offset 再发（客户端应收到 409 并重新拉 status）
    const again = await sendChunk(id, Buffer.alloc(50), 0);
    expect(again.status).toBe(409);
  });

  test('伪造 chunk offset（跳片）→ 409', async () => {
    const r = await init({ size: 1000 });
    const id = r.body.uploadId;
    const res = await sendChunk(id, Buffer.alloc(10), 999); // 起始 offset 应为 0
    expect(res.status).toBe(409);
  });

  test('空分片 → 400', async () => {
    const r = await init({ size: 100, hash: uniqHash('empty') });
    expect(r.status).toBe(200);
    const res = await sendChunk(r.body.uploadId, Buffer.alloc(0), 0);
    expect(res.status).toBe(400);
  });

  test('非法 uploadId（路径穿越/非 hex）→ 400/404 均拒绝', async () => {
    const res = await sendChunk('../../etc/passwd', Buffer.alloc(1), 0);
    expect([400, 404]).toContain(res.status);
    const res2 = await sendChunk('nothex!', Buffer.alloc(1), 0);
    expect([400, 404]).toContain(res2.status);
  });

  test('单用户并发分片会话数 ≤ MAX_CONCURRENT_UPLOADS（超额 429）', async () => {
    const { MAX_CONCURRENT_UPLOADS } = require('../src/utils/upload');
    // 重置 u1 的并发计数（前面用例残留的 meta 不计入本用例）
    chunkUp.__testResetForUser?.(u1.userId);
    // 先占满上限（每个用不同 hash 制造不同 uploadId）
    const ids = [];
    for (let i = 0; i < MAX_CONCURRENT_UPLOADS; i++) {
      const r = await init({ size: 1000, hash: uniqHash(`conc${i}`) });
      expect(r.status).toBe(200);
      ids.push(r.body.uploadId);
    }
    const over = await init({ size: 1000, hash: uniqHash('overflow') });
    expect(over.status).toBe(429);

    // 清理：逐个 finish 不掉（大小不足），直接靠 sweep 的 meta 清理——测试内移除内存 meta 以便不污染后续
    for (const id of ids) chunkUp.__testDeleteMeta?.(id);
  });

  test('非所有者访问 upload status → 404（不泄露他人上传会话）', async () => {
    chunkUp.__testResetForUser?.(u1.userId);
    const r = await init({ size: 1000, hash: uniqHash('owner') });
    expect(r.status).toBe(200);
    const res = await request(app)
      .get(`/api/messages/${convId}/upload-status/${r.body.uploadId}`)
      .set('Authorization', `Bearer ${u2.token}`);
    expect(res.status).toBe(404);
    chunkUp.__testDeleteMeta?.(r.body.uploadId);
  });
});
