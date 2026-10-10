import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { useFriendSearch } from './useFriendSearch';

const session = vi.hoisted(() => ({ generation: 1 }));
vi.mock('../utils/sessionContext', () => ({ captureSession: () => ({ generation: session.generation }), isSessionCurrent: scope => scope.generation === session.generation }));
let renderer, search;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const alice = { id: 'alice', username: 'Alice' };
function Probe({ query = '' }) {
  const value = useFriendSearch(query);
  React.useLayoutEffect(() => { search = value; });
  return null;
}
function mount(query) { act(() => { renderer = create(<Probe query={query} />); }); }
const lookup = (q, options) => act(() => search.search(q, options));
const settle = async (response, data) => act(async () => { response.resolve({ data }); await response.promise; });
beforeEach(() => { session.generation = 1; vi.useFakeTimers(); vi.spyOn(axios, 'get').mockResolvedValue({ data: [] }); });
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = null; vi.restoreAllMocks(); vi.useRealTimers(); });

test('clearing before the debounce prevents a hidden lookup', async () => {
  mount(); lookup('Alice'); lookup('');
  await act(async () => vi.runAllTimersAsync());
  expect(axios.get).not.toHaveBeenCalled(); expect(search.status).toBe('idle');
});
test('clearing an active request ignores a transport that resolves after cancellation', async () => {
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  mount('Alice'); const signal = axios.get.mock.calls[0][1].signal;
  lookup(''); expect(signal.aborted).toBe(true);
  await settle(response, [alice]); expect(search.results).toEqual([]); expect(search.query).toBe('');
});
test('a changed query invalidates the old response before the new debounce expires', async () => {
  const first = deferred(); axios.get.mockReturnValueOnce(first.promise);
  mount('Alice'); lookup('Bob'); await settle(first, [alice]);
  expect(search.results).toEqual([]); expect(search.query).toBe('Bob');
  await act(async () => vi.runAllTimersAsync()); expect(search.status).toBe('success');
});
test('Enter replaces the debounce and repeated Enter shares one active request', async () => {
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise);
  mount(); lookup('Alice'); lookup('Alice', { immediate: true }); lookup('Alice', { immediate: true });
  await act(async () => vi.runAllTimersAsync()); expect(axios.get).toHaveBeenCalledTimes(1);
  await settle(response, [alice]); expect(search.results).toEqual([alice]);
});
test('IME composition does not query partial text and resumes after composition ends', async () => {
  mount(); lookup('zhong', { composing: true }); lookup('中', { composing: true });
  await act(async () => vi.runAllTimersAsync()); expect(axios.get).not.toHaveBeenCalled();
  lookup('中文'); await act(async () => vi.runAllTimersAsync());
  expect(axios.get.mock.calls[0][0]).toContain(encodeURIComponent('中文'));
});
test.each([{}, [null], [{ id: 'x' }]])('malformed results show a retryable error instead of crashing: %j', async data => {
  axios.get.mockResolvedValueOnce({ data }); mount('Alice'); await act(async () => {});
  expect(search.status).toBe('error'); expect(search.results).toEqual([]);
  await act(async () => search.search('Alice', { immediate: true })); expect(search.status).toBe('success');
});
test('whitespace returns to idle without a request', () => { mount('   '); expect(search.status).toBe('idle'); expect(axios.get).not.toHaveBeenCalled(); });
test('an account switch rejects a late response and scopes the request', async () => {
  const response = deferred(); axios.get.mockReturnValueOnce(response.promise); mount('Alice');
  expect(axios.get.mock.calls[0][1]._sessionContext).toEqual({ generation: 1 });
  session.generation++; await settle(response, [alice]); expect(search.results).toEqual([]);
});
test('unmount aborts an in-flight lookup', () => {
  axios.get.mockReturnValueOnce(deferred().promise); mount('Alice');
  const signal = axios.get.mock.calls[0][1].signal; act(() => renderer.unmount()); renderer = null;
  expect(signal.aborted).toBe(true);
});
test('a new supplied query replaces the input and stale results', async () => {
  mount('Alice'); await act(async () => {});
  await act(async () => renderer.update(<Probe query="Bob" />));
  expect(search.query).toBe('Bob'); expect(axios.get.mock.calls.at(-1)[0]).toContain('Bob');
});
