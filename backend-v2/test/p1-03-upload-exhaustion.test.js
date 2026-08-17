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

  test('直传超大文件（>200MB）→ 413 且不落盘', async () => {
    const before = require('fs').readdirSync(require('path').join(require('../src/config').uploadsRoot, 'files')).length;
    const res = await request(app)
      .post(`/api/messages/${convId}/upload`)
      .set('Authorization', `Bearer ${u1.token}`)
      .field('reply_to_id', '')
      .attach('file', Buffer.alloc(MAX + 1), 'huge.png');
    expect(res.status).toBe(413);
    const after = require('fs').readdirSync(require('path').join(require('../src/config').uploadsRoot, 'files')).length;
    expect(after).toBe(before); // multer 超限自动清理已写部分
  });

  test('直传同用户并发请求超过上限 → 429（guard 生效）', async () => {
    const { MAX_CONCURRENT_UPLOADS } = require('../src/utils/upload');
    // 并发发出 MAX_CONCURRENT_UPLOADS+1 个直传（各 3MB，避免 413 干扰）
    const bufs = Array.from({ length: MAX_CONCURRENT_UPLOADS + 1 }, (_, i) => Buffer.alloc(3 * 1024 * 1024, i + 1));
    const results = await Promise.all(
      bufs.map((b, i) =>
        request(app)
          .post(`/api/messages/${convId}/upload`)
          .set('Authorization', `Bearer ${u1.token}`)
          .field('reply_to_id', '')
          .attach('file', b, `par${i}.png`)
      )
    );
    const statuses = results.map(r => r.status);
    const okCount = statuses.filter(s => s === 200).length;
    const limited = statuses.filter(s => s === 429).length;
    expect(okCount).toBeLessThanOrEqual(MAX_CONCURRENT_UPLOADS);
    expect(limited).toBeGreaterThanOrEqual(1);
    // 清理并发直传产生的文件（防止后续用例/全量回归污染磁盘与 registry）
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(require('../src/config').uploadsRoot, 'files');
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).size >= 3 * 1024 * 1024) fs.unlinkSync(p);
    }
  });

  test('直传完成后计数释放：完成若干直传后再并发不误杀（M1 回归）', async () => {
    const { MAX_CONCURRENT_UPLOADS } = require('../src/utils/upload');
    // 先串行完成 2 个直传，再并发 MAX 个：若 release 双触发导致计数漂移（净-1），
    // 并发 MAX 个时实际在途会超过上限仍放行（漂移）或误杀；此处应恰好 MAX 全 200。
    for (let i = 0; i < 2; i++) {
      const r = await request(app)
        .post(`/api/messages/${convId}/upload`)
        .set('Authorization', `Bearer ${u1.token}`)
        .field('reply_to_id', '')
        .attach('file', Buffer.alloc(1024 * 1024, i + 1), `done${i}.png`);
      expect(r.status).toBe(200);
    }
    const bufs = Array.from({ length: MAX_CONCURRENT_UPLOADS }, (_, i) => Buffer.alloc(1024 * 1024, i + 9));
    const results = await Promise.all(
      bufs.map((b, i) =>
        request(app)
          .post(`/api/messages/${convId}/upload`)
          .set('Authorization', `Bearer ${u1.token}`)
          .field('reply_to_id', '')
          .attach('file', b, `parM1_${i}.png`)
      )
    );
    const statuses = results.map(r => r.status);
    // 无漂移：MAX 个并发应全部成功（正好等于上限）；若漂移净-1 会放行更多，
    // 若残留计数则部分 429。两者都说明 release 计数不正确。
    expect(statuses.every(s => s === 200)).toBe(true);
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(require('../src/config').uploadsRoot, 'files');
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).size >= 1024 * 1024) fs.unlinkSync(p);
    }
  });

  test('background-upload 超大图片（>5MB）→ 413（已切回 5MB 图片上传器）', async () => {
    const res = await request(app)
      .post(`/api/messages/conversation/${convId}/background-upload`)
      .set('Authorization', `Bearer ${u1.token}`)
      .attach('file', Buffer.alloc(6 * 1024 * 1024, 7), 'bg.png');
    expect(res.status).toBe(413);
  });
});
