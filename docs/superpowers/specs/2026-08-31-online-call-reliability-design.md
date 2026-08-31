# 在线通话可靠性修复设计

## 背景

投聊的 1 对 1 与群音视频通话使用 WebRTC 传输媒体、Socket.IO 转发信令，TURN 凭证由后端动态签发。当前实现已经具备基本鉴权、信令转发、通话日志、移动端音频路由和 coturn 自动部署，但存在三类可靠性缺口：同账号任意 Socket 断线都会结束 1 对 1 通话；各端 `callId` 契约不一致且 1 对 1/群通话没有统一忙线状态；TURN 部署成功不等同于真实 relay-only 通话通过。

本设计在不引入 Redis、微服务或 TypeScript 的前提下修复上述问题，继续适配单机约 1000 用户的私有化部署。

## 目标

1. 一台非通话设备断线不得结束同账号另一台设备上的通话。
2. 1 对 1 信令从请求到结束均绑定同一个 `callId`，迟到信令不得影响新通话。
3. 一个用户同一时刻只能占用一通 1 对 1或群通话。
4. Socket 短暂断线提供有限重连宽限；超过宽限后可靠收尾并更新日志。
5. TURN 自动部署必须通过可自动执行的 relay 检查；真实双外网设备验证作为明确的发布验收项留痕。
6. 保持旧客户端在升级窗口内仍能进行基本通话。

## 非目标

- 不引入 Redis、SFU、独立信令服务或多进程共享状态。
- 不恢复 PM2 重启后的进行中媒体会话；本次仅保证重启后数据库悬挂状态可清理、客户端能明确结束。
- 不把群 Mesh 改造成服务器转发媒体。
- 不自动伪造手机 4G 与外部 Wi-Fi 的物理网络验收。
- 不改变现有通话 UI 视觉设计。

## 总体方案

### 统一会话注册表

新增后端内部模块 `callSessionRegistry`，作为 1 对 1和群通话共享的进程内状态边界。注册表维护：

- `sessions: Map<callId, Session>`：通话元数据和参与者；
- `userSessions: Map<userId, callId>`：全局忙线占用；
- 每名参与者的 `socketIds: Set<socketId>`：真正参与或处理该通话的设备连接；
- `disconnectTimers`：最后一条参与 Socket 断开后的宽限计时器。

`Session` 至少包含：

```text
callId
kind                 // private | group
type                 // audio | video
conversationId
participants         // userId -> { socketIds, joinedAt }
startedBy
createdAt
answeredAt
status
```

注册表只负责状态和互斥，不直接发送 Socket 事件或写数据库。1 对 1与群通话 handler 负责业务事件、日志和通知。这样可以在不重写现有 handler 的情况下统一忙线规则。

### Socket 所有权与断线宽限

发起、接听或加入通话的 Socket 会登记为该用户在该通话中的参与 Socket。同账号的其他在线设备可以收到同步事件，但不会自动成为媒体参与 Socket。

断线处理规则：

1. 从参与者的 `socketIds` 移除当前 socket；
2. 若该用户仍有参与 Socket，不做任何通话清理；
3. 若没有参与 Socket，启动 15 秒重连宽限；
4. 宽限期间同一用户携带 `callId` 重连/恢复时，取消计时器并重新绑定 socket；
5. 宽限到期后由 handler 执行离开或结束逻辑。

未参与通话的另一台设备断线不会影响通话。1 对 1双方任一方宽限到期即结束整通电话；群通话只移除该成员。

### 全局忙线规则

创建或加入通话前统一调用注册表：

- 发起者或目标用户已占用其他通话时，拒绝并返回 `busy`；
- 同一 `callId` 的重复操作按幂等处理；
- 1 对 1与群通话共享同一 `userSessions`，禁止交叉占用；
- 仅收到邀请、尚未接听的被叫也临时占用该通话，防止多个来电同时覆盖 UI；拒绝、超时或取消后立即释放。

