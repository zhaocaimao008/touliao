import React, { useId, useLayoutEffect, useRef } from 'react';
import { useI18n } from '../contexts/I18nContext';

export default function VoiceRecordButton({ capture }) {
  const { t } = useI18n();
  const hintId = useId();
  const gesture = useRef(null);
  useLayoutEffect(() => { if (capture.phase === 'idle') gesture.current = null; }, [capture.phase]);
  const busy = capture.phase === 'sending' || capture.phase === 'finishing';
  const cancel = () => { gesture.current = null; capture.cancel(); };
  const inside = event => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  };
  const label = capture.phase === 'requesting' ? 'chat.voiceRequesting'
    : capture.phase === 'recording' ? 'chat.releaseToSend' : busy ? 'chat.voiceSending' : 'chat.holdToTalk';
  return <><div className="wc-voice-container">
    <button type="button" data-testid="chat-voice-btn"
      className={`wc-voice-btn${capture.phase === 'recording' ? ' recording' : ''}`}
      aria-describedby={hintId} aria-busy={busy || undefined} aria-disabled={busy || undefined}
      onPointerDown={event => {
        if (busy || gesture.current !== null || event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        gesture.current = event.pointerId;
        capture.start();
      }}
      onPointerMove={event => { if (gesture.current === event.pointerId && !inside(event)) cancel(); }}
      onPointerUp={event => {
        if (gesture.current !== event.pointerId) return;
        gesture.current = null;
        if (inside(event)) capture.finish(); else capture.cancel();
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => { if (gesture.current !== null) cancel(); }}
      onBlur={cancel}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        if (busy || event.repeat || gesture.current !== null) return;
        gesture.current = event.key;
        capture.start();
      }}
      onKeyUp={event => {
        if (gesture.current !== event.key) return;
        event.preventDefault(); gesture.current = null; capture.finish();
      }}
      onContextMenu={event => event.preventDefault()}
    >{t(label)}</button>
  </div>
    <div className="wc-voice-hint" id={hintId}>
      {t('chat.voiceHoldHint')}<span className="wc-voice-keyboard-hint"> {t('chat.voiceKeyboardHint')}</span>
    </div>
  </>;
}
