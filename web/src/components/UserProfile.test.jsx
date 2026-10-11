import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import UserProfile from './UserProfile';
import { showConfirm } from '../utils/toast';

const fixture = vi.hoisted(() => ({ generation: 1, trap: null }));
vi.mock('../utils/sessionContext', () => ({ captureSession: () => ({ generation: fixture.generation }), isSessionCurrent: s => s.generation === fixture.generation }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key === 'up.iAmTemplate' ? 'I am {name}' : key }), getI18n: () => key => key }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', username: 'Sender' } }) }));
vi.mock('../utils/url', () => ({ mediaUrl: value => value, useMediaCredentials: () => 0 }));
vi.mock('../utils/time', () => ({ formatLastOnline: () => '' }));
vi.mock('../utils/toast', () => ({ showToast: vi.fn(), showConfirm: vi.fn() }));
vi.mock('./Avatar', () => ({ default: () => null }));
vi.mock('../hooks/useFocusTrap', async () => {
  const { useRef, useLayoutEffect } = await import('react');
  return { default: function useTestFocusTrap(_active, options) { useLayoutEffect(() => { fixture.trap = options; }); return useRef(null); } };
});

let renderer, callbacks;
const profile = { id: 'alice', username: 'Alice', isFriend: true, isBlocked: false, remark: '' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async (response, data) => act(async () => { response.resolve({ data }); await response.promise; });
const element = id => <UserProfile userId={id} {...callbacks} />;
async function mount(data = profile) {
  axios.get.mockResolvedValueOnce({ data });
  await act(async () => { renderer = create(element(data.id)); });
}
const node = props => renderer.root.findByProps(props);
const click = props => act(() => { node(props).props.onClick(); });
function editRemark(value = 'Draft') {
  click({ className: 'up-row', type: 'button' });
  act(() => node({ className: 'up-remark-input' }).props.onChange({ target: { value } }));
}
const submit = () => node({ className: 'up-remark-box' }).props.onSubmit({ preventDefault() {} });
beforeEach(() => {
  fixture.generation = 1;
  callbacks = { onClose: vi.fn(), onStartChat: vi.fn(), onFriendAdded: vi.fn(), onFriendDeleted: vi.fn() };
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { activeElement: null, body: {} });
  vi.stubGlobal('CustomEvent', class { constructor(type, options) { this.type = type; this.detail = options.detail; } });
  vi.stubGlobal('requestAnimationFrame', callback => callback());
  vi.spyOn(axios, 'get').mockResolvedValue({ data: profile });
  vi.spyOn(axios, 'put').mockResolvedValue({ data: { success: true } });
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { success: true, id: 'request' } });
  vi.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } });
  showConfirm.mockResolvedValue(false);
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = null; vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

