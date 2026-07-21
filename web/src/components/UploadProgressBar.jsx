import React, { memo } from 'react';

/* ── 文件上传进度 / 失败重试条（从 ChatWindow 抽离）─────────────────
   纯展示子组件：由 uploadState 驱动（null | { name, progress, status,
   errorMsg?, retryFn? }）。retryFn 为父级存入的回调，取消经 onCancel 上抛。
   memo 化后，父组件因打字/来消息等重渲染时，只要 uploadState / onCancel
   未变，进度条不重渲染。 */
function UploadProgressBar({ uploadState, onCancel }) {
  if (!uploadState) return null;
  const isError = uploadState.status === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`wc-upload-bar ${isError ? 'wc-upload-bar-error' : 'wc-upload-bar-progress'}`}
    >
      {uploadState.status === 'uploading' ? (
        <>
          <span className="wc-upload-icon wc-upload-icon-ok">📤</span>
          <div className="wc-upload-body">
            <div className="wc-upload-name">
              {uploadState.name} · {uploadState.progress}%
            </div>
            <div className="wc-upload-track">
              <div className="wc-upload-fill" style={{ width: `${uploadState.progress}%` }} />
            </div>
          </div>
        </>
      ) : (
        <>
          <span className="wc-upload-icon wc-upload-icon-fail">❌</span>
          <div className="wc-upload-error-text">
            {uploadState.errorMsg || '上传失败'}
          </div>
          {uploadState.retryFn && (
            <button className="wc-retry-btn" onClick={uploadState.retryFn}>
              重试
            </button>
          )}
          <button
            className="wc-cancel-upload-btn"
            onClick={onCancel}
            aria-label="取消上传"
          >✕</button>
        </>
      )}
    </div>
  );
}

export default memo(UploadProgressBar);
