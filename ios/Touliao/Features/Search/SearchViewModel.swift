import Foundation

@MainActor
final class SearchViewModel: ObservableObject {
    @Published var query = "" { didSet { scheduleSearch() } }
    // F5 搜索筛选（对齐 Web GlobalSearch / Android SearchFilters）：类型/时间/发送人，变化即重新搜索
    @Published var typeFilter = "" { didSet { scheduleSearch() } }
    @Published var timeRange = "" { didSet { scheduleSearch() } }
    @Published var senderId = "" { didSet { scheduleSearch() } }
    @Published var loading = false
    @Published var results: [SearchResult] = []
    @Published var searched = false
    @Published var error: String?
    /// 发送人筛选选项：从已搜到的结果聚合（对齐 Web senderOptions——无额外接口，成本最低）
    @Published var senderOptions: [(id: String, name: String)] = []

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
            // 仅筛选激活时带 type/from/to/senderId（对齐 Web buildMessageSearchParams）
            let filters = buildSearchFilterParams(type: typeFilter, timeRange: timeRange, senderId: senderId)
            let found = try await repo.search(q, filters: filters)
            results = found
            searched = true
            rebuildSenderOptions(from: found)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "搜索失败"
        }
        loading = false
    }

    /// 结果变化后聚合发送人选项（按 id 去重，取第一个非空名字，按名字排序）；
    /// 当前选中的发送人不在新结果里时清掉选择（避免挂着查不出任何结果的过滤器）。
    private func rebuildSenderOptions(from found: [SearchResult]) {
        var byId: [String: String] = [:]
        for m in found where !m.senderId.isEmpty {
            let existing = byId[m.senderId] ?? ""
            if existing.isEmpty { byId[m.senderId] = m.senderName }
        }
        senderOptions = byId.map { (id: $0.key, name: $0.value) }.sorted { $0.name < $1.name }
        if !senderId.isEmpty && !byId.keys.contains(senderId) {
            senderId = ""
        }
    }
}
