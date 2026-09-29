'use strict';
// 密码哈希线程池：与 bcryptjs 双向兼容（老账号的哈希照常校验），且计算不占主线程。
const bcrypt = require('bcryptjs');
const passwordHash = require('../src/utils/passwordHash');

test('线程池生成的哈希 bcryptjs 能校验，bcryptjs 的老哈希线程池也能校验', async () => {
  const h = await passwordHash.hash('passw0rd!', 4);
  expect(h).toMatch(/^\$2[ab]\$04\$/);
  expect(bcrypt.compareSync('passw0rd!', h)).toBe(true);
  const legacy = bcrypt.hashSync('老密码123', 4);
  expect(await passwordHash.compare('老密码123', legacy)).toBe(true);
  expect(await passwordHash.compare('wrong', legacy)).toBe(false);
});

test('并发计算期间主线程不被阻塞', async () => {
  const h = bcrypt.hashSync('x', 10);
  let maxLag = 0, last = Date.now();
  const iv = setInterval(() => { const now = Date.now(); maxLag = Math.max(maxLag, now - last - 5); last = now; }, 5);
  await Promise.all(Array.from({ length: 6 }, () => passwordHash.compare('x', h)));
  clearInterval(iv);
  expect(maxLag).toBeLessThan(50);
});

test('非法参数按 bcryptjs 的方式报错，而不是挂起', async () => {
  await expect(passwordHash.compare('x', 'not-a-hash')).resolves.toBe(false);
  await expect(passwordHash.hash(undefined, 4)).rejects.toThrow();
});
