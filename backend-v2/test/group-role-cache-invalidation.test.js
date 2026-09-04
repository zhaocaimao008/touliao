'use strict';
// 回归测试：群主设管理员 / 转让群主必须立刻生效，不能等 memberRole 的 5s 缓存自然过期。
// 根因：invalidateConv() 已经在 kick/join/leave 里正确调用（同一模式），但 setRole()
// 和 transferOwner() 改了 conversation_members.role 之后漏调——如果这两个用户之前被
// memberRole() 缓存过角色，提权/转让后短时间内仍会被当成旧角色，管理操作被误拒。

const { v4: uuid } = require('uuid');
const { db } = require('../src/db/connection');
const { setRole, transferOwner } = require('../src/modules/groups/groups.service');
const { memberRole } = require('../src/modules/messages/shared');

function seedUser(id, username) {
  db.prepare('INSERT INTO users (id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)')
    .run(id, username, `1${id.slice(0, 10)}`, 'x', id.slice(0, 8));
}

function seedGroup(id, ownerId, memberIds) {
  db.prepare("INSERT INTO conversations (id,type,owner_id) VALUES (?,'group',?)").run(id, ownerId);
  db.prepare('INSERT INTO conversation_members (conversation_id,user_id,role) VALUES (?,?,?)').run(id, ownerId, 'owner');
  for (const uid of memberIds) {
    db.prepare('INSERT INTO conversation_members (conversation_id,user_id,role) VALUES (?,?,?)').run(id, uid, 'member');
  }
}

describe('群角色变更立即失效 memberRole 缓存', () => {
  test('setRole 提权为 admin 后同一 tick 内 memberRole 立刻反映新角色', () => {
    const owner = uuid(), member = uuid();
    seedUser(owner, `owner-${owner.slice(0, 8)}`);
    seedUser(member, `member-${member.slice(0, 8)}`);
    const conv = uuid();
    seedGroup(conv, owner, [member]);

    // 触发一次缓存写入(旧角色 member)，模拟提权前已有过权限检查
    expect(memberRole(conv, member)).toBe('member');

    setRole(null, conv, owner, member, 'admin');
    expect(memberRole(conv, member)).toBe('admin');
  });

  test('transferOwner 后新旧群主的角色同一 tick 内都立刻反映', () => {
    const owner = uuid(), member = uuid();
    seedUser(owner, `owner2-${owner.slice(0, 8)}`);
    seedUser(member, `member2-${member.slice(0, 8)}`);
    const conv = uuid();
    seedGroup(conv, owner, [member]);

    // 触发两个方向的缓存写入
    expect(memberRole(conv, owner)).toBe('owner');
    expect(memberRole(conv, member)).toBe('member');

    transferOwner(null, conv, owner, member);
    expect(memberRole(conv, member)).toBe('owner');
    expect(memberRole(conv, owner)).toBe('member');
  });
});
