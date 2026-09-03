import React, { useState, useEffect } from 'react';
import axios from 'axios';
import useFocusTrap from '../hooks/useFocusTrap';
import { useI18n } from '../contexts/I18nContext';

export default function RedPacketModal({ conversation, onClose, onSent }) {
  const { t } = useI18n();
  const trapRef = useFocusTrap();
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('');
  const [greeting, setGreeting] = useState(t('redPacket.defaultGreeting'));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // 私聊红包固定 1 个（对齐微信：私聊只填金额，无「个数」）；群聊才有个数
  const isGroup = conversation.type === 'group';
  const amountNum = Math.floor(parseFloat(amount) || 0);
  const countNum = isGroup ? (parseInt(count) || 0) : 1;
  const perPerson = countNum > 0 ? Math.floor(amountNum / countNum) : 0;
  const canSend = amountNum > 0 && amountNum <= 20000
    && (isGroup ? (countNum > 0 && countNum <= 100 && amountNum >= countNum) : true);

  // Esc 关闭（与其它弹窗一致；发送中不关闭，避免资金操作被中途打断）
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sending, onClose]);

  const send = async () => {
    // 资金操作，函数入口二次守卫：快速双击时 disabled 尚未重渲染也不会重复发送/扣款
    if (!canSend || sending) return;
    setSending(true);
    setError('');
    try {
      const { data } = await axios.post('/api/redpackets/send', {
        conversationId: conversation.id,
        totalAmount: amountNum,
        totalCount: countNum,
        greeting,
      });
      onSent?.(data.message);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || t('chat.sendFailed'));
    }
    setSending(false);
  };

  return (
    <div className="rpm-overlay" ref={trapRef} onClick={() => { if (!sending) onClose(); }}>
      <div className="rpm-card" role="dialog" aria-modal="true" aria-label={t('redPacket.title')} onClick={e => e.stopPropagation()}>
        <div className="rpm-title">{t('redPacket.title')}</div>

        {error && <div className="rpm-error" role="alert">{error}</div>}

        <div className="rpm-field">
          <label className="rpm-label" htmlFor="rpm-amount">{t('redPacket.totalAmountLabel')}</label>
          <input id="rpm-amount" type="text" inputMode="numeric" value={amount}
            onChange={e => setAmount(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder={t('redPacket.amountPlaceholder')} className="rpm-input" aria-label={t('redPacket.amountAriaLabel')} />
        </div>

        {isGroup && (
          <div className="rpm-field">
            <label className="rpm-label" htmlFor="rpm-count">{t('redPacket.countLabel')}</label>
            <input id="rpm-count" type="text" inputMode="numeric" value={count}
              onChange={e => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder={t('redPacket.countPlaceholder')} className="rpm-input" aria-label={t('redPacket.countAriaLabel')} />
          </div>
        )}
        {!isGroup && (
          <div className="rpm-field">
            <div className="rpm-label" style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>
              {t('redPacket.privateFixedCount')}
            </div>
          </div>
        )}

        {isGroup && countNum > 0 && amountNum > 0 && (
          <div className="rpm-preview">
            <div className="rpm-preview-label">{t('redPacket.avgPerPerson')}</div>
            <div className="rpm-preview-amount">{perPerson} {t('chat.coinUnit')}</div>
            {amountNum < countNum && <div className="rpm-preview-warn">⚠ {t('redPacket.totalLessThanCountWarn')}</div>}
          </div>
        )}

        <div className="rpm-field">
          <label className="rpm-label">{t('redPacket.greetingLabel')}</label>
          <textarea value={greeting} onChange={e => setGreeting(e.target.value)} maxLength={100}
            placeholder={t('redPacket.greetingPlaceholderTemplate').replace('{greeting}', t('redPacket.defaultGreeting'))} className="rpm-textarea" />
          <div className="rpm-counter">{greeting.length}/100</div>
        </div>

        <div className="rpm-actions">
          <button onClick={onClose} className="rpm-btn-cancel" disabled={sending}>{t('common.cancel')}</button>
          <button onClick={send} disabled={!canSend || sending} className="rpm-btn-send"
            style={{ background: canSend && !sending ? 'var(--rp-orange)' : 'rgba(244,81,30,.4)', cursor: canSend && !sending ? 'pointer' : 'not-allowed' }}>
            {sending ? t('redPacket.sending') : t('redPacket.confirmSend')}
          </button>
        </div>
      </div>
    </div>
  );
}
