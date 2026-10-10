import TouliaoIcon from '../ui-kit/Icon';
import React from 'react';
import Avatar from './Avatar';
import useCallHistory, { canOpenCall } from '../hooks/useCallHistory';

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
  const { list, loading, loadError, retry, openingId, openErrorId, openPeer } = useCallHistory(refreshKey, onOpenChat);

  return (
    <div className="tl-call-history" style={{ height: '100%', overflowY: 'auto' }} aria-busy={loading}>
      {loading && list.length === 0 ? (
        <Skeleton rows={6} avatar />
      ) : loadError && list.length === 0 ? (
        <div className="tl-call-state" role="status">
          <p>{t('callHistory.historyLoadFailed')}</p><button type="button" onClick={retry}>{t('common.retry')}</button>
        </div>
      ) : list.length === 0 ? (
        <div className="tl-call-state" role="status">{t('callHistory.noCallHistory')}</div>
      ) : <>
        {(loadError || loading) && <div className="tl-call-refresh" role="status">
          <span>{t(loading ? 'common.loading' : 'callHistory.refreshFailed')}</span>
          <button type="button" onClick={retry} disabled={loading}>{t('common.retry')}</button>
        </div>}
        {
        list.map(c => {
          const actionable = Boolean(onOpenChat && canOpenCall(c));
          const pending = openingId === c.id;
          const stRaw = STATUS[c.status] || STATUS.completed;
          const st = { ...stRaw, label: t(`callHistory.status.${stRaw.key}`) };
          const isMissed = c.direction === 'in' && (c.status === 'missed' || c.status === 'canceled');
          // 红色只留给「需要处理」的：未接来电、异常中断。自己打出去被拒/自己取消、自己拒接的都是灰色，
          // 否则整页一片红，看起来像有很多未接电话
          const statusColor = (isMissed || c.status === 'interrupted') ? 'var(--color-badge)'
            : c.status === 'ongoing' ? st.color : 'var(--text-tertiary)';
          return (
            <div key={c.id} className="tl-call-log" data-testid="call-log-item" onClick={() => openPeer(c)}
              role={actionable ? 'button' : undefined} tabIndex={actionable ? 0 : undefined}
              aria-disabled={actionable && openingId !== null ? true : undefined} aria-busy={pending || undefined}
              onKeyDown={e => { if (actionable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPeer(c); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border-color)', cursor: actionable ? 'pointer' : 'default' }}>
              {c.kind === 'group'
                ? <GroupAvatar avatar={c.peer_avatar} size='md' />
                : <Avatar src={c.peer_avatar} name={c.peer_name} size='md' />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tl-call-name" style={{ fontSize: 'var(--text-name)', fontWeight: 500, color: isMissed ? 'var(--color-badge)' : 'var(--text-primary)' }}>{c.peer_name || t('messageItem.defaultUsername')}</div>
                <div className="tl-call-description" style={{ fontSize: 'var(--text-sm)', color: statusColor, marginTop: 2, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <TouliaoIcon name={isMissed ? 'callMissed' : c.direction === 'out' ? 'callOutgoing' : 'callIncoming'} size="xs" />
                  <span>
                  {c.direction === 'out' ? t('callHistory.outgoing') : t('callHistory.incoming')} · {c.kind === 'group'
                    ? (c.type === 'video' ? t('chat.groupVideoCall') : t('chat.groupVoiceCall'))
                    : (c.type === 'video' ? t('chat.videoCall') : t('chat.voiceCall'))} · {st.label}
                  {c.duration > 0 && ` · ${fmtDuration(c.duration, t)}`}
                  {c.kind === 'group' && c.participant_count > 0 && ` · ${t('callHistory.participantsTemplate').replace('{n}', c.participant_count)}`}
                  </span>
                </div>
                {pending && <div className="tl-call-feedback" role="status">{t('callHistory.openingChat')}</div>}
                {openErrorId === c.id && <div className="tl-call-feedback is-error" role="alert">{t('callHistory.openChatFailed')}</div>}
              </div>
              <span className="tl-call-time" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{ago(c.created_at, t)}</span>
            </div>
          );
        })
      }</>}
    </div>
  );
}