为兼容多设备，被叫任一设备接听后，其余设备收到 `answered_elsewhere`；拒绝的语义维持当前行为，即任一设备明确拒绝就结束本次来电。

## `callId` 信令契约

### 1 对 1事件

所有新客户端事件都携带非空 `callId`：

| 事件 | 方向 | callId 来源 |
|---|---|---|
| `call:request` | client → server | 客户端不提供；服务端创建，通过 ack 返回 |
| `call:incoming` | server → client | 服务端创建值 |
| `call:outgoing` | server → 同账号其他设备 | 服务端创建值 |
| `call:response` | 双向 | request/incoming 获得的值 |
| `call:offer` | 双向 | 当前通话值 |
| `call:answer` | 双向 | 当前通话值 |
| `call:ice` | 双向 | 当前通话值 |
| `call:end` | 双向 | 当前通话值 |

后端必须同时校验：

- `callId` 对应活跃 session；
- 当前用户和目标用户都是该 session 参与者；
- 信令方向符合参与关系；
- `callId` 与当前用户占用的通话一致。

后端转发时始终原样携带 `callId`。客户端先按 `callId` 过滤，再处理 SDP、ICE、应答或结束事件。

### 兼容窗口

增加配置 `CALL_REQUIRE_ID`，默认 `false`：

- `false`：旧客户端不带 `callId` 时，仅在两个用户之间恰好存在唯一活跃 1 对 1通话时由服务端补全；存在歧义则拒绝。
- `true`：除 `call:request` 外，所有 1 对 1信令缺少 `callId` 均返回 `call:error { code: 'CALL_ID_REQUIRED' }`。

Web、Android、iOS 更新完成并达到最低受支持版本后，生产环境再启用强制模式。兼容逻辑集中在后端解析函数中，不分散到各事件 handler。

### 客户端调整

- Web：`activeCall` 保存 callId；发起时等待 request ack 后再进入稳定呼叫态；incoming、response、SDP、ICE、end 均校验 callId。
- Android：保留现有 request ack 和 end 校验，给 response、SDP、ICE 数据模型及 emit 补齐 callId。
- iOS：`emitCallRequest` 改为接收 ack 并写入主叫 state；所有 subject、emit 和过滤器携带 callId。
- 所有端监听 `call:outgoing`，将同账号其他设备置为同步占用态或至少禁止再次发起，不在非发起设备上采集媒体。

## TURN 部署门禁

### 自动检查

新增只读检查脚本，完成以下步骤：

1. 检查 `TURN_SECRET`、`TURN_URLS`、中继端口范围等配置存在且格式有效；
2. 请求后端 `/api/turn/credentials` 的能力由独立、不会输出凭证的校验函数覆盖；
3. 使用 coturn 自带工具或项目内最小 WebRTC 探针验证时效凭证能创建 relay allocation；
4. 校验至少产生一个 `relay` candidate；
5. 任一步失败均返回非零退出码，日志不得打印 secret、完整 credential 或 JWT；
6. `bootstrap-server.sh` 在未显式设置 `SKIP_COTURN=1` 时必须执行该检查，失败则部署失败，不打印总体成功。

自动检查证明 TURN 配置、认证和 allocation 可用，但不声称证明两台真实外部网络互通。

### 人工发布验收

提供固定模板记录：

- 设备 A 网络类型与客户端版本；
- 设备 B 网络类型与客户端版本；
- 双方强制 relay-only；
- 双向拨打、接听、静音、切后台、切网、挂断结果；
- selected candidate pair 的双方 candidateType 均为 `relay`；
- 测试时间、部署版本和验收人。

没有完成该记录的私有化实例，发布状态标记为“通话未验收”，不得写成“在线语音已通过”。

## 进程重启与日志收尾

注册表仍是进程内状态，因此 PM2 重启不会恢复媒体会话。为避免数据库永久留下 `ongoing`：

