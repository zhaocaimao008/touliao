'use strict';
const path = require('path');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const { verifyChatFile } = require('../src/utils/upload');
const fixture = path.join(__dirname, 'fixtures/voice-opus.webm');

// Real Chromium MediaRecorder output using its synthetic audio device.
test('browser WebM audio stays a voice message through local upload', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await befriend(a, b);
  const convId = await privateConversation(a, b);
  const response = await request(app).post(`/api/messages/${convId}/upload`)
    .set('Authorization', `Bearer ${a.token}`)
    .attach('file', fixture, { filename: 'voice.webm', contentType: 'audio/webm;codecs=opus' });
  expect(response.status).toBe(200);
  expect(response.body.type).toBe('voice');
});

test('container classification still uses actual bytes for incompatible claims', async () => {
  expect((await verifyChatFile(fixture, 'video.webm', 'video/webm')).mime).toBe('video/webm');
  expect((await verifyChatFile(fixture, 'voice.m4a', 'audio/mp4')).mime).toBe('video/webm');
});
