function stopStream(stream) {
  stream?.getTracks().forEach(track => track.stop());
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
  let stream;
  let mediaError = false;
  try {
    stream = await getUserMedia(constraints);
  } catch {
    stream = createEmptyStream();
    mediaError = true;
    if (!isCurrent()) {
      stopStream(stream);
      return null;
    }
  }
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

export { stopStream };
