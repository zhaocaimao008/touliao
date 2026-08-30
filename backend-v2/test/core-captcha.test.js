'use strict';
/**
 * 图形验证码：取图 + 一次性校验 + 登录接口的开关联动（admin_settings.feature_login_captcha）。
 * 默认关闭；开启后登录必须带正确验证码；核销后同一 captchaId 不能重复使用。
 * 隔离测试库，见 testEnv.js。
 */
const { request, app, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const captchaUtil = require('../src/utils/captcha');

function setLoginCaptchaRequired(on) {
  db.prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES ('feature_login_captcha', ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(on ? 'on' : 'off');
}

afterAll(() => setLoginCaptchaRequired(false)); // 复位，避免污染同库其它用例

describe('图形验证码', () => {
  test('GET /api/auth/captcha 返回 captchaId + svgDataUrl', async () => {
    const res = await request(app).get('/api/auth/captcha');
    expect(res.status).toBe(200);
    expect(typeof res.body.captchaId).toBe('string');
    expect(res.body.svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  test('verify()：错误文本失败', () => {
    const { captchaId } = captchaUtil.generate();
    expect(captchaUtil.verify(captchaId, 'definitely-wrong')).toBe(false);
  });

  test('verify()：正确文本（不分大小写）第一次通过', () => {
    const { captchaId } = captchaUtil.generate();
    const text = captchaUtil._peekTextForTests(captchaId);
    expect(captchaUtil.verify(captchaId, text.toUpperCase())).toBe(true);
  });

  test('verify()：一次性核销——验证过一次后，同一 captchaId 再验（即便文本正确）也失败', () => {
    const { captchaId } = captchaUtil.generate();
    const text = captchaUtil._peekTextForTests(captchaId);
    expect(captchaUtil.verify(captchaId, text)).toBe(true);
    expect(captchaUtil.verify(captchaId, text)).toBe(false);
  });

  test('开关关闭（默认）：登录不带验证码字段也能成功', async () => {
    setLoginCaptchaRequired(false);
    const u = await makeUser({ username: 'cap_off' });
    const res = await request(app).post('/api/auth/login').send({ phone: u.phone, password: u.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test('开关开启：登录不带验证码 → 400', async () => {
    setLoginCaptchaRequired(true);
    const u = await makeUser({ username: 'cap_on_missing' });
    const res = await request(app).post('/api/auth/login').send({ phone: u.phone, password: u.password });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/验证码/);
  });

  test('开关开启：登录带错误验证码 → 400，即便密码正确也不放行', async () => {
    setLoginCaptchaRequired(true);
    const u = await makeUser({ username: 'cap_on_wrong' });
    const { captchaId } = captchaUtil.generate();
    const res = await request(app).post('/api/auth/login')
      .send({ phone: u.phone, password: u.password, captchaId, captchaText: 'zzzzz' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/验证码/);
  });

  test('开关开启：登录带正确验证码 → 成功；同一验证码不能被第二次登录尝试复用', async () => {
    setLoginCaptchaRequired(true);
    const u = await makeUser({ username: 'cap_on_correct' });
    const { captchaId } = captchaUtil.generate();
    const text = captchaUtil._peekTextForTests(captchaId);

    const ok = await request(app).post('/api/auth/login')
      .send({ phone: u.phone, password: u.password, captchaId, captchaText: text });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    // 同一 captchaId+text 再试一次（模拟重放攻击）应该失败，因为已被核销
    const replay = await request(app).post('/api/auth/login')
      .send({ phone: u.phone, password: u.password, captchaId, captchaText: text });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toMatch(/验证码/);
  });
});
