import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import useFocusTrap from '../hooks/useFocusTrap';
import { useScheduledMessages } from '../hooks/useScheduledMessages';
import { defaultScheduleLocal, scheduleBounds } from '../utils/scheduleSend';
import TouliaoIcon from '../ui-kit/Icon';
import './ScheduleSendModal.css';

function ScheduleForm({ convId, defaultContent = '', owner, onClose, onScheduled }) {
  const { t, lang } = useI18n();
  const titleId = useId(), errorId = useId(), timeHintId = useId();
  const [content, setContent] = useState(defaultContent);
  const [sendAtLocal, setSendAtLocal] = useState(() => defaultScheduleLocal());
  const [bounds, setBounds] = useState(() => scheduleBounds());
  const schedules = useScheduledMessages({ conversationId: convId, owner, onCreated: onScheduled });
  const { state } = schedules;
  const close = () => { if (schedules.canClose()) onClose(); };
  const trapRef = useFocusTrap(true, { onEscape: close, lockScroll: true, initialFocus: state.phase ? undefined : '.schedule-content' });
  const busy = !!state.phase;
  const creating = state.phase === 'creating';
  const timeError = ['ss.errInvalidTime', 'ss.errTooSoon', 'ss.errTooFar'].includes(state.error);
  const contentError = ['ss.errEmptyContent', 'ss.errContentLong'].includes(state.error);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatTime = value => new Date(Number(value) * 1000).toLocaleString(lang || 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

  return createPortal(
    <div className="schedule-overlay" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <form className="schedule-dialog" ref={trapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined}
        noValidate onSubmit={event => { event.preventDefault(); schedules.create(content, sendAtLocal); }}>
        <header className="schedule-header">
          <h2 id={titleId}>{t('ss.title')}</h2>
          <button type="button" className="schedule-close" onClick={close} disabled={busy} aria-label={t('common.close')}><TouliaoIcon name="close" size="sm" /></button>
        </header>
        <div className="schedule-body">
          <label className="schedule-field">
            <span>{t('ss.contentLabel')}</span>
            <textarea className="schedule-content" data-testid="schedule-content" rows={3} value={content} maxLength={30000} disabled={busy}
              aria-invalid={contentError || undefined} aria-describedby={contentError ? errorId : undefined}
              placeholder={t('ss.contentPlaceholder')} onChange={event => { setContent(event.target.value); schedules.clearError(); }} />
          </label>
          <label className="schedule-field">
            <span>{t('ss.timeLabel')}</span>
            <input type="datetime-local" data-testid="schedule-time" step="60" value={sendAtLocal} min={bounds.min} max={bounds.max} disabled={busy}
              aria-invalid={timeError || undefined} aria-describedby={timeError ? `${timeHintId} ${errorId}` : timeHintId}
              onChange={event => { setSendAtLocal(event.target.value); schedules.clearError(); }} />
          </label>
          <p className="schedule-hint" id={timeHintId}>{t('ss.timezoneTemplate').replace('{zone}', timezone)}</p>
          {state.error && <div className="schedule-error" role="alert" id={errorId}>{state.detail || t(state.error)}</div>}
          {state.error === 'ss.errTooSoon' && <button type="button" className="schedule-link" onClick={() => {
            const now = Date.now(); setBounds(scheduleBounds(now)); setSendAtLocal(scheduleBounds(now + 60000).min); schedules.clearError();
          }}>{t('ss.useEarliest')}</button>}
          <section className="schedule-tasks" aria-label={t('ss.pendingTitle')}>
            <div className="schedule-task-heading"><h3>{t('ss.pendingTitle')}</h3>
              <button type="button" className="schedule-link" disabled={state.loading || busy} onClick={schedules.refresh}>{t('ss.refresh')}</button>
            </div>
            {state.loading ? <p className="schedule-hint" role="status">{t('common.loading')}</p>
              : state.listError ? <p className="schedule-error" role="alert">{t('ss.loadFailed')}</p>
                : state.tasks.length === 0 ? <p className="schedule-hint">{t('ss.noPending')}</p> : null}
            {!state.loading && !state.listError && state.tasks.length > 0 && <ul className="schedule-task-list">
              {state.tasks.map(item => <li key={item.id}>
                <div className="schedule-task-content">{item.content}</div>
                <div className="schedule-task-meta"><time dateTime={new Date(Number(item.send_at) * 1000).toISOString()}>{formatTime(item.send_at)}</time>
                  <button type="button" className="schedule-task-cancel" disabled={busy} onClick={() => schedules.cancel(item.id)}
                    aria-label={t('ss.cancelTaskTemplate').replace('{content}', item.content.slice(0, 50))}>
                    {state.phase === item.id ? t('ss.cancelling') : t('ss.cancelTask')}
                  </button>
                </div>
                {item.status === 'recovery_required' && <p className="schedule-hint">{t('ss.recoveryHint')}</p>}
              </li>)}
            </ul>}
            {state.truncated && <p className="schedule-hint">{t('ss.listLimited')}</p>}
            {state.uncertain && <div className="schedule-uncertain">
              <p>{t('ss.reviewBeforeRetry')}</p>
              <button type="button" className="schedule-link" disabled={busy || state.loading || state.listError} onClick={schedules.acknowledge}>{t('ss.reviewed')}</button>
            </div>}
          </section>
        </div>
        <footer className="schedule-footer">
          <button type="button" className="schedule-secondary" onClick={close} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="schedule-primary" disabled={busy || state.uncertain || !content.trim()}>{creating ? t('ss.saving') : t('ss.confirmSend')}</button>
        </footer>
      </form>
    </div>, document.body,
  );
}

export default function ScheduleSendModal(props) {
  const { outboxScope } = useAuth();
  const key = JSON.stringify([props.convId, outboxScope?.server, outboxScope?.accountId, outboxScope?.generation]);
  return <ScheduleForm key={key} {...props} owner={outboxScope} />;
}
