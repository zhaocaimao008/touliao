import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import ResponsiveHomeLayout from './ResponsiveHomeLayout';

const fixtures = vi.hoisted(() => ({ resources: {} }));
vi.mock('../hooks/useDirectoryResource', () => ({ useDirectoryResource: url => fixtures.resources[url] }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key, lang: 'zh-CN' }), getI18n: () => key => key }));
vi.mock('../contexts/SocketContext', () => ({ useSocketCore: () => ({ socket: null }) }));
vi.mock('../utils/sessionContext', () => ({ captureSession: () => ({ owner: 1 }), isSessionCurrent: () => true }));
vi.mock('../utils/toast', () => ({ showToast: () => {}, showConfirm: () => Promise.resolve(false) }));
vi.mock('../utils/url', async importOriginal => ({ ...await importOriginal(), useMediaCredentials: () => 0 }));

let ContactList, renderer;
const submit = { preventDefault: () => {} };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const resource = data => ({ data, loaded: true, loading: false, error: false, emptyReady: true, reload: vi.fn(), setData: vi.fn(), commitData: vi.fn() });
const labels = () => fixtures.resources['/api/friend-labels'];
const shell = mobile => <ResponsiveHomeLayout mobile={mobile} showChatArea sidebar={<p>Account</p>} navigation={<nav>Tabs</nav>}>
  <ContactList onStartChat={() => {}} />
</ResponsiveHomeLayout>;
const click = props => act(() => renderer.root.findByProps(props).props.onClick());
function createDraft() {
  act(() => { renderer = create(shell(false)); });
  click({ 'data-directory-section': 'labels' });
  click({ 'data-directory-section': 'edit:new' });
  act(() => renderer.root.findByProps({ id: 'friend-label-name' }).props.onChange({ target: { value: 'Unsaved label' } }));
  act(() => renderer.root.findByProps({ type: 'radio', value: '#17B8A6' }).props.onChange());
}
beforeEach(async () => {
  vi.stubGlobal('window', { localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, location: { protocol: 'https:', origin: 'https://touliao.test' } });
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('document', { activeElement: null, body: {} });
  vi.stubGlobal('requestAnimationFrame', callback => callback());
  fixtures.resources = Object.fromEntries(['/api/users/contacts', '/api/users/friend-requests', '/api/users/friend-requests/sent', '/api/users/me/blocked', '/api/messages/my-groups', '/api/friend-labels', '/api/config'].map(url => [url, resource([])]));
  ({ default: ContactList } = await import('./ContactList'));
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { id: 'new-label', name: 'Unsaved label', color: '#17B8A6', members: [] } });
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount()); renderer = null;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test('real label name and selected color survive both layout directions without refetching', () => {
  createDraft(); const count = labels().reload.mock.calls.length;
  for (const mobile of [true, false, true]) {
    act(() => renderer.update(shell(mobile)));
    expect(renderer.root.findByProps({ id: 'friend-label-name' }).props.value).toBe('Unsaved label');
    expect(renderer.root.findByProps({ type: 'radio', value: '#17B8A6' }).props.checked).toBe(true);
    expect(labels().reload).toHaveBeenCalledTimes(count);
  }
});
test('a pending label save survives resizing, remains locked, and commits once', async () => {
  createDraft(); const response = deferred(); axios.post.mockReturnValueOnce(response.promise);
  let task;
  act(() => { task = renderer.root.findByType('form').props.onSubmit(submit); });
  act(() => renderer.update(shell(true)));
  expect(renderer.root.findByProps({ id: 'friend-label-name' }).props.disabled).toBe(true);
  expect(axios.post.mock.calls[0][2].signal.aborted).toBe(false);
  await act(async () => { await renderer.root.findByType('form').props.onSubmit(submit); });
  expect(axios.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    response.resolve({ data: { id: 'new-label', name: 'Unsaved label', color: '#17B8A6', members: [] } });
    await task;
  });
  expect(labels().commitData).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByProps({ id: 'friend-label-name' })).toHaveLength(0);
  expect(renderer.root.findByProps({ 'data-directory-section': 'edit:new' }).props.disabled).toBe(false);
});
test('friend request subview remains selected through a layout change', () => {
  act(() => { renderer = create(shell(false)); });
  click({ 'data-directory-section': 'requests' });
  act(() => renderer.root.findAllByType('button').find(node => node.props.children === 'contacts.sent').props.onClick());
  act(() => renderer.update(shell(true)));
  const sent = renderer.root.findAllByType('button').find(node => node.props.children === 'contacts.sent');
  expect(sent.props['aria-pressed']).toBe(true);
});
test('label member management stays open across a layout change', () => {
  labels().data = [{ id: 'team', name: 'Team', members: [{ id: 'friend' }] }];
  fixtures.resources['/api/users/contacts'].data = [{ id: 'friend', username: 'Alice' }];
  act(() => { renderer = create(shell(true)); });
  click({ 'data-directory-section': 'labels' }); click({ 'data-directory-section': 'members:team' });
  act(() => renderer.update(shell(false)));
  expect(renderer.root.findByProps({ role: 'checkbox' }).props['aria-checked']).toBe(true);
});
