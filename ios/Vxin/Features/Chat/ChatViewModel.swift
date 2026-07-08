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
    // 失败重试所需的原始数据
    var data: Data? = nil
    var mimeType: String = ""
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
    // ── 会话内消息搜索 ──
    @Published var searchActive = false
    @Published var searchQuery = ""
    @Published var searching = false
    @Published var searchResults: [Message] = []
    // ── 多选（批量撤回/删除）──
    @Published var multiSelect = false
    @Published var selectedIds: Set<String> = []
    @Published var editTarget: Message?
    @Published var forwardTarget: Message?
    @Published var closed = false   // 被踢/群解散 → 关闭聊天页
    @Published var background = ""   // 聊天专属背景图 URL（空=无）
    // ── 红包 ──
    @Published var redPacketDetail: RedPacketDetail?   // 非空 = 显示红包详情弹窗
    @Published var claimedAmount: Int?                 // 刚领取到的金额
    @Published var sendingRedPacket = false            // 发红包进行中，防连点重复扣币
    @Published var claimingRedPacket = false           // 抢红包进行中，防连点重复领取
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
        self.input = DraftStore.shared.get(conversationId)   // 恢复未发送草稿(对齐微信/Web/Android)

        // 输入变化即持久化草稿(去抖，避免每字符都写盘)
        $input
            .dropFirst()
            .debounce(for: .milliseconds(300), scheduler: RunLoop.main)
            .sink { [weak self] text in
                guard let self else { return }
                DraftStore.shared.set(self.conversationId, text)
            }
            .store(in: &cancellables)

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
                self?.messages.removeAll { $0.id == msgId }
            }}
            .store(in: &cancellables)

        repo.messageVanishedPublisher
            .sink { [weak self] msgId in Task { @MainActor in
                self?.messages.removeAll { $0.id == msgId }
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
                self.messages.removeAll { idSet.contains($0.id) }
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
            // 被 @ 提及：仅提示当前会话，复用 error 承载的一次性 toast
            repo.mentionedPublisher
                .sink { [weak self] (convId, _) in Task { @MainActor in
                    guard let self, convId == self.conversationId else { return }
                    self.error = "有人在群里 @ 了你"
                }}
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

    // ── 会话内消息搜索 ──
    private var searchTask: Task<Void, Never>?

    func openSearch() { searchActive = true }
    func closeSearch() {
        searchTask?.cancel()
        searchActive = false; searchQuery = ""; searchResults = []; searching = false
    }

    func onSearchQueryChange(_ q: String) {
        searchQuery = q
        searchTask?.cancel()
        let kw = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !kw.isEmpty else { searchResults = []; searching = false; return }
        searching = true
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)   // 去抖
            guard let self, !Task.isCancelled else { return }
            do {
                let list = try await self.repo.searchInConversation(self.conversationId, q: kw)
                if !Task.isCancelled { self.searchResults = list; self.searching = false }
            } catch {
                if !Task.isCancelled { self.searchResults = []; self.searching = false }
            }
        }
    }

    // ── 多选（批量撤回/删除）──
    func enterMultiSelect(_ first: Message) { multiSelect = true; selectedIds = [first.id] }
    func exitMultiSelect() { multiSelect = false; selectedIds = [] }
    func toggleSelect(_ msg: Message) {
        if selectedIds.contains(msg.id) { selectedIds.remove(msg.id) } else { selectedIds.insert(msg.id) }
    }
    func batchDeleteSelected() {
        let ids = Array(selectedIds)
        guard !ids.isEmpty else { return }
        Task {
            do {
                try await repo.batchDelete(conversationId: conversationId, msgIds: ids)
                messages.removeAll { ids.contains($0.id) }   // 乐观移除(广播亦会移除，幂等)
                multiSelect = false; selectedIds = []
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "批量删除失败"
            }
        }
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

    func vanish(_ msg: Message) {
        Task { await repo.vanishMessage(msg.id) }   // 实时事件 message_vanished 移除，无痕
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

    /// 本人文本消息，不限时间可编辑
    func canEdit(_ msg: Message) -> Bool {
        msg.senderId == myId && msg.type == "text"
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

    func parseContactCard(_ msg: Message) -> ContactCardContent? {
        guard msg.type == "contact_card" || msg.type == "contact",
              let data = msg.content.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ContactCardContent.self, from: data)
    }

    func sendRedPacket(totalAmount: Int, totalCount: Int, greeting: String) {
        guard !sendingRedPacket else { return }   // 资金操作：进行中禁止重复触发，防快速双击重复扣币
        sendingRedPacket = true
        Task {
            defer { sendingRedPacket = false }
            do {
                let resp = try await RedPacketRepository.shared.send(
                    conversationId: conversationId, totalAmount: totalAmount, totalCount: totalCount,
                    greeting: greeting.trimmingCharacters(in: .whitespaces)
                )
                if let msg = resp.message { appendUnique(msg) }   // socket 通常也会广播，appendUnique 去重
                Haptics.notify(.success)   // 发红包成功的满足感反馈
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "发送红包失败"
                Haptics.notify(.error)
            }
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
        guard !claimingRedPacket else { return }   // 进行中禁止重复触发，防快速双击重复领取
        claimingRedPacket = true
        Task {
            defer { claimingRedPacket = false }
            do {
                let resp = try await RedPacketRepository.shared.claim(packetId)
                claimedAmount = resp.amount
                Haptics.notify(.success)   // 抢到红包的满足感
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "手慢了，红包没抢到"
                Haptics.notify(.warning)   // 手慢了，轻提示
            }
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
            let list = try await repo.loadHistory(conversationId)
            // 合并本地待发件箱：上次发送失败且未成功的文本消息，切走/重启/重连后仍在。
            // 服务端可能已幂等落库(id==outbox 的 clientMsgId) → 已成功,剔除并清理。
            let serverIds = Set(list.map { $0.id })
            let pending = OutboxStore.shared.load(conversationId)
            let stillPending = pending.filter { !serverIds.contains($0.id) }
            for done in pending where !stillPending.contains(where: { $0.id == done.id }) {
                OutboxStore.shared.remove(conversationId, done.id)
            }
            messages = (list + stillPending).sorted { $0.createdAt < $1.createdAt }
            reachedStart = list.count < 50
            markReadLatest()   // 打开会话即标记已读
            healFailedMessages()   // 连线且有失败气泡 → 进会话/重连自动重发一次
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

    // 用户是否在消息列表底部附近(由 View 更新)。看历史时收到新消息不立即标已读，
    // 避免对方过早看到「已读」；滚回底部后再补标(对齐微信/web/安卓)。
    private var atBottom = true

    func setAtBottom(_ value: Bool) {
        let was = atBottom
        atBottom = value
        if value && !was { markReadLatest() }   // 刚滚回底部：补标在底看到的最新消息
    }

    private func onIncoming(_ msg: Message) {
        guard msg.conversationId == conversationId else { return }
        claimOrAppend(msg)
        // 仅在底部附近才即时标已读；看历史时留给「N 条新消息」提示，滚回底再标
        if msg.senderId != myId && atBottom { markReadLatest() }
    }

    /// 广播消息落地：若它是本端某条乐观气泡的回声（按 client_msg_id 认领），就替换那条
    /// 乐观气泡（并清出待发件箱），避免「乐观 + 广播」双显；否则按 id 去重后追加。
    /// 关键：即便发送时 ack 丢失(乐观转 failed)，只要广播带回同一 client_msg_id 也能自愈为成功。
    private func claimOrAppend(_ msg: Message) {
        if let cid = msg.clientMsgId,
           let idx = messages.firstIndex(where: { $0.clientMsgId == cid || $0.id == cid }) {
            OutboxStore.shared.remove(conversationId, messages[idx].id)
            // 若真实消息已因其它路径存在，先去重再替换
            messages.removeAll { $0.id == msg.id && $0.clientMsgId != cid }
            if let i = messages.firstIndex(where: { $0.clientMsgId == cid || $0.id == cid }) { messages[i] = msg }
            return
        }
        appendUnique(msg)
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
        guard !text.isEmpty else { return }
        Haptics.impact(.light)   // 发送轻震，给一点触觉反馈
        let replyId = replyingTo?.id
        // 幂等键：本次发送固定一个 clientMsgId；失败重发复用它，后端据 (sender_id, client_msg_id)
        // 去重，弱网重发/socket 重连补发都不产生重复气泡。同时作乐观消息的临时 id。
        let clientMsgId = UUID().uuidString
        let replySnap: ReplyPreview? = replyingTo.map {
            ReplyPreview(id: $0.id, type: $0.type, content: $0.content, senderName: $0.senderName)
        }
        // 立刻渲染「发送中」乐观气泡（对齐 Web/Android），输入框即时清空，不再回填打断输入
        let optimistic = Message(optimisticText: clientMsgId, conversationId: conversationId,
                                 senderId: myId, content: text, replyToId: replyId,
                                 replyTo: replySnap, clientMsgId: clientMsgId)
        input = ""
        DraftStore.shared.clear(conversationId)
        replyingTo = nil
        error = nil
        messages.append(optimistic)
        repo.emitStopTyping(conversationId)
        dispatchSend(optimistic)
    }

    /// 发送一条乐观消息并处理成功/失败落地；失败入待发件箱，可自动/手动重发。
    private func dispatchSend(_ optimistic: Message) {
        let cid = optimistic.clientMsgId ?? optimistic.id
        // 标记发送中（重发场景从 failed 回到 sending）
        setLocalStatus(optimistic.id, LocalMsgStatus.sending)
        Task { [weak self] in
            guard let self else { return }
            let result = await repo.sendText(conversationId: optimistic.conversationId,
                                             content: optimistic.content,
                                             replyToId: optimistic.replyToId, clientMsgId: cid)
            switch result {
            case .success(let real):
                OutboxStore.shared.remove(conversationId, optimistic.id)
                // 用真实消息替换乐观气泡（保留位置）；若广播已先到则去重
                messages.removeAll { $0.id == real.id }
                if let idx = messages.firstIndex(where: { $0.id == optimistic.id }) { messages[idx] = real }
                else { appendUnique(real) }
            case .failure:
                setLocalStatus(optimistic.id, LocalMsgStatus.failed)
                var failed = optimistic
                failed.localStatus = LocalMsgStatus.failed
                OutboxStore.shared.upsert(conversationId, failed)
            }
        }
    }

    /// 手动/自动重发一条失败的文本气泡
    func retryMessage(_ id: String) {
        guard let msg = messages.first(where: { $0.id == id }), msg.localStatus == LocalMsgStatus.failed else { return }
        dispatchSend(msg)
    }

    private func setLocalStatus(_ id: String, _ status: String?) {
        if let idx = messages.firstIndex(where: { $0.id == id }) { messages[idx].localStatus = status }
    }

    /// 自动自愈：把当前所有 failed 文本气泡错峰重发（连线时调用，对齐 Web/Android）
    func healFailedMessages() {
        guard repo.isSocketConnected else { return }
        let failed = messages.filter { $0.localStatus == LocalMsgStatus.failed }
        guard !failed.isEmpty else { return }
        Task { [weak self] in
            guard let self else { return }
            for (i, m) in failed.enumerated() {
                try? await Task.sleep(nanoseconds: UInt64(i) * 120_000_000)   // 错峰 120ms
                if let cur = messages.first(where: { $0.id == m.id }), cur.localStatus == LocalMsgStatus.failed {
                    dispatchSend(cur)
                }
            }
        }
    }

    // MARK: - 媒体上传
    func upload(data: Data, fileName: String, mimeType: String, localType: String, preview: UIImage?) {
        // 保存原始数据，失败后可一键重传
        let item = PendingUpload(type: localType, name: fileName, previewImage: preview, data: data, mimeType: mimeType)
        pending.append(item)
        runUpload(item)
    }

    /// 执行/重试上传（失败后可重复调用）
    private func runUpload(_ item: PendingUpload) {
        Task { [weak self] in
            guard let self else { return }
            guard let data = item.data else { return }
            do {
                let msg = try await repo.uploadMedia(conversationId: conversationId, data: data, fileName: item.name, mimeType: item.mimeType)
                removePending(item.id)
                appendUnique(msg)
            } catch {
                markFailed(item.id)
                self.error = (error as? LocalizedError)?.errorDescription ?? "上传失败"
            }
        }
    }

    /// 重试失败的上传项
    func retryPending(_ id: String) {
        guard let idx = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[idx].failed = false
        error = nil
        runUpload(pending[idx])
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
