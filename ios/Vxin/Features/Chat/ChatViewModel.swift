import Foundation
import Combine
import UIKit

/// 上传中的占位项（成功后被真实 Message 替换），对齐 Android PendingUpload
struct PendingUpload: Identifiable {
    let id: String = UUID().uuidString
    let type: String                // image | voice | video | file
    let name: String
    let previewImage: UIImage?       // 图片本地预览
    var failed: Bool = false
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var pending: [PendingUpload] = []
    @Published var input = ""
    @Published var sending = false
    @Published var recording = false
    @Published var peerTyping = false
    @Published var peerReadAt: Double = 0      // 对方已读时间（秒）；我的消息 createdAt <= 此值即「已读」
    @Published var replyingTo: Message?        // 正在回复的消息
    @Published var stickers: [Sticker] = []
    @Published var groupMembers: [GroupMember] = []
    @Published var pinnedMessages: [PinnedMessage] = []
    @Published var loadingEarlier = false
    @Published var reachedStart = false
    @Published var galleryImages: [String]?
    @Published var galleryStart = 0
    @Published var scrollTarget: String?
    @Published var highlightedId: String?
    @Published var forwardTargets: [Conversation] = []
    @Published var editTarget: Message?
    @Published var forwardTarget: Message?
    @Published var closed = false   // 被踢/群解散 → 关闭聊天页
    @Published var background = ""   // 聊天专属背景图 URL（空=无）
    // ── 红包 ──
    @Published var redPacketDetail: RedPacketDetail?   // 非空 = 显示红包详情弹窗
    @Published var claimedAmount: Int?                 // 刚领取到的金额
    @Published var error: String?

    let conversationId: String
    let title: String
    let myId: String
    let isGroup: Bool
    /// 私聊对端 userId(来自 Conversation.otherUser.id)。可靠取对端的首选;
    /// 通话发起用。为空时回退扫历史消息。
    private var peerUserId: String?

    private let repo = ChatRepository.shared
    private let recorder = AudioRecorder.shared
    private let player = AudioPlayerService.shared
    private var cancellables = Set<AnyCancellable>()
    private var lastTypingEmit = Date.distantPast
    private var typingClearTask: Task<Void, Never>?

    init(conversationId: String, title: String, myId: String, isGroup: Bool = false, peerUserId: String? = nil) {
        self.conversationId = conversationId
        self.title = title
        self.myId = myId
        self.isGroup = isGroup
        self.peerUserId = peerUserId

        repo.incomingPublisher
            .sink { [weak self] msg in Task { @MainActor in self?.onIncoming(msg) } }
            .store(in: &cancellables)

        repo.typingPublisher
            .sink { [weak self] e in Task { @MainActor in self?.onTyping(e) } }
            .store(in: &cancellables)

        repo.readPublisher
            .sink { [weak self] e in Task { @MainActor in self?.onRead(e) } }
            .store(in: &cancellables)

        repo.messageDeletedPublisher
            .sink { [weak self] msgId in Task { @MainActor in
                guard let self else { return }
                if let idx = self.messages.firstIndex(where: { $0.id == msgId }) {
                    var recalled = self.messages[idx]
                    recalled.deleted = 1
                    recalled.content = "消息已撤回"
                    recalled.type = "recalled"
                    self.messages[idx] = recalled
                }
            }}
            .store(in: &cancellables)

        repo.reactionPublisher
            .sink { [weak self] (msgId, reactions) in Task { @MainActor in self?.applyReactions(msgId, reactions) } }
            .store(in: &cancellables)

        repo.messageEditedPublisher
            .sink { [weak self] (msgId, content, convId) in Task { @MainActor in self?.applyEdit(msgId, content, convId) } }
            .store(in: &cancellables)

        repo.redPacketClaimedPublisher
            .sink { [weak self] (packetId, _, _) in Task { @MainActor in self?.onRedPacketClaimed(packetId) } }
            .store(in: &cancellables)

        repo.batchDeletedPublisher
            .sink { [weak self] msgIds in Task { @MainActor in
                guard let self else { return }
                let idSet = Set(msgIds)
                self.messages = self.messages.map { msg in
                    guard idSet.contains(msg.id) else { return msg }
                    var recalled = msg
                    recalled.deleted = 1
                    recalled.content = "消息已撤回"
                    recalled.type = "recalled"
                    return recalled
                }
            }}
            .store(in: &cancellables)

        repo.conversationClearedPublisher
            .sink { [weak self] convId in Task { @MainActor in
                guard let self, convId == self.conversationId else { return }
                self.messages.removeAll()
            }}
            .store(in: &cancellables)

        repo.reconnectedPublisher
            .sink { [weak self] in Task { @MainActor in
                guard let self else { return }
                await self.loadHistory()
            }}
            .store(in: &cancellables)

        if isGroup {
            repo.pinChangedPublisher
                .sink { [weak self] convId in Task { @MainActor in if convId == self?.conversationId { await self?.loadPinned() } } }
                .store(in: &cancellables)
            repo.groupGonePublisher
                .sink { [weak self] convId in Task { @MainActor in if convId == self?.conversationId { self?.closed = true } } }
                .store(in: &cancellables)
        }

        repo.joinConversation(conversationId)
        Task { await loadHistory() }
        Task { await loadBackground() }
        if isGroup {
            Task { await loadPinned() }
            Task { await loadGroupMembers() }
        }
    }

