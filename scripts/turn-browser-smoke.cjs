'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('../desktop-electron/node_modules/playwright');
const { probeTurn } = require('../deploy/lib/turn-allocation-probe');
const credentials = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
(async () => {
  const transports = [];
  for (const url of credentials.urls) {
    try {
      assert.equal((await probeTurn({ ...credentials, urls: [url], timeoutMs: 8000 })).ok, true, url);
      assert.equal((await probeTurn({ ...credentials, credential: 'invalid', urls: [url], timeoutMs: 8000 })).ok, false, `invalid credential: ${url}`);
      transports.push(url);
      console.log(JSON.stringify({ url, allocation: true, invalidCredentialRejected: true }));
    } catch (error) { console.error(JSON.stringify({ url, allocation: false, error: error.message })); }
  }
  assert.equal(transports.length, credentials.urls.length, 'All configured transports must pass external allocation');
  const server = http.createServer((_req, res) => res.end('<!doctype html><title>TURN test</title>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    async function verifyMedia(url) {
      return page.evaluate(async iceServer => {
      const connections = [new RTCPeerConnection({ iceServers: [iceServer], iceTransportPolicy: 'relay' }), new RTCPeerConnection({ iceServers: [iceServer], iceTransportPolicy: 'relay' })];
      const streams = [], queues = [[], []], received = [[], []];
      const wait = async check => {
        const deadline = Date.now() + 30000;
        while (!check()) {
          if (Date.now() > deadline) throw new Error(`Relay timed out: ${connections.map(pc => pc.connectionState).join(',')}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      };
      try {
        for (let i = 0; i < 2; i++) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 320, height: 240 } });
          streams.push(stream);
          for (const track of stream.getTracks()) connections[i].addTrack(track, stream);
          connections[i].onicecandidate = event => {
            if (!event.candidate) return;
            const other = connections[1 - i];
            if (other.remoteDescription) other.addIceCandidate(event.candidate).catch(() => {});
            else queues[1 - i].push(event.candidate);
          };
        }
        const outgoing = connections[0].createDataChannel('probe');
        outgoing.onmessage = event => received[0].push(event.data);
        connections[1].ondatachannel = event => { event.channel.onmessage = message => { received[1].push(message.data); event.channel.send('reply'); }; };
        await connections[0].setLocalDescription(await connections[0].createOffer());
        await connections[1].setRemoteDescription(connections[0].localDescription);
        for (const candidate of queues[1]) await connections[1].addIceCandidate(candidate);
        await connections[1].setLocalDescription(await connections[1].createAnswer());
        await connections[0].setRemoteDescription(connections[1].localDescription);
        for (const candidate of queues[0]) await connections[0].addIceCandidate(candidate);
        await wait(() => outgoing.readyState === 'open');
        outgoing.send('request');
        await wait(() => received[0].includes('reply') && received[1].includes('request'));
        await new Promise(resolve => setTimeout(resolve, 3000));
        const reports = [];
        for (const connection of connections) {
          const stats = await connection.getStats();
          const transport = [...stats.values()].find(row => row.type === 'transport' && row.selectedCandidatePairId);
          const pair = stats.get(transport.selectedCandidatePairId);
          const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
          const media = [...stats.values()].filter(row => row.type === 'inbound-rtp').map(row => ({ kind: row.kind, packetsReceived: row.packetsReceived, framesDecoded: row.framesDecoded }));
          reports.push({ localCandidate: local.candidateType, remoteCandidate: remote.candidateType, media });
        }
        return { reports, received };
      } finally {
        for (const stream of streams) stream.getTracks().forEach(track => track.stop());
        connections.forEach(connection => connection.close());
      }
      }, { ...credentials, urls: [url] });
    }
    for (const url of transports) {
      const result = await verifyMedia(url);
      for (const report of result.reports) {
        assert.equal(report.localCandidate, 'relay'); assert.equal(report.remoteCandidate, 'relay');
        assert.ok(report.media.some(row => row.kind === 'audio' && row.packetsReceived > 0));
        assert.ok(report.media.some(row => row.kind === 'video' && row.framesDecoded > 0));
      }
      console.log(JSON.stringify({ url, bidirectionalRelay: true, ...result }));
    }
    console.log(JSON.stringify({ authenticatedTransports: transports.length, invalidCredentialsRejected: transports.length, bidirectionalMediaTransports: transports.length }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
