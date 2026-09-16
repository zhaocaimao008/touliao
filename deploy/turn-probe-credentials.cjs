#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
// Export only a ten-minute probe credential, never the server's signing secret.
const secret = fs.readFileSync('/etc/touliao-turn/secret', 'utf8').trim();
const username = `${Math.floor(Date.now() / 1000) + 600}:release-probe`;
const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
process.stdout.write(JSON.stringify({ username, credential, urls: [
  'turn:touliao.cc:3478?transport=udp', 'turn:touliao.cc:3478?transport=tcp', 'turns:touliao.cc:5349?transport=tcp',
] }));
