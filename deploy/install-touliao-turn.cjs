'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [publicIp, localIp] = process.argv.slice(2);
if (process.getuid() !== 0 || net.isIP(publicIp) !== 4 || net.isIP(localIp) !== 4) {
  throw new Error('Usage: sudo node deploy/install-touliao-turn.cjs PUBLIC_IPV4 LOCAL_IPV4');
}
const root = '/etc/touliao-turn';
fs.mkdirSync(root, { recursive: true, mode: 0o750 });
fs.chownSync(root, 0, 65534);
const secretPath = path.join(root, 'secret');
const secret = fs.existsSync(secretPath) ? fs.readFileSync(secretPath, 'utf8').trim() : crypto.randomBytes(32).toString('hex');
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid existing TURN secret');
fs.writeFileSync(secretPath, secret + '\n', { mode: 0o600 });
const variables = { PUBLIC_IP: publicIp, LOCAL_IP: localIp, SECRET: secret };
const template = fs.readFileSync(path.join(__dirname, 'touliao-turn/turnserver.conf.template'), 'utf8');
const config = template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name) => {
  if (!variables[name]) throw new Error(`Missing template variable ${name}`);
  return variables[name];
});
function install(name, contents) {
  const file = path.join(root, name);
  fs.writeFileSync(file, contents, { mode: 0o640 });
  fs.chownSync(file, 0, 65534);
  fs.chmodSync(file, 0o640);
}
install('turnserver.conf', config);
// 云防火墙（Lightsail 等）必须放行的端口以渲染出的配置为准；端口范围变过（41000-41999 → 41000-44999），
// 文档容易滞后，这里直接打印给执行者。
const portOf = (key) => (config.match(new RegExp(`^${key}=(\\d+)`, 'm')) || [])[1];
const relayRange = `${portOf('min-port') || '?'}-${portOf('max-port') || '?'}`;
fs.writeFileSync(path.join(root, 'firewall-ports.txt'), `TCP/UDP 3478, TCP 5349, UDP ${relayRange}\n`, { mode: 0o644 });
console.error(`[touliao-turn] 云防火墙必须放行：TCP/UDP 3478、TCP 5349、UDP ${relayRange}（中继端口，见 ${root}/firewall-ports.txt）`);
for (const name of ['fullchain.pem', 'privkey.pem']) install(name, fs.readFileSync(`/etc/letsencrypt/live/touliao.cc/${name}`));
fs.writeFileSync(path.join(root, 'backend.env'), `TURN_SECRET=${secret}\nTURN_URLS=turn:touliao.cc:3478?transport=udp,turn:touliao.cc:3478?transport=tcp,turns:touliao.cc:5349?transport=tcp\nTURN_TTL=3600\n`, { mode: 0o600 });
execFileSync('docker', ['compose', '-p', 'touliao-turn', '-f', path.join(__dirname, 'touliao-turn/compose.yml'), 'up', '-d'], { stdio: 'inherit' });
console.log('Dedicated TURN configured. Backend credentials are staged, not activated. Verify public relay and invalid credentials before applying backend.env.');
