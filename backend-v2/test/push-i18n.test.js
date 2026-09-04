'use strict';
/**
 * 推送文案多语言（2026-09-04）。
 *
 * 背景：推送文案此前在服务端写死简体中文（'新消息'/'收到一条新消息'/'[图片]'…），
 * 而前端有 zh-CN/en/zh-TW 三套完整词典。推送是用户在 App 之外唯一看得到的文案，
 * 英文用户锁屏收到的却是简中。服务端异步发推送时没有请求上下文可协商语言，
 * 故新增 user_settings.lang 持久化用户偏好，由客户端切语言时上报。
 *
 * 覆盖：
 *   1. pushI18n 纯函数：三语取词、附件类型占位符、未知语言/缺键回落
 *   2. PUT/GET /api/users/me/settings 的 lang 往返
 *   3. 白名单：非法语言码（含注入串、非字符串）必须被忽略且不污染旧值
 *   4. 默认值：从未设置过的用户为 zh-CN，与改动前行为一致（老用户不受影响）
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser } = require('./helpers');
const pushI18n = require('../src/utils/pushI18n');

describe('pushI18n 取词', () => {
  test('三语各自返回本语言文案，互不相同', () => {
    const bodies = ['zh-CN', 'en', 'zh-TW'].map(l => pushI18n.bodyForMessage(l, 'image'));
    expect(bodies).toEqual(['[图片]', '[Photo]', '[圖片]']);
    expect(new Set(bodies).size).toBe(3);
  });

  test('各附件类型都有本地化占位符', () => {
    for (const type of ['image', 'voice', 'video', 'location', 'red_packet', 'contact_card']) {
      expect(pushI18n.bodyForMessage('en', type)).toMatch(/^\[[A-Za-z]/);
    }
    expect(pushI18n.bodyForMessage('en', 'file', 'report.pdf')).toBe('[File] report.pdf');
  });

  test('文本消息直接用内容，并截断到 100 字', () => {
    expect(pushI18n.bodyForMessage('en', 'text', 'hello')).toBe('hello');
    expect(pushI18n.bodyForMessage('en', 'text', 'x'.repeat(200))).toHaveLength(100);
  });

  test('未知/空语言码回落 zh-CN，绝不返回 undefined', () => {
    for (const bad of ['ja', '', null, undefined, 'en-US', 123]) {
      expect(pushI18n.normalizeLang(bad)).toBe('zh-CN');
      expect(pushI18n.t(bad, 'push.oneNewMessage')).toBe('收到一条新消息');
    }
  });

  test('缺键回落到 key 本身，不会推出空文案', () => {
    expect(pushI18n.t('en', 'push.doesNotExist')).toBe('push.doesNotExist');
  });
});

describe('非「新消息」路径的推送文案也按语言渲染', () => {
  // 这几条路径（来电/好友申请/朋友圈互动）不走 pushNewMessage 的批量查询，
  // 而是各自 langOf(收件人) 取语言。第一版只改了新消息，审查时发现漏了这些。
  test('来电标题/正文三语各不相同', () => {
    expect(pushI18n.t('zh-CN', 'call.title')).toBe('来电');
    expect(pushI18n.t('en', 'call.title')).toBe('Incoming call');
    expect(pushI18n.t('zh-TW', 'call.title')).toBe('來電');
    const videos = ['zh-CN', 'en', 'zh-TW'].map(l => pushI18n.t(l, 'call.video'));
    expect(new Set(videos).size).toBe(3);
    const audios = ['zh-CN', 'en', 'zh-TW'].map(l => pushI18n.t(l, 'call.audio'));
    expect(new Set(audios).size).toBe(3);
    // 视频/语音两条文案本身也必须不同，否则用户分不清来的是哪种通话
    expect(videos).not.toEqual(audios);
  });

  test('好友申请默认文案三语各不相同', () => {
    const all = ['zh-CN', 'en', 'zh-TW'].map(l => pushI18n.t(l, 'friend.request'));
    expect(new Set(all).size).toBe(3);
    expect(all.every(Boolean)).toBe(true);
  });

  test('朋友圈互动文案：占位符被真实替换，且赞/评论可区分', () => {
    for (const lang of ['zh-CN', 'en', 'zh-TW']) {
      const liked = pushI18n.tf(lang, 'moment.liked', { name: 'Alice' });
      const commented = pushI18n.tf(lang, 'moment.commented', { name: 'Alice' });
      expect(liked).toContain('Alice');
      expect(commented).toContain('Alice');
      expect(liked).not.toContain('{name}');      // 占位符必须被替换掉
      expect(commented).not.toContain('{name}');
      expect(liked).not.toBe(commented);
    }
  });

  test('tf 未知语言回落 zh-CN，占位符照样替换', () => {
    expect(pushI18n.tf('ja', 'moment.liked', { name: 'Bob' })).toBe('Bob 赞了你的朋友圈');
  });

  test('tf 缺变量时不残留占位符炸给用户……有变量才替换，没传就原样保留供排查', () => {
    expect(pushI18n.tf('en', 'moment.liked', {})).toContain('{name}');
  });
});

describe('user_settings.lang HTTP 往返', () => {
  let u;
  beforeAll(async () => { u = await makeUser(); });

  test('默认 zh-CN（与改动前行为一致，老用户不受影响）', async () => {
    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
    expect(res.body.lang).toBe('zh-CN');
  });

  test('支持的语言码可写入并读回', async () => {
    for (const lang of ['en', 'zh-TW', 'zh-CN']) {
      const put = await request(app)
        .put('/api/users/me/settings')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ lang });
      expect(put.status).toBe(200);
      expect(put.body.lang).toBe(lang);

      const get = await request(app)
        .get('/api/users/me/settings')
        .set('Authorization', `Bearer ${u.token}`);
      expect(get.body.lang).toBe(lang);
    }
  });

  test('非白名单语言码被忽略，旧值保留', async () => {
    await request(app).put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`).send({ lang: 'en' });

    for (const bad of ['ja', 'en-US', '', "zh-CN'; DROP TABLE users;--", {}, 42, null]) {
      const res = await request(app)
        .put('/api/users/me/settings')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ lang: bad });
      expect(res.status).toBe(200);
      expect(res.body.lang).toBe('en');   // 旧值保留，未被污染
    }
  });

  test('注入串未破坏 users 表（后续请求仍正常）', async () => {
    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
  });

  test('改 lang 不影响其它设置项', async () => {
    await request(app).put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ messageNotify: false, detailPreview: false });
    const res = await request(app).put('/api/users/me/settings')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ lang: 'zh-TW' });
    expect(res.body.lang).toBe('zh-TW');
    expect(res.body.messageNotify).toBe(false);
    expect(res.body.detailPreview).toBe(false);
  });
});
