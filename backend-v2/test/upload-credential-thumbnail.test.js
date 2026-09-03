'use strict';
/**
 * POST /api/upload/credential 缩略图预签名 URL（2026-09-03，性能审计配套）。
 * 云直传路径服务器不经手字节，无法自己生成缩略图——改为额外发一个 <uuid>_thumb.webp
 * 的预签名 PUT URL，前端用 Canvas 生成缩略图后再传一次。图片扩展名才发，非图片
 * （如 pdf）不该额外拿一个永远不会被写入的对象凭证。
 *
 * 单测隔离：mock cloudStorage（真实 R2 凭证不在测试环境）+ isMember（不建真实会话），
 * 只验证本次新增的 credential 控制器逻辑，不是端到端集成测试。
 */
jest.mock('../src/utils/cloudStorage', () => ({
  isConfigured: () => true,
  getPresignedPutUrl: jest.fn(async (key) => ({ uploadUrl: `https://fake-r2.example/${key}?sig=x` })),
}));
jest.mock('../src/modules/messages/shared', () => ({
  isMember: () => true,
}));
jest.mock('../src/utils/fileRegistry', () => ({ registerFile: jest.fn() }));

const { credential } = require('../src/modules/upload/upload.controller');
const { getPresignedPutUrl } = require('../src/utils/cloudStorage');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('POST /api/upload/credential 缩略图预签名', () => {
  beforeEach(() => getPresignedPutUrl.mockClear());

  test('图片文件名（.jpg）：响应带 thumbUploadUrl，key 与原图同 uuid + _thumb.webp', async () => {
    const req = { user: { id: 'u1' }, body: { filename: 'photo.jpg', contentType: 'image/jpeg', conversationId: 'c1' } };
    const res = makeRes();
    await credential(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.thumbUploadUrl).toBeTruthy();

    // publicUrl: /uploads/files/<uuid>.jpg —— 缩略图 key 须用同一个 uuid + _thumb.webp
    const uuid = body.publicUrl.match(/\/uploads\/files\/([^.]+)\.jpg$/)[1];
    const thumbCall = getPresignedPutUrl.mock.calls.find(([key]) => key.includes('_thumb.webp'));
    expect(thumbCall).toBeTruthy();
    expect(thumbCall[0]).toBe(`uploads/files/${uuid}_thumb.webp`);
    expect(thumbCall[1]).toBe('image/webp');
  });

  test('非图片文件名（.pdf）：不发缩略图预签名请求，响应无 thumbUploadUrl', async () => {
    const req = { user: { id: 'u1' }, body: { filename: 'doc.pdf', contentType: 'application/pdf', conversationId: 'c1' } };
    const res = makeRes();
    await credential(req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.thumbUploadUrl).toBeUndefined();
    expect(getPresignedPutUrl).toHaveBeenCalledTimes(1); // 只有原图那一次
  });

  test('GIF：不发缩略图预签名请求（与本地路径 THUMBNAIL_MIMES 跳过 GIF 同口径）', async () => {
    const req = { user: { id: 'u1' }, body: { filename: 'anim.gif', contentType: 'image/gif', conversationId: 'c1' } };
    const res = makeRes();
    await credential(req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.thumbUploadUrl).toBeUndefined();
    expect(getPresignedPutUrl).toHaveBeenCalledTimes(1);
  });
});
