import Foundation

@MainActor
final class AddFriendViewModel: ObservableObject {
    @Published var query = ""
    @Published var searching = false
    @Published var results: [SearchUser] = []
    @Published var sentIds: Set<String> = []
    @Published var message: String?
    @Published var searched = false

    private let repo = ContactRepository.shared

    func search() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !searching else { return }
        searching = true
        message = nil
        Task {
            do {
                results = try await repo.search(q)
                searched = true
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "搜索失败"
            }
            searching = false
        }
    }

    func sendRequest(_ user: SearchUser) {
        Task {
            do {
                let resp = try await repo.sendFriendRequest(toId: user.id)
                sentIds.insert(user.id)
                message = (resp.autoAccepted == true) ? "已添加为好友" : "好友申请已发送"
            } catch {
                message = (error as? LocalizedError)?.errorDescription ?? "发送失败"
            }
        }
    }
}
