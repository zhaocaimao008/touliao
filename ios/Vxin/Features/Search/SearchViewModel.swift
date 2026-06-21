import Foundation

@MainActor
final class SearchViewModel: ObservableObject {
    @Published var query = "" { didSet { scheduleSearch() } }
    @Published var loading = false
    @Published var results: [SearchResult] = []
    @Published var searched = false
    @Published var error: String?

    private let repo = SearchRepository.shared
    private var searchTask: Task<Void, Never>?

    private func scheduleSearch() {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else {
            results = []; searched = false; loading = false
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)   // 防抖 300ms
            if Task.isCancelled { return }
            await runSearch(q)
        }
    }

    private func runSearch(_ q: String) async {
        loading = true; error = nil
        do {
            results = try await repo.search(q)
            searched = true
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "搜索失败"
        }
        loading = false
    }
}
