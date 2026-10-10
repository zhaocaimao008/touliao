import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import DirectoryFeedback from './DirectoryFeedback';

const fixtures = vi.hoisted(() => ({ resources: {}, action: {} }));
vi.mock('../hooks/useDirectoryResource', () => ({ useDirectoryResource: url => fixtures.resources[url] || resource() }));
vi.mock('../hooks/useDirectoryAction', () => ({ useDirectoryAction: () => fixtures.action }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key, lang: 'zh-CN' }), getI18n: () => key => key }));
vi.mock('../contexts/SocketContext', () => ({ useSocketCore: () => ({ socket: null }) }));
vi.mock('../utils/toast', () => ({ showToast: () => {}, showConfirm: () => Promise.resolve(false) }));
vi.mock('../utils/url', async importOriginal => ({ ...await importOriginal(), useMediaCredentials: () => 0 }));

function resource(patch = {}) {
  return { data: [], loaded: false, loading: true, error: false, emptyReady: false, reload: () => {}, setData: () => {}, ...patch };
}
let ContactList, LabelsTab;
beforeEach(async () => {
  fixtures.resources = {};
  fixtures.action = { pendingKey: null, error: false, run: () => {} };
  vi.stubGlobal('window', { localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, location: { protocol: 'https:', origin: 'https://touliao.test' } });
  vi.stubGlobal('localStorage', { getItem: () => null });
  ({ default: ContactList, LabelsTab } = await import('./ContactList'));
});
afterEach(() => vi.unstubAllGlobals());
const render = props => renderToString(<ContactList onStartChat={() => {}} {...props} />);

test('first contact load, including with a search query, never flashes an empty result', () => {
  for (const query of ['', 'Alice']) {
    const html = render({ searchQuery: query });
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('contacts.noContacts');
    expect(html).not.toContain('contacts.notFoundTemplate');
  }
});
test('failed contacts show a retry action and preserve existing rows', () => {
  fixtures.resources['/api/users/contacts'] = resource({ data: [{ id: 'a', username: 'Alice' }], loaded: true, loading: false, error: true });
  const html = render();
  expect(html).toContain('Alice'); expect(html).toContain('role="alert"'); expect(html).toContain('common.retry');
  expect(html).not.toContain('contacts.noContacts');
});
test('search finds the original name even with a remark and trims surrounding whitespace', () => {
  fixtures.resources['/api/users/contacts'] = resource({ data: [{ id: 'a', username: 'Alice', remark: '合作伙伴' }], loaded: true, loading: false, emptyReady: true });
  const html = render({ searchQuery: '  ALICE  ' });
  expect(html).toContain('合作伙伴'); expect(html).toContain('Alice'); expect(html).not.toContain('contacts.notFoundTemplate');
});
test('friend request initial load and failure are distinct from a confirmed empty list', () => {
  let html = render({ openFriendRequests: 1 });
  expect(html).toContain('aria-busy="true"'); expect(html).not.toContain('contacts.noNewRequests');
  fixtures.resources['/api/users/friend-requests'] = resource({ loading: false, error: true });
  html = render({ openFriendRequests: 1 });
  expect(html).toContain('common.retry'); expect(html).not.toContain('contacts.noNewRequests');
  fixtures.resources['/api/users/friend-requests'] = resource({ loading: false, loaded: true, emptyReady: true });
  html = render({ openFriendRequests: 1 });
  expect(html).toContain('contacts.noNewRequests'); expect(html).toContain('aria-pressed="true"'); expect(html).toContain('aria-pressed="false"');
});
test('refresh uses a compact live status while initial load uses an accessible skeleton', () => {
  const initial = renderToString(<DirectoryFeedback resource={resource()} />);
  expect(initial).toContain('wc-skeleton');
  const refresh = renderToString(<DirectoryFeedback resource={resource({ loaded: true })} />);
  expect(refresh).toContain('role="status"'); expect(refresh).toContain('cl-load-status'); expect(refresh).not.toContain('wc-skeleton');
});

test('a pending friend operation disables every conflicting request action and announces progress', () => {
  fixtures.resources['/api/users/friend-requests'] = resource({ data: [{ id: 'one', username: 'Alice' }, { id: 'two', username: 'Bob' }], loaded: true, loading: false });
  fixtures.action.pendingKey = 'request:one:accepted';
  const html = render({ openFriendRequests: 1 });
  expect(html.match(/data-testid="friend-request-(accept|reject)" disabled=""/g)).toHaveLength(4);
  expect(html).toContain('role="status"'); expect(html).toContain('contacts.processing');
});
test('labels retain named action groups and disable conflicting buttons during confirmation', () => {
  fixtures.action.pendingKey = 'delete:one';
  const html = renderToString(<LabelsTab labels={[{ id: 'one', name: 'Work', members: [] }]} contacts={[]}
    onBack={() => {}} resource={resource({ loaded: true, loading: false })} contactResource={resource()} />);
  expect(html).toContain('role="group" aria-label="Work"');
  expect(html).toContain('data-directory-section="members:one"');
  expect(html).toContain('data-directory-section="edit:one"');
  expect(html.match(/disabled=""/g)).toHaveLength(4);
});
test('unconfirmed operations show persistent feedback without automatically offering to replay writes', () => {
  fixtures.action.error = true;
  const html = render({ openFriendRequests: 1 });
  expect(html).toContain('role="alert"'); expect(html).toContain('contacts.actionUnconfirmed');
});

test('label creation waits for the first list response so saving cannot cancel the only initial load', () => {
  const html = renderToString(<LabelsTab labels={[]} contacts={[]} onBack={() => {}}
    resource={resource()} contactResource={resource()} />);
  expect(html).toContain('disabled="" data-directory-section="edit:new"');
  expect(html).not.toContain('contacts.noLabels');
});
