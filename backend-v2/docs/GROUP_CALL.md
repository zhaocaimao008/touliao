# 群音视频通话（mesh）— 客户端对接协议

后端信令已实现并测试通过（`src/realtime/handlers/groupCall.js`）。本文给三端
（Web / Android / iOS）提供对接规范。拓扑为 **mesh**：N 人两两建立 PeerConnection，
无媒体服务器，上限 **9 人**（再多需上 SFU，另议）。

ICE 配置复用 1:1 通话的 `GET /api/turn/credentials`（已动态化，见 COTURN_SETUP.md）。

## 事件协议

所有事件经 Socket.io。`callId` 由后端在 `group_call:start` 时生成。

| 方向 | 事件 | payload | 说明 |
|------|------|---------|------|
| C→S | `group_call:start` | `{conversationId, type}` | 发起。type=audio\|video。仅群会话 |
| S→发起者 | `group_call:started` | `{callId, conversationId, type}` | 发起成功，自己进入通话 |
| S→群其他成员 | `group_call:invite` | `{callId, conversationId, type, from, fromName, fromAvatar}` | 来电邀请，弹接听 UI |
| C→S | `group_call:join` | `{callId}` | 接听/加入 |
| S→加入者 | `group_call:peers` | `{callId, type, peers:[userId...]}` | 既有成员列表。加入者作为 **answerer**，等这些人的 offer |
| S→既有成员 | `group_call:peer_joined` | `{callId, userId}` | 新成员加入 → 你向其 `createOffer` |
| C→S→C | `group_call:offer` | `{callId, to, offer}` → `{callId, from, offer}` | 既有成员 → 新成员 |
| C→S→C | `group_call:answer` | `{callId, to, answer}` → `{callId, from, answer}` | 新成员 → 既有成员 |
| C→S→C | `group_call:ice` | `{callId, to, candidate}` → `{callId, from, candidate}` | 双向 |
| C→S | `group_call:leave` | `{callId}` | 挂断/离开 |
| S→其余成员 | `group_call:peer_left` | `{callId, userId}` | 某人离开 → 关闭对应 PC、移除画面 |
| S→发起/加入者 | `group_call:error` | `{reason}` | reason=busy\|not_group\|not_found\|full |

断线由后端按 `leave` 自动处理（会广播 `peer_left`）。

## 防 glare 约定（关键）

**新加入者只 answer，不 offer**：
- 加入者收到 `group_call:peers` 后，为列表里每个 peer **预建** `RTCPeerConnection` 并等待 offer。
- 既有成员收到 `group_call:peer_joined` 后，对该新 peer `createOffer` → `group_call:offer`。

这样每条连接只有一方发 offer，杜绝 offer 对撞。既有成员之间的连接在各自加入时已建好，不重连。

## 客户端 mesh 骨架（伪码）

```js
const pcs = new Map();           // peerId -> RTCPeerConnection
const iceCfg = await fetchIceConfig();   // 复用 1:1 的 /api/turn/credentials

function createPC(peerId) {
  const pc = new RTCPeerConnection(iceCfg);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = ({candidate}) => candidate && socket.emit('group_call:ice', {callId, to: peerId, candidate});
  pc.ontrack = e => attachRemoteTile(peerId, e.streams[0]);
  pcs.set(peerId, pc);
  return pc;
}

// 加入者：拿到既有成员，预建 PC 等 offer
socket.on('group_call:peers', ({peers}) => peers.forEach(createPC));

// 既有成员：有人加入 → 主动 offer
socket.on('group_call:peer_joined', async ({userId}) => {
  const pc = createPC(userId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('group_call:offer', {callId, to: userId, offer});
});

socket.on('group_call:offer', async ({from, offer}) => {
  const pc = pcs.get(from) || createPC(from);
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('group_call:answer', {callId, to: from, answer});
});

socket.on('group_call:answer', ({from, answer}) => pcs.get(from)?.setRemoteDescription(answer));
socket.on('group_call:ice',    ({from, candidate}) => pcs.get(from)?.addIceCandidate(candidate));
socket.on('group_call:peer_left', ({userId}) => { pcs.get(userId)?.close(); pcs.delete(userId); removeTile(userId); });
```

UI 需求：N 路视频宫格、各 peer 名牌、本地静音/关摄像头/挂断、来电邀请弹窗（监听 `group_call:invite`）。
Web 可在现有 `CallModal.jsx` 旁新增 `GroupCallModal.jsx`；Android/iOS 在 CallManager 旁加 `GroupCallManager`。
