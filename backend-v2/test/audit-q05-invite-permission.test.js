'use strict';

const { request, app, makeUser, befriend } = require('./helpers');
const { db } = require('../src/db/connection');
const { previewByToken, joinByToken } = require('../src/modules/groups/groups.service');

const auth = user => ({ Authorization: `Bearer ${user.token}` });

async function createGroup(owner, members) {
  const res = await request(app)
    .post('/api/messages/conversation/group')
    .set(auth(owner))
    .send({ name: 'Q05 invite permission', memberIds: members.map(user => user.userId) });
  expect(res.status).toBe(200);
  return res.body.conversationId;
}

describe('Q05 group invite credential permissions', () => {
  let owner;
  let admin;
  let member;
  let nonmember;
  let savedTokenJoiner;
  let directTargetForAdmin;
  let directTargetForOwner;
  let convId;

  const inviteLink = user => request(app)
    .post(`/api/messages/conversation/${convId}/invite-link`)
    .set(auth(user));
  const qrCode = user => request(app)
    .get(`/api/messages/conversation/${convId}/qr-code`)
    .set(auth(user));
  const manage = memberCanInvite => request(app)
    .put(`/api/messages/conversation/${convId}/manage`)
    .set(auth(owner))
    .send({ member_can_invite: memberCanInvite });
  const setRole = role => request(app)
    .put(`/api/messages/conversation/${convId}/members/${member.userId}/role`)
    .set(auth(owner))
    .send({ role });
  const directInvite = (actor, target) => request(app)
    .post(`/api/messages/conversation/${convId}/invite`)
    .set(auth(actor))
    .send({ userIds: [target.userId] });

  beforeAll(async () => {
    owner = await makeUser({ username: 'q05_owner' });
    admin = await makeUser({ username: 'q05_admin' });
    member = await makeUser({ username: 'q05_member' });
    nonmember = await makeUser({ username: 'q05_nonmember' });
    savedTokenJoiner = await makeUser({ username: 'q05_saved_joiner' });
    directTargetForAdmin = await makeUser({ username: 'q05_direct_admin' });
    directTargetForOwner = await makeUser({ username: 'q05_direct_owner' });

    await befriend(owner, admin);
    await befriend(owner, member);
    await befriend(member, directTargetForAdmin);
    await befriend(member, directTargetForOwner);
    await befriend(owner, directTargetForOwner);

    convId = await createGroup(owner, [admin, member]);
    const promoted = await request(app)
      .put(`/api/messages/conversation/${convId}/members/${admin.userId}/role`)
      .set(auth(owner))
      .send({ role: 'admin' });
    expect(promoted.status).toBe(200);
  });

  test('owner and admin can obtain and reuse link/QR credentials while member invites are disabled', async () => {
    const ownerLink = await inviteLink(owner);
    const ownerQr = await qrCode(owner);
    const adminLink = await inviteLink(admin);
    const adminQr = await qrCode(admin);

    expect([ownerLink.status, ownerQr.status, adminLink.status, adminQr.status]).toEqual([200, 200, 200, 200]);
    expect(Boolean(ownerLink.body.token)).toBe(true);
    expect([
      ownerLink.body.token === ownerQr.body.token,
      ownerLink.body.token === adminLink.body.token,
      ownerLink.body.token === adminQr.body.token,
    ]).toEqual([true, true, true]);
  });

  test('member and nonmember cannot obtain link/QR credentials when member invites are disabled and a token exists', async () => {
    const memberLink = await inviteLink(member);
    const memberQr = await qrCode(member);
    const outsiderLink = await inviteLink(nonmember);
    const outsiderQr = await qrCode(nonmember);

    expect([memberLink.status, memberQr.status]).toEqual([403, 403]);
    expect([outsiderLink.status, outsiderQr.status]).toEqual([403, 403]);
  });

  test('expired credentials cannot be previewed or used, members cannot replace them, and owner can regenerate', async () => {
    db.prepare('UPDATE group_invite_tokens SET expires_at=? WHERE conversation_id=?')
      .run(Math.floor(Date.now() / 1000) - 1, convId);
    const expired = db.prepare('SELECT token FROM group_invite_tokens WHERE conversation_id=?').get(convId).token;

    const memberLink = await inviteLink(member);
    const memberQr = await qrCode(member);

    expect(() => previewByToken(savedTokenJoiner.userId, expired)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => joinByToken(null, savedTokenJoiner.userId, expired)).toThrow(expect.objectContaining({ status: 404 }));
    expect([memberLink.status, memberQr.status]).toEqual([403, 403]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM group_invite_tokens WHERE conversation_id=? AND expires_at>?')
      .get(convId, Math.floor(Date.now() / 1000)).n).toBe(0);

    const ownerQr = await qrCode(owner);
    expect(ownerQr.status).toBe(200);
    expect(Boolean(ownerQr.body.token)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM group_invite_tokens WHERE conversation_id=? AND expires_at>?')
      .get(convId, Math.floor(Date.now() / 1000)).n).toBe(1);
  });

  test('a member loses credential access after the toggle closes, admin retains it, and the saved shared token remains usable', async () => {
    const enabled = await manage(true);
    expect(enabled.status).toBe(200);

    const memberLink = await inviteLink(member);
    expect(memberLink.status).toBe(200);
    const savedToken = memberLink.body.token;

    const disabled = await manage(false);
    expect(disabled.status).toBe(200);
    const memberLinkAfter = await inviteLink(member);
    const memberQrAfter = await qrCode(member);
    const adminLinkAfter = await inviteLink(admin);
    const adminQrAfter = await qrCode(admin);

    expect([memberLinkAfter.status, memberQrAfter.status]).toEqual([403, 403]);
    expect([adminLinkAfter.status, adminQrAfter.status]).toEqual([200, 200]);
    expect([
      savedToken === adminLinkAfter.body.token,
      savedToken === adminQrAfter.body.token,
    ]).toEqual([true, true]);

    const joined = joinByToken(null, savedTokenJoiner.userId, savedToken);
    expect(joined.success).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id=? AND user_id=?')
      .get(convId, savedTokenJoiner.userId).n).toBe(1);
  });

  test('role changes take effect immediately for both credential entry points', async () => {
    expect((await setRole('admin')).status).toBe(200);
    const promotedLink = await inviteLink(member);
    const promotedQr = await qrCode(member);
    expect([promotedLink.status, promotedQr.status]).toEqual([200, 200]);

    expect((await setRole('member')).status).toBe(200);
    const demotedLink = await inviteLink(member);
    const demotedQr = await qrCode(member);
    expect([demotedLink.status, demotedQr.status]).toEqual([403, 403]);
  });

  test('direct invites follow the same role toggle while legitimate admin and owner invites remain available', async () => {
    const blockedMember = await directInvite(member, directTargetForAdmin);
    expect(blockedMember.status).toBe(403);

    expect((await setRole('admin')).status).toBe(200);
    const allowedAdmin = await directInvite(member, directTargetForAdmin);
    expect(allowedAdmin.status).toBe(200);
    expect(allowedAdmin.body.added).toBe(1);

    expect((await setRole('member')).status).toBe(200);
    const blockedDemoted = await directInvite(member, directTargetForOwner);
    expect(blockedDemoted.status).toBe(403);

    const allowedOwner = await directInvite(owner, directTargetForOwner);
    expect(allowedOwner.status).toBe(200);
    expect(allowedOwner.body.added).toBe(1);
  });
});
