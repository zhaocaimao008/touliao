import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import ForwardModal from './ForwardModal';
import { activateSession, invalidateSession } from '../utils/sessionContext';

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0 }));
vi.mock('react', async original => ({ ...(await original()),
  useState: initial => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], update => {
      hooks.slots[index] = typeof update === 'function' ? update(hooks.slots[index]) : update;
    }];
  },
  useRef: initial => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useMemo: compute => compute(),
  useEffect: () => {},
}));
vi.mock('../hooks/useFocusTrap', () => ({ default: () => null }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('./Avatar', () => ({ default: () => null }));
vi.mock('./GroupAvatar', () => ({ GroupAvatar: () => null }));

function nodes(root, predicate) {
  if (!root || typeof root !== 'object') return [];
  return [root, ...[root.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))].filter(predicate);
}

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0;
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  invalidateSession(); activateSession('https://fixture.invalid', 'account-A');
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('merged forwarding retries only failed targets with the same ID and counts all successes', async () => {
  const sent = [];
  vi.spyOn(axios, 'post').mockImplementation((url, body) => {
    sent.push({ url, body });
    return url.endsWith('/c2') && sent.filter(item => item.url.endsWith('/c2')).length === 1
      ? Promise.reject(new Error('lost response')) : Promise.resolve({ data: { id: 'saved' } });
  });
  const messages = [1, 2].map(index => ({ id: `m${index}`, type: 'text', content: `text ${index}`, sender_id: 'account-A', created_at: index }));
  const render = () => { hooks.cursor = 0; return ForwardModal({ messages, onClose: vi.fn() }); };
  render();
  hooks.slots[4] = [{ id: 'c1', name: 'One', memberCount: 2 }, { id: 'c2', name: 'Two', memberCount: 2 }];
  let tree = render();
  nodes(tree, node => node.props?.role === 'tab' && node.props?.children?.[0] === 'fwd.groupsTab')[0].props.onClick();
  tree = render();
  nodes(tree, node => node.props?.className === 'fwd-item').forEach(node => node.props.onClick());
  tree = render();
  nodes(tree, node => node.props?.role === 'radio' && node.props?.children === 'fwd.mergeForward')[0].props.onClick();
  tree = render();
  await nodes(tree, node => node.props?.className === 'fwd-btn fwd-btn-send')[0].props.onClick();
  expect(sent).toHaveLength(2);
  expect([...hooks.slots[5]]).toEqual(['c2']);
  tree = render();
  await nodes(tree, node => node.props?.className === 'fwd-btn fwd-btn-send')[0].props.onClick();
  expect(sent).toHaveLength(3);
  expect(sent[2].url).toBe(sent[1].url);
  expect(sent[2].body.clientMsgId).toBe(sent[1].body.clientMsgId);
  expect(hooks.slots[10].success_count).toBe(2);
});