test('a failed initial profile remains visible with Close and Retry', async () => {
  axios.get.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { renderer = create(element('alice')); });
  expect(node({ role: 'alert' })).toBeTruthy(); expect(node({ className: 'up-close-btn' })).toBeTruthy();
  await act(async () => node({ className: 'wc-state-retry' }).props.onClick());
  expect(node({ className: 'up-name' }).children).toEqual(['Alice']);
});
test('changing targets clears the previous identity and draft even if the next profile fails', async () => {
  await mount(); editRemark(); axios.get.mockRejectedValueOnce(new Error('offline'));
  await act(async () => renderer.update(element('bob')));
  expect(renderer.root.findAllByProps({ className: 'up-name' })).toHaveLength(0);
  expect(renderer.root.findAllByType('input')).toHaveLength(0); expect(node({ role: 'alert' })).toBeTruthy();
});
test('a response for the wrong target is rejected', async () => {
  await act(async () => { renderer = create(element('bob')); });
  expect(renderer.root.findAllByProps({ className: 'up-name' })).toHaveLength(0); expect(node({ role: 'alert' })).toBeTruthy();
});
test('late reads cannot restore an old target', async () => {
  const old = deferred(); axios.get.mockReturnValueOnce(old.promise);
  act(() => { renderer = create(element('alice')); });
  const signal = axios.get.mock.calls[0][1].signal;
  axios.get.mockResolvedValueOnce({ data: { ...profile, id: 'bob', username: 'Bob' } });
  await act(async () => renderer.update(element('bob'))); await settle(old, profile);
  expect(signal.aborted).toBe(true); expect(node({ className: 'up-name' }).children).toEqual(['Bob']);
});
test('same-tick remark submissions serialize, lock conflicts, and commit once', async () => {
  await mount(); editRemark(); const response = deferred(); axios.put.mockReturnValueOnce(response.promise);
  let task; act(() => { task = submit(); submit(); });
  expect(axios.put).toHaveBeenCalledTimes(1); expect(node({ className: 'up-remark-input' }).props.disabled).toBe(true);
  expect(node({ className: 'up-action-btn up-action-chat' }).props.disabled).toBe(true);
  expect(node({ className: 'up-close-btn' }).props.disabled).toBe(true);
  await act(async () => { response.resolve({ data: { success: true } }); await task; });
  expect(node({ className: 'up-name' }).children).toEqual(['Draft']);
  expect(callbacks.onFriendAdded).toHaveBeenCalledTimes(1); expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
});
test('an unconfirmed remark save keeps the draft and exposes an error while reading back', async () => {
  await mount(); editRemark(); axios.put.mockResolvedValueOnce({ data: {} });
  await act(async () => submit());
  expect(node({ className: 'up-remark-input' }).props.value).toBe('Draft');
  expect(node({ className: 'up-err' }).props.role).toBe('alert');
  expect(callbacks.onFriendAdded).not.toHaveBeenCalled(); expect(axios.get).toHaveBeenCalledTimes(2);
});
test.each(['target', 'account'])('a pending save cannot affect a new %s', async mode => {
  await mount(); editRemark(); const response = deferred(); axios.put.mockReturnValueOnce(response.promise);
  let task; act(() => { task = submit(); });
  if (mode === 'target') {
    axios.get.mockResolvedValueOnce({ data: { ...profile, id: 'bob', username: 'Bob' } });
    await act(async () => renderer.update(element('bob')));
  } else fixture.generation++;
  await act(async () => { response.resolve({ data: { success: true } }); await task; });
  expect(callbacks.onFriendAdded).not.toHaveBeenCalled(); expect(window.dispatchEvent).not.toHaveBeenCalled();
});
test('Escape cancels only an unchanged editor before closing the profile', async () => {
  await mount(); editRemark(''); await act(async () => fixture.trap.onEscape());
  expect(renderer.root.findAllByType('input')).toHaveLength(0); expect(callbacks.onClose).not.toHaveBeenCalled();
  await act(async () => fixture.trap.onEscape()); expect(callbacks.onClose).toHaveBeenCalledTimes(1);
});
test('declining discard keeps both the draft and profile open', async () => {
  await mount(); editRemark(); await act(async () => fixture.trap.onEscape());
  expect(showConfirm).toHaveBeenCalledTimes(1); expect(node({ className: 'up-remark-input' }).props.value).toBe('Draft');
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(window.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
});
test('duplicate close gestures share one confirmation and a stale confirmation cannot close a new target', async () => {
  await mount(); editRemark(); const confirmation = deferred(); showConfirm.mockReturnValueOnce(confirmation.promise);
  let task; act(() => { task = node({ className: 'up-close-btn' }).props.onClick(); node({ className: 'up-close-btn' }).props.onClick(); });
  expect(showConfirm).toHaveBeenCalledTimes(1);
  axios.get.mockResolvedValueOnce({ data: { ...profile, id: 'bob', username: 'Bob' } });
  await act(async () => renderer.update(element('bob')));
  await act(async () => { confirmation.resolve(true); await task; }); expect(callbacks.onClose).not.toHaveBeenCalled();
});
test('default verification identifies the sender and accepts reciprocal requests correctly', async () => {
  await mount({ ...profile, isFriend: false }); click({ className: 'up-btn-primary up-btn-full' });
  expect(node({ className: 'up-verify-input' }).props.placeholder).toBe('I am Sender');
  axios.post.mockResolvedValueOnce({ data: { success: true } });
  await act(async () => node({ className: 'up-btn-primary', loading: false }).props.onClick());
  expect(axios.post.mock.calls[0][1]).toEqual({ toId: 'alice', message: 'I am Sender' });
  expect(node({ className: 'up-action-btn up-action-chat' })).toBeTruthy();
});
test('verification drafts are retained when discard is cancelled', async () => {
  await mount({ ...profile, isFriend: false }); click({ className: 'up-btn-primary up-btn-full' });
  act(() => node({ className: 'up-verify-input' }).props.onChange({ target: { value: 'Hello' } }));
  await act(async () => node({ className: 'up-close-btn' }).props.onClick());
  expect(node({ className: 'up-verify-input' }).props.value).toBe('Hello'); expect(axios.post).not.toHaveBeenCalled();
});
test('a rejected application preserves the draft and explains the server refusal', async () => {
  const stranger = { ...profile, isFriend: false };
  axios.get.mockResolvedValue({ data: stranger });
  await mount(stranger); click({ className: 'up-btn-primary up-btn-full' });
  act(() => node({ className: 'up-verify-input' }).props.onChange({ target: { value: 'Hello' } }));
  axios.post.mockRejectedValueOnce({ response: { data: { error: '请先移出黑名单' } } });
  await act(async () => node({ className: 'up-btn-primary', loading: false }).props.onClick());
  expect(node({ className: 'up-err' }).children).toEqual(['请先移出黑名单']);
  expect(node({ className: 'up-verify-input' }).props.value).toBe('Hello');
  expect(callbacks.onFriendAdded).not.toHaveBeenCalled();
});
test('invalid conversation responses never navigate or close the profile', async () => {
  await mount(); axios.post.mockResolvedValueOnce({ data: {} });
  await act(async () => node({ className: 'up-action-btn up-action-chat' }).props.onClick());
  expect(callbacks.onStartChat).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(node({ className: 'up-err' })).toBeTruthy();
});
test('delete confirmation is locked before the request and can be cancelled safely', async () => {
  await mount(); const confirmation = deferred(); showConfirm.mockReturnValueOnce(confirmation.promise);
  let task; act(() => { task = node({ className: 'up-action-btn up-action-danger' }).props.onClick(); node({ className: 'up-action-btn up-action-danger' }).props.onClick(); });
  expect(showConfirm).toHaveBeenCalledTimes(1);
  await act(async () => { confirmation.resolve(false); await task; });
  expect(axios.delete).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled();
});
