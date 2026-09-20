import Foundation
import Combine

@MainActor
final class ContactsViewModel: ObservableObject {
    @Published var contacts: [Contact] = []
    @Published var onlineIds: Set<String> = []
    @Published var loading = false
    @Published var requestCount = 0
    @Published var error: String?
    @Published var aiBots: [AiAssistant] = [] // AI 助手入口列表（/api/config）
    @Published var showAiBots = false         // 通讯录「AI 助手」展开态

    private let socialGuard = SocialReadGuard()
    private var socialSubscription: AnyCancellable?
    private let repo = ContactRepository.shared
    private var cancellables = Set<AnyCancellable>()

    init() {
        socialSubscription = SocketService.shared.socialState.dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in Task { @MainActor in self?.contacts = []; await self?.refresh() } }

        repo.friendEventsPublisher
            .sink { [weak self] in Task { @MainActor in await self?.refresh() } }
            .store(in: &cancellables)
        repo.presencePublisher
            .sink { [weak self] (userId, online) in
                Task { @MainActor in
                    if online { self?.onlineIds.insert(userId) } else { self?.onlineIds.remove(userId) }
                }
            }
            .store(in: &cancellables)
    }

    func refresh() async {
        guard let stamp = socialGuard.begin() else { return }
        loading = true
        error = nil
        do {
            let fresh = try await repo.contacts()
            guard socialGuard.current(stamp) else { return }
            contacts = fresh
            onlineIds = Set(contacts.filter { $0.status == "online" }.map { $0.id })
        }
        catch { guard socialGuard.current(stamp) else { return }; self.error = (error as? LocalizedError)?.errorDescription ?? "加载联系人失败" }
        loading = false
        let count = try? await repo.receivedRequests().count
        let bots = try? await repo.fetchAiAssistants()
        guard socialGuard.current(stamp) else { return }
        requestCount = count ?? requestCount
        aiBots = bots ?? aiBots // 拉取失败静默保持旧值（隐藏分组）
    }

    /// 发起与 AI 助手的私聊，成功返回可用于导航的 Conversation
    func startAiChat(_ bot: AiAssistant) async -> Conversation? {
        do {
            let id = try await repo.createPrivate(userId: bot.id)
            return Conversation(id: id, type: "private", name: bot.name.isEmpty ? bot.username : bot.name)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "发起聊天失败"
            return nil
        }
    }

    /// 发起私聊，成功返回可用于导航的 Conversation
    func startPrivateChat(_ contact: Contact) async -> Conversation? {
        do {
            let id = try await repo.createPrivate(userId: contact.id)
            return Conversation(id: id, type: "private", name: contact.displayName)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "发起聊天失败"
            return nil
        }
    }

    // ── 好友管理：备注/删除/拉黑 ──
    func setRemark(_ contact: Contact, remark: String) {
        let trimmed = remark.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                try await repo.setRemark(contact.id, remark: trimmed)
                await refresh()
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置备注失败" }
        }
    }

    func deleteContact(_ contact: Contact) {
        Task {
            do { try await repo.deleteContact(contact.id); await refresh() }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "删除好友失败" }
        }
    }

    func block(_ contact: Contact) {
        Task {
            do { try await repo.block(contact.id); await refresh() }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "拉黑失败" }
        }
    }
}
