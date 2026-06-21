import Foundation
import Combine

@MainActor
final class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
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

        Task { await refresh() }
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
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "加载会话失败"
        }
        loading = false
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
