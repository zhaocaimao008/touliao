import Foundation

@MainActor
final class InviteMembersViewModel: ObservableObject {
    @Published var candidates: [Contact] = []
    @Published var selected: Set<String> = []
    @Published var loading = true
    @Published var inviting = false
    @Published var done = false
    @Published var error: String?

    let conversationId: String
    private let groupRepo = GroupRepository.shared
    private let contactRepo = ContactRepository.shared

    init(conversationId: String) {
        self.conversationId = conversationId
    }

    func load() async {
        loading = true
        do {
            let contacts = try await contactRepo.contacts()
            let memberIds = Set((try await groupRepo.info(conversationId)).members.map { $0.id })
            candidates = contacts.filter { !memberIds.contains($0.id) }
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败"
        }
        loading = false
    }

    func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    func invite() {
        guard !selected.isEmpty, !inviting else { return }
        inviting = true; error = nil
        Task {
            do { try await groupRepo.invite(conversationId, userIds: Array(selected)); done = true }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "邀请失败" }
            inviting = false
        }
    }
}
