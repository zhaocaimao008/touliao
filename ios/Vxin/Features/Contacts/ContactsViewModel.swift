import Foundation
import Combine

@MainActor
final class ContactsViewModel: ObservableObject {
    @Published var contacts: [Contact] = []
    @Published var loading = false
    @Published var requestCount = 0
    @Published var error: String?

    private let repo = ContactRepository.shared
    private var cancellables = Set<AnyCancellable>()

    init() {
        repo.friendEventsPublisher
            .sink { [weak self] in Task { @MainActor in await self?.refresh() } }
            .store(in: &cancellables)
    }

    func refresh() async {
        loading = true
        error = nil
        do { contacts = try await repo.contacts() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载联系人失败" }
        loading = false
        requestCount = (try? await repo.receivedRequests().count) ?? requestCount
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
                if let idx = contacts.firstIndex(where: { $0.id == contact.id }) { contacts[idx].remark = trimmed.isEmpty ? nil : trimmed }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "设置备注失败" }
        }
    }

    func deleteContact(_ contact: Contact) {
        Task {
            do { try await repo.deleteContact(contact.id); contacts.removeAll { $0.id == contact.id } }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "删除好友失败" }
        }
    }

    func block(_ contact: Contact) {
        Task {
            do { try await repo.block(contact.id); contacts.removeAll { $0.id == contact.id }; error = "已加入黑名单" }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "拉黑失败" }
        }
    }
}
