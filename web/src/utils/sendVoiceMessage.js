// The release gesture has already authorized this send. Stale work must neither
// fall back to a new upload nor emit on a later account's connection.
export async function sendVoiceMessage({ recording, conversationId, clientMsgId, operation, socket, uploadCloud, uploadLocal, onProgress, t }) {
  const { blob, mimeType, filename } = recording;
  const { signal, session, isCurrent } = operation;
  const current = () => !signal.aborted && isCurrent();
  if (!current()) return null;
  const request = { signal, _sessionContext: session, skipReply: true };
  let publicUrl;
  try { ({ publicUrl } = await uploadCloud(blob, mimeType, filename, onProgress, request)); }
  catch (error) {
    if (!current()) return null;
    if ([400, 401, 403].includes(error.response?.status)) throw error;
    await uploadLocal(new File([blob], filename, { type: mimeType }), onProgress, request);
    return current() ? { route: 'local' } : null;
  }
  if (!current()) return null;
  if (!socket?.connected) throw new Error(t('chat.connectionLostRetry'));
  const message = await new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => done(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => done(new Error(t('chat.voiceDeliveryUnconfirmed'))), 15000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      socket.emit('send_file_message', {
        conversationId, type: 'voice', file_url: publicUrl, content: filename, clientMsgId,
      }, result => {
        if (!current()) { abort(); return; }
        if (result?.success !== true) { done(new Error(result?.error || t('chat.voiceSendFailed'))); return; }
        const value = result.message;
        if (!value?.id || value.conversation_id !== conversationId || value.sender_id !== session.accountId ||
            value.client_msg_id !== clientMsgId || value.type !== 'voice') {
          done(new Error(t('chat.voiceDeliveryUnconfirmed'))); return;
        }
        done(null, value);
      });
    } catch (error) { done(error); }
  });
  return current() ? { route: 'cloud', message } : null;
}
