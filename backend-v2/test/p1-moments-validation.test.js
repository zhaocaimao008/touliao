'use strict';
const { app, request, makeUser } = require('./helpers');
const { db } = require('../src/db/connection');
const moderation = require('../src/modules/moderation/moderation.service');
let auth;
const keyword = 'p1-edit-blocked-keyword';
const create = body => request(app).post('/api/moments').set('Authorization', auth).send(body);
const edit = (id, body) => request(app).put(`/api/moments/${id}`).set('Authorization', auth).send(body);
const stored = id => db.prepare('SELECT content, visibility FROM moments WHERE id=?').get(id);
beforeAll(async () => {
  auth = `Bearer ${(await makeUser()).token}`;
  moderation.addWord(keyword);
});

test('creation and editing reject the same keyword before persisting any changes', async () => {
  expect((await create({ content: keyword })).status).toBe(400);
  const good = await create({ content: 'allowed', visibility: 'private' });
  expect(good.status).toBe(200);
  expect((await edit(good.body.id, { content: keyword, visibility: 'all' })).status).toBe(400);
  expect(stored(good.body.id)).toEqual({ content: 'allowed', visibility: 'private' });
});

test.each([4999, 5000, 5001])('creation and editing apply the same %i character boundary', async length => {
  const content = '文'.repeat(length);
  const good = await create({ content: 'before', visibility: 'private' });
  expect(good.status).toBe(200);
  const expected = length <= 5000 ? 200 : 400;
  expect((await create({ content, visibility: 'private' })).status).toBe(expected);
  expect((await edit(good.body.id, { content })).status).toBe(expected);
  expect(stored(good.body.id).content).toBe(length <= 5000 ? content : 'before');
});

test('visibility-only edit preserves content and still validates persisted text', async () => {
  const good = await create({ content: 'unchanged', visibility: 'private' });
  expect(good.status).toBe(200);
  expect((await edit(good.body.id, { visibility: 'friends' })).status).toBe(200);
  expect(stored(good.body.id)).toEqual({ content: 'unchanged', visibility: 'friends' });
  db.prepare('UPDATE moments SET content=? WHERE id=?').run(keyword, good.body.id);
  expect((await edit(good.body.id, { visibility: 'all' })).status).toBe(400);
  expect(stored(good.body.id)).toEqual({ content: keyword, visibility: 'friends' });
});

test.each([{ images: ['/uploads/p1-image.png'] }, { video: '/uploads/p1-video.mp4' }])(
  'media-only post can change visibility and keep empty text: %j', async media => {
    const good = await create({ ...media, visibility: 'private' });
    expect(good.status).toBe(200);
    expect((await edit(good.body.id, { visibility: 'friends' })).status).toBe(200);
    expect(stored(good.body.id)).toEqual({ content: '', visibility: 'friends' });
  },
);
