import Foundation
import Combine
import SocketIO

enum SocketStatus {
    case disconnected, connecting, connected
}

struct TypingEvent {
    let userId: String
    let conversationId: String
    let isTyping: Bool
}

struct ReadEvent {
    let userId: String
    let conversationId: String
    let readAt: Double
    let lastReadMessageId: String?
}

/// Socket.IO 实时通道（封装 Socket.IO-Client-Swift）。职责等同 Android 的 SocketManager。
///
/// - 鉴权：connect(withPayload:) 把 {token} 作为 CONNECT auth 负载发送，
///   服务端从 handshake.auth.token 读取（对齐 Android opts.auth）
/// - 心跳：由 engine.io 内置 ping/pong 维持 + 库自动重连，无需自造
/// - 接收：监听 new_message / new_message_batch → 统一转 Message 发到 incoming
/// - 发送：emitWithAck("send_message", ...)（消息收发阶段使用）
///
/// 生命周期由 SessionStore 管理：登录/恢复会话后 connect()，登出/401 时 disconnect()。
final class SocketService {
    static let shared = SocketService()
    private init() {}

    /// 注意：SocketIO 库自带 SocketManager 类型，这里用全限定名避免与本类混淆
    private var manager: SocketIO.SocketManager?
    private var socket: SocketIOClient?

    let status = CurrentValueSubject<SocketStatus, Never>(.disconnected)
    let incoming = PassthroughSubject<Message, Never>()
    let typing = PassthroughSubject<TypingEvent, Never>()
    let read = PassthroughSubject<ReadEvent, Never>()
    /// 本人某会话已读（多端同步 + 本端 markRead 回声）→ conversationId
    let unreadCleared = PassthroughSubject<String, Never>()
    /// 新会话（如被拉入群聊）→ 提示列表刷新
    let newConversation = PassthroughSubject<Void, Never>()
    /// 消息撤回/删除 → msgId
    let messageDeleted = PassthroughSubject<String, Never>()
    /// 表情回应更新 → (msgId, reactions)
    let reaction = PassthroughSubject<(String, [MessageReaction]), Never>()
    /// 红包被领取 → (packetId, userId, amount)
    let redPacketClaimed = PassthroughSubject<(String, String, Int), Never>()
    /// 群置顶消息变化（置顶/取消）→ convId
    let pinChanged = PassthroughSubject<String, Never>()
    /// 被踢/群解散 → convId（本端已出局）
    let groupGone = PassthroughSubject<String, Never>()
    /// 群资料/设置/角色/成员变更 → convId
    let groupChanged = PassthroughSubject<String, Never>()
    /// 消息被编辑 → (msgId, content, conversationId)
    let messageEdited = PassthroughSubject<(String, String, String), Never>()

    // ── WebRTC 通话信令 ──
    let callIncoming = PassthroughSubject<(from: String, type: String, callerName: String), Never>()
    let callResponse = PassthroughSubject<(from: String, accepted: Bool), Never>()
    let callOffer = PassthroughSubject<(from: String, sdp: String), Never>()
    let callAnswer = PassthroughSubject<(from: String, sdp: String), Never>()
    let callIce = PassthroughSubject<(from: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int32), Never>()
    let callEnd = PassthroughSubject<String, Never>()

    private let decoder = JSONDecoder()

