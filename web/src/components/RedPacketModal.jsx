import React, { useState } from 'react';
import axios from 'axios';

export default function RedPacketModal({ conversation, onClose, onSent }) {
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('');
  const [greeting, setGreeting] = useState('恭喜发财，大吉大利！');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // 私聊红包固定 1 个（对齐微信：私聊只填金额，无「个数」）；群聊才有个数
  const isGroup = conversation.type === 'group';
  const amountNum = Math.floor(parseFloat(amount) || 0);
  const countNum = isGroup ? (parseInt(count) || 0) : 1;
  const perPerson = countNum > 0 ? Math.floor(amountNum / countNum) : 0;
  const canSend = amountNum > 0 && amountNum <= 20000
    && (isGroup ? (countNum > 0 && countNum <= 100 && amountNum >= countNum) : true);

  const send = async () => {
    if (!canSend) return;
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
      setError(e.response?.data?.error || '发送失败');
    }
    setSending(false);
  };

  return (
    <div className="rpm-overlay" onClick={() => { if (!sending) onClose(); }}>
      <div className="rpm-card" role="dialog" aria-modal="true" aria-label="发红包" onClick={e => e.stopPropagation()}>
        <div className="rpm-title">发红包</div>

        {error && <div className="rpm-error" role="alert">{error}</div>}

        <div className="rpm-field">
          <label className="rpm-label" htmlFor="rpm-amount">红包金币总额 (1-20000)</label>
          <input id="rpm-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} min="1" max="20000"
            placeholder="输入金币数" className="rpm-input" />
        </div>

        {isGroup && (
          <div className="rpm-field">
            <label className="rpm-label" htmlFor="rpm-count">红包个数 (1-100)</label>
            <input id="rpm-count" type="number" value={count} onChange={e => setCount(e.target.value)} min="1" max="100"
              placeholder="输入红包个数" className="rpm-input" />
          </div>
        )}

        {isGroup && countNum > 0 && amountNum > 0 && (
          <div className="rpm-preview">
            <div className="rpm-preview-label">平均每个</div>
            <div className="rpm-preview-amount">{perPerson} 金币</div>
            {amountNum < countNum && <div className="rpm-preview-warn">⚠ 总金币不能少于红包个数</div>}
          </div>
        )}

        <div className="rpm-field">
          <label className="rpm-label">祝福语 (可选)</label>
          <textarea value={greeting} onChange={e => setGreeting(e.target.value)} maxLength={100}
            placeholder="例如：恭喜发财，大吉大利！" className="rpm-textarea" />
          <div className="rpm-counter">{greeting.length}/100</div>
        </div>

        <div className="rpm-actions">
          <button onClick={onClose} className="rpm-btn-cancel" disabled={sending}>取消</button>
          <button onClick={send} disabled={!canSend || sending} className="rpm-btn-send"
            style={{ background: canSend && !sending ? 'var(--green)' : 'rgba(7,193,96,.4)', cursor: canSend && !sending ? 'pointer' : 'not-allowed' }}>
            {sending ? '发送中…' : '确认发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
