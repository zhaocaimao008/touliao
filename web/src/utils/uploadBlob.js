// Abort reaches the actual cloud request, including cancellation before send.
export function uploadBlob(url, blob, contentType, { signal, onProgress, errorText } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const cancelled = () => new DOMException('Upload cancelled', 'AbortError');
    const abort = () => { finish(cancelled()); xhr.abort(); };
    xhr.upload.addEventListener('progress', event => {
      if (!settled && event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    });
    xhr.addEventListener('load', () => finish(xhr.status >= 200 && xhr.status < 300 ? null : new Error(errorText?.(xhr.status) || 'Upload failed')));
    xhr.addEventListener('error', () => finish(new Error(errorText?.() || 'Upload failed')));
    xhr.addEventListener('timeout', () => finish(new Error(errorText?.() || 'Upload timed out')));
    xhr.addEventListener('abort', () => finish(cancelled()));
    if (signal?.aborted) { finish(cancelled()); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      xhr.open('PUT', url);
      xhr.timeout = 600000;
      xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
      xhr.send(blob);
    } catch (error) { finish(error); }
  });
}
