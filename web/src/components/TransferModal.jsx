import React, { useState, useEffect } from 'react';
import axios from 'axios';
import useFocusTrap from '../hooks/useFocusTrap';
import { useI18n } from '../contexts/I18nContext';

/**
 * 好友转账弹窗：输入金币数 + 备注，确认后调 POST /api/wallet/transfer。
 * 设计：转账即到账，不搞 24h 未领退回的复杂度；收款方收到消息气泡即已入账。
 */
export default function TransferModal({ conversation, onClose, onSent }) {
  const { t } = useI18n();
  const trapRef = useFocusTrap();
  const [amount, setAmount]   = useState('');
  const [note,   setNote]     = useState('');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');

  // 仅私聊才能转账（校验由父组件保证，这里防御性显示）
  const otherUser = conversation?.otherUser;
  const amountNum = parseInt(amount, 10) || 0;
  const canSend   = amountNum >= 1 && amountNum <= 20000;

  // Esc 关闭（发送中不关闭，避免资金操作中途打断）
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sending, onClose]);

  const send = async () => {
    // 资金操作入口二次守卫：快速双击时 disabled 尚未重渲染也不重复扣款
    if (!canSend || sending) return;
    setSending(true);
    setError('');
    try {
      const { data } = await axios.post('/api/wallet/transfer', {
        to_user_id: otherUser?.id,
        amount: amountNum,
        note: note.trim(),
      });
      onSent?.(data.message);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || t('transfer.failedRetry'));
    }
    setSending(false);
  };

  return (
    <div className="rpm-overlay" ref={trapRef} onClick={() => { if (!sending) onClose(); }}>
      <div className="rpm-card" role="dialog" aria-modal="true" aria-label={t('transfer.title')} onClick={e => e.stopPropagation()}>
        <div className="rpm-title">{t('transfer.title')}</div>
        {otherUser?.username && (
          <div style={{ textAlign: 'center', fontSize: 'var(--text-sm2)', color: 'var(--text-secondary)', marginBottom: 8 }}>
            {t('transfer.recipientTemplate').replace('{name}', otherUser.username)}
          </div>
        )}

        {error && <div className="rpm-error" role="alert">{error}</div>}

        <div className="rpm-field">
          <label className="rpm-label" htmlFor="tf-amount">{t('transfer.amountLabel')}</label>
          <input
            id="tf-amount"
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={e => { setAmount(e.target.value.replace(/\D/g, '').slice(0, 5)); setError(''); }}
            placeholder={t('redPacket.amountPlaceholder')}
            className="rpm-input"
            aria-label={t('transfer.amountAriaLabel')}
            autoFocus
          />
        </div>

        <div className="rpm-field">
          <label className="rpm-label" htmlFor="tf-note">{t('transfer.noteLabel')}</label>
          <input
            id="tf-note"
            type="text"
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 50))}
            placeholder={t('transfer.notePlaceholder')}
            className="rpm-input"
            aria-label={t('transfer.noteAriaLabel')}
          />
        </div>

        <div className="rpm-actions">
          <button onClick={onClose} className="rpm-btn-cancel" disabled={sending}>{t('common.cancel')}</button>
          <button
            onClick={send}
            disabled={!canSend || sending}
            className="rpm-btn-send"
            style={{
              background: canSend && !sending ? 'var(--green)' : 'rgba(var(--color-primary-rgb),.35)',
              cursor:     canSend && !sending ? 'pointer'     : 'not-allowed',
            }}
          >
            {sending ? t('transfer.sending') : t('transfer.confirmSend')}
          </button>
        </div>
      </div>
    </div>
  );
}
