import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import ForwardModal from './ForwardModal';
import { activateSession, invalidateSession } from '../utils/sessionContext';

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
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
  useEffect: effect => { hooks.effects.push(effect); },
}));
vi.mock('react-dom', () => ({ createPortal: child => child }));
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
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  vi.stubGlobal('document', { body: {} });
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  invalidateSession(); activateSession('https://fixture.invalid', 'account-A');
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0);
});

test('selecting a friend blocks overlapping selection and sending until the target resolves', async () => {
  let resolve;
  const post = vi.spyOn(axios, 'post').mockImplementation(() => new Promise(r => { resolve = r; }));
  const render = () => { hooks.cursor = 0; return ForwardModal({ message: { id: 'm1', type: 'text', content: 'fixture' }, onClose: vi.fn() }); };
  render();
  hooks.slots[3] = [{ id: 'friend', username: 'Test recipient' }];
  hooks.slots[12] = { friends: 'ready', groups: 'ready' };
  let tree = render();
  const row = nodes(tree, node => node.props?.className === 'fwd-item')[0];
  const first = row.props.onClick();
  await row.props.onClick();
  expect(post).toHaveBeenCalledTimes(1);
  tree = render();
  expect(nodes(tree, node => node.props?.className === 'fwd-item')[0].props['aria-disabled']).toBe(true);
  const send = nodes(tree, node => node.props?.className === 'fwd-btn fwd-btn-send')[0];
  expect(send.props.disabled).toBe(true);
  await send.props.onClick();
  expect(post).toHaveBeenCalledTimes(1);
  resolve({ data: { conversationId: 'c1' } });
  await first;
  tree = render();
  expect(nodes(tree, node => node.props?.className === 'fwd-item')[0].props['aria-pressed']).toBe(true);
  expect(nodes(tree, node => node.props?.className === 'fwd-btn fwd-btn-send')[0].props.disabled).toBe(false);
});

test('two immediate send activations submit only once and keep targets stable', async () => {
  let resolve;
  const post = vi.spyOn(axios, 'post').mockImplementation(() => new Promise(r => { resolve = r; }));
  const render = () => { hooks.cursor = 0; return ForwardModal({ message: { id: 'm1', type: 'text', content: 'fixture' }, onClose: vi.fn() }); };
  render();
  hooks.slots[2] = 'groups';
  hooks.slots[4] = [{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two' }];
  hooks.slots[5] = new Set(['c1']);
  let tree = render();
  const send = nodes(tree, node => node.props?.className === 'fwd-btn fwd-btn-send')[0];
  const first = send.props.onClick();
  await send.props.onClick();
  nodes(tree, node => node.props?.className === 'fwd-item')[1].props.onClick();
  expect(post).toHaveBeenCalledTimes(1);
  expect([...hooks.slots[5]]).toEqual(['c1']);
  resolve({ data: { status: 'success', success_count: 1 } });
  await first;
  tree = render();
  expect(nodes(tree, node => node.props?.className === 'fwd-done-title')[0].props.children).toBe('fwd.success');
});

test('loading, failed directories, and unmatched searches have distinct feedback', () => {
  const render = () => { hooks.cursor = 0; return ForwardModal({ message: { id: 'm1' }, onClose: vi.fn() }); };
  let tree = render();
  expect(nodes(tree, node => node.props?.className === 'fwd-empty')[0].props.children).toBe('common.loading');
  hooks.slots[12] = { friends: 'error', groups: 'ready' };
  tree = render();
  expect(nodes(tree, node => node.props?.role === 'alert')).toHaveLength(1);
  expect(nodes(tree, node => node.props?.className === 'fwd-empty')).toHaveLength(0);
  hooks.slots[12] = { friends: 'ready', groups: 'ready' };
  hooks.slots[7] = 'no match';
  tree = render();
  expect(nodes(tree, node => node.props?.className === 'fwd-empty')[0].props.children).toBe('fwd.noMatches');
  hooks.slots[7] = '';
  tree = render();
  expect(nodes(tree, node => node.props?.className === 'fwd-empty')[0].props.children).toBe('moments.noFriends');
});

test('failed results remain readable and success auto-close timers are cleaned up', () => {
  const close = vi.fn();
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  const render = () => { hooks.cursor = 0; return ForwardModal({ message: { id: 'm1' }, onClose: close }); };
  render();
  hooks.slots[9] = true;
  hooks.slots[10] = { status: 'partial_success' };
  render();
  expect(hooks.effects.at(-1)()).toBeUndefined();
  expect(setTimeout).not.toHaveBeenCalled();
  hooks.slots[10] = { status: 'success' };
  render();
  const cleanup = hooks.effects.at(-1)();
  expect(setTimeout).toHaveBeenCalledWith(close, 3000);
  cleanup();
  expect(clear).toHaveBeenCalledWith(0);
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
