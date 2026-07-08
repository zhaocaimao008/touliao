import Foundation
import Combine

@MainActor
final class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var drafts: [String: String] = [:]   // convId → 未发送草稿(用于「[草稿]」前缀)
    @Published var loading = false
    @Published var error: String?
    @Published var socketStatus: SocketStatus = .disconnected

    private let repo = ChatRepository.shared
    private let myId: String
    private var cancellables = Set<AnyCancellable>()

    init(myId: String) {
        self.myId = myId

        repo.statusPublisher
            .sink { [weak self] status in
                Task { @MainActor in
                    self?.socketStatus = status
                    // 断线重连成功后整表重拉，纠正离线期间差异
                    if status == .connected { await self?.refresh() }
                }
            }
            .store(in: &cancellables)

        repo.incomingPublisher
            .sink { [weak self] msg in
                Task { @MainActor in self?.apply(msg) }
            }
            .store(in: &cancellables)

        // 本人已读某会话（本端或其他端）→ 清零未读
        repo.unreadClearedPublisher
            .sink { [weak self] convId in
                Task { @MainActor in self?.clearUnread(convId) }
            }
            .store(in: &cancellables)

        // 被拉入群聊/新会话 → 整表刷新
        repo.newConversationPublisher
            .sink { [weak self] _ in
                Task { @MainActor in await self?.refresh() }
            }
            .store(in: &cancellables)

        // 被踢/群解散 → 从列表移除
        repo.groupGonePublisher
            .sink { [weak self] convId in Task { @MainActor in self?.conversations.removeAll { $0.id == convId } } }
            .store(in: &cancellables)
        // 群资料变更 → 刷新
        repo.groupChangedPublisher
            .sink { [weak self] _ in Task { @MainActor in await self?.refresh() } }
            .store(in: &cancellables)

        Task { await refresh() }
    }

    // ── 会话操作：置顶/免打扰/清空 ──
    func togglePin(_ conv: Conversation) {
        let pinned = conv.pinned != 1
        Task {
            do { try await repo.setConversationPinned(conv.id, pinned: pinned); await refresh() }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "操作失败" }
        }
    }

    func toggleMute(_ conv: Conversation) {
        let muted = conv.muted != 1
        Task {
            do {
                try await repo.setConversationMuted(conv.id, muted: muted)
                if let idx = conversations.firstIndex(where: { $0.id == conv.id }) { conversations[idx].muted = muted ? 1 : 0 }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "操作失败" }
        }
    }

    func clearMessages(_ conv: Conversation) {
        Task {
            do {
                try await repo.clearMessages(conv.id)
                if let idx = conversations.firstIndex(where: { $0.id == conv.id }) {
                    conversations[idx].lastMessage = nil
                    conversations[idx].lastMessageType = nil
                }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "清空失败" }
        }
    }

    /// 标为已读：先就地清零未读，再通知服务端（多端同步）
    func markRead(_ conv: Conversation) {
        guard conv.unreadCount > 0 else { return }
        clearUnread(conv.id)
        Task { await repo.markRead(conversationId: conv.id, messageId: nil) }
    }

    private func clearUnread(_ conversationId: String) {
        guard let idx = conversations.firstIndex(where: { $0.id == conversationId }),
              conversations[idx].unreadCount != 0 else { return }
        conversations[idx].unreadCount = 0
    }

    func refresh() async {
        loading = true
        error = nil
        do {
            conversations = try await repo.loadConversations()
            refreshDrafts()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "加载会话失败"
        }
        loading = false
    }

    /// 从聊天页返回时刷新草稿映射(草稿在聊天页写入 UserDefaults，列表页读取)
    func refreshDrafts() {
        var map: [String: String] = [:]
        for conv in conversations {
            let d = DraftStore.shared.get(conv.id)
            if !d.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { map[conv.id] = d }
        }
        drafts = map
    }

    /// 新消息到达：就地更新对应会话的最后消息/时间/未读，并置顶
    private func apply(_ msg: Message) {
        guard let idx = conversations.firstIndex(where: { $0.id == msg.conversationId }) else {
            return  // 新会话暂忽略，下次刷新/重连可见
        }
        var conv = conversations.remove(at: idx)
        conv.lastMessage = msg.content
        conv.lastMessageType = msg.type
        conv.lastTime = msg.createdAt
        if msg.senderId != myId { conv.unreadCount += 1 }
        conversations.insert(conv, at: 0)
    }
}
