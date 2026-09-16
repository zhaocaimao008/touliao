import { expect, test } from 'vitest';
import { createVoiceRecorder, recordedVoice } from './voiceRecording';
test('requests MP4 on a recorder that cannot record WebM', () => {
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; }
  }
  const stream = {};
  const recorder = createVoiceRecorder(stream, Recorder);
  expect(recorder.mimeType).toBe('audio/mp4');
  expect(recorder.stream).toBe(stream);
  const result = recordedVoice([new Blob(['mp4 audio'], { type: 'audio/mp4' })], recorder);
  expect(result.filename).toBe('voice.m4a');
  expect(result.blob.type).toBe('audio/mp4');
});
test('actual chunk MIME wins over the requested recorder format', () => {
  const result = recordedVoice([new Blob(['opus'], { type: 'audio/ogg;codecs=opus' })], { mimeType: 'audio/webm' });
  expect(result.filename).toBe('voice.ogg');
  expect(result.blob.type).toBe('audio/ogg;codecs=opus');
});
test('uses recorder MIME for untyped chunks and rejects unknown formats', () => {
  const result = recordedVoice([new Blob(['audio'])], { mimeType: 'audio/webm;codecs=opus' });
  expect(result.filename).toBe('voice.webm');
  expect(() => recordedVoice([new Blob(['audio'])], { mimeType: '' })).toThrow();
});
