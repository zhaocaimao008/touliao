import Foundation

@MainActor
final class ContactsViewModel: ObservableObject {
    @Published var contacts: [Contact] = []
    @Published var loading = false
    @Published var requestCount = 0
    @Published var error: String?

    private let repo = ContactRepository.shared

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
}
