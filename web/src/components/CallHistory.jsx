import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Avatar from './Avatar';

function ago(sec) {
  // 钳到 0：时钟偏差/服务器时间超前时避免出现「-3分钟前」
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + '分钟前';
  if (d < 86400) return Math.floor(d / 3600) + '小时前';
  const dt = new Date(sec * 1000);
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
}

function fmtDuration(s) {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

// 状态 → 中文 + 颜色
const STATUS = {
  completed: { label: '已接通', color: 'var(--text-tertiary)' },
  missed:    { label: '未接听', color: 'var(--color-badge)' },
  canceled:  { label: '已取消', color: 'var(--color-badge)' },
  rejected:  { label: '已拒绝', color: 'var(--color-badge)' },
  ongoing:   { label: '通话中', color: 'var(--green)' },
};

export default function CallHistory({ onOpenChat }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoading(true);
    axios.get('/api/users/me/call-logs')
      .then(r => { setList(r.data); setLoadError(false); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // 点击通话记录 → 打开对方会话（回拨/继续聊天），对齐移动端
  const openPeer = async (c) => {
    if (!c.peer_id || !onOpenChat) return;
    try {
      const { data } = await axios.post('/api/messages/conversation/private', { userId: c.peer_id });
      onOpenChat({ id: data.conversationId, type: 'private', name: c.peer_name, avatar: c.peer_avatar, otherUser: { id: c.peer_id, username: c.peer_name, avatar: c.peer_avatar } });
    } catch { /* 静默失败，用户可重试 */ }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>加载中…</div>
      ) : loadError && list.length === 0 ? (
        <div role="status" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 13 }}>
          加载失败，<button onClick={load} style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>点击重试</button>
        </div>
      ) : list.length === 0 ? (
        <div role="status" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 13 }}>暂无通话记录</div>
      ) : (
        list.map(c => {
          const st = STATUS[c.status] || STATUS.completed;
          const isMissed = c.direction === 'in' && (c.status === 'missed' || c.status === 'canceled');
          return (
            <div key={c.id} data-testid="call-log-item" onClick={() => openPeer(c)}
              role={onOpenChat ? 'button' : undefined} tabIndex={onOpenChat ? 0 : undefined}
              onKeyDown={e => { if (onOpenChat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPeer(c); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border-color)', cursor: onOpenChat ? 'pointer' : 'default' }}>
              <Avatar src={c.peer_avatar} name={c.peer_name} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500, color: isMissed ? 'var(--color-badge)' : 'var(--text-primary)' }}>{c.peer_name || '用户'}</div>
                <div style={{ fontSize: 12, color: st.color, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true" style={{ transform: c.direction === 'out' ? 'none' : 'scaleX(-1)' }}>{c.direction === 'out' ? '↗' : '↙'}</span>
                  {c.direction === 'out' ? '去电' : '来电'} · {c.type === 'video' ? '视频通话' : '语音通话'} · {st.label}
                  {c.duration > 0 && ` · ${fmtDuration(c.duration)}`}
                </div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>{ago(c.created_at)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
