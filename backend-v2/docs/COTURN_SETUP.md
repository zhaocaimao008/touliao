# 自建 coturn（TURN 中继）部署

通话默认只有 STUN，4G / 对称 NAT / 企业网下 P2P 直连大概率失败，必须有 TURN 中继兜底。
本后端用 coturn 的 **REST API 时效凭证**（`use-auth-secret` 模式）下发，客户端通过
`GET /api/turn/credentials` 动态拉取，**不在客户端硬编码账号**。

## 1. 安装

```bash
apt-get update && apt-get install -y coturn
```

## 2. 生成共享密钥

```bash
openssl rand -hex 32     # 输出作为 static-auth-secret，同时填进后端 .env 的 TURN_SECRET
```

## 3. /etc/turnserver.conf（最小可用）

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<上一步生成的密钥>
realm=turn.你的域名.com
# 公网 IP（云主机填弹性公网 IP；NAT 后机器两者都填）
external-ip=<公网IP>
# TLS 证书（turns:// 需要，可复用域名证书）
cert=/etc/letsencrypt/live/turn.你的域名.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.你的域名.com/privkey.pem
# 中继端口范围（防火墙/安全组需放行 UDP）
min-port=49152
max-port=65535
no-cli
no-multicast-peers
# 收敛攻击面：禁止中继到内网/环回
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
```

启用并启动：

```bash
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable --now coturn
```

## 4. 防火墙 / 安全组放行

| 端口 | 协议 | 用途 |
|------|------|------|
| 3478 | TCP/UDP | STUN/TURN |
| 5349 | TCP/UDP | TURN over TLS (turns) |
| 49152–65535 | UDP | 中继媒体端口 |

## 5. 后端 .env

```env
TURN_SECRET=<与 static-auth-secret 完全一致>
TURN_URLS=turn:turn.你的域名.com:3478,turns:turn.你的域名.com:5349
TURN_TTL=3600
# 可选：替换公共 STUN
# STUN_URLS=stun:turn.你的域名.com:3478
```

改完 `pm2 restart vxin-server-v2`。`TURN_SECRET` 留空时后端只下发 STUN（退化为旧行为）。

## 6. 凭证机制（实现说明）

`GET /api/turn/credentials`（需登录）返回可直接喂给 `RTCPeerConnection` 的 `iceServers`：

```jsonc
{
  "iceServers": [
    { "urls": ["stun:stun.l.google.com:19302", "..."] },
    { "urls": ["turn:...:3478", "turns:...:5349"],
      "username": "1735689600:用户ID",          // <到期unix秒>:<userId>
      "credential": "base64(HMAC-SHA1(secret, username))" }
  ],
  "ttl": 3600
}
```

coturn 用同一 `static-auth-secret` 重算 HMAC 校验，凭证到期自动失效——
泄漏一份凭证最多只在 `TTL` 窗口内可用，无需在服务端存账号。

## 7. 验证

```bash
# 拉一份凭证
curl -s https://chat.91aigu.com/api/turn/credentials -H "Cookie: vxin_token=<你的token>"
```

把返回的 `iceServers` 贴到 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
选 `relay` 候选能出 `relay` 类型即 TURN 通了。
