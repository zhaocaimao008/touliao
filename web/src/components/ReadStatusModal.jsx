import React, { useEffect, useMemo, useState } from 'react';
import Avatar from './Avatar';
import useFocusTrap from '../hooks/useFocusTrap';
import { useI18n } from '../contexts/I18nContext';
import { createReadStatusModel } from '../utils/readStatus';

export default function ReadStatusModal({ state, conversation, members, currentUserId, onClose, onRetry }) {
  const { t } = useI18n();
  const trapRef = useFocusTrap();
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(() => createReadStatusModel({
    conversation,
    members,
    currentUserId,
    message: state.message,
    readUserIds: state.readUserIds,
  }), [conversation, members, currentUserId, state.message, state.readUserIds]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const groupCount = model.type === 'group' && model.recipientCount > 0
    ? t('readStatus.groupCountTemplate').replace('{read}', model.readCount).replace('{total}', model.recipientCount)
    : t('readStatus.groupReadTemplate').replace('{count}', model.readCount || 0);

  return (
    <div className="wc-modal-overlay read-status-overlay" ref={trapRef} onClick={onClose}>
      <div className="wc-modal read-status-modal" role="dialog" aria-modal="true" aria-labelledby="read-status-title" onClick={event => event.stopPropagation()}>
        <div className="wc-modal-header">
          <h2 id="read-status-title" className="wc-modal-title">{t('readStatus.title')}</h2>
          <button type="button" className="wc-modal-close" onClick={onClose} aria-label={t('common.close')}>×</button>
        </div>
        <div className="wc-modal-body read-status-body">
          {state.loading ? (
            <div className="read-status-state" role="status">{t('readStatus.loading')}</div>
          ) : state.error ? (
            <div className="read-status-state">
              <div role="alert">{t('readStatus.loadFailed')}</div>
              <button type="button" className="read-status-retry" onClick={() => onRetry(state.message)}>{t('common.retry')}</button>
            </div>
          ) : model.type === 'private' ? (
            <div className={`read-status-private${model.isRead ? ' is-read' : ''}`}>
              <span className="read-status-mark" aria-hidden="true">{model.isRead ? '✓✓' : '✓'}</span>
              <div>
                <div className="read-status-primary">{model.isRead ? t('readStatus.peerRead') : t('readStatus.peerUnread')}</div>
                {model.peerName && <div className="read-status-secondary">{model.peerName}</div>}
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="read-status-group-summary"
                aria-expanded={expanded}
                disabled={model.readCount === 0}
                onClick={() => setExpanded(value => !value)}
              >
                <span>{groupCount}</span>
                {model.readCount > 0 && <span className="read-status-expand">{expanded ? t('readStatus.collapse') : t('readStatus.expand')}</span>}
              </button>
              {model.readCount === 0 && <div className="read-status-empty" role="status">{t('readStatus.noGroupReaders')}</div>}
              {expanded && model.readers.length > 0 && (
                <ul className="read-status-list" aria-label={t('readStatus.readMembers')}>
                  {model.readers.map(reader => (
                    <li key={reader.id} className="read-status-member">
                      <Avatar src={reader.avatar} name={reader.name || t('readStatus.unknownMember')} size='sm' />
                      <span>{reader.name || t('readStatus.unknownMember')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
