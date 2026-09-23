import { beforeEach, expect, test, vi } from 'vitest';
import { MomentCard } from './Moments';

// Exercise the real card's rendered button and async callback; control hook
// scheduling only, as in the existing component interaction tests.
const hooks = vi.hoisted(() => ({ slots: [], cursor: 0 }));
vi.mock('react', async original => ({ ...(await original()),
  useState: initial => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], value => { hooks.slots[i] = value; }];
  },
}));
vi.mock('./Avatar', () => ({ default: () => null }));
vi.mock('./ImagePreview', () => ({ default: () => null }));
vi.mock('./VideoPreview', () => ({ default: () => null }));
vi.mock('./UploadProgressBar', () => ({ default: () => null }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../utils/toast', () => ({ showToast: vi.fn(), showConfirm: vi.fn() }));
vi.mock('../utils/url', () => ({ getThumbUrl: v => v, mediaUrl: v => v, useMediaCredentials: () => {} }));
vi.mock('../utils/linkify', () => ({ linkify: v => v }));
function find(node, className) {
  if (!node || typeof node !== 'object') return undefined;
  if (node.props?.className === className) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, className);
    if (found) return found;
  }
}
const moment = comments => ({ id: 'light', user_id: 'author', author: { username: 'author' },
  content: 'post', commentCount: 1, comments, created_at: 1 });
const comment = { id: 'c', user_id: 'reader', username: 'reader', content: 'loaded comment' };
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; });
const render = props => { hooks.cursor = 0; return MomentCard.type(props); };
const button = tree => find(tree, 'wc-moment-comment-viewall');
test.each([[[]], [undefined]])('F05 empty/missing preview with positive count exposes a working load entry (%j)', async comments => {
  let resolve;
  const onLoadComments = vi.fn(() => new Promise(done => { resolve = done; }));
  const props = { m: moment(comments), meId: 'me', onLoadComments };
  let tree = render(props);
  expect(button(tree)).toBeTruthy(); expect(button(tree).props.disabled).toBe(false);
  const pending = button(tree).props.onClick();
  expect(onLoadComments).toHaveBeenCalledWith(props.m);
  tree = render(props); expect(button(tree).props.disabled).toBe(true);
  resolve(); await pending;
  tree = render({ ...props, m: { ...props.m, comments: [comment] } });
  expect(button(tree)).toBeUndefined();
  expect(find(tree, 'wc-moment-comment').props.children).toBeTruthy();
});
test('partial preview retains entry until commentCount is satisfied', () => {
  expect(button(render({ m: { ...moment([comment]), commentCount: 2 }, meId: 'me' }))).toBeTruthy();
  expect(button(render({ m: moment([comment]), meId: 'me' }))).toBeUndefined();
});
test('zero comments renders neither comment list nor load entry', () => {
  const tree = render({ m: { ...moment([]), commentCount: 0 }, meId: 'me' });
  expect(find(tree, 'wc-moment-comments')).toBeUndefined(); expect(button(tree)).toBeUndefined();
});
test('failed loading leaves the entry enabled for retry', async () => {
  const props = { m: moment([]), meId: 'me', onLoadComments: vi.fn().mockRejectedValue(new Error('offline')) };
  await expect(button(render(props)).props.onClick()).rejects.toThrow('offline');
  expect(button(render(props)).props.disabled).toBe(false);
});
