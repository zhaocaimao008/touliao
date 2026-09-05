'use strict';

jest.mock('../src/db/connection', () => ({
  db: {
    prepare: jest.fn(() => ({
      get: jest.fn(),
      all: jest.fn(() => [{ token: 'device-token', platform: 'android' }]),
      run: jest.fn(),
    })),
  },
}));
jest.mock('../src/utils/push', () => ({
  pushToUser: jest.fn(() => Promise.resolve()),
}));

const { NotificationCenter, CHANNELS, PRIORITY } = require('../src/modules/notifications/notificationCenter');
const { pushToUser } = require('../src/utils/push');
const { db } = require('../src/db/connection');

describe('NotificationCenter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('routes app push through the canonical push service', async () => {
    const center = new NotificationCenter();

    await expect(center._sendViaAppPush('user-1', {
      title: '新消息',
      content: '你好',
      data: { conversationId: 'conv-1' },
    })).resolves.toMatchObject({ status: 'sent', channel: CHANNELS.APP_PUSH });

    expect(pushToUser).toHaveBeenCalledWith('user-1', expect.objectContaining({
      senderName: '新消息',
      body: '你好',
      conversationId: 'conv-1',
    }));
  });

  test('honors every channel preference, including app push and wechat work', () => {
    const center = new NotificationCenter();
    const prefs = {
      emailEnabled: true,
      smsEnabled: true,
      dingtalkEnabled: true,
      wechatWorkEnabled: false,
      appPushEnabled: false,
    };

    const channels = center._selectChannels(PRIORITY.CRITICAL, prefs);

    expect(channels).not.toContain(CHANNELS.APP_PUSH);
    expect(channels).not.toContain(CHANNELS.WECHAT_WORK);
  });

  test('treats SQLite numeric preference values as booleans', () => {
    db.prepare.mockReturnValueOnce({
      get: jest.fn(() => ({
        email_enabled: 1,
        sms_enabled: 0,
        dingtalk_enabled: 0,
        wechat_work_enabled: 0,
        app_push_enabled: 0,
      })),
    });

    const center = new NotificationCenter();

    expect(center._getUserPreferences('user-1')).toEqual({
      emailEnabled: true,
      smsEnabled: false,
      dingtalkEnabled: false,
      wechatWorkEnabled: false,
      appPushEnabled: false,
    });
  });
});
