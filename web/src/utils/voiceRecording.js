// Request a supported format and preserve the container actually produced.
const FORMATS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
const EXTENSIONS = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };
export function createVoiceRecorder(stream, Recorder = MediaRecorder) {
  const mimeType = FORMATS.find(type => Recorder.isTypeSupported?.(type));
  return mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream);
}
export function recordedVoice(chunks, recorder) {
  const mimeType = chunks.find(chunk => chunk.size && chunk.type)?.type || recorder.mimeType;
  const extension = EXTENSIONS[mimeType?.split(';')[0].trim().toLowerCase()];
  if (!extension) throw new Error('Unsupported voice recording format');
  return { blob: new Blob(chunks, { type: mimeType }), mimeType, filename: `voice.${extension}` };
}
