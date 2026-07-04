'use strict';
/**
 * 回归（round49）：Web Push 订阅 endpoint 必须限制到已知浏览器推送服务域名，防 SSRF。
 *
 * bug：notifications.webSubscribe 只校验 endpoint 是字符串且 ≤2048 字符，不限制协议/主机。
 * 攻击者注册 endpoint 指向内网/云元数据(http://169.254.169.254、http://localhost:port)的订阅，
 * 别人给他发消息触发 pushNewMessage→pushToUser→webpush.sendNotification 时，服务器就代其向该
 * 内网地址发请求 → SSRF(端口探测/触发内网副作用)。合法 Web Push endpoint 只可能来自
 * FCM/Mozilla/Apple/WNS，故白名单化。入口(webSubscribe)校验 + 发送前(pushToUser)纵深过滤。
 */
const { isAllowedPushEndpoint } = require('../src/utils/push');
const { request, app, makeUser } = require('./helpers');

describe('Web Push endpoint SSRF 防护（round49）', () => {
  describe('isAllowedPushEndpoint 纯函数', () => {
    test('放行已知推送服务（https + 白名单域名/子域）', () => {
      for (const ep of [
        'https://fcm.googleapis.com/fcm/send/abcDEF123',
        'https://android.googleapis.com/gcm/send/xyz',
        'https://updates.push.services.mozilla.com/wpush/v2/gAAbc',
        'https://db5p.notify.windows.com/w/?token=abc',
        'https://xyz.wns.windows.com/w/?token=abc',
        'https://web.push.apple.com/abc123',
      ]) {
        expect(isAllowedPushEndpoint(ep)).toBe(true);
      }
    });

    test('拦截内网/元数据/回环地址', () => {
      for (const ep of [
        'http://169.254.169.254/latest/meta-data/',
        'https://169.254.169.254/',
        'http://localhost:6379/',
        'https://localhost/x',
        'http://127.0.0.1:3002/api',
        'http://[::1]:8080/',
        'http://192.168.1.10/',
        'http://10.0.0.5:9200/',
      ]) {
        expect(isAllowedPushEndpoint(ep)).toBe(false);
      }
    });

    test('拦截非 https 协议与后缀绕过', () => {
      expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false); // 非 https
      expect(isAllowedPushEndpoint('https://evilgoogleapis.com/x')).toBe(false);          // 无前导点，非子域
      expect(isAllowedPushEndpoint('https://googleapis.com.evil.com/x')).toBe(false);     // 挂后缀绕过
      expect(isAllowedPushEndpoint('file:///etc/passwd')).toBe(false);
      expect(isAllowedPushEndpoint('not a url')).toBe(false);
      expect(isAllowedPushEndpoint(undefined)).toBe(false);
      expect(isAllowedPushEndpoint('')).toBe(false);
    });
  });

  describe('POST /api/notifications/web-subscribe 端到端', () => {
    let u;
    beforeAll(async () => { u = await makeUser({ username: 'ssrf_sub' }); });

    const sub = (endpoint) => ({ endpoint, keys: { p256dh: 'BOxxk', auth: 'abc' } });

    test('合法 fcm endpoint 订阅成功（200）', async () => {
      const res = await request(app).post('/api/notifications/web-subscribe')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ subscription: sub('https://fcm.googleapis.com/fcm/send/legit123') });
      expect(res.status).toBe(200);
    });

    test('内网 endpoint 订阅被拒（400，此前会 200 存入→SSRF）', async () => {
      const res = await request(app).post('/api/notifications/web-subscribe')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ subscription: sub('http://169.254.169.254/latest/meta-data/') });
      expect(res.status).toBe(400);
    });

    test('回环地址 endpoint 订阅被拒（400）', async () => {
      const res = await request(app).post('/api/notifications/web-subscribe')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ subscription: sub('http://127.0.0.1:3002/api/internal') });
      expect(res.status).toBe(400);
    });
  });
});
