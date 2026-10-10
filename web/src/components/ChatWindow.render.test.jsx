import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'qa-self', username: 'QA' }, outboxScope: null }) }));
vi.mock('../contexts/SocketContext', () => ({ useSocket: () => ({ socket: null, reconnectCount: 0, registerDelivered: () => {} }) }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key, lang: 'zh-CN' }), getI18n: () => key => key }));
vi.mock('../contexts/FilePreviewContext', () => ({ useFilePreview: () => ({ openPreview: () => {} }) }));
vi.mock('./VirtualMessageList', () => ({ default: () => null }));
vi.mock('../utils/callTones', () => ({ prewarmAudio: () => {} }));
vi.mock('../utils/toast', () => ({ showToast: () => {}, showConfirm: () => Promise.resolve(false) }));
vi.mock('../utils/url', async importOriginal => ({ ...await importOriginal(), useMediaCredentials: () => 0 }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('chat window initializes authenticated hooks and renders the composer', async () => {
  vi.stubGlobal('window', { innerWidth: 1280, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, location: { protocol: 'https:', origin: 'https://touliao.test' } });
  vi.stubGlobal('navigator', { userAgent: 'test', onLine: true });
  vi.stubGlobal('localStorage', { getItem: () => null });
  // Server rendering does not run layout effects; this smoke test covers the
  // real ChatWindow render, including hook ordering and context initialization.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { default: ChatWindow } = await import('./ChatWindow');
  const html = renderToString(<ChatWindow conversation={{ id: 'qa-conversation', type: 'private', name: 'QA', otherUser: { id: 'qa-peer' } }} />);
  expect(html).toContain('textarea');
  expect(html).toContain('QA');
});
