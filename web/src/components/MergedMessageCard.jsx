import React, { useEffect, useMemo, useState } from 'react';
import { formatFull } from '../utils/time';
import { useI18n } from '../contexts/I18nContext';
import useFocusTrap from '../hooks/useFocusTrap';

function parseMerged(content) {
  try {
    const parsed = JSON.parse(content || '{}');
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      items: Array.isArray(parsed.items) ? parsed.items.slice(0, 30) : [],
    };
  } catch {
    return { title: '', items: [] };
  }
}

function typeIcon(type) {
  return { text: '💬', image: '🖼', video: '🎬', voice: '🎤', file: '📎', contact_card: '👤', merged: '📚' }[type] || '💬';
}

export default function MergedMessageCard({ content }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trapRef = useFocusTrap(open);
  const record = useMemo(() => parseMerged(content), [content]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const title = record.title || t('merged.defaultTitle');
  return (
    <>
      <button type="button" className="wc-merged-card" onClick={() => setOpen(true)} aria-label={t('merged.openAriaLabel')}>
        <span className="wc-merged-title">{title}</span>
        <span className="wc-merged-summary">
          {record.items.slice(0, 2).map((item, index) => (
            <span key={`${item.mid || `${item.sender}-${item.ts}`}-${index}`}>{item.senderName ? `${item.senderName}: ` : ''}{item.snippet || ''}</span>
          ))}
        </span>
        <span className="wc-merged-footer" title={t('merged.viewAll')}>{t('merged.viewCountTemplate').replace('{count}', record.items.length)}</span>
      </button>

      {open && (
        <div className="wc-modal-overlay" ref={trapRef} onClick={event => event.target === event.currentTarget && setOpen(false)}>
          <div className="wc-modal wc-merged-modal" role="dialog" aria-modal="true" aria-label={title}>
            <div className="wc-modal-header">
              <span className="wc-modal-title">{title}</span>
              <button type="button" className="wc-modal-close" onClick={() => setOpen(false)} aria-label={t('common.close')}>✕</button>
            </div>
            <div className="wc-merged-list">
              {record.items.length === 0 ? (
                <div className="wc-merged-empty" role="status">{t('merged.empty')}</div>
              ) : record.items.map((item, index) => (
                <div className="wc-merged-item" key={`${item.mid || `${item.sender}-${item.ts}`}-${index}`}>
                  <span className="wc-merged-item-icon" aria-hidden="true">{typeIcon(item.type)}</span>
                  <div className="wc-merged-item-body">
                    <div className="wc-merged-item-head">
                      <strong>{item.senderName || t('messageItem.someone')}</strong>
                      <time>{item.ts ? formatFull(item.ts * 1000) : ''}</time>
                    </div>
                    <div className="wc-merged-item-snippet">{item.snippet || t('merged.unavailable')}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
