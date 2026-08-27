import Foundation
import Combine

@MainActor
final class FriendRequestsViewModel: ObservableObject {
    @Published var requests: [FriendRequest] = []
    @Published var sent: [SentRequest] = []
    @Published var loading = false
    @Published var handling: Set<String> = []
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
        do { requests = try await repo.receivedRequests() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "加载失败" }
        sent = (try? await repo.sentRequests()) ?? sent
        loading = false
    }

    func handle(_ req: FriendRequest, accept: Bool) {
        guard !handling.contains(req.id) else { return }
        handling.insert(req.id)
        Task {
            do {
                try await repo.handleRequest(id: req.id, accept: accept)
                requests.removeAll { $0.id == req.id }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "操作失败"
            }
            handling.remove(req.id)
        }
    }
}
