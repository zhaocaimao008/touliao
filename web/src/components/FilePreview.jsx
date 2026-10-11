import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TouliaoIcon from '../ui-kit/Icon';
import useFocusTrap from '../hooks/useFocusTrap';
import usePreviewDownload from '../hooks/usePreviewDownload';
import { shareMessage, canShare } from '../utils/share';
import { humanFileSize } from '../utils/fileSize';
import { classify } from '../utils/attachmentType';
import { useI18n } from '../contexts/I18nContext';
import { DocumentRenderer, PdfRenderer } from './DocumentRenderers';
import './FilePreview.css';

export default function FilePreview(props) {
  return createPortal(<FileSession key={JSON.stringify([props.fileUrl, props.filename, props.mimeType])} {...props} />, document.body);
}

function FileSession({ fileUrl, filename, mimeType, fileSize, onClose }) {
  const { t } = useI18n();
  const kind = classify(mimeType, filename);
  const [status, setStatus] = useState(() => !fileUrl ? 'error' : kind === 'generic' ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);
  const retrying = useRef(false);
  const closeRef = useRef(null);
  const modalRef = useFocusTrap(true, { onEscape: onClose, lockScroll: true, initialFocus: '[data-testid="file-preview-close"]' });
  const download = usePreviewDownload({ fileUrl, filename, mimeType, autoOpen: kind === 'generic' });
  const dl = download.state;
  const busy = dl && ['pending', 'downloading'].includes(dl.status);
  const onLoaded = useCallback(() => { retrying.current = false; setStatus('ready'); }, []);
  const onError = useCallback(() => { retrying.current = false; setStatus('error'); }, []);
  const retry = () => {
    if (retrying.current || !fileUrl) return;
    retrying.current = true;
    setAttempt(value => value + 1);
    setStatus('loading');
    closeRef.current?.focus({ preventScroll: true });
  };
  const Renderer = kind === 'pdf' ? PdfRenderer : DocumentRenderer;
  const saveLabel = kind === 'generic' ? t('filePreview.downloadOpen') : t('filePreview.saveLocal');
  return <div ref={modalRef} tabIndex={-1} className="tl-file-preview" role="dialog" aria-modal="true"
    aria-label={t('filePreview.title')} data-testid="file-preview">
    <header className="file-preview-header">
      <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.back')} data-testid="file-preview-close"><TouliaoIcon name="back" size="md" /></button>
      <div className="file-preview-heading"><div title={filename}>{filename || t('filePreview.title')}</div>
        {fileSize != null && <small>{humanFileSize(fileSize)}</small>}
      </div>
      {fileUrl && canShare() && <button type="button" onClick={() => shareMessage({ fileUrl, filename, title: filename })}>{t('filePreview.share')}</button>}
    </header>
    <div className="tl-file-preview-body" aria-busy={status === 'loading'}>
      {status === 'loading' && <div className="file-preview-status" role="status"><span className="file-preview-spinner" />{t('filePreview.loading')}</div>}
      {status === 'error' && <div className="file-preview-status" role="alert">
        <p>{t(fileUrl ? 'filePreview.loadFailed' : 'filePreview.unavailable')}</p>
        {fileUrl && <button type="button" onClick={retry} data-testid="file-preview-retry">{t('filePreview.retry')}</button>}
      </div>}
      {fileUrl && kind !== 'generic' && status !== 'error' && <div className="file-preview-document"
        style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} inert={status === 'ready' ? undefined : ''}>
        <Renderer key={attempt} fileUrl={fileUrl} filename={filename} kind={kind} onLoaded={onLoaded} onError={onError} />
      </div>}
      {kind === 'generic' && status === 'ready' && <div className="tl-file-details" tabIndex={0} aria-label={filename}>
        <TouliaoIcon name="fileContent" size="xl" />
        <div className="tl-file-details-name">{filename}</div>
        <div className="tl-file-details-meta">{humanFileSize(fileSize)}{mimeType ? ` · ${mimeType}` : ''}</div>
        <div className="tl-file-details-description">{t('filePreview.unsupported')}</div>
      </div>}
    </div>
    <footer className="file-preview-footer">
      {!dl && <button type="button" disabled={!fileUrl} onClick={download.start} data-testid="file-preview-download">{saveLabel}</button>}
      {busy && <div className="file-download-progress" role="status" aria-live="polite">
        <span>{t(dl.status === 'pending' ? 'filePreview.queued' : 'filePreview.downloading')}</span>
        {dl.status === 'downloading' && <progress max="100" value={dl.indeterminate ? undefined : dl.progress || 0} aria-label={t('filePreview.downloading')} />}
        {dl.status === 'downloading' && !dl.indeterminate && <span>{dl.progress || 0}%</span>}
        <button type="button" onClick={download.cancel}>{t('common.cancel')}</button>
      </div>}
      {dl?.status === 'completed' && <span role="status">{t('filePreview.saved')}</span>}
      {dl?.status === 'cancelled' && <button type="button" onClick={download.start}>{t('filePreview.cancelledRedownload')}</button>}
      {dl?.status === 'failed' && <div className="file-download-progress" role="alert"><span>{t('filePreview.downloadFailed')}</span>
        <button type="button" onClick={download.retry}>{t('filePreview.retry')}</button></div>}
    </footer>
  </div>;
}
