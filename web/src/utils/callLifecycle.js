function stopStream(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

function currentCallMedia(pc, isCurrent) {
  return pc && isCurrent(pc) ? pc : null;
}

function scheduleCurrentCallTimeout({ pc, isCurrent, setTimer, delay, onTimeout }) {
  if (!currentCallMedia(pc, isCurrent)) return null;
  return setTimer(() => {
    if (currentCallMedia(pc, isCurrent)) onTimeout();
  }, delay);
}

function trackKinds(stream) {
  const kinds = new Set();
  stream?.getTracks().forEach(track => kinds.add(track.kind));
  return kinds;
}

/**
 * 取本地媒体（1v1 与群通话共用）：
 *  · 先按原约束取；
 *  · 视频通话取失败（摄像头被占用/拒绝/不存在）→ 回退只取音频，error='camera'，按纯语音继续；
 *  · 仍失败 → stream=null，error='microphone'。
 * 取到的流里没有音轨（极少见）同样算 'microphone'，但流照常返回（视频仍可发）。
 * @returns {Promise<{ stream: MediaStream|null, error: false|'camera'|'microphone' }>}
 */
export async function acquireCallMedia({ constraints, getUserMedia, isCurrent = () => true }) {
  try {
    const stream = await getUserMedia(constraints);
    return { stream, error: trackKinds(stream).has('audio') ? false : 'microphone' };
  } catch (firstError) {
    if (!constraints.video || !isCurrent()) {
      if (!constraints.video) console.warn('[call] 获取麦克风失败:', firstError);
      return { stream: null, error: 'microphone' };
    }
    try {
      const stream = await getUserMedia({ ...constraints, video: false });
      return { stream, error: trackKinds(stream).has('audio') ? 'camera' : 'microphone' };
    } catch {
      return { stream: null, error: 'microphone' };
    }
  }
}

/**
 * 本端缺音轨/视频轨时补 recvonly transceiver：否则主叫 offer 里根本没有对应 m-line，
 * 对方的声音/画面无处可收（主叫拿不到麦克风时整通电话都听不到对方）。
 */
export function addMissingRecvTransceivers(pc, stream, wantVideo) {
  const kinds = trackKinds(stream);
  if (!pc.addTransceiver) return;
  if (!kinds.has('audio')) pc.addTransceiver('audio', { direction: 'recvonly' });
  if (wantVideo && !kinds.has('video')) pc.addTransceiver('video', { direction: 'recvonly' });
}

export async function initializeCallMedia({
  constraints,
  getUserMedia,
  createEmptyStream,
  fetchIceConfig,
  createPeerConnection,
  preparePeerConnection,
  publishStream,
  publishPeerConnection,
  discardStream,
  discardPeerConnection,
  setMediaError,
  isCurrent,
}) {
  const acquired = await acquireCallMedia({ constraints, getUserMedia, isCurrent });
  const stream = acquired.stream || createEmptyStream();
  const mediaError = acquired.error;
  if (!isCurrent()) {
    stopStream(stream);
    return null;
  }
  setMediaError(mediaError);
  publishStream(stream);

  const iceConfig = await fetchIceConfig();
  if (!isCurrent()) {
    stopStream(stream);
    discardStream(stream);
    return null;
  }
  const pc = createPeerConnection(iceConfig);
  publishPeerConnection(pc);
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  addMissingRecvTransceivers(pc, stream, !!constraints.video);
  await preparePeerConnection(pc);
  if (!isCurrent()) {
    pc.close();
    discardPeerConnection(pc);
    stopStream(stream);
    discardStream(stream);
    return null;
  }
  return pc;
}

export { currentCallMedia, scheduleCurrentCallTimeout, stopStream };
