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

// F-13 changes the endpoint contract: byte-unchecked cloud PUT is closed until
// quarantine/scanning is available. Keep all three format cases and assert no
// original/thumbnail credentials or registry grants escape the gate.
describe('POST /api/upload/credential 审核不可用时拒绝预签名', () => {
  beforeEach(() => { getPresignedPutUrl.mockClear(); require('../src/utils/fileRegistry').registerFile.mockClear(); });
  test.each([['photo.jpg','image/jpeg'],['doc.pdf','application/pdf'],['anim.gif','image/gif']])('%s cannot bypass scanning with a claimed MIME', async (filename,contentType) => {
    const req = {user:{id:'u1'},body:{filename,contentType,conversationId:'c1'}};
    const res = makeRes(); const next=jest.fn();
    await credential(req,res,next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({status:503,code:'MEDIA_MODERATION_UNAVAILABLE'}));
    expect(res.json).not.toHaveBeenCalled();
    expect(getPresignedPutUrl).not.toHaveBeenCalled();
    expect(require('../src/utils/fileRegistry').registerFile).not.toHaveBeenCalled();
  });
});
