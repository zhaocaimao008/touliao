# 投聊 coturn/TURN 事故记录与根因分析

日期：2026-08-29
影响范围：`/etc/turnserver.conf` 管理的这台 coturn（realm=vxinchat.com，为 V信/vxin 项目部署，投聊后端 `TURN_URLS` 复用同一实例）。**未修改/未影响 newchat 项目自己独立的 coturn 容器（pid 61565，docker，端口3479/40000-40100）。**
证据文件目录：`docs/incident-evidence-20260829/`

---

## 一、时间线

| 时间(UTC) | 事件 |
|---|---|
| 08-28 11:43 前 | coturn 已长期运行（本轮介入时已 15h+ uptime），TURN 凭证签发逻辑正常 |
| 08-29 ~03:00 | 开始本轮语音通话专项审计，发现生产 `.env` 已配置 `TURN_SECRET`/`TURN_URLS`，但 `ufw`/iptables 从未放行 3478/5349/49152-65535，TURN 中继在公网不可达（P0-1） |
| 03:XX | 用户授权后开放上述防火墙端口（`ufw allow`，纯新增规则） |
| 04:0X | 尝试修复 TLS(5349) 证书权限问题，`systemctl restart coturn` 后首次触发端口冲突：与 newchat 项目自己的 coturn 容器抢占端口 3479 (RFC5780 alt-port 默认值=主端口+1) |
| 04:2X | 反复测试 `listening-ip`/`relay-ip`/config文件里的 `alt-listening-port` 均未能解决冲突（当时未意识到是配置文件读取失败导致这些改动从未生效） |
| 04:40 | 改用 systemd override 以 CLI 参数传递 `--alt-listening-port`，规避了端口冲突（服务变为 active），**但引入了此报告的核心事故**：CLI 覆盖导致 coturn 完全未能读取 `/etc/turnserver.conf`（进程日志：`Default realm:` 为空、`Cannot find config file`），`use-auth-secret`/`static-auth-secret` 未生效 |
| 04:4X | 用伪造用户名密码 (`test:test`) 实测，**认证被绕过，成功建立中继并转发约1000字节双向数据** —— 确认为一段时间内对公网开放的匿名中继 |
| 04:4X | **发现后立即 `systemctl stop coturn`**，用 `ss`/真实连接测试确认端口不再响应；删除有问题的 systemd override |
| 04:4X-05:0X | 服务保持停止，期间反复验证：用完全未改动的原始配置文件重启依然复现端口冲突（证明冲突非CLI覆盖引入，是环境本身已存在的潜伏问题） |
| 05:0X | 找到真正根因：`/etc/turnserver.conf` 权限为 `640 root:root`，`turnserver` 系统用户不在 `root` 组，进程**根本读不了自己的配置文件**——这是 CLI-覆盖方式"读不到配置"的真实原因，不是 coturn 版本 bug；这也解释了此前 config-file 方式改 `alt-listening-port` 为何"改了没用"——因为那些改动的文件从始至终未被进程读取过 |
| 05:0X | 修复：`chown root:turnserver /etc/turnserver.conf && chmod 640`（最小权限，非644全局可读，非777），`systemctl restart` → 配置正确加载(`Default realm: vxinchat.com`)，**端口冲突同时消失**（因为正确加载配置后 coturn 的地址发现/alt-port逻辑行为正常，此前的"冲突"本身也是"读不到配置→退化成不可预期的默认多网卡枚举行为"的下游症状），认证正确拒绝伪造凭证 |
| 05:0X | 追加修复：`listening-ip` 由 `0.0.0.0` 收窄为显式 `45.77.131.33`，避免自动发现本机全部 10 个地址(含8个docker网桥网关)作为监听/中继地址 |
| 05:1X | 外网3节点验证 3478/5349 均可达；`turnutils_uclient` 用生产签发的真实凭证验证：认证通过、成功分配中继、真实双向数据转发（约1000字节，0丢包） |
| 05:2X | **仍未解决的开放问题**：用真实 Web 浏览器(Chromium)+真实 App 代码路径、强制 `iceTransportPolicy=relay`，模拟 A/B 双方都必须走中继互相呼叫时，反复测试均未能建立连接（详见"六、未解决问题"），抓包显示 coturn 对部分 STUN 请求的回包目的地址错误指向本机其他 docker 项目的网桥网关IP，而非请求的真实来源地址 |

---

## 二、根因分析

### 根因1（已修复）：TURN 中继端口从未在防火墙放行
`ufw`/iptables 从未包含 3478/5349/49152-65535 的 ACCEPT 规则。TURN 凭证签发逻辑本身一直是对的，但公网任何客户端物理上连不到中继端口。**已修复**（新增3条ufw规则，纯增量，未改动/删除任何现有规则）。

### 根因2（已修复）：`/etc/turnserver.conf` 权限错误，`turnserver` 服务账号读不了自己的配置文件
文件权限 `640 root:root`，而 systemd unit 里 `User=turnserver Group=turnserver`——该账号不在 `root` 组，无权读取。实测 `sudo -u turnserver cat /etc/turnserver.conf` 直接失败。

