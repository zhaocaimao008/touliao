'use strict';
/**
 * 删除好友后的私聊规则（对齐微信）：A 删除 B 后，双方在原私聊里都发不出消息，
 * 提示各自的原因；重新加为好友后恢复。从未加过好友的陌生人私聊不受影响。
 */
const { makeUser, befriend, privateConversation } = require('./helpers');
const { privateSendGuard, deletedRelation } = require('../src/modules/messages/shared');
const contactsSvc = require('../src/modules/contacts/contacts.service');
const convSvc = require('../src/modules/conversations/conversations.service');

describe('删除好友后的私聊', () => {
  test('A 删 B：A、B 都发不出；重新加好友后恢复', async () => {
    const a = await makeUser({ username: 'cdc_a' });
    const b = await makeUser({ username: 'cdc_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    expect(privateSendGuard(convId, a.userId)).toBeNull();

    contactsSvc.deleteContact(a.userId, b.userId);
    expect(privateSendGuard(convId, a.userId)).toBe('你已删除对方，请重新添加好友后再发消息');
    expect(privateSendGuard(convId, b.userId)).toBe('对方已不是你的好友，请先发送好友申请');
    expect(deletedRelation(b.userId, a.userId)).toBeTruthy();

    await befriend(b, a);
    expect(privateSendGuard(convId, a.userId)).toBeNull();
    expect(privateSendGuard(convId, b.userId)).toBeNull();
  });

  test('从未加过好友的陌生人私聊不受影响', async () => {
    const x = await makeUser({ username: 'cdc_x' });
    const y = await makeUser({ username: 'cdc_y' });
    const { conversationId } = convSvc.getOrCreatePrivate(x.userId, y.userId, { internal: true });
    expect(privateSendGuard(conversationId, x.userId)).toBeNull();
    expect(deletedRelation(x.userId, y.userId)).toBeNull();
  });
});
