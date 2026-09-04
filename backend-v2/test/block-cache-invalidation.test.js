'use strict';
// 回归测试：解除拉黑必须立刻生效，不能等 privateSendGuard 的 5s 黑名单缓存自然过期。
// 根因：invalidateBlocked() 早就写好了（对齐 invalidateConv 在群成员变更时的失效模式），
// 但从未从 contacts.service.js 的 block()/unblock() 里调用，也没被 module.exports 导出——
// 纯内存缓存命中期间，解除拉黑后仍会把对方的消息判成"已发出但被拒收"，最长卡 5 秒。

const { v4: uuid } = require('uuid');
const { db } = require('../src/db/connection');
const { block, unblock } = require('../src/modules/contacts/contacts.service');
const { privateSendGuard } = require('../src/modules/messages/shared');

function seedUser(id, username) {
  db.prepare('INSERT INTO users (id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)')
    .run(id, username, `1${id.slice(0, 10)}`, 'x', id.slice(0, 8));
}

function seedPrivateConversation(id, memberIds) {
  db.prepare("INSERT INTO conversations (id,type) VALUES (?,'private')").run(id);
  for (const uid of memberIds) {
    db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id, uid);
  }
}

describe('block/unblock 立即失效 privateSendGuard 缓存', () => {
  test('unblock 后同一时刻(未等5s缓存过期)对方立刻能发消息', () => {
    const alice = uuid(), bob = uuid();
    seedUser(alice, `alice-${alice.slice(0, 8)}`);
    seedUser(bob, `bob-${bob.slice(0, 8)}`);
    const conv = uuid();
    seedPrivateConversation(conv, [alice, bob]);

    // 未拉黑：bob 发消息给 alice 允许
    expect(privateSendGuard(conv, bob)).toBeNull();

    // alice 拉黑 bob → bob 发消息应被拒绝(命中缓存也必须立刻反映新状态)
    block(alice, bob);
    expect(privateSendGuard(conv, bob)).toBe('消息已发出，但被对方拒收');

    // alice 解除拉黑 → 同一 tick 内 bob 必须立刻能发消息，不能还卡在缓存里
    unblock(alice, bob);
    expect(privateSendGuard(conv, bob)).toBeNull();
  });

  test('block 立刻生效，不依赖缓存尚未写入的偶然时序', () => {
    const carol = uuid(), dave = uuid();
    seedUser(carol, `carol-${carol.slice(0, 8)}`);
    seedUser(dave, `dave-${dave.slice(0, 8)}`);
    const conv = uuid();
    seedPrivateConversation(conv, [carol, dave]);

    // 先触发一次缓存写入(未拉黑状态)，模拟拉黑前已有正常聊天场景
    expect(privateSendGuard(conv, dave)).toBeNull();

    block(carol, dave);
    expect(privateSendGuard(conv, dave)).toBe('消息已发出，但被对方拒收');
  });
});
