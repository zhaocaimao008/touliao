import React, { useId } from 'react';
import useFocusTrap from '../hooks/useFocusTrap';
import { TouliaoButton } from './Button';
import { getI18n } from '../contexts/I18nContext';

/** iOS/Android keep their native alert/confirmationDialog adapters. */
export default function TouliaoDialog({ variant = 'CONFIRM', title, message, children,
  confirmLabel, cancelLabel, onConfirm, onCancel, busy = false }) {
  const t = getI18n();
  const id = useId();
  const cancellable = !!onCancel;
  const ref = useFocusTrap(true, {
    initialFocus: cancellable ? '[data-testid="confirm-cancel"]' : '[data-testid="confirm-ok"]',
    onEscape: busy ? undefined : onCancel || onConfirm,
    lockScroll: true,
  });
  return <div className="wc-confirm-overlay tl-dialog-overlay"
    onClick={event => { if (event.target === event.currentTarget && !busy) onCancel?.(); }}>
    <div ref={ref} tabIndex={-1} className="wc-confirm-box tl-dialog" role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={message ? `${id}-body` : undefined} data-variant={variant}>
      <h2 id={`${id}-title`} className="tl-dialog-title">{title || t('common.confirm')}</h2>
      {message && <div id={`${id}-body`} className="wc-confirm-msg tl-dialog-body">{message}</div>}
      {children}
      <div className="wc-confirm-btns tl-dialog-actions">
        {cancellable && <TouliaoButton variant="secondary" disabled={busy} data-testid="confirm-cancel" onClick={onCancel}>
          {cancelLabel || t('common.cancel')}
        </TouliaoButton>}
        <TouliaoButton variant={variant === 'DANGER' ? 'danger' : 'primary'} loading={busy}
          data-testid="confirm-ok" onClick={onConfirm}>{confirmLabel || t('common.confirm')}</TouliaoButton>
      </div>
    </div>
  </div>;
}