**这一个根因解释了本轮遇到的几乎所有诡异现象**：
- `realm`/`static-auth-secret`/`denied-peer-ip`/`cert`/`pkey` 等配置全部未生效，进程实际跑在 coturn 内置默认值上
- TLS(5349) 报"找不到证书"——因为它压根没读到我配置的证书路径，退化成默认文件名 `turn_server_cert.pem`（当然也找不到）
- "改 `alt-listening-port` 没用"——因为改的是一个进程读不到的文件
- **认证绕过/匿名中继**——`static-auth-secret` 未生效，退化为无认证默认行为

无法 100% 取证复原这个权限从何时开始错误（可能是很早之前一次密钥轮换脚本的遗留问题，也可能是本轮会话中某次 `cp`/`sed -i` 操作意外重置了权限位）。诚实说明：**这不能排除是本次审计过程中我自己的操作引入的**，但也有证据（更早的 `.pre-rotation-20260828` 备份同样是这个权限模式）指向这可能是更早就存在的问题。

**已修复**：`chown root:turnserver` + `chmod 640`（root可读写、turnserver组只读，不是 `644` 全局可读，密钥内容不暴露给本机其他账号；也不是 `777`）。

### 根因3（已修复）：与 newchat 项目 coturn 容器的端口冲突
本质是根因2的下游症状——配置文件读不到时，coturn 的地址自动发现逻辑对本机全部10个网络接口(含8个其他项目的docker网桥网关)都尝试监听 alt-port(主端口+1=3479)，与 newchat 自己 coturn 容器占用的 3479 端口冲突。**修复根因2后自然消失**，未再复现。额外把 `listening-ip` 从 `0.0.0.0` 收窄为显式 `45.77.131.33`，进一步避免自动发现行为影响到其他项目的网络接口。

**两个项目的 coturn 相互独立、各自绑定各自的端口，未共享、未合并、未互相依赖。**

### 根因4（未解决）：真实浏览器强制relay-only时，同宿主机内两个WebRTC客户端互相连接失败
详见下方"六、未解决问题"。

---

## 三、匿名中继安全事件详情

- **触发方式**：04:40左右为规避端口冲突，用 systemd override 以纯 CLI 参数方式启动 coturn（`--alt-listening-port=13478` 等），未意识到这种方式导致 `-c /etc/turnserver.conf` 实际未被读取（根因即上述"根因2"）
- **暴露内容**：认证退化为默认行为，任意用户名/密码组合均可通过 `check_stun_auth`，成功分配中继资源并转发真实流量
- **验证方式**：用完全虚构的 `test:test` 凭证实测，`turnutils_uclient` 显示成功中继约1000字节双向数据、0丢包
- **暴露时长**：约十几分钟（04:40 服务变为 active，到发现问题后立即 `systemctl stop` 之间）
- **已观测到的流量**：仅本次审计自己的测试流量。无法排除这段时间内是否有第三方扫描/利用（3478是公开TURN标准端口，理论上任何人都可能扫描到），建议后续：
  - 若追求彻底排查，可查 `/var/log`/coturn 自身日志（本次已确认当时日志因同一根因也未正常写入实际配置里指定的路径，可用日志有限）
  - 出于稳妥考虑，**建议轮换 `static-auth-secret`**（同步改 touliao 后端 `.env` 的 `TURN_SECRET`，以及任何引用它的 vxin 侧配置），本报告不代为执行，需要你确认后由你或下一轮审计执行
- **处置**：发现后立即停止服务；删除引发问题的 systemd override；确认端口不再响应任何连接

---

## 四、当前配置快照

见 `docs/incident-evidence-20260829/`：
- `turnserver.conf.pristine-original` —— 本轮介入前的原始配置（含错误的640 root:root权限证据链）
- `turnserver.conf.snapshot` —— 排查中间状态快照
- `turnserver.conf.final-fixed` —— 当前最终修复后的配置
- `systemd-unit-cat.txt` / `systemd-show.txt` —— systemd单元完整信息（当前已无override，纯用回原厂 `/lib/systemd/system/coturn.service`）
- `journalctl-full.log` —— 本轮全程journal日志（37391行）
- `dpkg-version.txt` —— `coturn 4.5.2-3.1~ubuntu22.04.1`（官方apt包，非snap/非容器/非野版本，`/usr/bin/turnserver` 唯一二进制，无重复安装）
- `final-listening-ports.txt` —— 修复后的最终监听状态

当前配置与原始配置的实质差异：
1. `cert=`/`pkey=` 指向 `/etc/coturn/certs/{fullchain,privkey}.pem`（root:turnserver 640的可读副本），而非turnserver读不到的 `/etc/letsencrypt/...`（640 root:root）
2. `listening-ip=45.77.131.33`（原为 `0.0.0.0`，导致自动发现全部10个本机地址）
3. 文件权限 `root:turnserver 640`（原为 `root:root 640`，服务账号无法读取）

