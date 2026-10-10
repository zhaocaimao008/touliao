import { expect, test } from 'vitest';
import { matchesContact, normalizeContactQuery } from './contactSearch';

const contact = { remark: '合作伙伴', username: 'Alice 陈', phone: '13800138000', wechat_id: 7654321 };
test.each(['合作', 'alice', ' 陈 ', '1380013', '7654321'])('contact lookup searches all identities: %s', query => {
  expect(matchesContact(contact, query)).toBe(true);
});
test('whitespace is an empty query and missing fields do not produce false matches', () => {
  expect(normalizeContactQuery(' \t\n')).toBe('');
  expect(matchesContact(contact, '   ')).toBe(true);
  expect(matchesContact({}, 'undefined')).toBe(false);
  expect(matchesContact(contact, 'other person')).toBe(false);
});