    // MARK: - 拍一拍
    /// 拍一拍某人（双击头像）。系统会广播 type='nudge' 消息，经 incomingPublisher 回流入列表。
    func nudge(_ targetId: String) {
        guard targetId != myId else { return }
        repo.nudge(conversationId: conversationId, targetId: targetId)
    }

    /// 解析 nudge 消息为展示文案：「你/X 拍了拍 你/Y」
    func nudgeText(_ msg: Message) -> String {
        guard let data = msg.content.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "拍一拍" }
        let actor = obj["actor"] as? String ?? ""
        let target = obj["target"] as? String ?? ""
        let actorName = actor == myId ? "你" : ((obj["actorName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "某人")
        let targetName = target == myId ? "你" : ((obj["targetName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "某人")
        return "\(actorName) 拍了拍 \(targetName)"
    }

    // MARK: - 聊天背景
    func loadBackground() async {
        if let conv = try? await repo.loadConversations().first(where: { $0.id == conversationId }) {
            if !conv.background.isEmpty { background = conv.background }
            if peerUserId == nil, let pid = conv.peerId { peerUserId = pid }  // 回填对端id,供通话用
        }
    }

    /// 选定图片 → 上传得 URL → 设为本会话背景
    func setBackground(data: Data, fileName: String) {
        Task {
            do {
                let urls = try await MomentRepository.shared.uploadImages([(data: data, name: fileName)])
                guard let url = urls.first, !url.isEmpty else { throw APIError.server(0, "上传失败") }
                try await repo.setConversationBackground(conversationId, background: url)
                background = url
                error = "已设置聊天背景"
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置背景失败" }
        }
    }

    func clearBackground() {
        Task {
            do { try await repo.setConversationBackground(conversationId, background: ""); background = "" }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "清除失败" }
        }
    }

    // MARK: - @提及
    func loadGroupMembers() async {
        if let info = try? await GroupRepository.shared.info(conversationId) {
            groupMembers = info.members.filter { $0.id != myId }
        }
    }

    func appendMention(_ member: GroupMember) {
        input += "@\(member.username) "
    }

    // MARK: - 群置顶消息
    func isPinned(_ msgId: String) -> Bool { pinnedMessages.contains { $0.msgId == msgId } }

    func loadPinned() async {
        pinnedMessages = (try? await repo.pinnedMessages(conversationId: conversationId)) ?? pinnedMessages
    }

    func pinMessage(_ msg: Message) {
        Task {
            do { try await repo.pinMessage(conversationId: conversationId, msgId: msg.id); await loadPinned() }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "置顶失败" }
        }
    }

    func unpinMessage(_ msgId: String) {
        Task {
            do { try await repo.unpinMessage(conversationId: conversationId, msgId: msgId); await loadPinned() }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "取消置顶失败" }
        }
    }

    // MARK: - 表情/贴纸
    func appendEmoji(_ emoji: String) { input += emoji }

    func loadStickers() {
        Task { stickers = (try? await StickerRepository.shared.list()) ?? stickers }
    }

    func sendSticker(_ sticker: Sticker) {
        Task {
            do { let msg = try await StickerRepository.shared.send(conversationId: conversationId, stickerId: sticker.id); appendUnique(msg) }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "发送失败" }
        }
    }

    /// 点击图片：打开本会话所有图片的画廊，定位到该张
    func openImage(_ msg: Message) {
        let imgs = messages.filter { $0.type == "image" }
        galleryImages = imgs.map { MediaUrlResolver.resolve($0.fileUrl) ?? "" }
        galleryStart = imgs.firstIndex { $0.id == msg.id } ?? 0
    }

    /// 点击引用条：滚动到原消息并高亮
    func jumpTo(_ msgId: String) {
        guard messages.contains(where: { $0.id == msgId }) else { return }
        scrollTarget = msgId
        highlightedId = msgId
        Task { try? await Task.sleep(nanoseconds: 1_500_000_000); if highlightedId == msgId { highlightedId = nil } }
    }

    func collectMessage(_ msg: Message) {
        Task {
            do { try await repo.collectMessage(msg.id); error = "已收藏" }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "收藏失败" }
        }
    }

    func collectSticker(_ url: String) {
        Task {
            await StickerRepository.shared.collect(url: url)
            error = "已添加到表情"
            loadStickers()
        }
    }

    // MARK: - 消息操作:回复/撤回/表情回应
    func startReply(_ msg: Message) { replyingTo = msg }
    func cancelReply() { replyingTo = nil }

    func recall(_ msg: Message) {
        Task { await repo.deleteMessage(msg.id) }   // 实时事件移除
    }

    func react(_ msg: Message, emoji: String) {
        Task {
            let reactions = await repo.react(msg.id, emoji: emoji)
            applyReactions(msg.id, reactions)
        }
    }

    private func applyReactions(_ msgId: String, _ reactions: [MessageReaction]) {
        if let idx = messages.firstIndex(where: { $0.id == msgId }) {
            messages[idx].reactions = reactions
        }
    }

    // MARK: - 编辑 / 转发
    private func applyEdit(_ msgId: String, _ content: String, _ convId: String) {
        guard convId == conversationId, let idx = messages.firstIndex(where: { $0.id == msgId }) else { return }
        messages[idx].content = content
        messages[idx].edited = 1
    }

    /// 本人文本消息且 2 分钟内可编辑
    func canEdit(_ msg: Message) -> Bool {
        msg.senderId == myId && msg.type == "text" && (Date().timeIntervalSince1970 - msg.createdAt) <= 120
    }

    func editMessage(_ msg: Message, newText: String) {
        let text = newText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task {
            do {
                try await repo.editMessage(msg.id, content: text)
                if let idx = messages.firstIndex(where: { $0.id == msg.id }) { messages[idx].content = text; messages[idx].edited = 1 }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "编辑失败" }
        }
    }

    func loadForwardTargets() {
        Task { forwardTargets = (try? await repo.loadConversations()) ?? forwardTargets }
    }

    func forward(_ msg: Message, conversationIds: [String]) {
        guard !conversationIds.isEmpty else { return }
        Task {
            do { try await repo.forward(msgId: msg.id, conversationIds: conversationIds); error = "已转发" }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "转发失败" }
        }
    }

