import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Avatar from './Avatar';

function ago(sec) {
  const d = Date.now() / 1000 - sec;
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

export default function CallHistory() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/users/me/call-logs').then(r => setList(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>加载中…</div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 13 }}>暂无通话记录</div>
      ) : (
        list.map(c => {
          const st = STATUS[c.status] || STATUS.completed;
          const isMissed = c.direction === 'in' && (c.status === 'missed' || c.status === 'canceled');
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border-color)' }}>
              <Avatar src={c.peer_avatar} name={c.peer_name} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500, color: isMissed ? 'var(--color-badge)' : 'var(--text-primary)' }}>{c.peer_name || '用户'}</div>
                <div style={{ fontSize: 12, color: st.color, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* 方向箭头 */}
                  <span style={{ transform: c.direction === 'out' ? 'none' : 'scaleX(-1)' }}>{c.direction === 'out' ? '↗' : '↙'}</span>
                  {c.type === 'video' ? '视频通话' : '语音通话'} · {st.label}
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
