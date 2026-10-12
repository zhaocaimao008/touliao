import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const post = vi.fn(() => Promise.resolve({ data: {} }));
vi.mock('axios', () => ({ default: { post: (...a) => post(...a) } }));

const docListeners = {};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: (ev, fn) => { (docListeners[ev] ||= []).push(fn); },
  removeEventListener: () => {},
};

const {
  reportRead, flushRead, resetReadState, resetAllReadState, lastReadableMessage, setKeepaliveSender,
  __resetReadReporterForTests, READ_DEBOUNCE_MS,
} = await import('./readReporter.js');

const msg = (id, seq) => ({ id, server_sequence: seq, conversation_id: 'c1', created_at: 1000 + seq });

describe('readReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    post.mockClear();
    __resetReadReporterForTests();
    document.visibilityState = 'visible';
  });
  afterEach(() => { vi.useRealTimers(); });

  it('合并防抖窗口内的多次上报为一次，取最新消息', () => {
    reportRead('c1', null);
    reportRead('c1', msg('m1', 1));
    reportRead('c1', msg('m2', 2));
    reportRead('c1', msg('m3', 3));
    expect(post).not.toHaveBeenCalled();
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/messages/conversation/c1/read', { messageId: 'm3' });
  });

  it('不比上次上报更新时不发送', () => {
    reportRead('c1', msg('m3', 3));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    reportRead('c1', msg('m3', 3));
    reportRead('c1', msg('m2', 2));
    reportRead('c1', null);
    flushRead('c1');
    vi.advanceTimersByTime(READ_DEBOUNCE_MS * 3);
    expect(post).toHaveBeenCalledTimes(1);
    reportRead('c1', msg('m4', 4));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('会话之间相互独立', () => {
    reportRead('c1', msg('a', 1));
    reportRead('c2', { id: 'b', server_sequence: 1 });
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('页面不可见时延后，可见后补发', () => {
    document.visibilityState = 'hidden';
    reportRead('c1', msg('m1', 1));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS * 5);
    expect(post).not.toHaveBeenCalled();
    document.visibilityState = 'visible';
    (docListeners.visibilitychange || []).forEach(fn => fn());
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('flushRead 立即发出，并可走 keepalive 通道', () => {
    const ka = vi.fn();
    setKeepaliveSender(ka);
    reportRead('c1', msg('m1', 1));
    flushRead('c1', { keepalive: true });
    expect(ka).toHaveBeenCalledWith('c1', { messageId: 'm1' });
    expect(post).not.toHaveBeenCalled();
    setKeepaliveSender(null);
  });

  it('请求失败后回滚，允许重试', async () => {
    post.mockImplementationOnce(() => Promise.reject(new Error('net')));
    reportRead('c1', msg('m1', 1));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    await Promise.resolve(); await Promise.resolve();
    reportRead('c1', msg('m1', 1));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('resetReadState 后重新上报', () => {
    reportRead('c1', msg('m1', 1));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    resetReadState('c1');
    reportRead('c1', null);
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith('/api/messages/conversation/c1/read', {});
  });

  it('lastReadableMessage 跳过发送中/失败的乐观消息与他会话残留', () => {
    const list = [msg('m1', 1), { id: 't1', _tempId: 't1', _status: 'sending' }, { id: 't2', _tempId: 't2', _status: 'error' }];
    expect(lastReadableMessage(list).id).toBe('m1');
    expect(lastReadableMessage(list, 'other')).toBe(null);
    expect(lastReadableMessage([])).toBe(null);
  });

  it('重新打开会话（resetReadState）后即使没有更新消息也会再上报一次，用于清除他端「标为未读」', () => {
    reportRead('c1', msg('m5', 5));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(1);
    // 不重置时：同一消息再次上报被去重
    reportRead('c1', null);
    reportRead('c1', msg('m5', 5));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(1);
    // 打开会话时重置基线
    resetReadState('c1');
    reportRead('c1', null);
    reportRead('c1', msg('m5', 5));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith('/api/messages/conversation/c1/read', { messageId: 'm5' });
  });

  it('resetAllReadState 清空全部基线与待发（会话边界不跨账号继承）', () => {
    reportRead('c1', msg('m1', 1));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    reportRead('c2', msg('x1', 1));
    resetAllReadState();
    vi.advanceTimersByTime(READ_DEBOUNCE_MS * 5);
    expect(post).toHaveBeenCalledTimes(1); // c2 的待发已被丢弃
    reportRead('c1', msg('m1', 1));
    vi.advanceTimersByTime(READ_DEBOUNCE_MS);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
