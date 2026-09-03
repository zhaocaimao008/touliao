import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Avatar from './Avatar';
import { GroupAvatar } from './GroupAvatar';
import { Skeleton } from './StateViews';
import { useI18n } from '../contexts/I18nContext';

function ago(sec, t) {
  // 钳到 0：时钟偏差/服务器时间超前时避免出现「-3分钟前」
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return t('callHistory.justNow');
  if (d < 3600) return t('callHistory.minutesAgoTemplate').replace('{n}', Math.floor(d / 60));
  if (d < 86400) return t('callHistory.hoursAgoTemplate').replace('{n}', Math.floor(d / 3600));
  const dt = new Date(sec * 1000);
  return t('callHistory.monthDayTemplate').replace('{month}', dt.getMonth() + 1).replace('{day}', dt.getDate());
}

function fmtDuration(s, t) {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0
    ? t('callHistory.durationMinSecTemplate').replace('{min}', m).replace('{sec}', sec)
    : t('callHistory.durationSecOnlyTemplate').replace('{sec}', sec);
}

// 状态 → key + 颜色
const STATUS = {
  completed:   { key: 'completed',   color: 'var(--text-tertiary)' },
  missed:      { key: 'missed',      color: 'var(--color-badge)' },
  canceled:    { key: 'canceled',    color: 'var(--color-badge)' },
  rejected:    { key: 'rejected',    color: 'var(--color-badge)' },
  ongoing:     { key: 'ongoing',     color: 'var(--green)' },
  // 服务端进程重启时，重启前还没结束的 1对1 通话记录会被启动时的收尾逻辑
  // （callReconciler.js）统一标成这个状态——否则会永久停在 'ongoing'，
  // 列表里显示"通话中"却其实早就断了，具有误导性。
  interrupted: { key: 'interrupted', color: 'var(--color-badge)' },
};

export default function CallHistory({ onOpenChat, refreshKey = 0 }) {
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // 重试用：显示转圈后重新拉取
  const load = useCallback(() => {
    setLoading(true);
    axios.get('/api/users/me/call-logs')
      .then(r => { setList(r.data); setLoadError(false); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  // 初次挂载拉取：loading 初值已为 true，effect 内不做同步 setState（避免级联渲染）
  useEffect(() => {
    let alive = true;
    axios.get('/api/users/me/call-logs')
      .then(r => { if (alive) { setList(r.data); setLoadError(false); } })
      .catch(() => { if (alive) setLoadError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 通话结束事件驱动刷新：Home 层在收到 call:end（挂断/拒绝/超时/断线）时 bump
  // refreshKey——停留在历史页时列表也能自动出现新记录。静默刷新，不闪 loading。
  useEffect(() => {
    if (refreshKey === 0) return; // 首次挂载由上方 effect 拉取
    let alive = true;
    axios.get('/api/users/me/call-logs')
      .then(r => { if (alive) { setList(r.data); setLoadError(false); } })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [refreshKey]);

  // 点击通话记录 → 打开对方会话（回拨/继续聊天）或群聊（群通话记录），对齐移动端
  const openPeer = async (c) => {
    if (!onOpenChat) return;
    if (c.kind === 'group') {
      if (!c.conversation_id) return;
      onOpenChat({ id: c.conversation_id, type: 'group', name: c.peer_name, avatar: c.peer_avatar });
      return;
    }
    if (!c.peer_id) return;
    try {
      const { data } = await axios.post('/api/messages/conversation/private', { userId: c.peer_id });
      onOpenChat({ id: data.conversationId, type: 'private', name: c.peer_name, avatar: c.peer_avatar, otherUser: { id: c.peer_id, username: c.peer_name, avatar: c.peer_avatar } });
    } catch { /* 静默失败，用户可重试 */ }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {loading ? (
        <Skeleton rows={6} avatar />
      ) : loadError && list.length === 0 ? (
        <div role="status" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)' }}>
          {t('callHistory.loadFailed')}<button onClick={load} style={{ color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{t('callHistory.clickToRetry')}</button>
        </div>
      ) : list.length === 0 ? (
        <div role="status" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm2)' }}>{t('callHistory.noCallHistory')}</div>
      ) : (
        list.map(c => {
          const stRaw = STATUS[c.status] || STATUS.completed;
          const st = { ...stRaw, label: t(`callHistory.status.${stRaw.key}`) };
          const isMissed = c.direction === 'in' && (c.status === 'missed' || c.status === 'canceled');
          return (
            <div key={c.id} data-testid="call-log-item" onClick={() => openPeer(c)}
              role={onOpenChat ? 'button' : undefined} tabIndex={onOpenChat ? 0 : undefined}
              onKeyDown={e => { if (onOpenChat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPeer(c); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border-color)', cursor: onOpenChat ? 'pointer' : 'default' }}>
              {c.kind === 'group'
                ? <GroupAvatar avatar={c.peer_avatar} size={40} />
                : <Avatar src={c.peer_avatar} name={c.peer_name} size={40} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-name)', fontWeight: 500, color: isMissed ? 'var(--color-badge)' : 'var(--text-primary)' }}>{c.peer_name || t('messageItem.defaultUsername')}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: st.color, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true" style={{ transform: c.direction === 'out' ? 'none' : 'scaleX(-1)' }}>{c.direction === 'out' ? '↗' : '↙'}</span>
                  {c.direction === 'out' ? t('callHistory.outgoing') : t('callHistory.incoming')} · {c.kind === 'group'
                    ? (c.type === 'video' ? t('chat.groupVideoCall') : t('chat.groupVoiceCall'))
                    : (c.type === 'video' ? t('chat.videoCall') : t('chat.voiceCall'))} · {st.label}
                  {c.duration > 0 && ` · ${fmtDuration(c.duration, t)}`}
                  {c.kind === 'group' && c.participant_count > 0 && ` · ${t('callHistory.participantsTemplate').replace('{n}', c.participant_count)}`}
                </div>
              </div>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{ago(c.created_at, t)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
