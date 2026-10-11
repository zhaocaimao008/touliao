import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import PrivateChatSettings from './PrivateChatSettings';

vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../utils/toast', () => ({ showConfirm: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test.each([false, true])('real settings hooks render with narrow=%s and preserve the saved burn option', narrow => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: narrow }) });
  // Effects are verified in the browser; SSR exercises real render initialization.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToString(<PrivateChatSettings conversation={{ id: 'qa', pinned: 1, muted: 0, burn_after: 60 }} onClose={() => {}} />);
  expect(html).toContain(`role="${narrow ? 'dialog' : 'region'}"`);
  expect(html).toContain('value="60" selected=""');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('aria-checked="false"');
  expect(html).toContain('privateChat.burnAfterReading');
});
