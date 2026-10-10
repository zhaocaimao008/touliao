import React from 'react';
import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import ConversationOpenFeedback from './ConversationOpenFeedback';
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
test('opening announces status, failure announces an alert with a retry control', () => {
  const pending = renderToString(<ConversationOpenFeedback navigation={{ openingKey: 'contact:a' }} />);
  expect(pending).toContain('role="status"'); expect(pending).toContain('gs.openingChat');
  const failed = renderToString(<ConversationOpenFeedback navigation={{ error: true, retry: () => {} }} />);
  expect(failed).toContain('role="alert"'); expect(failed).toContain('common.retry'); expect(failed).toContain('gs.openFailed');
});
test('retry keeps its button mounted and disabled while opening', () => {
  const html = renderToString(<ConversationOpenFeedback navigation={{ openingKey: 'contact:a', retry: () => {} }} />);
  expect(html).toContain('disabled=""'); expect(html).toContain('common.retry'); expect(html).not.toContain('role="alert"');
});
