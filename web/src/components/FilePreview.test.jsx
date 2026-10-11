import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, test, vi } from 'vitest';
import FilePreview from './FilePreview';
import { DocumentRenderer } from './DocumentRenderers';
import { startDownload, subscribe, cancelDownload, retryDownload } from '../utils/downloadManager';

vi.mock('react-dom', () => ({ createPortal: children => children }));
vi.mock('../hooks/useFocusTrap', () => ({ default: () => null }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../utils/share', () => ({ canShare: () => false }));
vi.mock('./DocumentRenderers', () => ({ DocumentRenderer: () => null, PdfRenderer: () => null }));
vi.mock('../utils/downloadManager', () => ({ startDownload: vi.fn(), subscribe: vi.fn(), cancelDownload: vi.fn(), retryDownload: vi.fn() }));
let view, updateDownload, unsubscribe;
function mount(props = {}) {
  vi.stubGlobal('document', { body: {} });
  unsubscribe = vi.fn();
  startDownload.mockReturnValue('download-1');
  subscribe.mockImplementation((id, cb) => { updateDownload = cb; cb({ id, status: 'pending' }); return unsubscribe; });
  act(() => { view = create(<FilePreview fileUrl="/a.csv" filename="a.csv" onClose={() => {}} {...props} />); });
}
const byTest = id => view.root.findByProps({ 'data-testid': id });
const content = () => view.root.findByType(DocumentRenderer);
const text = () => JSON.stringify(view.toJSON());
afterEach(() => { if (view) act(() => view.unmount()); view = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });

test('failed preview can retry, and a new file starts with fresh loading state', () => {
  mount(); act(() => content().props.onError()); expect(text()).toContain('filePreview.loadFailed');
  const retry = byTest('file-preview-retry').props.onClick;
  act(() => { retry(); retry(); }); expect(content()).toBeDefined();
  expect(text()).toContain('filePreview.loading');
  act(() => content().props.onLoaded()); expect(text()).not.toContain('filePreview.loading');
  act(() => view.update(<FilePreview fileUrl="/b.txt" filename="b.txt" onClose={() => {}} />));
  expect(text()).toContain('filePreview.loading'); expect(content().props.fileUrl).toBe('/b.txt');
});
test('missing URLs show an actionable error instead of an endless spinner', () => {
  mount({ fileUrl: '' }); expect(text()).toContain('filePreview.unavailable');
  expect(byTest('file-preview-download').props.disabled).toBe(true); expect(text()).not.toContain('filePreview.loading');
});
test('generic files show details immediately, and zero-byte files keep their size label', () => {
  mount({ filename: 'a.zip', fileSize: 0 }); expect(text()).toContain('filePreview.unsupported');
  expect(text()).toContain('0 B'); expect(text()).not.toContain('filePreview.loading');
});
test('queued downloads remain visible, cancelable and deduplicated', () => {
  mount(); const save = byTest('file-preview-download').props.onClick;
  act(() => { save(); save(); }); expect(startDownload).toHaveBeenCalledTimes(1);
  expect(text()).toContain('filePreview.queued');
  act(() => view.root.findAllByType('button').find(button => button.props.children === 'common.cancel').props.onClick());
  expect(cancelDownload).toHaveBeenCalledWith('download-1');
});
test('progress, retry and cleanup follow the download subscription', () => {
  mount(); act(() => byTest('file-preview-download').props.onClick());
  act(() => updateDownload({ id: 'download-1', status: 'downloading', progress: 40 }));
  expect(view.root.findByType('progress').props.value).toBe(40);
  act(() => updateDownload({ id: 'download-1', status: 'failed' }));
  act(() => view.root.findAllByType('button').find(button => button.props.children === 'filePreview.retry').props.onClick());
  expect(retryDownload).toHaveBeenCalledWith('download-1');
  act(() => view.unmount()); view = null; expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(() => updateDownload({ id: 'download-1', status: 'completed' })).not.toThrow();
});
test('switching files removes the old download subscriber and resets its presentation', () => {
  mount(); act(() => byTest('file-preview-download').props.onClick()); const oldUpdate = updateDownload;
  act(() => view.update(<FilePreview fileUrl="/b.csv" filename="b.csv" onClose={() => {}} />));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  act(() => oldUpdate({ status: 'completed' })); expect(text()).not.toContain('filePreview.saved');
  expect(byTest('file-preview-download')).toBeDefined();
});

test('unknown-size transfers show indeterminate progress and browser handoff does not claim a saved file', () => {
  mount(); act(() => byTest('file-preview-download').props.onClick());
  act(() => updateDownload({ id: 'download-1', status: 'downloading', indeterminate: true }));
  expect(view.root.findByType('progress').props.value).toBeUndefined();
  expect(text()).not.toContain('0%');
  act(() => updateDownload({ id: 'download-1', status: 'completed', browserManaged: true }));
  expect(text()).toContain('filePreview.browserDownloadStarted'); expect(text()).not.toContain('filePreview.saved');
  act(() => updateDownload({ id: 'download-1', status: 'completed', browserManaged: false }));
  expect(text()).toContain('filePreview.saved');
});
