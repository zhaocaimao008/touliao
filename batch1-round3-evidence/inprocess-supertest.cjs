'use strict';
// Supplemental evidence only: preserve Supertest's request construction and assertions,
// but deliver HTTP bytes directly to the actual Express server without a TCP listener.
// Do not use this adapter for live Socket.IO/nginx tests or claim network validation.
const { IncomingMessage, ServerResponse } = require('http');
const { Duplex } = require('stream');
const Test = require('../backend-v2/node_modules/supertest/lib/test');
Test.prototype.serverAddress = function (app, url) { return `http://fixture.invalid${url}`; };
Test.prototype.end = function (done) {
  const socket = new Duplex({ read() {}, write(chunk, encoding, next) { next(); } });
  socket.remoteAddress = '127.0.0.1';
  const req = new IncomingMessage(socket);
  // The full serialized body is available below; mimic Node's completed HTTP parser.
  req.complete = true;
  req.method = this.method;
  const url = new URL(this.url);
  req.url = url.pathname + url.search;
  req.headers = { host: 'fixture.invalid', ...Object.fromEntries(Object.entries(this.header).map(([k, v]) => [k.toLowerCase(), v])) };
  let bytes;
  if (this._formData) {
    bytes = this._formData.getBuffer();
    Object.assign(req.headers, this._formData.getHeaders());
  } else if (this._data !== undefined) {
    bytes = Buffer.from(typeof this._data === 'string' ? this._data : JSON.stringify(this._data));
    req.headers['content-type'] ||= 'application/json';
  }
  if (bytes) req.headers['content-length'] = String(bytes.length);
  const res = new ServerResponse(req);
  const chunks = [];
  let completed = false;
  const finish = (error, response) => {
    if (completed) return;
    completed = true;
    socket.destroy();
    this.assert(error, response, done);
  };
  res.write = (chunk, encoding, next) => {
    chunks.push(Buffer.from(chunk));
    if (typeof encoding === 'function') encoding();
    else if (next) next();
    return true;
  };
  res.end = chunk => {
    if (chunk) chunks.push(Buffer.from(chunk));
    res.finished = true;
    res.emit('finish');
    const buffer = Buffer.concat(chunks);
    const text = buffer.toString();
    const headers = res.getHeaders();
    let body = buffer;
    if (String(headers['content-type']).includes('json')) {
      try { body = JSON.parse(text); } catch (error) { finish(error); return res; }
    }
    finish(null, { status: res.statusCode, statusCode: res.statusCode, headers, header: headers, text, body });
    return res;
  };
  res.once('error', finish);
  if (bytes) req.push(bytes);
  req.push(null);
  this.app.emit('request', req, res);
  return this;
};
