const { app, request, makeUser } = require('./helpers');
const db = require('../src/db');
let user;
const ids = [];
beforeAll(async () => {
  user = await makeUser({ username: 'timeline-cursor' });
  for (let i = 0; i < 25; i++) {
    const response = await request(app).post('/api/moments').set('Authorization', `Bearer ${user.token}`)
      .send({ content: `cursor-${i}`, visibility: 'private' });
    expect(response.status).toBe(200);
    ids.push(response.body.id);
  }
  // Same-second ties are common when publishing multiple posts.
  db.prepare('UPDATE moments SET created_at=1700000000 WHERE user_id=?').run(user.userId);
});
const get = query => request(app).get('/api/moments').set('Authorization', `Bearer ${user.token}`).query(query);
test('cursor traverses every post without gaps/duplicates after an insertion and boundary deletion', async () => {
  const first = await get({ limit: 20 });
  expect(first.status).toBe(200);
  expect(first.body).toHaveLength(20);
  const cursor = first.body.at(-1);
  const inserted = await request(app).post('/api/moments').set('Authorization', `Bearer ${user.token}`).send({ content: 'newer', visibility: 'private' });
  expect(inserted.status).toBe(200);
  expect((await request(app).delete(`/api/moments/${cursor.id}`).set('Authorization', `Bearer ${user.token}`)).status).toBe(200);
  const second = await get({ limit: 20, beforeCreatedAt: cursor.created_at, beforeId: cursor.id });
  expect(second.status).toBe(200);
  expect(second.body).toHaveLength(5);
  expect(new Set([...first.body, ...second.body].map(m => m.id))).toEqual(new Set(ids));
  expect(second.body.some(m => m.id === inserted.body.id)).toBe(false);
});
test.each([{ beforeId: 'missing-time' }, { beforeCreatedAt: 123 }, { beforeCreatedAt: 'bad', beforeId: 'id' }])('invalid cursor returns 400: %j', async query => {
  expect((await get(query)).status).toBe(400);
});
test('legacy offset pagination and other users privacy remain supported', async () => {
  const all = await get({ limit: 50 });
  const page = await get({ limit: 5, offset: 5 });
  expect(page.body.map(m => m.id)).toEqual(all.body.slice(5, 10).map(m => m.id));
  const stranger = await makeUser({ username: 'timeline-stranger' });
  const result = await request(app).get('/api/moments').set('Authorization', `Bearer ${stranger.token}`).query({ beforeCreatedAt: 2000000000, beforeId: 'z' });
  expect(result.status).toBe(200);
  expect(result.body).toEqual([]);
});
