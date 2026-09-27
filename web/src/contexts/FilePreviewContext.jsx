import React, { createContext, useCallback, useContext, useState, Suspense } from 'react';
import { useAuth } from './AuthContext';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const FilePreview = lazyWithRetry(() => import('../components/FilePreview'));

const FilePreviewContext = createContext(null);

// Keep the viewer above the desktop/mobile chat branches so resizing preserves it.
export function FilePreviewProvider({ children }) {
  const { outboxScope } = useAuth();
  const [preview, setPreview] = useState(null);
  const openPreview = useCallback(file => setPreview(file ? { file, scope: outboxScope } : null), [outboxScope]);
  return <FilePreviewContext.Provider value={openPreview}>
    {children}
    {preview && preview.scope === outboxScope && <Suspense fallback={null}><FilePreview {...preview.file} onClose={() => setPreview(null)} /></Suspense>}
  </FilePreviewContext.Provider>;
}

export const useFilePreview = () => useContext(FilePreviewContext);
