import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import TransferModal from './TransferModal';
import RedPacketModal from './RedPacketModal';
import { activateSession, invalidateSession } from '../utils/sessionContext';
import { setupAxiosInterceptors, clearCsrfToken } from '../utils/axiosInterceptor';

// Exercise the actual rendered inputs/buttons and async submit callbacks. Only
// React scheduling is controlled: retain hooks across renders, and deliberately
// dispatch two clicks before a render so the inFlight ref must do real work.
// This is a component interaction test, not a browser layout/focus test.
const hooks = vi.hoisted(() => ({ slots: [], cursor: 0 }));
vi.mock('react', async original => ({ ...(await original()),
  useState: initial => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[i], value => { hooks.slots[i] = value; }];
  },
  useRef: initial => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
    return hooks.slots[i];
  },
  useEffect: () => {},
}));
vi.mock('../hooks/useFocusTrap', () => ({ default: () => null }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
const originalAdapter = axios.defaults.adapter;
let requests;
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; requests = [];
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { cookie: '' });
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) });
  invalidateSession(); activateSession('https://fixture.invalid', 'A');
  axios.interceptors.request.clear(); axios.interceptors.response.clear(); clearCsrfToken();
  setupAxiosInterceptors(axios);
  axios.defaults.adapter = config => new Promise((resolve, reject) => requests.push({ config, resolve, reject }));
});
afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  axios.interceptors.request.clear(); axios.interceptors.response.clear();
  vi.unstubAllGlobals();
});
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
test.each([
  ['transfer', TransferModal, 'tf-amount', '/api/wallet/transfer'],
  ['redpacket', RedPacketModal, 'rpm-amount', '/api/redpackets/send'],
])('%s modal guards double clicks and preserves the actual request key on manual retries', async (kind, Component, amountId, endpoint) => {
  const props = { conversation: { id: 'conversation-B', type: 'private', otherUser: { id: 'B' } }, onClose: vi.fn(), onSent: vi.fn() };
  let tree;
  const render = () => { hooks.cursor = 0; tree = Component(props); };
  const button = () => find(tree, node => node.props?.className === 'rpm-btn-send');
  const enter = value => { find(tree, node => node.props?.id === amountId).props.onChange({ target: { value } }); render(); };
  const reject = async pending => {
    const req = requests.at(-1);
    req.reject(new axios.AxiosError('synthetic lost response', 'ECONNABORTED', req.config));
    await pending; render();
    expect(find(tree, node => node.props?.role === 'alert')).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();
  };
  render();
  expect(button().props.disabled).toBe(true);
  await button().props.onClick(); await flush();
  expect(requests).toHaveLength(0);
  enter('10');
  expect(button().props.disabled).toBe(false);
  const click = button().props.onClick;
  const first = click(); const duplicate = click(); await flush();
  expect(requests).toHaveLength(1);
  const config = requests[0].config;
  expect(config.url).toBe(endpoint); expect(config.skipRetry).toBe(true);
  const key = config.headers.get('Idempotency-Key');
  expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  render(); expect(button().props.disabled).toBe(true);
  await reject(first); await duplicate;
  localStorage.setItem('touliao_session_revision', 'refreshed');
  const retry = button().props.onClick(); await flush();
  expect(requests).toHaveLength(2);
  expect(requests[1].config.headers.get('Idempotency-Key')).toBe(key);
  expect(requests[1].config.data).toBe(config.data);
  await reject(retry);
  enter('20');
  const changed = button().props.onClick(); await flush();
  expect(requests[2].config.headers.get('Idempotency-Key')).not.toBe(key);
  await reject(changed);
  enter('10');
  activateSession('https://fixture.invalid', 'C');
  render();
  const otherAccount = button().props.onClick(); await flush();
  expect(requests[3].config.headers.get('Idempotency-Key')).not.toBe(key);
  const last = requests[3];
  last.resolve({ status: 200, data: { message: { id: `${kind}-message` } }, headers: {}, config: last.config });
  await otherAccount;
  expect(props.onSent).toHaveBeenCalledExactlyOnceWith({ id: `${kind}-message` });
  expect(props.onClose).toHaveBeenCalledOnce();
});
