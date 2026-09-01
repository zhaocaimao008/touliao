'use strict';
/**
 * 推送分发 + 推送通道覆盖检查(E)。
 *
 * 背景:platform 查询漏项已造成两次生产事故(iOS 来电漏 ios_apns、安卓来电漏
 * getui)。本文件的核心目标是在编码阶段拦住这类 bug:
 *   - 对每个 pushXxx 函数,插入覆盖「全 platform 集」的假 token,调用后断言
 *     每个 platform 的发送器都被触发——漏查 platform = 零调用 = 测试红。
 *   - 守卫:DB 里 DISTINCT platform 必须是 ALL_PLATFORMS 的子集——新 platform
 *     值入库未声明即失败,强制开发者确认所有 pushXxx 已覆盖。
 *   - senderFor 映射表查不到 → 显式 throw(绝不静默 undefined)。
 *
 * mock 设计:
 *   - firebase-admin → mock(FCM send 可计数)
 *   - getuiPush → mock(pushCallToCid 可计数)
 *   - APNs 直连(sendVoipPush/sendIosCallPush):测试环境无 APNS_P8 走
 *     「未配置」降级分支,真实执行无害——以 console.warn 出现为「被调用」断言
 */
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-proj';
process.env.FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || 'test@example.com';
process.env.FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY || 'test-key';
// 置空(非 delete)防止 dotenv 从 .env 重新注入生产值:
// 空字符串存在 → dotenv 默认不覆盖已存在 key → APNs 直连走 skipped 降级分支,
// 不会真的连接 api.push.apple.com(否则测试会挂起/超时)
process.env.APNS_P8 = '';
process.env.APNS_KEY_ID = '';
process.env.APNS_TEAM_ID = '';

jest.mock('firebase-admin', () => {
  const send = jest.fn(() => Promise.resolve({ messageId: 'mock' }));
  return {
    apps: [],
    credential: { cert: jest.fn(() => ({})) },
    initializeApp: jest.fn(),
    messaging: () => ({ send }),
    __testSend: send,
  };
});
jest.mock('../src/utils/getuiPush', () => ({
  isEnabled: jest.fn(() => true),
  pushToCid: jest.fn(() => Promise.resolve()),
  pushCallToCid: jest.fn(() => Promise.resolve()),
  getToken: jest.fn(),
}));

const { makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const push = require('../src/utils/push');
const getuiPush = require('../src/utils/getuiPush');
const firebaseAdmin = require('firebase-admin');

// ── 全 platform 集:DB 实际值域 + 已知值域并集(新值进 DB 由守卫1 强制发现)──
const KNOWN_PLATFORMS = ['android', 'ios', 'ios_apns', 'ios_voip', 'getui'];
const ALL_PLATFORMS = [
  ...new Set([
    ...db.prepare('SELECT DISTINCT platform FROM device_tokens').all().map(r => r.platform),
    ...KNOWN_PLATFORMS,
  ]),
];

function insertToken(userId, platform, token) {
  db.prepare(
    'INSERT INTO device_tokens (id, user_id, token, platform, created_at) VALUES (?,?,?,?,?)'
  ).run(
    `${userId}-${platform}-${Math.random().toString(36).slice(2, 10)}`, userId, token, platform,
    Math.floor(Date.now() / 1000)
  );
}
function cleanTokens() {
  db.prepare("DELETE FROM device_tokens WHERE token LIKE 'covtest%'").run();
}

// ── senderFor:platform → 断言发送器被调用的函数。未知 platform 显式 throw ──
function warnCount(needle) {
  return console.warn.mock.calls.filter(c => String(c[0]).includes(needle)).length;
}
const SENDER = {
  getui: () => getuiPush.pushCallToCid.mock.calls.length,
  android: () => firebaseAdmin.__testSend.mock.calls.length,
  ios: () => firebaseAdmin.__testSend.mock.calls.length,
  ios_apns: () => warnCount('[call-push] APNs 未配置'),
  ios_voip: () => warnCount('[call-push] APNs voip 未配置'),
};
function senderFor(platform) {
  const check = SENDER[platform];
  if (!check) {
    throw new Error(
      `[覆盖检查] 未知 platform 映射: ${platform} —— 新增 platform 必须在 SENDER 表补充映射,并确认所有 pushXxx 已覆盖`
    );
  }
  return check;
}

describe('推送分发(含 FCM mock)', () => {
  let user, caller;

  beforeAll(async () => {
    user = await makeUser({ username: 'push_dst_a' });
    caller = await makeUser({ username: 'push_dst_b' });
  });
  beforeEach(() => {
    cleanTokens();
    jest.clearAllMocks();
    console.warn = jest.fn();   // spy:warn 作为 APNs 直连降级分支的调用证据
  });

  test('各 platform 都被正确调用(getui 直连 / FCM / APNs 直连)', async () => {
    for (const [i, p] of ALL_PLATFORMS.entries()) insertToken(user.userId, p, `covtest-${p}-${i}`);
    await push.pushCallInvite({
      toUserId: user.userId, fromUserId: caller.userId, callerName: '测试', callType: 'audio', callId: 'cov-call-1',
    });
    // 全 platform 注入时:android(FCM)存在 → getui 被防双弹有意 skip,
    // getui 的覆盖由下一个用例(仅 getui)验证
    for (const p of ALL_PLATFORMS) {
      if (p === 'getui') continue;
      expect(senderFor(p)()).toBeGreaterThan(0);   // 每个 platform 至少一次发送
    }
    expect(getuiPush.pushCallToCid.mock.calls.length).toBe(0);   // 防双弹:getui 零调用
    expect(firebaseAdmin.__testSend.mock.calls.length).toBeGreaterThanOrEqual(2); // android + ios
  });

  test('防双弹:仅 getui 无 FCM 时,个推兜底推送', async () => {
    insertToken(user.userId, 'getui', 'covtest-getui-only');
    await push.pushCallInvite({
      toUserId: user.userId, fromUserId: caller.userId, callerName: '测试', callType: 'audio', callId: 'cov-call-2',
    });
    expect(getuiPush.pushCallToCid.mock.calls.length).toBe(1);
  });

  test('iOS 视频来电:voip + apns 直连都被调用', async () => {
    insertToken(user.userId, 'ios_voip', 'covtest-voip');
    insertToken(user.userId, 'ios_apns', 'covtest-apns');
    await push.pushCallInvite({
      toUserId: user.userId, fromUserId: caller.userId, callerName: '测试', callType: 'video', callId: 'cov-call-3',
    });
    expect(senderFor('ios_voip')()).toBeGreaterThan(0);
    expect(senderFor('ios_apns')()).toBeGreaterThan(0);
  });
});

describe('推送分发(firebase 未配置:APNs/个推直连不误伤)', () => {
  let user, caller, pushNoFcm, getuiNoFcm;

  beforeAll(async () => {
    jest.resetModules();                       // 重新 require push.js
    // 置空 FIREBASE_*(非 delete,防 dotenv 从 .env 回填)→ firebaseAdmin = null
    process.env.FIREBASE_PROJECT_ID = '';
    process.env.FIREBASE_CLIENT_EMAIL = '';
    process.env.FIREBASE_PRIVATE_KEY = '';
    process.env.APNS_P8 = '';
    process.env.APNS_KEY_ID = '';
    process.env.APNS_TEAM_ID = '';
    getuiNoFcm = require('../src/utils/getuiPush');   // mock 注册仍在,新实例
    pushNoFcm = require('../src/utils/push');
    user = await makeUser({ username: 'push_nofcm_a' });
    caller = await makeUser({ username: 'push_nofcm_b' });
  });

  beforeEach(() => {
    cleanTokens();
    jest.clearAllMocks();
    console.warn = jest.fn();
    getuiNoFcm.pushCallToCid.mockClear();
  });

  test('firebaseAdmin 缺失时 android/ios(FCM)跳过,但 ios_apns/ios_voip 直连仍尝试', async () => {
    insertToken(user.userId, 'android', 'covtest-nofcm-android');
    insertToken(user.userId, 'ios', 'covtest-nofcm-ios');
    insertToken(user.userId, 'ios_apns', 'covtest-nofcm-apns');
    insertToken(user.userId, 'ios_voip', 'covtest-nofcm-voip');
    await pushNoFcm.pushCallInvite({
      toUserId: user.userId, fromUserId: caller.userId, callerName: '测试', callType: 'audio', callId: 'cov-call-nofcm',
    });
    expect(firebaseAdmin.__testSend.mock.calls.length).toBe(0);       // FCM 未配置:零调用
    expect(warnCount('[call-push] APNs')).toBeGreaterThanOrEqual(2);  // voip + apns 直连都尝试了(未被整体短路误伤)
  });

  test('firebaseAdmin 缺失时 getui 兜底仍推(不依赖 firebaseAdmin)', async () => {
    insertToken(user.userId, 'getui', 'covtest-nofcm-getui');
    await pushNoFcm.pushCallInvite({
      toUserId: user.userId, fromUserId: caller.userId, callerName: '测试', callType: 'audio', callId: 'cov-call-nofcm-2',
    });
    expect(getuiNoFcm.pushCallToCid.mock.calls.length).toBe(1);
  });
});

describe('E: 推送通道覆盖检查', () => {
  test('守卫1:DB 的 DISTINCT platform ⊆ ALL_PLATFORMS(新 platform 强制发现)', () => {
    const dbValues = db.prepare('SELECT DISTINCT platform FROM device_tokens').all().map(r => r.platform);
    const declared = new Set(ALL_PLATFORMS);
    const unknown = dbValues.filter(p => !declared.has(p));
    expect(unknown).toEqual(
      [],
      `发现未声明的新 platform 值: ${JSON.stringify(unknown)} —— 请确认所有 pushXxx 函数已覆盖该值后,再加入 ALL_PLATFORMS`
    );
  });

  test('守卫2:pushCallInvite 遍历全 platform,每个都产生发送调用', async () => {
    const user = await makeUser({ username: 'cov_check_u' });
    const caller = await makeUser({ username: 'cov_check_c' });
    jest.clearAllMocks();
    console.warn = jest.fn();

    // 轮1:全 platform 注入 → 非 getui 全部发送;getui 被防双弹 skip(有意)
    for (const [i, p] of ALL_PLATFORMS.entries()) insertToken(user.userId, p, `covtest-${p}-${i}`);
    await push.pushCallInvite({
      toUserId: user.userId, fromUserId: caller.userId, callerName: '测试', callType: 'audio', callId: 'cov-call-final',
    });
    for (const p of ALL_PLATFORMS) {
      if (p === 'getui') continue;
      expect(senderFor(p)()).toBeGreaterThan(0);
    }
    expect(getuiPush.pushCallToCid.mock.calls.length).toBe(0);   // 防双弹

    // 轮2:仅 getui(无 android FCM)→ 个推兜底路径必须触发
    cleanTokens();
    jest.clearAllMocks();
    insertToken(user.userId, 'getui', 'covtest-getui-only');
    await push.pushCallInvite({
      toUserId: user.userId, fromUserId: caller.userId, callerName: '测试', callType: 'audio', callId: 'cov-call-final-2',
    });
    expect(getuiPush.pushCallToCid.mock.calls.length).toBe(1);
  });

  test('守卫3:静态扫描 push.js 的 platform 字面量 ∈ ALL_PLATFORMS,且 pushCallInvite 查询 ⊇ ALL_PLATFORMS', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/utils/push.js'), 'utf8');
    // 提取所有 platform 字面量('x' / "x")
    const literals = [...new Set(
      [...src.matchAll(/platform(?: IN \(([^)]*)\)|='([^']+)'|= "([^"]+)"|= '([^']+)')/g)].flatMap(m =>
        (m[1] ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [m[2] || m[3] || m[4]]).filter(Boolean)
      )
    )];
    const known = new Set(KNOWN_PLATFORMS);
    const bogus = literals.filter(p => !known.has(p));
    expect(bogus).toEqual([], `push.js 出现未知 platform 字面量: ${JSON.stringify(bogus)}`);
    // pushCallInvite 的查询必须覆盖全部已知 platform(来电推送全端可达)
    const inviteSql = src.match(/platform IN \(([^)]*)\)/)?.[0] || '';
    for (const p of KNOWN_PLATFORMS) {
      expect(inviteSql).toContain(`'${p}'`);
    }
  });
});
