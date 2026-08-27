import Foundation

@MainActor
final class CreateGroupViewModel: ObservableObject {
    @Published var contacts: [Contact] = []
    @Published var selected: Set<String> = []
    @Published var name = ""
    @Published var loading = false
    @Published var creating = false
    @Published var error: String?

    private let repo = ContactRepository.shared

    var canCreate: Bool { !selected.isEmpty && !creating }

    func load() async {
        loading = true
        do { contacts = try await repo.contacts() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载联系人失败" }
        loading = false
    }

    func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    /// 创建群聊，成功返回可导航的 Conversation
    func create() async -> Conversation? {
        guard canCreate else { return nil }
        let groupName = name.trimmingCharacters(in: .whitespaces).isEmpty
            ? String(contacts.filter { selected.contains($0.id) }.map { $0.displayName }.joined(separator: "、").prefix(20))
            : name.trimmingCharacters(in: .whitespaces)
        creating = true
        error = nil
        defer { creating = false }
        do {
            let id = try await repo.createGroup(name: groupName, memberIds: Array(selected))
            return Conversation(id: id, type: "group", name: groupName)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "创建群聊失败"
            return nil
        }
    }
}
