import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createVoiceRecorder, recordedVoice } from '../utils/voiceRecording';
import { captureSession, isSessionCurrent } from '../utils/sessionContext';

const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());
const dispose = task => {
  if (!task) return;
  task.cancelled = true;
  task.controller.abort();
  if (task.recorder) {
    task.recorder.ondataavailable = null;
    task.recorder.onstop = null;
    task.recorder.onerror = null;
    try { if (task.recorder.state !== 'inactive') task.recorder.stop(); } catch { /* Already stopped. */ }
  }
  stopTracks(task.stream);
};

// A release explicitly authorizes delivery. Navigation, interruption and a late
// permission response can only discard capture, never turn it into a message.
export function useVoiceCapture({ conversationId, owner, enabled, canStart, onReady, onError }) {
  const { server, accountId, generation } = owner || {};
  const view = useMemo(() => ({ conversationId, server, accountId, generation }), [conversationId, server, accountId, generation]);
  const active = useRef(null);
  const taskRef = useRef(null);
  const callbacks = useRef(null);
  const [state, setState] = useState(null);
  useLayoutEffect(() => { callbacks.current = { onReady, onError, enabled, canStart }; });
  useLayoutEffect(() => {
    active.current = view;
    return () => {
      active.current = null;
      dispose(taskRef.current);
      taskRef.current = null;
    };
  }, [view]);

  const cancel = () => {
    const task = taskRef.current;
    // A recording already released for sending is no longer a capture gesture.
    if (!task || task.view !== view || task.phase === 'sending') return;
    taskRef.current = null;
    dispose(task);
    if (active.current === view) setState({ view, phase: 'idle' });
  };
  useLayoutEffect(() => {
    const interrupt = () => {
      const task = taskRef.current;
      if (!task || task.view !== view || task.phase === 'sending') return;
      taskRef.current = null;
      dispose(task);
      if (active.current === view) setState({ view, phase: 'idle' });
    };
    const hidden = () => { if (document.visibilityState === 'hidden') interrupt(); };
    const escape = event => { if (event.key === 'Escape') interrupt(); };
    if (!enabled) interrupt();
    window.addEventListener('blur', interrupt);
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('pagehide', interrupt);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [view, enabled]);

  const start = async () => {
    const session = captureSession();
    if (!callbacks.current?.enabled || active.current !== view || taskRef.current || !isSessionCurrent(session) ||
        session.accountId !== owner?.accountId || session.server !== owner?.server || session.generation !== owner?.generation) return;
    if (callbacks.current.canStart?.() === false) return;
    const task = { view, phase: 'requesting', controller: new AbortController(), ...callbacks.current };
    taskRef.current = task;
    const current = () => !task.cancelled && taskRef.current === task && active.current === view && isSessionCurrent(session);
    const update = phase => { task.phase = phase; if (active.current === view) setState({ view, phase }); };
    const fail = key => { if (current()) task.onError(key); };
    const finishTask = () => {
      if (taskRef.current !== task) return;
      taskRef.current = null;
      dispose(task);
      if (active.current === view) setState({ view, phase: 'idle' });
    };
    update('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      task.stream = stream;
      if (!current()) { stopTracks(stream); finishTask(); return; }
      const recorder = createVoiceRecorder(stream);
      task.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = event => { if (current() && event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => { fail('chat.voiceCaptureFailed'); finishTask(); };
      recorder.onstop = async () => {
        stopTracks(stream);
        if (!current() || !task.released) { finishTask(); return; }
        try {
          const recording = recordedVoice(chunks, recorder);
          if (task.duration < 1000 || recording.blob.size < 1000) { fail('chat.voiceTooShort'); return; }
          update('sending');
          await task.onReady(recording, { signal: task.controller.signal, session, isCurrent: current });
        } catch { fail('chat.voiceSendFailed'); }
        finally { finishTask(); }
      };
      recorder.start();
      task.startedAt = Date.now();
      update('recording');
    } catch {
      fail(task.stream ? 'chat.voiceCaptureFailed' : 'chat.micAccessDenied');
      finishTask();
    }
  };
  const finish = () => {
    const task = taskRef.current;
    if (!task || task.view !== view) return;
    if (task.phase === 'requesting') { cancel(); return; }
    if (task.phase !== 'recording') return;
    task.released = true;
    task.duration = Date.now() - task.startedAt;
    task.phase = 'finishing';
    setState({ view, phase: 'finishing' });
    try { task.recorder.stop(); }
    catch { task.onError('chat.voiceCaptureFailed'); cancel(); }
  };
  return { phase: state?.view === view ? state.phase : 'idle', start, finish, cancel };
}
