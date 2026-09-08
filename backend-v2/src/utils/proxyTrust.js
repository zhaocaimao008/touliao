'use strict';
const proxyaddr = require('proxy-addr');
// Trust addresses, never a hop count: direct clients cannot forge forwarding headers.
const trusted = proxyaddr.compile((process.env.TRUSTED_PROXIES || 'loopback').split(',').map(s => s.trim()).filter(Boolean));
function socketIp(socket) {
  const req = socket.request || { headers: socket.handshake.headers || {}, socket: { remoteAddress: socket.handshake.address } };
  return proxyaddr(req, trusted);
}
module.exports = { trusted, socketIp };
