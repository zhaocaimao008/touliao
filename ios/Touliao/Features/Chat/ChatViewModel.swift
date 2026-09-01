import Foundation
import Combine
import UIKit
import UserNotifications

/// 上传中的占位项（成功后被真实 Message 替换），对齐 Android PendingUpload
struct PendingUpload: Identifiable {
    let id: String = UUID().uuidString
    let type: String                // image | voice | video | file
    let name: String
    let previewImage: UIImage?       // 图片本地预览
    var failed: Bool = false
    // 失败重试所需的原始数据（图片/语音/文件走内存 Data；视频走磁盘文件見 fileURL，二选一）
    var data: Data? = nil
    var mimeType: String = ""
    // 2026-08-29 视频上传新增：大文件走磁盘流式上传，不进内存；上传进度 0...1。
    var fileURL: URL? = nil
    var progress: Double = 0
    // 2026-08-29新增：语音时长(秒)，随上传携带，供气泡显示真实时长（与 Android 对齐）。
    var duration: Int = 0
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
    @Published var canManageGroup = false          // 我是群主/管理员（决定能否 @所有人）
    @Published var groupAnnouncement = ""          // 群公告（非空时聊天页顶部置顶轮播）
    @Published var pinnedMessages: [PinnedMessage] = []
    @Published var loadingEarlier = false
    @Published var reachedStart = false
    @Published var galleryImages: [String]?
    @Published var galleryStart = 0
    // 2026-08-29 统一附件系统：视频/PDF/其他文件 App 内预览态（互斥，同时只开一个）
    @Published var videoPreview: (url: String, name: String?)?
    @Published var pdfPreview: (url: String, name: String?)?
    @Published var fileDetails: (url: String, name: String?, size: String?)?
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
    @Published var burnAfter = 0     // 阅后即焚秒数（0=关闭）
    // 后台功能开关（群通话按钮显隐）默认开启，拉取失败不误伤
    @Published var groupVoiceCallEnabled = true
    @Published var groupVideoCallEnabled = true
    // ── 红包 ──
    @Published var redPacketDetail: RedPacketDetail?   // 非空 = 显示红包详情弹窗
    @Published var claimedAmount: Int?                 // 刚领取到的金额
    @Published var sendingRedPacket = false            // 发红包进行中，防连点重复扣币
    @Published var claimingRedPacket = false           // 抢红包进行中，防连点重复领取
    // ── 定时消息 ──
    @Published var sendingSchedule = false             // 定时消息提交中，防连点
    @Published var scheduledList: [ScheduledMessage] = []   // 定时消息列表（pending+sent+cancelled）
    @Published var loadingScheduledList = false
    // ── 转账 ──
    @Published var sendingTransfer = false             // 转账进行中，防连点重复扣币
    // ── 聊天记录导出 ──
    @Published var exportingChat = false               // 导出进行中
    @Published var exportContent: String?              // 非空 = 已拿到导出文本，View 写文件并分享后清空
    // ── 语音转文字 ──
    @Published var transcribingIds: Set<String> = []   // 正在转写的语音消息 id（气泡显示「转写中…」）
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
                guard let self else { return }
                self.removeMessage(msgId)   // 移除 + 引用块无痕摘除
                MsgCacheStore.shared.remove(self.conversationId, msgId)   // 撤回/删除 → 缓存同步移除
            }}
            .store(in: &cancellables)

        repo.messageRecalledPublisher
            .sink { [weak self] msgId in Task { @MainActor in
                guard let self else { return }
                self.removeMessage(msgId)   // 撤回新协议，与 message_deleted 同语义，幂等
                MsgCacheStore.shared.remove(self.conversationId, msgId)
            }}
            .store(in: &cancellables)

        repo.messageDeletedForMePublisher
            .sink { [weak self] msgId in Task { @MainActor in
                guard let self else { return }
                self.removeMessage(msgId)   // 个人删除（仅当前账号），多设备同步
                MsgCacheStore.shared.remove(self.conversationId, msgId)
            }}
            .store(in: &cancellables)

        repo.messageVanishedPublisher
            .sink { [weak self] msgId in Task { @MainActor in
                guard let self else { return }
                self.removeMessage(msgId)
                MsgCacheStore.shared.remove(self.conversationId, msgId)
            }}
            .store(in: &cancellables)

        repo.reactionPublisher
            .sink { [weak self] (msgId, reactions) in Task { @MainActor in self?.applyReactions(msgId, reactions) } }
            .store(in: &cancellables)

        repo.messageEditedPublisher
            .sink { [weak self] (msgId, content, convId) in Task { @MainActor in
                self?.applyEdit(msgId, content, convId)
                if convId == self?.conversationId { self?.persistCache() }   // 编辑 → 按 id 覆写落盘
            } }
            .store(in: &cancellables)

        repo.redPacketClaimedPublisher
            .sink { [weak self] (packetId, _, _) in Task { @MainActor in self?.onRedPacketClaimed(packetId) } }
            .store(in: &cancellables)

        repo.batchDeletedPublisher
            .sink { [weak self] msgIds in Task { @MainActor in
                guard let self else { return }
                let idSet = Set(msgIds)
                self.messages.removeAll { idSet.contains($0.id) }
                for id in msgIds { MsgCacheStore.shared.remove(self.conversationId, id) }
            }}
            .store(in: &cancellables)

        repo.conversationClearedPublisher
            .sink { [weak self] convId in Task { @MainActor in
                guard let self, convId == self.conversationId else { return }
                self.messages.removeAll()
                MsgCacheStore.shared.clear(self.conversationId)   // 清空聊天记录 → 缓存整会话清除（隐私红线）
            }}
            .store(in: &cancellables)

        repo.reconnectedPublisher
            .sink { [weak self] in Task { @MainActor in
                guard let self else { return }
                await self.catchUp()
                self.healFailedMessages(announce: true)
            }}
            .store(in: &cancellables)

        repo.syncAvailablePublisher
            .filter { [conversationId] in $0 == conversationId }
            .sink { [weak self] _ in Task { @MainActor in await self?.catchUp() } }
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
            // 后台开关实时广播 → 即时显隐群通话按钮，无需刷新
            repo.configUpdatedPublisher
                .sink { [weak self] (voice, video) in Task { @MainActor in
                    self?.groupVoiceCallEnabled = voice
                    self?.groupVideoCallEnabled = video
                }}
                .store(in: &cancellables)
        }

        repo.joinConversation(conversationId)
        primeFromCache()                     // 首屏占位：先渲染离线缓存，随后 loadHistory 拉真相源覆盖
        Task { await loadHistory(); await catchUp() }
        Task { await loadBackground() }
        if isGroup {
            Task { await loadPinned() }
            Task { await loadGroupMembers() }
            Task { await loadCallFeatures() }   // 拉后台开关，同步群通话按钮显隐
        }
    }

    /// 拉取后台功能开关（GET /api/config），同步群语音/群视频按钮显隐。失败保持默认开启，不误伤。
    func loadCallFeatures() async {
        struct CallConfig: Decodable {
            struct Features: Decodable { let groupVoiceCall: Bool?; let groupVideoCall: Bool? }
            let features: Features?
        }
        guard let cfg: CallConfig = try? await APIClient.shared.send("api/config", authorized: false) else { return }
        await MainActor.run {
            self.groupVoiceCallEnabled = cfg.features?.groupVoiceCall ?? true
            self.groupVideoCallEnabled = cfg.features?.groupVideoCall ?? true
        }
    }

    // MARK: - 拍一拍
    /// 拍一拍某人（双击头像）。系统会广播 type='nudge' 消息，经 incomingPublisher 回流入列表。
    func nudge(_ targetId: String) {
        guard targetId != myId else { return }
        repo.nudge(conversationId: conversationId, targetId: targetId)
    }

    /// 解析 call 消息为展示文案:主叫/被叫文案不同,status: completed|canceled|rejected|missed
    func callText(_ msg: Message) -> String {
        guard let data = msg.content.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "通话结束" }
        let status = obj["status"] as? String ?? ""
        let isCaller = (obj["callerId"] as? String) == myId
        let duration = obj["duration"] as? Int ?? 0
        let kind = (obj["callType"] as? String) == "video" ? "视频通话" : "语音通话"
        switch status {
        case "completed":
            let d = max(0, duration)
            let dur: String
            if d >= 60 {
                let m = d / 60, s = d % 60
                dur = s > 0 ? "\(m)分 \(s)秒" : "\(m)分钟"
            } else {
                dur = "\(d) 秒"
            }
            return "\(kind) \(dur)"
        case "canceled": return isCaller ? "已取消" : "未接来电"
        case "rejected": return isCaller ? "对方已拒绝" : "已拒绝"
        case "missed":   return isCaller ? "对方无应答" : "未接来电"
        default:         return (obj["text"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "通话结束"
        }
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
            burnAfter = conv.burnAfter
            if peerUserId == nil, let pid = conv.peerId { peerUserId = pid }  // 回填对端id,供通话用
        }
    }

    /// 设置阅后即焚（seconds=0 关闭）。
    func setBurnAfter(_ seconds: Int) {
        Task {
            do {
                try await repo.setBurnAfter(conversationId, seconds: seconds)
                burnAfter = seconds
                error = seconds > 0 ? "已开启阅后即焚" : "已关闭阅后即焚"
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置失败" }
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
            canManageGroup = info.canManage
            groupAnnouncement = info.announcement
        }
    }

    func appendMention(_ member: GroupMember) {
        input += "@\(member.username) "
    }

    /// @所有人（仅群主/管理员可用，UI 已按 canManageGroup 控制入口）。
    func appendMentionAll() {
        input += "@所有人 "
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

    /// 统一附件打开入口：视频→App内播放器；PDF→App内PDFKit预览；其余(旧版doc/ppt/压缩包等)
    /// →文件详情页(仅下载/分享/用其他应用打开)。此前直接 UIApplication.shared.open() 跳
    /// Safari，是本次要修的"点视频/文件跳浏览器"根因。
    func openAttachment(_ msg: Message) {
        guard let resolved = MediaUrlResolver.resolve(msg.fileUrl) else { return }
        if msg.type == "video" {
            videoPreview = (resolved, msg.content)
            return
        }
        let ext = (msg.content as NSString).pathExtension.lowercased()
        if ext == "pdf" {
            pdfPreview = (resolved, msg.content)
        } else {
            fileDetails = (resolved, msg.content, humanFileSize(msg.fileSize))
        }
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

    /// 上传自定义表情（从相册选图）。
    func uploadSticker(data: Data, fileName: String) {
        Task {
            do {
                _ = try await StickerRepository.shared.upload(data: data, fileName: fileName)
                error = "表情已添加"
                loadStickers()
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "上传失败" }
        }
    }

    // MARK: - 消息操作:回复/撤回/表情回应
    func startReply(_ msg: Message) { replyingTo = msg }
    func cancelReply() { replyingTo = nil }

    func recall(_ msg: Message) {
        let prev = messages
        // 乐观移除(对齐 Web): 撤回立即从列表消失; 失败则恢复
        removeMessage(msg.id)
        Task {
            do {
                try await repo.deleteMessage(msg.id)
                MsgCacheStore.shared.remove(conversationId, msg.id)
            } catch {
                messages = prev   // 失败恢复
                self.error = (error as? LocalizedError)?.errorDescription ?? "撤回失败"
            }
        }   // 实时事件 message_deleted 幂等兜底(乐观已移除,重复事件无副作用)
    }

    func vanish(_ msg: Message) {
        Task { await repo.vanishMessage(msg.id) }   // 实时事件 message_vanished 移除，无痕
    }

    /// 个人删除（per-user tombstone，仅当前账号）：乐观移除 + 失败恢复，
    /// 多设备经 message_deleted_for_me 同步
    func deleteForMe(_ msg: Message) {
        let prev = messages
        removeMessage(msg.id)
        Task {
            let ok = await repo.deleteForMeMessage(msg.id)
            if ok {
                MsgCacheStore.shared.remove(conversationId, msg.id)
            } else {
                messages = prev   // 失败恢复
                error = "删除失败，请重试"
            }
        }
    }

    /// 移除目标消息 + 引用它的消息引用块无痕摘除(replyTo.deleted=1 →
    /// 消息视图见 deleted 不渲染引用条)。幂等：目标不存在时仅摘除引用。
    private func removeMessage(_ msgId: String) {
        messages.removeAll { $0.id == msgId }
        for i in messages.indices where messages[i].replyTo?.id == msgId {
            messages[i].replyTo?.deleted = 1
        }
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
                persistCache()   // 本端编辑 → 覆写落盘
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

    // MARK: - 转账
    /// 解析 transfer 消息的 content（失败返回 nil）
    func parseTransfer(_ msg: Message) -> TransferContent? {
        guard msg.type == "transfer", let data = msg.content.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(TransferContent.self, from: data)
    }

    /// 私聊对方 userId（供转账对话框使用；群聊为 nil）
    func transferPeerId() -> String? { peerId() }

    /// 向对方转账 amount 金币（1~20000），note 为备注（≤50 字）。成功后消息列表追加 transfer 气泡。
    func sendTransfer(toUserId: String, amount: Int, note: String) {
        guard !sendingTransfer else { return }   // 资金操作：进行中禁止重复触发，防快速双击重复扣币
        sendingTransfer = true
        Task {
            defer { sendingTransfer = false }
            do {
                let resp = try await WalletRepository.shared.transfer(
                    toUserId: toUserId, amount: amount, note: note.trimmingCharacters(in: .whitespaces)
                )
                if let msg = resp.message { appendUnique(msg) }   // socket 通常也会广播，appendUnique 去重
                Haptics.notify(.success)   // 转账成功反馈
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "转账失败"
                Haptics.notify(.error)
            }
        }
    }

    // MARK: - 定时消息

    /// 创建定时消息：content + sendAt（Unix秒，前端已校验≥15分钟≤30天，后端二次校验）
    func scheduleMessage(content: String, sendAt: Date) {
        guard !sendingSchedule else { return }
        sendingSchedule = true
        Task {
            defer { sendingSchedule = false }
            do {
                _ = try await repo.scheduleMessage(
                    conversationId: conversationId,
                    content: content.trimmingCharacters(in: .whitespacesAndNewlines),
                    sendAt: sendAt.timeIntervalSince1970
                )
                error = "定时消息已设置，到点自动发送"
                Haptics.notify(.success)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "定时发送失败"
                Haptics.notify(.error)
            }
        }
    }

    /// 加载本会话定时消息列表
    func loadScheduledMessages() {
        guard !loadingScheduledList else { return }
        loadingScheduledList = true
        Task {
            defer { loadingScheduledList = false }
            // 全量拉取后按本会话过滤
            if let all = try? await repo.scheduledMessages() {
                scheduledList = all.filter { $0.conversationId == conversationId }
            }
        }
    }

    /// 取消定时消息
    func cancelScheduledMessage(_ item: ScheduledMessage) {
        Task {
            do {
                try await repo.cancelScheduledMessage(item.id)
                scheduledList.removeAll { $0.id == item.id }
                error = "已取消定时消息"
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "取消失败"
            }
        }
    }

    // MARK: - 聊天记录导出
    /// 拉取当前会话全量聊天记录文本，存入 exportContent；View 监听到非空后写文件并分享，随后调 clearExportContent()。
    func exportChat() {
        guard !exportingChat else { return }
        exportingChat = true
        Task {
            defer { exportingChat = false }
            do { exportContent = try await repo.exportConversation(conversationId) }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "导出失败" }
        }
    }

    /// View 写完文件/分享后调用，清除一次性 exportContent 避免重复触发。
    func clearExportContent() { exportContent = nil }

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

    // MARK: - 离线消息历史缓存（首屏占位；非真相源，语义对齐 Web msgCache.js）

    /// 首屏占位：进入会话立即渲染上次落盘的离线历史，避免白屏等 loadHistory。
    /// 缓存非真相源——loadHistory 成功后以服务端结果 mergeById 覆盖并重新落盘。
    /// 阅后即焚会话不读缓存（该会话本就不落盘）；已存在 outbox 待发消息也一并合并。
    private func primeFromCache() {
        guard !conversationId.isEmpty, burnAfter == 0 else { return }
        let cached = MsgCacheStore.shared.load(conversationId)
        guard !cached.isEmpty, messages.isEmpty else { return }   // 已被 loadHistory 抢先则不覆盖
        let pending = OutboxStore.shared.load(conversationId)
        messages = (cached + pending).sorted { $0.createdAt < $1.createdAt }
    }

    /// 将当前「已确认历史消息」落盘（内部 normalize：去乐观/待发、去重、截断 50）。
    /// 阅后即焚会话不落盘（隐私红线）——并顺手清掉可能残留的缓存。
    private func persistCache() {
        guard !conversationId.isEmpty else { return }
        guard burnAfter == 0 else { MsgCacheStore.shared.clear(conversationId); return }
        MsgCacheStore.shared.save(conversationId, messages)
    }

    // MARK: - 历史 / 实时
    func loadHistory(announceHeal: Bool = false) async {
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
            if SyncCursorStore.shared.load(accountId: myId, conversationId: conversationId) == 0,
               let maximum = list.map(\.serverSequence).max(), maximum > 0 {
                SyncCursorStore.shared.save(accountId: myId, conversationId: conversationId, sequence: maximum)
            }
            reachedStart = list.count < 50
            // 离线缓存：server 覆盖旧缓存（含已编辑/已删同步），落盘最近 50。
            if burnAfter == 0 {
                let merged = MsgCacheStore.mergeById(MsgCacheStore.shared.load(conversationId), list)
                MsgCacheStore.shared.save(conversationId, merged)
            } else {
                MsgCacheStore.shared.clear(conversationId)   // 焚毁会话不落盘
            }
            markReadLatest()   // 打开会话即标记已读
            try? await UNUserNotificationCenter.current().setBadgeCount(0)   // 打开会话即清零角标，避免残留
            healFailedMessages(announce: announceHeal)   // 连线且有失败气泡 → 进会话/重连自动重发
        } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载消息失败" }
    }

    private var syncRunning = false
    private var syncRequested = false

    func catchUp() async {
        guard !conversationId.isEmpty, !myId.isEmpty else { return }
        if syncRunning { syncRequested = true; return }
        syncRunning = true
        defer { syncRunning = false }
        repeat {
          syncRequested = false
          var cursor = SyncCursorStore.shared.load(accountId: myId, conversationId: conversationId)
          while true {
            guard let page = try? await repo.sync(conversationId, cursor: cursor), page.nextCursor >= cursor else { return }
            for event in page.messages.sorted(by: { $0.serverSequence < $1.serverSequence }) {
                switch event.eventType {
                case "message_created":
                    if let message = event.message { claimOrAppend(message) }
                case "message_edited":
                    if let index = messages.firstIndex(where: { $0.id == event.messageId }) {
                        messages[index].content = event.payload["content"] ?? messages[index].content
                        messages[index].edited = 1
                    }
                case "message_recalled", "message_deleted_for_me", "message_vanished":
                    messages.removeAll { $0.id == event.messageId }
                default: break
                }
            }
            messages.sort {
                let lhsSequence = $0.serverSequence > 0 ? $0.serverSequence : Int64.max
                let rhsSequence = $1.serverSequence > 0 ? $1.serverSequence : Int64.max
                if lhsSequence != rhsSequence { return lhsSequence < rhsSequence }
                if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
                return $0.id < $1.id
            }
            SyncCursorStore.shared.save(accountId: myId, conversationId: conversationId, sequence: page.nextCursor)
            if !page.hasMore || page.nextCursor == cursor { break }
            cursor = page.nextCursor
          }
        } while syncRequested
        persistCache()
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
        persistCache()   // 收到真实 socket 新消息 → 追加后落盘（截断 50）
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

    /// 我的消息是否已被对方读过（双勾）。优先信服务端 history 接口按 peerLastReadAt 算好的
    /// msg.read（覆盖"重新打开会话，对方离线期间已读的历史消息"这类 peerReadAt 还没被实时
    /// 事件更新到的场景），不够再退回 peerReadAt（同一会话内收到实时 message_read 事件）。
    func isReadByPeer(_ msg: Message) -> Bool {
        guard msg.senderId == myId else { return false }
        return msg.read || (peerReadAt > 0 && msg.createdAt <= peerReadAt)
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

    /// 自动自愈：把当前所有 failed 文本气泡错峰重发（连线时调用，对齐 Web/Android）。
    /// - Parameter announce: true 时轻量安抚一次（网络恢复场景），进会话静默不打扰。
    func healFailedMessages(announce: Bool = false) {
        guard repo.isSocketConnected else { return }
        let failed = messages.filter { $0.localStatus == LocalMsgStatus.failed }
        guard !failed.isEmpty else { return }
        if announce { error = "网络已恢复，正在重发 \(failed.count) 条消息" }
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
    func upload(data: Data, fileName: String, mimeType: String, localType: String, preview: UIImage?, duration: Int = 0) {
        // 保存原始数据，失败后可一键重传
        let item = PendingUpload(type: localType, name: fileName, previewImage: preview, data: data, mimeType: mimeType, duration: duration)
        pending.append(item)
        runUpload(item)
    }

    /// 2026-08-29 新增：视频上传入口。走磁盘流式上传(不整体读进内存)，独立于上面 upload(data:)。
    /// fileURL 指向 PickedVideoFile 已拷贝到投聊自己 tmp 目录的稳定文件，上传成功/彻底放弃后清理。
    func uploadVideo(fileURL: URL, fileName: String, mimeType: String, preview: UIImage?) {
        let item = PendingUpload(type: "video", name: fileName, previewImage: preview, mimeType: mimeType, fileURL: fileURL)
        pending.append(item)
        runUpload(item)
    }

    /// 执行/重试上传（失败后可重复调用）
    private func runUpload(_ item: PendingUpload) {
        Task { [weak self] in
            guard let self else { return }
            do {
                let msg: Message
                if let fileURL = item.fileURL {
                    msg = try await repo.uploadMediaFile(
                        conversationId: conversationId, fileURL: fileURL, fileName: item.name, mimeType: item.mimeType,
                        onProgress: { [weak self] frac in
                            Task { @MainActor [weak self] in self?.updateProgress(item.id, frac) }
                        }
                    )
                    PickedVideoCleanup.removeFile(fileURL)
                } else {
                    guard let data = item.data else { return }
                    msg = try await repo.uploadMedia(conversationId: conversationId, data: data, fileName: item.name, mimeType: item.mimeType, duration: item.duration)
                }
                removePending(item.id)
                appendUnique(msg)
            } catch {
                markFailed(item.id)
                self.error = (error as? LocalizedError)?.errorDescription ?? "上传失败"
            }
        }
    }

    private func updateProgress(_ id: String, _ frac: Double) {
        guard let idx = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[idx].progress = frac
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
            upload(data: data, fileName: url.lastPathComponent, mimeType: recorder.mimeType, localType: "voice", preview: nil, duration: recorder.lastDurationSeconds)
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

    // MARK: - 语音转文字
    /// 语音消息转文字。幂等由后端管理（已转写直接返回缓存）；成功后把 transcript 写回消息并落盘。
    /// ASR 不可用后端返回 503 → toast「转写服务暂不可用」；其他失败 toast 错误信息；不显示假数据。
    func transcribeVoice(_ msg: Message) {
        // 已有转写结果或正在转写 → 不重复请求
        guard msg.transcript?.isEmpty ?? true else { return }
        guard !transcribingIds.contains(msg.id) else { return }
        transcribingIds.insert(msg.id)
        Task { [weak self] in
            guard let self else { return }
            defer { self.transcribingIds.remove(msg.id) }
            do {
                let resp = try await self.repo.transcribe(msg.id)
                if let idx = self.messages.firstIndex(where: { $0.id == msg.id }) {
                    self.messages[idx].transcript = resp.text
                }
                self.persistCache()   // 转写结果随消息落盘，下次进入直接显示
            } catch APIError.server(503, _) {
                self.error = "转写服务暂不可用"
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "转文字失败"
            }
        }
    }

    /// 某条语音消息是否正在转写中（供气泡显示「转写中…」）
    func isTranscribing(_ msgId: String) -> Bool { transcribingIds.contains(msgId) }

    func dismissFailed(_ id: String) {
        if let item = pending.first(where: { $0.id == id }), let fileURL = item.fileURL {
            PickedVideoCleanup.removeFile(fileURL)
        }
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