`/etc/coturn/certs/` 已配好证书续期自动同步：`/etc/letsencrypt/renewal-hooks/deploy/coturn-cert-sync.sh`，证书续期时自动复制+设权限+重启coturn。

---

## 五、当前验证结果

| 项 | 结果 | 证据 |
|---|---|---|
| coturn服务状态 | ✅ active | `systemctl is-active coturn` |
| 配置文件真实加载 | ✅ 确认 | 日志 `Default realm: vxinchat.com`（此前为空） |
| TLS证书加载 | ✅ 确认 | 日志 `SSL23/TLS1.2/DTLS/DTLS1.2: Certificate file found` |
| 3478 UDP/TCP 外网可达 | ✅ | check-host.net 3个国际节点(瑞士/德国/美国)实测连通 |
| 5349(TLS) 外网可达 | ✅ | check-host.net 2个国际节点(伊朗/瑞典)实测连通 |
| 真实凭证认证 | ✅ 通过 | `turnutils_uclient` 生产签发凭证：成功分配+双向数据转发(~1000字节,0丢包) |
| 伪造凭证认证 | ✅ 正确拒绝 | `turnutils_uclient` 用 `test:test` 及伪造HMAC均报 `Cannot complete Allocation` |
| 与newchat端口冲突 | ✅ 已消失 | 修复后 `ss` 确认两个coturn各自独立绑定，无重叠端口 |
| 匿名中继 | ✅ 已彻底关闭 | 见上方验证 |
| 双客户端强制relay互通 | ❌ 未解决 | 见下节 |

---

## 六、未解决问题：强制 relay-only 时同宿主机双客户端互连失败

用真实Chromium浏览器（含真实touliao Web App代码路径，通过 `addInitScript` 注入 `iceTransportPolicy:'relay'`）模拟 A/B 双方都强制走中继呼叫，反复测试（单页面双PC、双独立browser context、多次调整凭证）均未能建立 `connected` 状态，卡在 `connecting`/`checking` → `disconnected` → `failed`。

**关键抓包证据**：客户端从 `45.77.131.33:X` 发往 `45.77.131.33:3478` 的STUN请求，coturn的回包**源地址正确(45.77.131.33:3478)但目的地址错误**——部分回包被发往本机其他docker项目的网桥网关IP(如 `172.22.0.1`、`172.24.0.1` 等)而非请求方真实来源 `45.77.131.33:X`，即使在 `listening-ip` 已收窄为单一显式IP之后依然复现。

**已排除的可能性**：
- 不是我的测试脚本本身的bug（用两种完全不同的测试方式：单页面双PeerConnection、双独立browser context+手动candidate中转，结果一致）
- 不是认证问题（真实凭证已确认能正常通过认证、正常分配中继）
- 不是防火墙问题（相关端口已确认外网可达）

**推测方向（未证实）**：这台VPS上跑了大量其他项目的docker容器（jarvis-chat/wecom-kf/private-lottery等），网络接口/路由表比一般生产环境复杂得多；"A、B两个测试客户端与coturn全部挤在同一台宿主机上"这种测试拓扑本身可能触发了某种该环境特有的地址选择/回包路由异常，**不代表真实场景下两台不同网络的真实设备互相呼叫时一定会复现同样问题**（真实场景两端来自完全不同的公网IP，不会有本机多网卡回包混淆的可能性）。但这个假设本身未经验证，不能排除是coturn在处理relay-to-relay(双方都在同一中继服务器上分配)场景时的真实缺陷。

**建议**：下一轮找条件做一次真正跨物理网络的验证（如用手机4G + 公司WiFi各登一次，实际互相呼叫一次语音通话），这是唯一能彻底排除"是否是本机测试环境特有问题"的方法。本机环境没有第二台真实外部主机可用，无法在当前会话内进一步验证。

---

## 七、遗留行动项

1. ~~建议轮换 `static-auth-secret`~~ **已完成**（2026-08-29 下一轮跟进）：生成新的64位hex密钥，同步更新 `/etc/turnserver.conf` 的 `static-auth-secret` 与 `backend-v2/.env` 的 `TURN_SECRET`，重启 coturn + `pm2 restart touliao-backend --update-env`；已验证：用新密钥生成的凭证能正常认证+完成真实中继(0丢包)，用旧密钥伪造的凭证正确被拒绝(`Cannot complete Allocation`)。旧密钥备份于 `docs/incident-evidence-20260829/turnserver.conf.pre-secret-rotation-20260829` 和 `backend-v2/.env.bak-pre-turn-rotation-20260829`（均600权限，未入库）。
2. 找真实跨网络设备验证 relay-to-relay 是否在生产场景下同样有问题（仍待办）
3. `/etc/coturn/certs/` 证书自动续期钩子已配好，但本身依赖 `certbot renew` 定时任务是否配置——未在本轮核实 certbot timer 是否启用（超出本次范围，标记为待确认项）