- 后端启动时将未结束的 1 对 1 `ongoing` 日志更新为 `interrupted` 并记录结束时间；通话历史 UI 将该状态显示为“服务重启，通话中断”；
- 将未结束的群通话日志标记为 `ended`；
- 客户端 Socket 重连后如果本地仍处于通话态，发送 `call:resume { callId }`；服务端不存在该 callId 时返回 `call:end { reason: 'server_restarted' }`，客户端立即释放媒体。

本次不尝试重建 PeerConnection，因为 SDP/ICE、设备 socket 所有权和对端状态在单进程重启后无法可靠恢复。

## 安全约束

- `callId` 必须通过现有 ID 长度/类型守卫，不能用于数据库或房间名拼接。
- 任何 callId 查询后仍需验证当前认证用户属于该 session，不能把 UUID 当作授权凭据。
- TURN 检查脚本不得通过命令行参数传递 secret，避免出现在进程列表；从受限环境文件读取。
- 日志只显示 TURN URL 主机、协议和检查阶段，不显示 username、credential 或 secret。
- 继续保留私聊关系、拉黑检查、群成员检查和 coturn `denied-peer-ip` 配置。

## 错误处理

统一新增或复用以下机器可读错误：

- `CALL_BUSY`
- `CALL_NOT_FOUND`
- `CALL_ID_REQUIRED`
- `CALL_ID_MISMATCH`
- `CALL_NOT_PARTICIPANT`
- `CALL_RECONNECT_EXPIRED`

旧客户端仍可接收现有的 `accepted:false` 和 `reason` 字段；新客户端优先按 code 映射 UI 文案。

## 测试策略

### 后端单元与 Socket 集成测试

- 同账号两个 socket，非参与 socket 断线不结束通话；
- 参与 socket 断线但同一通话还有另一参与 socket时不结束；
- 最后参与 socket 断线进入宽限，重连取消计时；
- 宽限到期后结束 1 对 1或移除群成员；
- 用户处于 1 对 1时不能发起/加入群通话，反向亦然；
- 同一对用户快速重拨时，旧 callId 的 response/SDP/ICE/end 全部被拒绝；
- 兼容模式唯一会话可补全 callId，歧义或强制模式下拒绝；
- PM2 等价的模块重载/启动清理能收尾悬挂日志。

测试使用可注入时钟或短超时，不真实等待 15 秒。

### 客户端测试

- Web：call reducer/状态管理测试覆盖 request ack、incoming、旧事件过滤和 outgoing 同步；
- Android：Socket 事件 DTO 与 CallManager 测试覆盖所有信令携带 callId；
- iOS：SocketService 解析/发送与 CallManager 状态测试覆盖主叫 ack 和旧信令过滤；
- 四端契约 fixture 使用同一组 JSON 样例，防字段再次漂移。

### TURN 与部署测试

- 缺失配置、错误 secret、无 relay candidate、探针超时均返回非零；
- 成功输出不包含 secret 或 credential；
- bootstrap 在检查失败时停止，不能继续输出成功；
- 人工 relay-only 验收保留为发布检查表，不伪装成 CI 自动测试。

## 发布顺序

1. 先发布兼容模式后端与注册表。
2. 发布 Web、Android、iOS 的完整 callId 客户端。
3. 观察旧客户端占比和 `CALL_ID_REQUIRED` 预警日志。
4. 私有化部署执行 TURN 自动门禁和双外网人工验收。
5. 最低支持版本全部具备 callId 后，设置 `CALL_REQUIRE_ID=true`。

## 成功标准

- 非通话设备断线不会终止另一设备的通话。
- 旧 callId 的任何迟到信令都不会改变新通话状态。
- 同一用户无法同时占用两通电话，也不能同时占用 1 对 1与群通话。
- 15 秒内 Socket 重连不会结束通话；超时后双方均可靠收尾。
- TURN 自动检查失败会使部署失败，并且输出中没有敏感凭证。
- 每个生产实例都有真实双外网 relay-only 验收记录，或者被明确标记为未验收。
