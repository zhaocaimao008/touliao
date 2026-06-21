import Foundation

@MainActor
final class GroupInfoViewModel: ObservableObject {
    @Published var info: GroupInfo?
    @Published var loading = true
    @Published var left = false
    @Published var error: String?

    let conversationId: String
    private let repo = GroupRepository.shared

    init(conversationId: String) {
        self.conversationId = conversationId
    }

    func refresh() async {
        loading = true
        do { info = try await repo.info(conversationId) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载群信息失败" }
        loading = false
    }

    func rename(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        Task {
            do {
                try await repo.rename(conversationId, name: trimmed)
                info?.name = trimmed
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "改名失败" }
        }
    }

    func kick(_ member: GroupMember) {
        Task {
            do {
                try await repo.kick(conversationId, userId: member.id)
                info?.members.removeAll { $0.id == member.id }
            } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "移除失败" }
        }
    }

    func leave() {
        Task {
            do { try await repo.leave(conversationId); left = true }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? "退群失败" }
        }
    }
}