    func resolveMediaUrl(_ url: String?) -> String? { MediaUrlResolver.resolve(url) }

    // MARK: - 红包
    /// 解析 red_packet 消息的 content（失败返回 nil）
    func parseRedPacket(_ msg: Message) -> RedPacketContent? {
        guard msg.type == "red_packet", let data = msg.content.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(RedPacketContent.self, from: data)
    }

    func sendRedPacket(totalAmount: Int, totalCount: Int, greeting: String) {
        Task {
            do {
                let resp = try await RedPacketRepository.shared.send(
                    conversationId: conversationId, totalAmount: totalAmount, totalCount: totalCount,
                    greeting: greeting.trimmingCharacters(in: .whitespaces)
                )
                if let msg = resp.message { appendUnique(msg) }   // socket 通常也会广播，appendUnique 去重
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "发送红包失败" }
        }
    }

    /// 点击红包消息 → 拉详情并弹窗
    func openRedPacket(_ msg: Message) {
        guard let packetId = parseRedPacket(msg)?.packetId, !packetId.isEmpty else { return }
        claimedAmount = nil
        Task {
            do { redPacketDetail = try await RedPacketRepository.shared.detail(packetId) }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "打开红包失败" }
        }
    }

    func claimOpenedRedPacket() {
        guard let packetId = redPacketDetail?.id else { return }
        Task {
            do {
                let resp = try await RedPacketRepository.shared.claim(packetId)
                claimedAmount = resp.amount
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "手慢了，红包没抢到" }
            await refreshRedPacketDetail(packetId)
        }
    }

    func closeRedPacket() { redPacketDetail = nil; claimedAmount = nil }

    // MARK: - 音视频通话
    /// 私聊对方 userId：优先用 Conversation.otherUser.id(可靠,对端没发过消息也能拿到);
    /// 回退取历史里第一条非本人消息的发送者。修复"对端未发言时通话按钮无反应"。
    private func peerId() -> String? {
        peerUserId ?? messages.first(where: { $0.senderId != myId })?.senderId
    }

    /// 发起通话；无法确定对方（如无消息）返回 false
    func startCall(video: Bool, callerName: String) -> Bool {
        guard let peer = peerId() else { return false }
        CallManager.shared.startCall(peerId: peer, peerName: title, video: video, callerName: callerName)
        return true
    }

    /// 发起群通话（mesh）。仅群聊有效。
    func startGroupCall(video: Bool) {
        guard isGroup else { return }
        GroupCallManager.shared.start(conversationId: conversationId, video: video)
    }

    private func refreshRedPacketDetail(_ packetId: String) async {
        if let d = try? await RedPacketRepository.shared.detail(packetId), redPacketDetail?.id == packetId {
            redPacketDetail = d
        }
    }

    private func onRedPacketClaimed(_ packetId: String) {
        guard redPacketDetail?.id == packetId else { return }
        Task { await refreshRedPacketDetail(packetId) }
    }

    // MARK: - 历史 / 实时
    func loadHistory() async {
        do {
            messages = try await repo.loadHistory(conversationId)
            reachedStart = messages.count < 50
            markReadLatest()   // 打开会话即标记已读
        } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载消息失败" }
    }

    /// 上滑加载更早消息
    func loadEarlier() {
        guard !loadingEarlier, !reachedStart, let before = messages.first?.createdAt else { return }
        loadingEarlier = true
        Task {
            defer { loadingEarlier = false }
            if let older = try? await repo.loadHistory(conversationId, before: before) {
                let existing = Set(messages.map { $0.id })
                messages = older.filter { !existing.contains($0.id) } + messages
                reachedStart = older.count < 50
            }
        }
    }

    private func onIncoming(_ msg: Message) {
        guard msg.conversationId == conversationId else { return }
        appendUnique(msg)
        if msg.senderId != myId { markReadLatest() }   // 在会话内收到对方消息即已读
    }

    private func onTyping(_ e: TypingEvent) {
        guard e.conversationId == conversationId, e.userId != myId else { return }
        peerTyping = e.isTyping
        typingClearTask?.cancel()
        if e.isTyping {
            typingClearTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 5_000_000_000)   // 5s 兜底隐藏
                await MainActor.run { self?.peerTyping = false }
            }
        }
    }

    private func onRead(_ e: ReadEvent) {
        guard e.conversationId == conversationId, e.userId != myId else { return }
        if e.readAt > peerReadAt { peerReadAt = e.readAt }
    }

    /// 我的消息是否已被对方读过（双勾）
    func isReadByPeer(_ msg: Message) -> Bool {
        msg.senderId == myId && peerReadAt > 0 && msg.createdAt <= peerReadAt
    }

    func markReadLatest() {
        guard let last = messages.last else { return }
        Task { await repo.markRead(conversationId: conversationId, messageId: last.id) }
    }

    /// 输入变化时节流发送 typing
    func userIsTyping() {
        guard !input.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        if Date().timeIntervalSince(lastTypingEmit) > 2 {
            lastTypingEmit = Date()
            repo.emitTyping(conversationId)
        }
    }

    /// 退出聊天：发送 read + stop_typing
    func onLeave() {
        repo.emitStopTyping(conversationId)
        markReadLatest()
    }

    // MARK: - 文本
    func sendText() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        let replyId = replyingTo?.id
        input = ""
        replyingTo = nil
        sending = true
        error = nil
        repo.emitStopTyping(conversationId)
        Task { [weak self] in
            guard let self else { return }
            let result = await repo.sendText(conversationId: conversationId, content: text, replyToId: replyId)
            sending = false
            switch result {
            case .success(let msg): appendUnique(msg)
            case .failure(let err):
                input = text
                error = (err as? LocalizedError)?.errorDescription ?? "发送失败"
            }
        }
    }

    // MARK: - 媒体上传
    func upload(data: Data, fileName: String, mimeType: String, localType: String, preview: UIImage?) {
        let item = PendingUpload(type: localType, name: fileName, previewImage: preview)
        pending.append(item)
        Task { [weak self] in
            guard let self else { return }
            do {
                let msg = try await repo.uploadMedia(conversationId: conversationId, data: data, fileName: fileName, mimeType: mimeType)
                removePending(item.id)
                appendUnique(msg)
            } catch {
                markFailed(item.id)
                self.error = (error as? LocalizedError)?.errorDescription ?? "上传失败"
            }
        }
    }

    // MARK: - 录音
    func startRecording() {
        guard !recording else { return }
        if recorder.start() { recording = true } else { error = "无法开始录音" }
    }

    func stopRecordingAndSend() {
        guard recording else { return }
        recording = false
        guard let url = recorder.stop() else { error = "录音失败"; return }
        Task { [weak self] in
            guard let self else { return }
            guard let data = try? Data(contentsOf: url) else { error = "读取录音失败"; return }
            upload(data: data, fileName: url.lastPathComponent, mimeType: recorder.mimeType, localType: "voice", preview: nil)
        }
    }

    func cancelRecording() {
        recorder.cancel()
        recording = false
    }

    // MARK: - 播放 / 移除失败项
    func playVoice(_ message: Message) {
        if let url = resolveMediaUrl(message.fileUrl) { player.play(urlString: url) }
    }

    func dismissFailed(_ id: String) {
        pending.removeAll { $0.id == id }
    }

    // MARK: - helpers
    private func appendUnique(_ msg: Message) {
        guard !messages.contains(where: { $0.id == msg.id }) else { return }
        messages.append(msg)
    }

    private func removePending(_ id: String) { pending.removeAll { $0.id == id } }

    private func markFailed(_ id: String) {
        if let idx = pending.firstIndex(where: { $0.id == id }) { pending[idx].failed = true }
    }
}
