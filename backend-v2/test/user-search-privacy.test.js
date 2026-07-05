'use strict';
/**
 * 隐私回归：/api/users/search 结果不得泄露 bio 与 phone。
 *
 * getUserDetail 对「非好友且 profile_visible=0」会隐藏 bio；搜索若照返 bio 就绕过了
 * 资料可见性。phone 早已约定不返回。本测试锁定这两个字段不出现在搜索结果里。
 */
const { request, app, makeUser } = require('./helpers');

describe('用户搜索隐私：不泄露 bio / phone', () => {
  let u1, u2, uniqName;

  beforeAll(async () => {
    // 用户名限 20 字符：Date.now() 取后 8 位保证唯一又不超长
    const ts = Date.now().toString().slice(-8);
    uniqName = `srchpriv_${ts}`;
    u1 = await makeUser({ username: uniqName });
    u2 = await makeUser({ username: `srchpriv_o_${ts}` });

    // u1 设置个性签名 + 关闭资料对非好友可见
    await request(app).put('/api/users/profile')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ bio: '这是我的私密签名' });
    await request(app).put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ profileVisible: false });
  });

  test('搜索能按用户名命中，但结果不含 bio / phone', async () => {
    const res = await request(app).get(`/api/users/search?q=${encodeURIComponent(uniqName)}`)
      .set('Authorization', `Bearer ${u2.token}`);
    expect(res.status).toBe(200);
    const hit = res.body.find(u => u.id === u1.userId);
    expect(hit).toBeTruthy();               // 命中该用户
    expect(hit.username).toBe(uniqName);    // 基本资料仍可见（用于加好友）
    expect(hit.bio).toBeUndefined();        // 不泄露签名
    expect(hit.phone).toBeUndefined();      // 不泄露手机号
  });
});