    func connect() {
        guard let token = KeychainStore.shared.token else { return }
        if socket?.status == .connected { return }
        disconnect()

        guard let url = URL(string: ServerConfig.shared.baseURL) else { return }
        let mgr = SocketIO.SocketManager(socketURL: url, config: [
            .log(false),
            .forceWebsockets(true),     // 仅 websocket，匹配服务端
            .reconnects(true),
            .reconnectWait(1),
            .reconnectWaitMax(10),
            .compress,
        ])
        let sock = mgr.defaultSocket

        sock.on(clientEvent: .connect) { [weak self] _, _ in
            self?.status.send(.connected)
        }
        sock.on(clientEvent: .disconnect) { [weak self] _, _ in
            self?.status.send(.disconnected)
        }
        sock.on(clientEvent: .error) { _, _ in /* 交给库自动重连 */ }

        sock.on("new_message") { [weak self] data, _ in
            self?.handleMessage(data.first)
        }
        sock.on("new_message_batch") { [weak self] data, _ in
            if let arr = data.first as? [[String: Any]] {
                arr.forEach { self?.handleMessage($0) }
            }
        }
        sock.on("typing") { [weak self] data, _ in self?.handleTyping(data.first, isTyping: true) }
        sock.on("stop_typing") { [weak self] data, _ in self?.handleTyping(data.first, isTyping: false) }
        sock.on("message_read") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any] else { return }
            self?.read.send(ReadEvent(
                userId: dict["userId"] as? String ?? "",
                conversationId: dict["conversationId"] as? String ?? "",
                readAt: (dict["readAt"] as? NSNumber)?.doubleValue ?? 0,
                lastReadMessageId: dict["lastReadMessageId"] as? String
            ))
        }
        sock.on("sync:unread_cleared") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["conversationId"] as? String, !id.isEmpty {
                self?.unreadCleared.send(id)
            }
        }
        sock.on("new_conversation") { [weak self] _, _ in self?.newConversation.send(()) }
        sock.on("message_deleted") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["msgId"] as? String, !id.isEmpty {
                self?.messageDeleted.send(id)
            }
        }
        sock.on("message_reaction") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any], let msgId = dict["msgId"] as? String else { return }
            let arr = (dict["reactions"] as? [[String: Any]]) ?? []
            let reactions = arr.map { MessageReaction(emoji: $0["emoji"] as? String ?? "", count: ($0["count"] as? NSNumber)?.intValue ?? 0) }
            self?.reaction.send((msgId, reactions))
        }
        sock.on("message_edited") { [weak self] data, _ in
            guard let d = data.first as? [String: Any], let msgId = d["msgId"] as? String, !msgId.isEmpty else { return }
            self?.messageEdited.send((msgId, d["content"] as? String ?? "", d["conversationId"] as? String ?? ""))
        }
        sock.on("message_pinned") { [weak self] data, _ in
            if let convId = (data.first as? [String: Any])?["convId"] as? String, !convId.isEmpty { self?.pinChanged.send(convId) }
        }
        sock.on("message_unpinned") { [weak self] data, _ in
            if let convId = (data.first as? [String: Any])?["convId"] as? String, !convId.isEmpty { self?.pinChanged.send(convId) }
        }
        // ── 群实时事件 ──
        sock.on("group_kicked") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["conversationId"] as? String, !id.isEmpty { self?.groupGone.send(id) }
        }
        sock.on("group_dismissed") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["conversationId"] as? String, !id.isEmpty { self?.groupGone.send(id) }
        }
        sock.on("group_updated") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["id"] as? String, !id.isEmpty { self?.groupChanged.send(id) }
        }
        sock.on("group_settings_updated") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["id"] as? String, !id.isEmpty { self?.groupChanged.send(id) }
        }
        sock.on("role_changed") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["conversationId"] as? String, !id.isEmpty { self?.groupChanged.send(id) }
        }
        sock.on("group_member_added") { [weak self] data, _ in
            if let id = (data.first as? [String: Any])?["conversationId"] as? String, !id.isEmpty { self?.groupChanged.send(id) }
        }
        sock.on("red_packet_claimed") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any], let packetId = dict["packetId"] as? String, !packetId.isEmpty else { return }
            let userId = dict["userId"] as? String ?? ""
            let amount = (dict["amount"] as? NSNumber)?.intValue ?? 0
            self?.redPacketClaimed.send((packetId, userId, amount))
        }
        // ── 通话信令接收 ──
        sock.on("call:incoming") { [weak self] data, _ in
            guard let d = data.first as? [String: Any], let from = d["from"] as? String, !from.isEmpty else { return }
            let type = d["type"] as? String ?? "audio"
            let name = (d["caller"] as? [String: Any])?["name"] as? String ?? ""
            self?.callIncoming.send((from, type, name))
        }
        sock.on("call:response") { [weak self] data, _ in
            guard let d = data.first as? [String: Any], let from = d["from"] as? String, !from.isEmpty else { return }
            self?.callResponse.send((from, (d["accepted"] as? Bool) ?? false))
        }
        sock.on("call:offer") { [weak self] data, _ in
            guard let d = data.first as? [String: Any], let from = d["from"] as? String,
                  let sdp = (d["offer"] as? [String: Any])?["sdp"] as? String, !sdp.isEmpty else { return }
            self?.callOffer.send((from, sdp))
        }
        sock.on("call:answer") { [weak self] data, _ in
            guard let d = data.first as? [String: Any], let from = d["from"] as? String,
                  let sdp = (d["answer"] as? [String: Any])?["sdp"] as? String, !sdp.isEmpty else { return }
            self?.callAnswer.send((from, sdp))
        }
        sock.on("call:ice") { [weak self] data, _ in
            guard let d = data.first as? [String: Any], let from = d["from"] as? String,
                  let cand = d["candidate"] as? [String: Any], let c = cand["candidate"] as? String else { return }
            let sdpMid = cand["sdpMid"] as? String
            let idx = (cand["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
            self?.callIce.send((from, c, sdpMid, idx))
        }
        sock.on("call:end") { [weak self] data, _ in
            guard let d = data.first as? [String: Any], let from = d["from"] as? String, !from.isEmpty else { return }
            self?.callEnd.send(from)
        }

        manager = mgr
        socket = sock
        status.send(.connecting)
        sock.connect(withPayload: ["token": token])
    }

    /// 通过 socket 发送文本消息；ack 返回服务端落库后的 Message（消息收发阶段调用）
    func sendMessage(conversationId: String, content: String, replyToId: String? = nil) async -> Result<Message, Error> {
        guard let sock = socket, sock.status == .connected else {
            return .failure(SocketError.notConnected)
        }
        var payload: [String: Any] = ["conversationId": conversationId, "content": content]
        if let replyToId { payload["reply_to_id"] = replyToId }
        return await withCheckedContinuation { continuation in
            sock.emitWithAck("send_message", payload)
                .timingOut(after: 15) { [weak self] ackData in
                    guard let self else { return }
                    guard let dict = ackData.first as? [String: Any] else {
                        continuation.resume(returning: .failure(SocketError.noResponse)); return
                    }
                    if let ok = dict["success"] as? Bool, ok,
                       let msgDict = dict["message"], let msg = self.decode(msgDict) {
                        continuation.resume(returning: .success(msg))
                    } else {
                        let err = (dict["error"] as? String) ?? "发送失败"
                        continuation.resume(returning: .failure(SocketError.server(err)))
                    }
                }
        }
    }

    /// 进入会话主动入房（连上后服务端已自动入房，这里兜底防时序）
    func joinConversation(_ conversationId: String) {
        socket?.emit("join_conversation", ["conversationId": conversationId])
    }

    func emitTyping(_ conversationId: String) {
        socket?.emit("typing", ["conversationId": conversationId])
    }

    func emitStopTyping(_ conversationId: String) {
        socket?.emit("stop_typing", ["conversationId": conversationId])
    }

    // ── 通话信令发送 ──
    func emitCallRequest(to: String, type: String, callerName: String) {
        socket?.emit("call:request", ["to": to, "type": type, "caller": ["name": callerName]])
    }
    func emitCallResponse(to: String, accepted: Bool) {
        socket?.emit("call:response", ["to": to, "accepted": accepted])
    }
    func emitCallOffer(to: String, sdp: String) {
        socket?.emit("call:offer", ["to": to, "offer": ["type": "offer", "sdp": sdp]])
    }
    func emitCallAnswer(to: String, sdp: String) {
        socket?.emit("call:answer", ["to": to, "answer": ["type": "answer", "sdp": sdp]])
    }
    func emitCallIce(to: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {
        var cand: [String: Any] = ["candidate": candidate, "sdpMLineIndex": sdpMLineIndex]
        if let sdpMid { cand["sdpMid"] = sdpMid }
        socket?.emit("call:ice", ["to": to, "candidate": cand])
    }
    func emitCallEnd(to: String) {
        socket?.emit("call:end", ["to": to])
    }

    func disconnect() {
        socket?.removeAllHandlers()
        socket?.disconnect()
        manager?.disconnect()
        socket = nil
        manager = nil
        status.send(.disconnected)
    }

    private func handleMessage(_ any: Any?) {
        decode(any).map { incoming.send($0) }
    }

    private func handleTyping(_ any: Any?, isTyping: Bool) {
        guard let dict = any as? [String: Any] else { return }
        typing.send(TypingEvent(
            userId: dict["userId"] as? String ?? "",
            conversationId: dict["conversationId"] as? String ?? "",
            isTyping: isTyping
        ))
    }

    private func decode(_ any: Any?) -> Message? {
        guard let dict = any as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: dict),
              let msg = try? decoder.decode(Message.self, from: data) else { return nil }
        return msg
    }
}

enum SocketError: LocalizedError {
    case notConnected, noResponse, server(String)
    var errorDescription: String? {
        switch self {
        case .notConnected: return "连接已断开"
        case .noResponse: return "无响应"
        case .server(let m): return m
        }
    }
}
